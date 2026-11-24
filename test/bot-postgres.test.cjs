/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test'),assert = require('node:assert/strict')
const fs = require('node:fs'),os = require('node:os'),path = require('node:path'),{createHash} = require('node:crypto')
const {SettingsDatabase} = require('../dist/webui/settings-db')
const {botPostgresDsn} = require('../dist/DatabaseOptions')
const {migrateBotToPostgres,migrateExistingPostgresStores} = require('../dist/BotPostgresMigration')
const {createBotDataSource} = require('../dist/BotDataSource')
const {BindGroup} = require('../dist/entity/BindGroup')
const {Configuration} = require('../dist/entity/Configuration')
const {Message} = require('../dist/entity/Message')
const {OfficialAccountForum} = require('../dist/entity/OfficialAccountForum')
const {OfficialAccountTopic} = require('../dist/entity/OfficialAccountTopic')
const {TypeOrmOfficialForumStorage} = require('../dist/service/OfficialAccountForumAdapters')
const {MessageRepository} = require('../dist/repository/MessageRepository')
const {WebMessageStore} = require('../dist/webui/message-store')
const {TelegramOutbox} = require('../dist/repository/TelegramOutbox')
const {MomentsArchive} = require('../dist/service/MomentsArchive')
const {RedPacketService} = require('../dist/service/RedPacketService')
const {TransferService} = require('../dist/service/TransferService')

test('the bot defaults to SQLite and does not auto-enable PG from the server DSN',()=>{
  assert.equal(botPostgresDsn({MESSAGE_STORE_POSTGRES_DSN:'postgres://server@host/archive'}),undefined)
  assert.equal(createBotDataSource(undefined).options.type,'sqlite')
  const dsn = 'postgresql://bot@host/wechat2tg_bot'
  assert.equal(createBotDataSource(botPostgresDsn({BOT_POSTGRES_DSN:dsn})).options.type,'postgres')
  assert.throws(()=>botPostgresDsn({BOT_POSTGRES_DSN:'postgres://bot:secret@host/'}),{code:'BOT_PG_INVALID_DSN'})
})

test('the optional PostgreSQL driver leaves SQLite column types unchanged',async()=>{
  const sqlite = await createBotDataSource(undefined,true,':memory:').initialize()
  try {
    for(const name of ['configuration','bind_group','message','official_account_forum','official_account_topic']){
      const columns = await sqlite.query(`PRAGMA table_info(${name})`)
      assert.equal(columns.find(column=>column.name === 'chatId').type.toLowerCase(),'integer')
    }
  } finally {await sqlite.destroy()}
})

const dsn = process.env.TEST_BOT_POSTGRES_DSN
const upgradeDsn = process.env.TEST_BOT_POSTGRES_UPGRADE_DSN
const digest = file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const wxId = 'wx_peer',accountId = 'wx_self',remoteId = '9223372036854775806'
const message = {wxId,remoteId,body:'已保存的消息 abc',direction:'incoming',type:'text',status:'received',timestamp:1800000000,telegramTracked:1}
const packetId = '10000000000000000001'
const packetXml = `<msg><appmsg><type>2001</type><wcpayinfo><paymsgid>${packetId}</paymsgid><nativeurl><![CDATA[wxpay://c2cbizmessagehandler/hongbao/receivehongbao?sendid=${packetId}]]></nativeurl></wcpayinfo></appmsg></msg>`
const transferXml = '<msg><appmsg><type>2000</type><wcpayinfo><paysubtype>1</paysubtype><transferid>test-transfer</transferid><transcationid>test-transaction</transcationid><invalidtime>1999999999</invalidtime><receiver_username>wx_self</receiver_username><feedesc>￥12.30</feedesc></wcpayinfo></appmsg></msg>'
const post = {id:remoteId,target:wxId,author:wxId,time:1800000000,text:'朋友圈备份',photos:['example'],likes:[],comments:[]}
const binary = Buffer.from([0x00,0xff,0x80,0x11])

async function seedAuxiliaryStores(dir,ownerId,chatId){
  const session = async()=>({accountId,ownerId,baseURL:'http://127.0.0.1:1/api'})
  const web = new WebMessageStore(path.join(dir,'webui-messages.db'))
  const outbox = new TelegramOutbox(path.join(dir,'telegram-outbox.db'))
  const packets = new RedPacketService(session,undefined,path.join(dir,'red-packets.db'))
  const transfers = new TransferService(session,undefined,path.join(dir,'transfers.db'))
  const moments = new MomentsArchive(path.join(dir,'moments.db'))
  const names = ['webui-messages.db','telegram-outbox.db','red-packets.db','transfers.db','moments.db']
  let saved,outboxKey,packet,transfer
  const destination = {conversation:wxId,chatId,threadId:19}
  try {
    saved = await web.insert({...message,status:'sending'})
    await web.run('INSERT INTO media(id,name,kind,mime,size,digest) VALUES(?,?,?,?,?,?)',['local-attachment','archive.png','image','image/png',4,'synthetic'])
    await web.run('UPDATE inbox SET attachmentId=? WHERE id=?',['local-attachment',saved.id])
    await web.run('INSERT INTO telegram_recalls (key,status) VALUES (?,?)',[`source:${wxId}:${remoteId}`,'syncing'])
    outboxKey = await outbox.enqueue(accountId,{id:remoteId,wxId,chatId,type:1,file:{fileName:'test.bin',file:binary}})
    await outbox.claim(outboxKey,accountId)
    await outbox.begin(outboxKey,accountId)
    packet = await packets.register({accountId,conversation:wxId,remoteId,source:packetXml,chatId,threadId:19})
    transfer = await transfers.register(transferXml,accountId,destination)
    await moments.setEnabled(accountId,{id:wxId,name:'测试账号'},true)
    assert.equal(await moments.save(accountId,post,[binary]),true)
    assert.equal(await moments.claimDaily(accountId,wxId,1800000000000),true)
  } finally {await Promise.all([web,outbox,packets,transfers,moments].map(store=>store.close()))}
  // Seed interruption markers directly. No test transport can reach WeChat.
  const sqlite = await createBotDataSource(undefined,false,path.join(dir,'red-packets.db')).initialize()
  const transferDb = await createBotDataSource(undefined,false,path.join(dir,'transfers.db')).initialize()
  try {
    await sqlite.query('UPDATE red_packets SET state=\'opening\' WHERE token=?',[packet.token])
    await transferDb.query('UPDATE transfers SET state=\'accepting\' WHERE token=?',[transfer.token])
  } finally {await Promise.all([sqlite.destroy(),transferDb.destroy()])}
  return {saved,outboxKey,packet,transfer,destination,names,hashes:names.map(name=>digest(path.join(dir,name)))}
}

async function verifyAuxiliaryStores(dir,ownerId,chatId,extras){
  assert.deepEqual(extras.names.map(name=>digest(path.join(dir,name))),extras.hashes)
  const previous = process.env.BOT_POSTGRES_DSN
  process.env.BOT_POSTGRES_DSN = dsn
  const session = async()=>({accountId,ownerId,baseURL:'http://127.0.0.1:1/api'})
  const noRequests = async()=>{assert.fail('unexpected network dispatch')}
  let web = new WebMessageStore()
  const outbox = new TelegramOutbox(),moments = new MomentsArchive()
  const packets = new RedPacketService(session,noRequests),transfers = new TransferService(session,noRequests)
  try {
    const row = await web.byId(extras.saved.id)
    assert.equal(row.remoteId,remoteId)
    assert.equal(row.attachmentId,'local-attachment')
    assert.equal(row.status,'unknown')
    assert.equal(await web.cursor(),extras.saved.id)
    assert.equal((await outbox.row(extras.outboxKey)).state,'unknown')
    assert.deepEqual((await outbox.message(extras.outboxKey)).file.file,binary)
    assert.equal((await packets.status(extras.packet.token,extras.destination)).state,'unknown')
    assert.equal((await transfers.status(extras.transfer.token,extras.destination)).state,'unknown')
    const another = packetXml.replaceAll(packetId,'10000000000000000002')
    assert.equal((await packets.register({accountId,conversation:wxId,remoteId:'9999999999999999999',source:another,chatId,threadId:19})).state,'ready')
    assert.equal((await transfers.register(transferXml.replace('test-transfer','second-transfer'),accountId,extras.destination)).state,'ready')
    assert.equal((await moments.at(accountId,wxId,0)).post.text,post.text)
    assert.deepEqual((await moments.at(accountId,wxId,0)).images,[binary])
    assert.equal(await moments.claimDaily(accountId,wxId,1800000000001),false)
    assert.equal(await moments.rememberContact(accountId,{id:'wx_new',name:'新联系人'}),undefined)
    assert.equal(await moments.save(accountId,{...post,id:'test-new'},[binary]),true)
    const events = [],stop = web.subscribe(event=>events.push(event))
    const later = await web.insert({...message,remoteId:'100',body:'最新 ABC',timestamp:message.timestamp + 1})
    assert(later.id > extras.saved.id)
    assert(events.some(event=>event.wxId === wxId && event.ids.includes(later.id)))
    events.length = 0
    await web.run('UPDATE inbox SET body=body WHERE id=?',[later.id])
    assert.equal(events.length,0)
    assert.equal(await web.claimSync(later.id),true)
    assert.equal(await web.claimSync(later.id),false)
    assert.equal(await web.claimRecallNotice(`source:${wxId}:${remoteId}`,false),false)
    assert.equal(await web.claimRecallNotice(`source:${wxId}:${remoteId}`,true),true)
    assert((await web.history(wxId,later.id)).messages.some(message=>message.id === row.id))
    await web.importHistory([{...message,remoteId:'88'},{...message,remoteId:'88'}])
    const pending = await web.insert({...message,requestId:'new-pending',remoteId:null,direction:'outgoing',status:'sending'})
    await web.completeManagedSend(pending.id,'88','{}',message.timestamp)
    assert.equal((await web.byRemoteId(wxId,'88')).id,pending.id)
    assert.equal(await web.cursor(),pending.id)
    stop()
    const freshKey = await outbox.enqueue(accountId,{id:'101',wxId,chatId,type:0,content:'text'})
    assert.equal((await outbox.due(accountId,'message',Date.now() + 100,10))[0].key,freshKey)
    assert.equal(await outbox.claim(freshKey,accountId),true)
    assert.equal(await outbox.begin(freshKey,accountId),true)
    await outbox.finish(freshKey,'sent',1)
    assert.equal((await outbox.row(freshKey)).state,'sent')
    await web.close()
    web = new WebMessageStore()
    assert.equal((await web.byRequest('new-pending')).status,'submitted')
    assert.equal(await web.cursor(),pending.id)
    assert.deepEqual(extras.names.map(name=>digest(path.join(dir,name))),extras.hashes)
  } finally {
    await Promise.all([web,outbox,moments,packets,transfers].map(store=>store.close()))
    if(previous === undefined)delete process.env.BOT_POSTGRES_DSN
    else process.env.BOT_POSTGRES_DSN = previous
  }
}

test('PostgreSQL imports the Bot main database, message journal, outbox, payment journals and Moments', {skip:!dsn},async t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'wechat2tg-pg-'))
  t.after(()=>fs.rmSync(dir,{force:true,recursive:true}))
  const file = path.join(dir,'wx2tg.db'),legacy = path.join(dir,'webui-config.json')
  const settings = await SettingsDatabase.open(file,legacy)
  const token = settings.document('webui-token').read()
  await settings.saveEnvironment({AI_MODEL:'sqlite-model'})
  await settings.close()
  const source = await createBotDataSource(undefined,true,file).initialize()
  const ownerId = 6001234567,chatId = -1001234567890
  try {
    await source.getRepository(Configuration).insert({id:1,chatId:ownerId,botId:ownerId + 1,selfMessage:false})
    await source.getRepository(BindGroup).insert({id:14,chatId,wxId:'synthetic-wx',name:'synthetic',type:0,isReceive:false})
    await source.getRepository(Message).insert(Array.from({length:201},(_,index)=>({id:500 + index,chatId,wxMsgId:'9223372036854775806',tgBotMsgId:1000 + index,createTime:1800000000000})))
    await source.getRepository(Message).insert({id:900,chatId,wxMsgId:'deleted'})
    await source.getRepository(Message).delete(900)
    await source.getRepository(OfficialAccountForum).insert({id:1,chatId,creationStatus:'provisioning'})
    await source.getRepository(OfficialAccountTopic).insert({chatId,wxId:'gh_test',threadId:null,status:'creating',name:'synthetic',randomId:'-9223372036854775807'})
    // An invalid final row must not leave partially imported history in PG.
    await source.query('UPDATE official_account_topic SET "isForwardOthers" = 2')
  } finally {await source.destroy()}
  const extras = await seedAuxiliaryStores(dir,ownerId,chatId)
  const original = digest(file)
  await assert.rejects(SettingsDatabase.openPostgres(dsn,file,legacy),{code:'BOT_PG_MIGRATION_REQUIRED'})
  await assert.rejects(migrateBotToPostgres(dsn,file),/Invalid SQLite boolean/)
  assert.equal(digest(file),original)
  const fix = await createBotDataSource(undefined,false,file).initialize()
  await fix.query('UPDATE official_account_topic SET "isForwardOthers" = 0')
  await fix.destroy()
  const corrected = digest(file)
  const counts = await migrateBotToPostgres(dsn,file)
  assert.equal(counts.message,201)
  assert.equal(counts.official_account_topic,1)
  for(const name of ['inbox','outbox','red_packets','transfers','moments_posts'])assert.equal(counts[name],1,name)
  assert.equal(digest(file),corrected)
  await verifyAuxiliaryStores(dir,ownerId,chatId,extras)
  await assert.rejects(migrateBotToPostgres(dsn,file),{code:'BOT_PG_TARGET_NOT_EMPTY'})

  const pgSettings = await SettingsDatabase.openPostgres(dsn,file,legacy)
  try {
    assert.equal(pgSettings.document('webui-token').read(),token)
    assert.equal(pgSettings.savedEnvironment().AI_MODEL,'sqlite-model')
    await pgSettings.saveEnvironment({AI_MODEL:'pg-model'})
  } finally {await pgSettings.close()}
  const reopened = await SettingsDatabase.openPostgres(dsn,file,legacy)
  assert.equal(reopened.savedEnvironment().AI_MODEL,'pg-model')
  await reopened.close()
  assert.equal(digest(file),corrected)

  const pg = await createBotDataSource(dsn).initialize()
  try {
    const configuration = await pg.getRepository(Configuration).findOneByOrFail({id:1})
    assert.equal(configuration.chatId,ownerId)
    assert.equal(configuration.botId,ownerId + 1)
    assert.equal(configuration.selfMessage,false)
    assert.equal((await pg.getRepository(BindGroup).findOneByOrFail({id:14})).chatId,chatId)
    const end = await pg.getRepository(Message).findOneByOrFail({id:700})
    assert.equal(end.wxMsgId,'9223372036854775806')
    assert.equal(end.chatId,chatId)
    assert.equal(end.createTime,1800000000000)
    assert.equal((await pg.getRepository(Message).save({chatId,wxMsgId:'new'})).id,901)
    const messages = Object.assign(Object.create(MessageRepository.prototype),{repository:pg.getRepository(Message)})
    await pg.getRepository(Message).save({chatId,wxMsgId:'older',createTime:1})
    assert.equal(await messages.deleteOldMessages(2),1)
    const forum = new TypeOrmOfficialForumStorage(async()=>pg)
    assert.equal(await forum.insertForum({id:1,chatId,creationStatus:'provisioning'}),false)
    await forum.saveForum({id:1,chatId,creationStatus:'ready'})
    assert.equal((await forum.getForum()).creationStatus,'ready')
    const topic = await forum.getTopic('gh_test')
    assert.equal(topic.randomId,'-9223372036854775807')
    await forum.insertTopic(topic)
    await forum.finishTopic('gh_test',19)
    assert.equal((await forum.getTopicByThread(chatId,19)).wxId,'gh_test')
  } finally {await pg.destroy()}
})

test('the offline stores-only upgrade keeps an existing PG settings and binding database', {skip:!upgradeDsn},async t=>{
  assert.notEqual(upgradeDsn,dsn,'use a separate empty DB for the stores-only test')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'wechat2tg-pg-upgrade-'))
  t.after(()=>fs.rmSync(dir,{force:true,recursive:true}))
  const file = path.join(dir,'wx2tg.db'),legacy = path.join(dir,'webui-config.json')
  const pg = await createBotDataSource(upgradeDsn).initialize()
  try {
    await pg.query('CREATE TABLE app_settings (name TEXT PRIMARY KEY, value TEXT NOT NULL)')
    await pg.query('INSERT INTO app_settings VALUES ($1,$2),($3,$4)',['legacy-v1','1','environment','{"AI_MODEL":"existing-pg"}'])
    await pg.getRepository(BindGroup).insert({name:'existing',wxId,chatId:-1000100010000,type:0})
    const web = new WebMessageStore(path.join(dir,'webui-messages.db'))
    try {await web.insert(message)} finally {await web.close()}
    await assert.rejects(SettingsDatabase.openPostgres(upgradeDsn,file,legacy),{code:'BOT_PG_STORES_MIGRATION_REQUIRED'})
    assert.deepEqual(await migrateExistingPostgresStores(upgradeDsn,file),{inbox:1,media:0,transcript_media:0,telegram_recalls:0})
    const settings = await SettingsDatabase.openPostgres(upgradeDsn,file,legacy)
    try {assert.equal(settings.savedEnvironment().AI_MODEL,'existing-pg')} finally {await settings.close()}
    assert.equal((await pg.getRepository(BindGroup).findOneByOrFail({wxId})).name,'existing')
    await assert.rejects(migrateExistingPostgresStores(upgradeDsn,file),{code:'BOT_PG_TARGET_NOT_EMPTY'})
  } finally {await pg.destroy()}
})