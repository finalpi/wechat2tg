/* eslint-disable @typescript-eslint/no-var-requires -- CommonJS test runner. */
const test = require('node:test'),assert = require('node:assert/strict')
const http = require('node:http'),{once} = require('node:events'),{Telegraf} = require('telegraf')
const fs = require('node:fs'),path = require('node:path'),os = require('node:os')
const {fetchMomentsPage,parseMomentsPage,momentsPhotoURL} = require('../dist/service/WechatMoments')
const {MomentsArchive,momentsDay} = require('../dist/service/MomentsArchive')
const {syncMoments} = require('../dist/service/MomentsSync')
const {MomentsTelegram} = require('../dist/service/MomentsTelegram')

const contact = {id:'wx_friend',name:'朋友 <甲>'}
const mode = {owner:7,account:'wx_me',baseURL:'https://example.invalid/api'}
const archiveScope = JSON.stringify([mode.owner,mode.account])
const first = '15059483964339720707',second = '15059483964339720601'
const tip = '朋友仅展示最近三天的朋友圈'
const record = (id = first,target = contact.id)=>({Id:Number(id),Username:target,Nickname:contact.name,LikeCount:2,CommentCount:1,
  ObjectDesc:{buffer:`<TimelineObject><id>${id}</id><username>${target}</username><createTime>1795230384</createTime><contentDesc>上行&#x0A;&lt;b&gt;&amp; [旺柴]</contentDesc><ContentObject><mediaList>
  <media><type>2</type><url>http://shmmsns.qpic.cn/mmsns/example/0</url><thumb>https://shmmsns.qpic.cn/mmsns/example/150</thumb></media>
  <media><type>2</type><url>http://localhost/mmsns/unsafe/0</url></media>
  <media><type>6</type><url>https://example.invalid/video</url></media>
  </mediaList></ContentObject></TimelineObject>`}})
const page = (records,ret = 2004,retTip = tip)=>({Code:0,Success:true,Data:{BaseResponse:{ret},FristPageMd5:'950aa948298138cf',ObjectList:records,RetTips:[retTip]}})
const finalIds = [first,second,'15059483964339720500','15059483964339720399']
const finalRecords = finalIds.map((id,index)=>({...record(id),ObjectDesc:{buffer:`<TimelineObject>
  <id><![CDATA[${id}]]></id><username><![CDATA[${contact.id}]]></username><createTime><![CDATA[1795230384]]></createTime>
  <contentDesc><![CDATA[样例动态 ${index + 1}\n[旺柴]]]></contentDesc><ContentObject><mediaList><media>
  <type><![CDATA[${index === 2 ? '6' : '2'}]]></type><url><![CDATA[http://szmmsns.qpic.cn/mmsns/example/0]]></url>
  <thumb><![CDATA[http://szmmsns.qpic.cn/mmsns/example/150]]></thumb></media></mediaList></ContentObject></TimelineObject>`}}))
const finalPage = page(finalRecords,207,'')
Object.assign(finalPage.Data,{ObjectCount:4,ContinueId:[0]})

async function archiveFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'moments-archive-')),file = path.join(directory,'moments.db')
  let archive = new MomentsArchive(file)
  t.after(async()=>{await archive.close();fs.rmSync(directory,{recursive:true,force:true})})
  return {get archive() {return archive},async restart() {await archive.close();archive = new MomentsArchive(file)}}
}

test('GetDetail reads visible posts despite 2004 with a privacy tip, preserves uint64 IDs, and filters malformed data',()=>{
  const records = [record(),record(),record(second,'wrong_author'),{...record(second),DeleteFlag:1},
    {...record(second),ObjectDesc:{buffer:'<!DOCTYPE TimelineObject><TimelineObject/>'}}]
  const result = parseMomentsPage(page(records),contact.id)
  assert.equal(result.tip,tip)
  assert.equal(result.next,first)
  assert.equal(result.posts.length,1)
  assert.equal(result.posts[0].text,'上行\n<b>& [旺柴]')
  assert.deepEqual(result.posts[0].photos,[{original:'https://shmmsns.qpic.cn/mmsns/example/0',thumbnail:'https://shmmsns.qpic.cn/mmsns/example/150'}])
  assert.equal(result.posts[0].otherMedia,true)
  assert.deepEqual(parseMomentsPage(page([record(),record(second)]),contact.id,first).posts.map(p=>p.id),[second])
  assert.equal(parseMomentsPage(page([record()]),contact.id,first).next,undefined,'stop when the server repeats a page')
  assert.throws(()=>parseMomentsPage(page([],500),contact.id),/读取失败/)
  assert.equal(parseMomentsPage(page([]),contact.id).tip,tip)
  assert.deepEqual(parseMomentsPage(page([],2004,''),contact.id).posts,[],'empty 2004 without a tip is not a send failure')
  for(const url of ['http://127.0.0.1/mmsns/img/0','https://x.qpic.cn.evil.example/mmsns/img/0',
    'https://shmmsns.qpic.cn:8080/mmsns/img/0','https://user@shmmsns.qpic.cn/mmsns/img/0','https://shmmsns.qpic.cn/unknown/img/0'])assert.equal(momentsPhotoURL(url),undefined)
})

test('GetDetail ret 207 is a successful terminal page with exact uint64 IDs and CDATA',()=>{
  const result = parseMomentsPage(finalPage,contact.id)
  assert.deepEqual(result.posts.map(post=>post.id),finalIds)
  assert.equal(result.posts[0].text,'样例动态 1\n[旺柴]')
  assert.equal(result.posts[0].photos[0].original,'https://szmmsns.qpic.cn/mmsns/example/0')
  assert.equal(result.posts[2].otherMedia,true)
  assert.equal(result.next,undefined)
  assert.equal(parseMomentsPage(page([],207,''),contact.id).next,undefined)
  assert.deepEqual(parseMomentsPage(finalPage,contact.id,second).posts.map(post=>post.id),finalIds.slice(2))
  assert.throws(()=>parseMomentsPage({...finalPage,Success:false},contact.id),/读取失败/)
})

test('the actual HTTP contract sends a numeric Maxid without precision loss and does not follow redirects',async t=>{
  const requests = []
  const server = http.createServer(async(req,res)=>{
    const chunks = [];for await(const chunk of req)chunks.push(chunk)
    requests.push({url:req.url,body:Buffer.concat(chunks).toString()})
    if(requests.length === 3){res.writeHead(307,{location:'/must-not-follow'});res.end();return}
    res.setHeader('content-type','application/json')
    res.end(JSON.stringify(requests.length === 1 ? page([record()]) : page([record(second)],207,'')))
  })
  server.listen(0,'127.0.0.1');await once(server,'listening')
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))})
  const session = {...mode,baseURL:`http://127.0.0.1:${server.address().port}/api/`}
  const view = await fetchMomentsPage(session,contact.id)
  assert.equal(view.next,first)
  const last = await fetchMomentsPage(session,contact.id,view.next,view.md5)
  assert.deepEqual(last.posts.map(post=>post.id),[second])
  assert.equal(last.next,undefined)
  assert.deepEqual(requests.slice(0,2),[
    {url:'/api/FriendCircle/GetDetail',body:'{"Wxid":"wx_me","Towxid":"wx_friend","Fristpagemd5":"","Maxid":0}'},
    {url:'/api/FriendCircle/GetDetail',body:`{"Wxid":"wx_me","Towxid":"wx_friend","Fristpagemd5":"950aa948298138cf","Maxid":${first}}`},
  ])
  await assert.rejects(fetchMomentsPage(session,contact.id),/上游/)
  await assert.rejects(fetchMomentsPage(session,contact.id,'1e10'),/无效/)
  assert.equal(requests.length,3)
})

test('saving a ret 207 response archives all its visible posts with one upstream request',async t=>{
  const f = await archiveFixture(t),calls = []
  await f.archive.rememberContact(archiveScope,contact)
  const done = await syncMoments(f.archive,mode,contact,'all',async()=>true,{pageDelay:0,
    fetchPage:async(_session,target,cursor)=>{calls.push(cursor);return parseMomentsPage(finalPage,target,cursor)},photos:async()=>[]})
  assert.equal(done.complete,true)
  assert.equal(done.saved,4)
  assert.equal(await f.archive.count(archiveScope,contact.id),4)
  assert.deepEqual(calls,[undefined])
})

test('archive is opt-in per account and contact, persists images, stops without deletion, and deduplicates',async t=>{
  const f = await archiveFixture(t),post = parseMomentsPage(page([record()]),contact.id).posts[0]
  await f.archive.save(archiveScope,post,[Buffer.from('picture')])
  assert.equal(await f.archive.count(archiveScope,contact.id),0)
  await f.archive.setEnabled(archiveScope,contact,true)
  await f.archive.save(archiveScope,post,[Buffer.from('picture')])
  await f.archive.save(archiveScope,post,[Buffer.from('different')])
  await f.archive.save('another account',post,[Buffer.from('other')])
  await f.archive.save(archiveScope,{...post,target:'another friend'},[])
  await f.restart()
  assert.equal(await f.archive.count(archiveScope,contact.id),1)
  assert.equal(await f.archive.count('another account',contact.id),0)
  assert.equal(await f.archive.count(archiveScope,'another friend'),0)
  const entry = await f.archive.at(archiveScope,contact.id,0)
  assert.equal(entry.post.id,first)
  assert.deepEqual(entry.post.photos,[],'archived snapshots do not keep remote URLs')
  assert.equal(entry.images[0].toString(),'picture')
  await f.archive.setEnabled(archiveScope,contact,false)
  await f.archive.save(archiveScope,{...post,id:second},[])
  assert.equal(await f.archive.count(archiveScope,contact.id),1)
  await f.archive.clear(archiveScope,contact.id)
  assert.equal(await f.archive.count(archiveScope,contact.id),0)
})

function telegramFixture(archive,{rich,richError,upstream,pictures = [Buffer.from('one'),Buffer.from('two')]} = {}) {
  const replies = [],albums = [],calls = [],answers = [],native = [],rejections = [],groupReplies = []
  let session = {...mode},changeOnFetch,bound = contact
  const controller = new MomentsTelegram({session:async()=>session,archive,boundContact:async()=>bound,
    fetchPage:async(_session,who,cursor)=>{
      calls.push([who,cursor]);if(changeOnFetch)changeOnFetch()
      return parseMomentsPage(upstream ?? page([record(cursor ? second : first,who)]),who,cursor)
    },
    photos:async()=>pictures,
    ...(rich === undefined ? {} : {rich:{allowed:()=>rich,rejected:chat=>rejections.push(chat)}}),
  })
  const ctx = {chat:{id:7,type:'private'},from:{id:7},async reply(text,extra) {replies.push({text,extra})},
    async answerCbQuery(text) {answers.push(text)},telegram:{async sendMessage(chat,text,extra) {replies.push({chat,text,extra})},
      async sendMediaGroup(chat,media,extra) {albums.push({chat,media,extra})},
      async callApi(method,payload) {native.push({method,payload});if(richError)throw richError}}}
  const buttons = ()=>replies.at(-1)?.extra?.reply_markup?.inline_keyboard.flat() || []
  const key = (action)=>{
    const button = buttons().find(item=>item.callback_data.endsWith(`:${action}`))
    assert.ok(button,`missing ${action}`)
    return button.callback_data.split(':')[1]
  }
  const group = {...ctx,chat:{type:'supergroup',id:-10},message:{message_thread_id:42},async reply(text,extra){groupReplies.push({text,extra})}}
  const groupCallback = {...group,message:undefined,callbackQuery:{message:{message_thread_id:42}}}
  return {controller,ctx,group,groupCallback,groupReplies,replies,albums,calls,answers,native,rejections,buttons,key,tap:async(action)=>controller.callback(ctx,key(action),action),
    setSession:value=>{session = value},setBound:value=>{bound = value},onFetch:fn=>{changeOnFetch = fn}}
}

test('ret 207 lets the owner browse every returned post in the bound topic without an extra upstream fetch',async t=>{
  const a = await archiveFixture(t),f = telegramFixture(a.archive,{upstream:finalPage})
  await f.controller.command(f.group)
  for(const id of [1,2,3,4]) {
    const payload = f.native.at(-1).payload
    assert.equal(payload.chat_id,-10)
    assert.equal(payload.message_thread_id,42)
    assert.ok(JSON.parse(payload.rich_message).blocks.some(block=>block.text === `样例动态 ${id}\n[旺柴]`))
    const next = payload.reply_markup.inline_keyboard.flat().find(button=>button.callback_data.endsWith(':next'))
    if(id < 4) {
      assert.equal(next.text,'下一条')
      await f.controller.callback(f.groupCallback,next.callback_data.split(':')[1],'next')
    } else assert.equal(next,undefined)
  }
  assert.deepEqual(f.calls,[[contact.id,undefined]])
})

test('Telegram displays escaped rich text, protects albums, paginates, and offers an independently configurable archive',async t=>{
  const a = await archiveFixture(t),f = telegramFixture(a.archive,{rich:false})
  await f.controller.command(f.ctx)
  assert.match(f.replies.at(-1).text,/<blockquote>上行\n&lt;b&gt;&amp; \[旺柴\]<\/blockquote>/)
  assert.match(f.replies.at(-1).text,/仅展示最近三天/)
  assert.equal(f.replies.at(-1).extra.protect_content,true)
  assert.equal(f.albums[0].extra.protect_content,true)
  assert.deepEqual(f.calls,[[contact.id,undefined]])
  assert.equal(await a.archive.count(archiveScope,contact.id),0)
  await f.tap('next')
  assert.deepEqual(f.calls.at(-1),[contact.id,first])
  await f.tap('settings');await f.tap('on');await f.tap('online')
  assert.equal(await a.archive.count(archiveScope,contact.id),1)
  await f.tap('archive')
  assert.match(f.replies.at(-1).text,/本地归档/)
  assert.equal(f.albums.at(-1).media.length,2)
  await f.tap('settings');await f.tap('off')
  assert.equal(await a.archive.count(archiveScope,contact.id),1)
  await f.tap('clear');await f.tap('delete')
  assert.equal(await a.archive.count(archiveScope,contact.id),0)
})

test('Telegraf sends native rich Moments in the bound topic with JSON text or multipart images',async t=>{
  const a = await archiveFixture(t),sent = []
  const server = http.createServer(async(req,res)=>{
    const chunks = [];for await(const chunk of req)chunks.push(chunk)
    sent.push({method:req.url.split('/').pop(),type:req.headers['content-type'],body:Buffer.concat(chunks).toString()})
    res.setHeader('content-type','application/json')
    res.end(JSON.stringify({ok:true,result:{message_id:10,date:1,chat:{id:-10,type:'supergroup'}}}))
  })
  server.listen(0,'127.0.0.1');await once(server,'listening')
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))})
  const bot = new Telegraf('123:synthetic-moments',{telegram:{apiRoot:`http://127.0.0.1:${server.address().port}`}})
  for(const pictures of [[],[Buffer.from('one'),Buffer.from('two')]]) {
    const f = telegramFixture(a.archive,{pictures})
    await f.controller.command({...f.group,telegram:bot.telegram})
  }
  assert.deepEqual(sent.map(req=>req.method),['sendRichMessage','sendRichMessage'])
  const json = JSON.parse(sent[0].body)
  assert.equal(json.chat_id,-10)
  assert.equal(json.message_thread_id,42)
  assert.equal(json.rich_message.blocks[0].text.type,'bold')
  const multipart = sent[1]
  const boundary = /boundary=([^;]+)/.exec(multipart.type)[1]
  const fields = Object.fromEntries(multipart.body.split(`--${boundary}`).flatMap(part=>{
    const match = /name="([^"]+)"/.exec(part)
    return match ? [[match[1],part.slice(part.indexOf('\r\n\r\n') + 4).replace(/\r\n$/,'')]] : []
  }))
  assert.equal(fields.chat_id,'-10')
  assert.equal(fields.message_thread_id,'42')
  assert.equal(fields.protect_content,'true')
  const collage = JSON.parse(fields.rich_message).blocks.find(block=>block.type === 'collage')
  assert.deepEqual(collage.blocks.map(block=>block.photo.media),['attach://moment_0','attach://moment_1'])
  assert.equal(fields.moment_0,'one')
  assert.equal(fields.moment_1,'two')
  assert.ok(JSON.parse(fields.reply_markup).inline_keyboard.length)
})

test('native rich Moments embeds images and falls back only after a definite rejection',async t=>{
  const a = await archiveFixture(t)
  const rich = telegramFixture(a.archive)
  await rich.controller.command(rich.group)
  assert.equal(rich.replies.length,0)
  assert.equal(rich.albums.length,0)
  const [{method,payload}] = rich.native
  assert.equal(method,'sendRichMessage')
  assert.equal(payload.protect_content,true)
  assert.equal(payload.chat_id,-10)
  assert.equal(payload.message_thread_id,42)
  const {blocks,skip_entity_detection:skip} = JSON.parse(payload.rich_message)
  assert.equal(skip,true)
  assert.equal(blocks[0].text.type,'bold')
  assert.equal(blocks.find(block=>block.type === 'collage').blocks[0].photo.media,'attach://moment_0')
  assert.equal(payload.moment_0.source.toString(),'one')
  assert.match(payload.reply_markup.inline_keyboard.flat()[0].callback_data,/:next$/)
  const unsupported = telegramFixture(a.archive,{rich:true,richError:{response:{error_code:404,description:'Not Found'}}})
  await unsupported.controller.command(unsupported.group)
  assert.deepEqual(unsupported.rejections,[-10])
  assert.equal(unsupported.albums.length,1)
  assert.equal(unsupported.albums[0].chat,-10)
  assert.equal(unsupported.albums[0].extra.message_thread_id,42)
  assert.match(unsupported.replies[0].text,/<b>/)
  assert.equal(unsupported.replies[0].chat,-10)
  const uncertain = telegramFixture(a.archive,{rich:true,richError:new Error('network timeout')})
  await uncertain.controller.command(uncertain.group)
  assert.equal(uncertain.albums.length,0)
  assert.equal(uncertain.native.length,1)
  assert.match(uncertain.replies[0].text,/暂时失败/)
})

test('/moments uses only the binding; owner-only callbacks stay in the original topic',async t=>{
  const a = await archiveFixture(t),f = telegramFixture(a.archive,{rich:false})
  f.setBound(undefined)
  await f.controller.command(f.ctx)
  assert.equal(f.calls.length,0)
  assert.match(f.replies.at(-1).text,/未绑定单个微信联系人/)
  assert.equal(f.buttons().length,0)
  f.setBound(contact)
  await f.controller.command(f.group)
  assert.deepEqual(f.calls,[[contact.id,undefined]])
  assert.equal(f.replies.at(-1).chat,-10)
  assert.equal(f.replies.at(-1).extra.message_thread_id,42)
  assert.equal(f.albums.at(-1).chat,-10)
  assert.ok(f.buttons().every(button=>!button.text.includes('选择联系人')))
  const key = f.key('next')
  await f.controller.callback(f.ctx,key,'next')
  await f.controller.callback({...f.groupCallback,callbackQuery:{message:{message_thread_id:43}}},key,'next')
  await f.controller.callback({...f.groupCallback,from:{id:8}},key,'next')
  await f.controller.command({...f.group,from:{id:8}})
  assert.equal(f.calls.length,1)
  assert.match(f.answers.at(-1),/原会话或联系人绑定已变更/)
  await f.controller.callback(f.groupCallback,key,'next')
  assert.deepEqual(f.calls.at(-1),[contact.id,first])
  assert.equal(f.replies.at(-1).extra.message_thread_id,42)
  f.onFetch(()=>f.setBound({id:'different_contact',name:'另一人'}))
  const before = f.replies.length
  await f.controller.command(f.group)
  assert.equal(f.replies.length,before,'changing the binding during lookup drops the result')
  assert.deepEqual(f.groupReplies,[])
})

test('a visibility-limited empty feed and a genuine upstream error get different messages in the current topic',async t=>{
  const a = await archiveFixture(t)
  for(const tip of ['', '朋友仅展示最近三天的朋友圈']) {
    const empty = telegramFixture(a.archive,{upstream:page([],2004,tip)})
    await empty.controller.command(empty.group)
    assert.equal(empty.replies[0].chat,-10)
    assert.equal(empty.replies[0].extra.message_thread_id,42)
    assert.match(empty.replies[0].text,/没有可查看的朋友圈/)
    assert.doesNotMatch(empty.replies[0].text,/私聊|开始/)
    if(tip)assert.ok(empty.replies[0].text.includes(tip))
    assert.equal(empty.native.length,0)
  }
  const rejected = telegramFixture(a.archive,{upstream:page([],500,'do not display raw detail')})
  await rejected.controller.command(rejected.group)
  assert.match(rejected.replies[0].text,/GetDetail.*ret=500/)
  assert.doesNotMatch(rejected.replies[0].text,/私聊|开始|raw detail/)
  assert.equal(rejected.replies[0].chat,-10)
})

test('manual save walks every visible page including known posts without enabling daily sync',async t=>{
  const a = await archiveFixture(t),f = telegramFixture(a.archive)
  await f.controller.command(f.group,true)
  assert.match(f.replies[0].text,/正在保存/)
  assert.equal(f.replies[0].chat,-10)
  for(let i = 0;i < 160 && !f.replies.some(reply=>reply.text.includes('保存完成'));i++)await new Promise(resolve=>setTimeout(resolve,15))
  assert.match(f.replies.at(-1).text,/新增 2 条/)
  assert.equal(f.replies.at(-1).extra.message_thread_id,42)
  assert.deepEqual(f.calls,[[contact.id,undefined],[contact.id,first],[contact.id,second]])
  assert.equal(await a.archive.count(archiveScope,contact.id),2)
  assert.equal(await a.archive.enabled(archiveScope,contact.id),false)
  assert.equal(f.albums.length,0,'archive jobs do not publish photos to Telegram')
  const cursors = []
  const result = await syncMoments(a.archive,mode,contact,'all',async()=>true,{pageDelay:0,
    fetchPage:async(_session,_target,cursor)=>{cursors.push(cursor);return parseMomentsPage(page([record(cursor ? second : first)]),contact.id,cursor)}})
  assert.equal(result.saved,0)
  assert.deepEqual(cursors,[undefined,first,second])
})

test('a bounded manual sync resumes at the exact saved pagination cursor',async t=>{
  const a = await archiveFixture(t),cursors = []
  await a.archive.rememberContact(archiveScope,contact)
  const fetchPage = async(_session,_target,cursor)=>{
    cursors.push(cursor)
    return parseMomentsPage(page([record(cursor ? second : first)]),contact.id,cursor)
  }
  const previous = await syncMoments(a.archive,mode,contact,'all',async()=>true,{pageDelay:0,maxPages:1,fetchPage})
  assert.equal(previous.complete,false)
  assert.deepEqual(previous.checkpoint,{cursor:first,md5:'950aa948298138cf'})
  const continued = await syncMoments(a.archive,mode,contact,'all',async()=>true,{pageDelay:0,fetchPage,checkpoint:previous.checkpoint})
  assert.equal(continued.complete,true)
  assert.equal(await a.archive.count(archiveScope,contact.id),2)
  assert.deepEqual(cursors,[undefined,first,second])
})

test('daily sync is opt-in, persisted, account-scoped, and cannot repeat within 24 hours',async t=>{
  const a = await archiveFixture(t),now = Date.now(),f = telegramFixture(a.archive)
  await f.controller.checkDaily(now)
  assert.equal(f.calls.length,0)
  await a.archive.setEnabled(archiveScope,contact,true)
  await Promise.all([f.controller.checkDaily(now),f.controller.checkDaily(now)])
  assert.equal(await a.archive.count(archiveScope,contact.id),2)
  assert.equal(f.calls.length,3)
  await a.restart()
  const g = telegramFixture(a.archive)
  await g.controller.checkDaily(now + momentsDay - 1)
  assert.equal(g.calls.length,0)
  g.setSession({...mode,account:'other'})
  await g.controller.checkDaily(now + momentsDay)
  assert.equal(g.calls.length,0)
  g.setSession(mode)
  await g.controller.checkDaily(now + momentsDay)
  assert.equal(g.calls.length,1,'the first known page ends an incremental daily check')
  await a.archive.setEnabled(archiveScope,contact,false)
  await g.controller.checkDaily(now + 3 * momentsDay)
  assert.equal(g.calls.length,1)
  assert.equal(g.replies.length,0)
})

test('other users and switched accounts cannot read or follow old Moments buttons',async t=>{
  const a = await archiveFixture(t),f = telegramFixture(a.archive,{rich:false})
  await f.controller.command({...f.ctx,chat:{id:9,type:'private'},from:{id:9}})
  assert.equal(f.calls.length,0)
  await f.controller.command(f.ctx)
  const key = f.key('next')
  f.setSession({...mode,account:'wx_changed'})
  await f.controller.callback(f.ctx,key,'next')
  assert.match(f.answers.at(-1),/已失效/)
  assert.equal(f.calls.length,1)
  f.onFetch(()=>f.setSession({...mode,account:'wx_switched_again'}))
  const previousReplies = f.replies.length,previousAlbums = f.albums.length
  await f.controller.command(f.ctx)
  assert.equal(f.replies.length,previousReplies)
  assert.equal(f.albums.length,previousAlbums)
})