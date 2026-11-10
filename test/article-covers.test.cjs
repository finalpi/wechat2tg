/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test'),assert = require('node:assert/strict')
const fs = require('node:fs'),os = require('node:os'),path = require('node:path'),http = require('node:http')
const {once} = require('node:events'),sharp = require('sharp'),{Telegram} = require('telegraf')
const {articleCoverURL,createArticleCoverLoader} = require('../dist/util/ArticleCover')
const {readLinkDetails,linkArticles,publicLinkDetails,articleText} = require('../dist/webui/articles')
const {prepareTelegramArticles,articleMessageRejected} = require('../dist/util/TelegramArticleMessage')
const url = 'https://mmbiz.qpic.cn/mmbiz_jpg/synthetic/640?wx_fmt=jpeg'
const png = ()=>sharp({create:{width:640,height:280,channels:3,background:'#567890'}}).png().toBuffer()
const temp = t=>{const directory = fs.mkdtempSync(path.join(os.tmpdir(),'article-covers-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return directory}
const xml = `<msg><appmsg><title>bundle</title><mmreader><category><item><title>First &amp; safe</title><summary>Summary</summary><url>https://example.com/one</url><cover>${url.replace(/&/g,'&amp;')}</cover></item><item><title>Second</title><url>https://example.com/two</url><thumburl>https://mmbiz.qpic.cn/second</thumburl></item></category></mmreader></appmsg></msg>`

test('article parsing preserves cover fields and publishes authenticated paths, never raw image URLs',()=>{
  const details = readLinkDetails(JSON.stringify({Content:xml}))
  assert.equal(details.articleLayoutVersion,2)
  assert.equal(details.articles.length,2)
  assert.equal(details.articles[0].title,'First & safe')
  assert.equal(details.articles[0].coverUrl,url)
  const result = publicLinkDetails(details,42)
  assert.equal(result.articles[0].coverPath,'/api/media/article/42/0')
  assert.equal(result.articles[1].coverPath,'/api/media/article/42/1')
  assert(!JSON.stringify(result).includes('qpic.cn'))
  assert(!Object.hasOwn(result,'articleLayoutVersion'))
  assert.match(articleText(details.articles),/First &amp; safe/)
  const plain = readLinkDetails('<msg><appmsg><title>Ordinary</title><url>https://example.com</url><thumburl>http://mmbiz.qpic.cn/cover</thumburl></appmsg></msg>')
  assert.equal(linkArticles(plain)[0].coverUrl,'https://mmbiz.qpic.cn/cover')
  assert.equal(publicLinkDetails(plain,43).coverPath,'/api/media/article/43/0')
  const inherited = readLinkDetails('<msg><appmsg><thumburl>https://mmbiz.qpic.cn/shared</thumburl><mmreader><category><item><title>One</title></item><item><title>Two</title></item></category></mmreader></appmsg></msg>')
  assert.equal(inherited.articles[0].coverUrl,'https://mmbiz.qpic.cn/shared')
  assert.equal(inherited.articles[1].coverUrl,undefined,'an app-level thumbnail is not invented for every article')
})

test('unsafe URLs, XML entities, excessive article counts and malformed source cannot create an open image proxy',()=>{
  for(const bad of ['http://127.0.0.1/a','http://[::1]/a','file:///etc/passwd','https://mmbiz.qpic.cn.evil.test/a','https://evil.qpic.cn/a','https://name:secret@mmbiz.qpic.cn/a','https://mmbiz.qpic.cn:8080/a','https://mmbiz.qpic.cn/\nsecret'])assert.equal(articleCoverURL(bad),'')
  assert.equal(articleCoverURL('http://mmbiz.qpic.cn/a#fragment'),'https://mmbiz.qpic.cn/a')
  const data = readLinkDetails(undefined,{articles:Array.from({length:25},()=>({title:'<b>title</b>',description:'<img>',url:'javascript:alert(1)',coverUrl:'http://localhost/a'}))})
  assert.equal(data.articles.length,20)
  assert(data.articles.every(article=>!article.url && !article.coverUrl))
  assert(!articleText(data.articles).includes('<img>'))
  assert.equal(readLinkDetails('<!DOCTYPE x><msg/>').articles.length,0)
  assert.equal(readLinkDetails('{broken').articles.length,0)
})

test('cover downloads deduplicate, resize to JPEG, cache privately, and validate every redirect',async t=>{
  const directory = temp(t),input = await png(),calls = []
  const load = createArticleCoverLoader(directory,async(value,options)=>{
    calls.push(value);assert.equal(options.maxRedirects,0);assert(options.signal)
    return {status:200,headers:{},data:input}
  })
  const [a,b] = await Promise.all([load(url),load(url)])
  assert.deepEqual(a,b);assert.equal(calls.length,1)
  const info = await sharp(a).metadata();assert.equal(info.format,'jpeg');assert.equal(info.width,640)
  await load(url);assert.equal(calls.length,1)
  const files = fs.readdirSync(directory);assert.equal(files.length,1);assert.match(files[0],/^[a-f0-9]{64}\.jpg$/)
  assert.equal(fs.statSync(path.join(directory,files[0])).mode & 0o777,0o600)
  let redirects = 0
  const unsafe = createArticleCoverLoader(temp(t),async()=>{redirects++;return {status:302,headers:{location:'http://127.0.0.1/private'},data:Buffer.alloc(0)}})
  await assert.rejects(unsafe(url),error=>error.code === 'coverUnavailable');assert.equal(redirects,1)
  await assert.rejects(unsafe(url));assert.equal(redirects,1,'brief negative cache prevents repeated failed downloads')
  await assert.rejects(unsafe('file:///etc/passwd'));assert.equal(redirects,1)
})

test('cover concurrency is bounded and SVG/oversized responses cannot be served as images',async t=>{
  const input = await png(),releases = []
  let active = 0,peak = 0
  const load = createArticleCoverLoader(temp(t),async()=>{
    active++;peak = Math.max(peak,active)
    await new Promise(resolve=>releases.push(resolve));active--
    return {status:200,headers:{},data:input}
  })
  const requests = Array.from({length:7},(_,i)=>load(url + '&i=' + i))
  while(releases.length < 3)await new Promise(resolve=>setImmediate(resolve))
  assert.equal(active,3)
  for(let i = 0;i < 7;i++){while(!releases.length)await new Promise(resolve=>setImmediate(resolve));releases.shift()()}
  await Promise.all(requests);assert(peak <= 3)
  for(const data of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),Buffer.alloc(3 * 1024 * 1024 + 1)]){
    const invalid = createArticleCoverLoader(temp(t),async()=>({status:200,headers:{},data}))
    await assert.rejects(invalid(url),error=>error.code === 'coverUnavailable')
  }
})

test('native Telegram article payload uses a leading cover, ordered secondary tiles and safe text fallback policy',async()=>{
  const articles = linkArticles(readLinkDetails(undefined,{articles:[0,1,2].map(i=>({title:`Article ${i}`,description:'Summary',url:`https://example.com/${i}`,coverUrl:url + '&i=' + i}))}))
  const payload = await prepareTelegramArticles(articles,'Publisher',async()=>Buffer.from('jpeg'))
  const rich = JSON.parse(payload.rich_message)
  assert.equal(rich.blocks[0].text,'Publisher')
  assert.equal(rich.blocks[1].type,'photo')
  assert.equal(rich.blocks[2].type,'collage')
  assert.equal(rich.blocks[2].blocks.length,2)
  assert.equal(rich.blocks[1].caption.text[0].url,'https://example.com/0')
  assert.equal(rich.blocks[2].blocks[1].caption.text[0].text,'Article 2')
  assert(!payload.rich_message.includes('qpic.cn'))
  assert.equal(rich.skip_entity_detection,true)
  assert.equal(await prepareTelegramArticles(articles,'Publisher',async()=>{throw Error('missing')}),undefined)
  for(const error of [{response:{error_code:400,description:'Bad Request: rich_message is not supported'}},{response:{error_code:400,description:'IMAGE_PROCESS_FAILED'}},{response:{error_code:400,description:'Bad Request: rich_message is too long'}}])assert(articleMessageRejected(error))
  for(const error of [new Error('timeout'),{response:{error_code:429,description:'retry after 5'}},{response:{error_code:500,description:'rich_message invalid'}}])assert.equal(articleMessageRejected(error),false)
})

test('actual Telegraf multipart sends article attachments with JSON rich blocks and the original topic', {timeout:10000},async t=>{
  let body = '',requestURL = ''
  const server = http.createServer(async(req,res)=>{
    requestURL = req.url;for await(const chunk of req)body += chunk.toString()
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,result:{message_id:123}}))
  })
  server.listen(0,'127.0.0.1');await once(server,'listening')
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))})
  const telegram = new Telegram('123:synthetic',{apiRoot:`http://127.0.0.1:${server.address().port}`})
  const payload = await prepareTelegramArticles(linkArticles(readLinkDetails(xml)),'Publisher',async()=>sharp(await png()).jpeg().toBuffer())
  await telegram.callApi('sendRichMessage',{...payload,chat_id:-100,message_thread_id:77})
  assert(requestURL.endsWith('/sendRichMessage'))
  const json = body.match(/name="rich_message"\r\n\r\n([^\r]+)\r\n/)
  assert(json);assert.equal(JSON.parse(json[1]).blocks[1].photo.media,'attach://article_cover_0')
  assert.match(body,/name="article_cover_0"; filename="article-0.jpg"/)
  assert.match(body,/name="message_thread_id"\r\n\r\n77\r\n/)
})