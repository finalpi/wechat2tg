/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'),path = require('node:path'),vm = require('node:vm')

function fixture() {
  const xml = '<msg><appmsg><type>2001</type><wcpayinfo><receivertitle>祝福</receivertitle><paymsgid>100000000001</paymsgid><nativeurl><![CDATA[wxpay://c2cbizmessagehandler/hongbao/receivehongbao?sendid=100000000001&sign=private-token]]></nativeurl><receiverc2cshowsourceurl>https://wx.gtimg.com/private-cover.png</receiverc2cshowsourceurl></wcpayinfo></appmsg></msg>'
  const row = {id:1,wxId:'room@chatroom',remoteId:'9000000000000000001',type:'red_packet',body:'',direction:'incoming',status:'received',hidden:0,revokeStatus:'none',timestamp:1,
    source:JSON.stringify({FromUserName:'sender',ToUserName:'self',Content:xml})}
  const wx = {hasLogin:true,wxInfo:{wxid:'self'}}, calls = [], hooks = {}
  const store = {byId:async()=>({...row}),all:async()=>[{...row}],run:async()=>undefined}
  const service = {
    register:async input=>{calls.push(['register',input]);await hooks.register?.();return {token:'a'.repeat(32)}},
    prepare:async()=>({state:'ready',canOpen:true,confirmation:'b'.repeat(32)}),
    open:async(_token,_confirmation,_scope,guard)=>{if(!await guard())throw Error('invalid target');calls.push(['open']);return {state:'received',canOpen:false,amountFen:123}},
  }
  const dependencies = {
    '../base/BaseClient':{AbstractClient:{getSpyClient:()=>wx}},
    '../data-sourse':{getGeWeChatDataSource:()=>({isInitialized:false}),AppDataSource:{getRepository:()=>({findOneBy:async()=>({wxId:'room@chatroom',type:1})})}},
    './mentions':{createGroupMentionService:()=>({})},
    '../util/WechatRedPacket':require('../dist/util/WechatRedPacket'),
    './red-packets':require('../dist/webui/red-packets'),
    '../service/RedPacketService':{redPacketService:()=>service},
    '../util/RedPacketCover':{loadRedPacketCover:async()=>{await hooks.cover?.();return Buffer.from('cover')}},
    './message-body':require('../dist/webui/message-body'),
    './revoke':{revokePolicy:()=>({}),revokePayload:()=>{throw Error('not revocable')}},
    'wx2tg-puppet':require('wx2tg-puppet'),
  }
  const exports = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/webui/messages.js'),'utf8'),{exports,require:name=>dependencies[name] || {}})
  return {center:exports.createMessageCenter(store,{}),row,wx,calls,hooks}
}

test('real message-center metadata exposes only safe cover paths/title, not raw payment credentials', async () => {
  const f = fixture()
  const output = await f.center.updates('room@chatroom',[1])
  assert.equal(output.messages[0].details.redPacket.title,'祝福')
  assert.equal(output.messages[0].details.redPacket.coverPath,'/api/media/red-packet/1')
  assert.equal(output.messages[0].details.redPacket.canOpen,true)
  const serialized = JSON.stringify(output)
  for(const privateValue of ['nativeurl','private-token','private-cover.png','paymsgid'])assert(!serialized.includes(privateValue))
  assert.equal(f.calls.length,0,'listing messages neither registers nor claims a packet')
})

test('real adapter refuses old-account, revoked and hidden claim targets before registration', async () => {
  for(const patch of [{source:JSON.stringify({FromUserName:'other',ToUserName:'old'})},{hidden:1},{revokeStatus:'revoked'}]){
    const f = fixture();Object.assign(f.row,patch)
    await assert.rejects(f.center.openRedPacket(1,'b'.repeat(32)))
    assert.equal(f.calls.length,0)
  }
  const f = fixture();f.wx.hasLogin = false
  await assert.rejects(f.center.redPacketStatus(1));assert.equal(f.calls.length,0)
})

test('cover reads recheck account and revocation after awaiting the private image loader', async () => {
  const f = fixture()
  assert.equal((await f.center.redPacketCover(1)).toString(),'cover')
  f.hooks.cover = async()=>{f.wx.wxInfo.wxid = 'other'}
  await assert.rejects(f.center.redPacketCover(1))
  f.wx.wxInfo.wxid = 'self';f.hooks.cover = async()=>{f.row.hidden = 1}
  await assert.rejects(f.center.redPacketCover(1));assert.equal(f.calls.length,0)
})

test('claim guards survive account switches or source changes during target registration', async () => {
  const f = fixture()
  f.hooks.register = async()=>{f.wx.wxInfo.wxid = 'other'}
  await assert.rejects(f.center.openRedPacket(1,'b'.repeat(32)))
  assert.equal(f.calls.filter(call=>call[0] === 'open').length,0)
  const valid = fixture()
  assert.equal((await valid.center.redPacketStatus(1)).confirmation,'b'.repeat(32))
  assert.equal((await valid.center.openRedPacket(1,'b'.repeat(32))).amountFen,123)
})