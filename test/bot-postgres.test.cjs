/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test'),assert = require('node:assert/strict')
const fs = require('node:fs'),os = require('node:os'),path = require('node:path'),{createHash} = require('node:crypto')
const {SettingsDatabase} = require('../dist/webui/settings-db')
const {botPostgresDsn} = require('../dist/DatabaseOptions')
const {migrateBotToPostgres} = require('../dist/BotPostgresMigration')
const {createBotDataSource} = require('../dist/BotDataSource')
const {BindGroup} = require('../dist/entity/BindGroup')
const {Configuration} = require('../dist/entity/Configuration')
const {Message} = require('../dist/entity/Message')
const {OfficialAccountForum} = require('../dist/entity/OfficialAccountForum')
const {OfficialAccountTopic} = require('../dist/entity/OfficialAccountTopic')
const {TypeOrmOfficialForumStorage} = require('../dist/service/OfficialAccountForumAdapters')
const {MessageRepository} = require('../dist/repository/MessageRepository')

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
const digest = file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex')

test('PostgreSQL imports and preserves Bot settings, bindings, history IDs and forum state', {skip:!dsn},async t=>{
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
  assert.equal(digest(file),corrected)
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