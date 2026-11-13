/* eslint-disable @typescript-eslint/no-var-requires */
/* global document, window */
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const {once} = require('node:events'), {chromium} = require('playwright-core')
const {createWebUIServer} = require('../dist/webui/server')
const {RedPacketService} = require('../dist/service/RedPacketService')

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'red-packet-browser-'))
  const calls = [], token = 'synthetic-red-packet-browser-token', group = 'fixture@chatroom'
  const service = new RedPacketService(async()=>({accountId:'self',ownerId:123,baseURL:'unused'}),async(_session,xml)=>{
    calls.push(xml)
    return {status:200,data:{Code:0,Success:true,Data:xml.includes('packet-000002') ? {} : {retcode:0,sendId:'packet-000001',receiveId:'synthetic-receipt',amount:123}}}
  },path.join(directory,'journal.db'))
  const entries = new Map()
  for(const id of [1,2]){
    const native = `packet-00000${id}`
    const source = `<msg><appmsg><type>2001</type><wcpayinfo><paymsgid>${native}</paymsgid><nativeurl><![CDATA[wxpay://c2cbizmessagehandler/hongbao/receivehongbao?sendid=${native}]]></nativeurl></wcpayinfo></appmsg></msg>`
    entries.set(id,await service.register({accountId:'self',conversation:group,remoteId:String(9000 + id),source}))
  }
  const rows = [1,2,3].map(id=>({id,wxId:group,senderId:'sender',senderName:'测试发送者',body:'',type:'red_packet',direction:'incoming',status:'received',telegramStatus:'synced',timestamp:1700000000 + id,
    details:{redPacket:{title:`测试红包 ${id}`,canOpen:id < 3,...(id < 3 ? {coverPath:`/api/media/red-packet/${id}`} : {})}}}))
  const cover = await require('sharp')({create:{width:200,height:280,channels:3,background:'#882233'}}).jpeg().toBuffer()
  const server = createWebUIServer({environment:{},file:path.join(directory,'settings.json'),token,mcpTokens:{read:'r'.repeat(32),write:'w'.repeat(32)},messages:{
    status:async()=>({available:true,wechatOnline:true,telegramOnline:true,directoryAvailable:true}),
    contacts:async()=>({contacts:[{wxId:group,name:'红包测试群',kind:'group',hasAvatar:false,lastActivity:0,lastSequence:0,unsyncedCount:0}],hasMore:false,offset:60,directoryAvailable:true}),
    history:async()=>({messages:rows,before:1,hasMore:false}),updates:async()=>({messages:rows}),
    redPacketCover:async()=>cover,
    redPacketStatus:async id=>service.prepare(entries.get(id).token,`webui:${id}`),
    openRedPacket:async(id,confirmation)=>service.open(entries.get(id).token,confirmation,`webui:${id}`),
  }})
  server.listen(0,'127.0.0.1');await once(server,'listening')
  let browser
  try {
    const executablePath = process.env.BROWSER_EXECUTABLE_PATH || ['/usr/bin/google-chrome','/usr/bin/chromium','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(file=>fs.existsSync(file))
    browser = await chromium.launch({executablePath,headless:true})
    const page = await browser.newPage({viewport:{width:390,height:780}}), requests = [], errors = []
    page.setDefaultTimeout(8000)
    page.on('pageerror',error=>errors.push(error.message))
    page.on('request',request=>requests.push({url:request.url(),headers:request.headers(),method:request.method()}))
    const origin = `http://127.0.0.1:${server.address().port}`
    await page.goto(origin + '/chat')
    await page.getByLabel('访问令牌').fill(token);await page.getByRole('button',{name:'进入控制台'}).click()
    await page.getByRole('button',{name:'红包测试群',exact:true}).click()
    const cards = page.locator('[aria-label="微信红包"]')
    await cards.nth(2).waitFor()
    await cards.first().getByAltText('红包封面').waitFor()
    assert((await cards.first().getByAltText('红包封面').getAttribute('src')).startsWith('blob:'))
    assert.equal(calls.length,0,'viewing covers never opens a packet')
    await cards.first().getByRole('button',{name:'打开红包',exact:true}).click()
    await page.getByRole('dialog').getByText('确认打开红包',{exact:true}).waitFor()
    assert.equal(calls.length,0)
    await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(calls.length,0)
    await cards.first().getByRole('button',{name:'打开红包',exact:true}).click()
    await page.getByRole('button',{name:'确认打开并领取',exact:true}).click()
    await cards.first().getByText('已确认领取 ¥1.23',{exact:true}).waitFor()
    assert.equal(calls.length,1)
    assert(await cards.first().getByRole('button',{name:'打开红包',exact:true}).isDisabled())
    await cards.first().getByRole('button',{name:'刷新领取状态',exact:true}).click()
    await cards.first().getByText('已确认领取 ¥1.23',{exact:true}).waitFor();assert.equal(calls.length,1)
    await cards.nth(1).getByRole('button',{name:'打开红包',exact:true}).click()
    await page.getByRole('button',{name:'确认打开并领取',exact:true}).click()
    await cards.nth(1).getByText('领取结果未知，请到微信核实；不会自动重复请求。',{exact:true}).waitFor()
    assert.equal(calls.length,2)
    await cards.nth(1).getByRole('button',{name:'刷新领取状态',exact:true}).click()
    assert.equal(calls.length,2)
    assert(await cards.nth(1).getByRole('button',{name:'打开红包',exact:true}).isDisabled())
    assert(await cards.nth(2).getByRole('button',{name:'打开红包',exact:true}).isDisabled())
    await page.setViewportSize({width:320,height:680})
    assert(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth),'mobile cards must not overflow')
    assert(requests.filter(request=>request.url.includes('/api/media/red-packet/')).every(request=>request.headers.authorization === `Bearer ${token}`))
    assert(requests.every(request=>!/^https?:/.test(request.url) || request.url.startsWith(origin)),'no external image/payment requests from the browser')
    assert.deepEqual(errors,[])
    console.log('Red-packet browser passed: authenticated cover previews, explicit confirmation/cancellation, strict receipts, unknown-state no-retry, mobile; synthetic protocol only, no real claims.')
  } finally {
    if(browser)await browser.close()
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve))
    await service.close();fs.rmSync(directory,{recursive:true,force:true})
  }
}
main().catch(error=>{console.error(error);process.exitCode = 1})