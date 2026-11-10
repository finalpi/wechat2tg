/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test'),assert = require('node:assert/strict')
const fs = require('node:fs'),path = require('node:path'),os = require('node:os'),vm = require('node:vm')
const {once} = require('node:events')
const {createWebUIServer} = require('../dist/webui/server')
const articles = require('../dist/webui/articles')

function fixture() {
  const url = 'https://mmbiz.qpic.cn/synthetic',calls = []
  const row = {id:7,wxId:'publisher',remoteId:'native-7',type:'link',hidden:0,revokeStatus:'none',details:JSON.stringify({articles:[{title:'Old cached title',url:'https://example.com'}]}),
    source:JSON.stringify({Content:`<msg><appmsg><title>Title</title><url>https://example.com</url><thumburl>${url}</thumburl></appmsg></msg>`})}
  const wx = {hasLogin:true,wxInfo:{wxid:'owner'}},hooks = {}
  const store = {byId:async id=>id === row.id ? {...row} : undefined,all:async()=>[],run:async(sql,args)=>{if(sql.startsWith('UPDATE inbox SET details='))row.details = args[0]}}
  const dependencies = {
    '../base/BaseClient':{AbstractClient:{getSpyClient:()=>wx}},
    '../data-sourse':{getGeWeChatDataSource:()=>({isInitialized:false}),AppDataSource:{getRepository:()=>({findOneBy:async()=>({wxId:'publisher'})})}},
    './mentions':{createGroupMentionService:()=>({})},'./articles':articles,
    '../util/ArticleCover':{loadArticleCover:async value=>{calls.push(value);await hooks.load?.();return Buffer.from('synthetic cover')}},
  }
  const exports = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/webui/messages.js'),'utf8'),{exports,require:name=>dependencies[name] || {}})
  return {center:exports.createMessageCenter(store,{}),row,wx,calls,hooks,url}
}

test('old article metadata is reparsed once for covers, and hidden/revoked or cross-account results cannot leak',async()=>{
  const f = fixture()
  assert.equal((await f.center.articleCover(7,0)).toString(),'synthetic cover')
  assert.deepEqual(f.calls,[f.url])
  assert.equal(JSON.parse(f.row.details).articleLayoutVersion,2)
  await assert.rejects(f.center.articleCover(7,20),error=>error.code === 'invalidRequest')
  await assert.rejects(f.center.articleCover(8,0),error=>error.code === 'coverUnavailable')
  f.row.revokeStatus = 'revoked'
  await assert.rejects(f.center.articleCover(7,0),error=>error.code === 'coverUnavailable')
  assert.equal(f.calls.length,1)
  f.row.revokeStatus = 'none'
  f.hooks.load = async()=>{f.wx.wxInfo.wxid = 'other-owner'}
  await assert.rejects(f.center.articleCover(7,0),error=>error.code === 'coverUnavailable')
  f.hooks.load = async()=>{f.row.hidden = 1}
  await assert.rejects(f.center.articleCover(7,0),error=>error.code === 'coverUnavailable')
})

test('cover HTTP route requires authentication, bounded stored-message indexes and no-store image responses',async t=>{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'webui-article-cover-'))
  const calls = [],token = 'synthetic-cover-token'
  const server = createWebUIServer({environment:{},file:path.join(directory,'config.json'),token,mcpTokens:{read:'r'.repeat(32),write:'w'.repeat(32)},messages:{articleCover:async(id,index)=>{calls.push([id,index]);return Buffer.from('jpg')}}})
  server.listen(0,'127.0.0.1');await once(server,'listening')
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true})})
  const base = `http://127.0.0.1:${server.address().port}`
  const request = (route,options = {})=>fetch(base + route,{headers:{Authorization:`Bearer ${token}`},...options})
  assert.equal((await fetch(base + '/api/media/article/7/0')).status,401)
  assert.equal(calls.length,0)
  assert.equal((await request('/api/media/article/7/20')).status,400)
  assert.equal((await request('/api/media/article/99999999999999999999/0')).status,400)
  assert.equal((await request('/api/media/article/7/0',{method:'POST'})).status,404)
  const response = await request('/api/media/article/7/0?url=http://127.0.0.1/private')
  assert.equal(response.status,200)
  assert.equal(response.headers.get('content-type'),'image/jpeg')
  assert.equal(response.headers.get('cache-control'),'no-store')
  assert.equal(response.headers.get('x-content-type-options'),'nosniff')
  assert.equal(await response.text(),'jpg')
  assert.deepEqual(calls,[[7,0]],'the client cannot supply a remote download URL')
})