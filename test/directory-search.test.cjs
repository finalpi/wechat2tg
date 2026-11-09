/* eslint-disable @typescript-eslint/no-var-requires */
require('reflect-metadata')
const {test} = require('node:test')
const assert = require('node:assert/strict')
const {DataSource} = require('typeorm')
const {WxContact} = require('../dist/entity/WxContact')
const {WxRoom} = require('../dist/entity/WxRoom')
const {WxContactRepository} = require('../dist/repository/WxContactRepository')
const {WxRoomRepository} = require('../dist/repository/WxRoomRepository')

test('real SQLite contact search includes enterprise IDs, aliases, names and literal wildcard characters', async t=>{
  const database = new DataSource({type:'sqlite',database:':memory:',entities:[WxContact,WxRoom],synchronize:true})
  await database.initialize();t.after(()=>database.destroy())
  const contacts = database.getRepository(WxContact),rooms = database.getRepository(WxRoom)
  await contacts.save([
    {userName:'worker_123@openim',nickName:'企微同事',remark:'项目伙伴',alias:'Work.Alice',verifyFlag:null},
    {userName:'workerX123@openim',nickName:'另一个同事',verifyFlag:null},
    {userName:'percent',nickName:'100% 完成'},
    {userName:'slash',remark:'folder\\name'},
  ])
  await rooms.save([{chatroomId:'team_123@chatroom',nickName:'项目群',remark:'测试组'}, {chatroomId:'teamX123@chatroom',nickName:'其他群'}])
  const repository = Object.create(WxContactRepository.prototype)
  repository.WxContactRepository = contacts
  for(const query of ['worker_123@openim','work.alice','企微同事','项目伙伴']) {
    assert.deepEqual((await repository.getByNickNameOrRemark(query)).map(row=>row.userName),['worker_123@openim'])
  }
  assert.equal((await repository.getByNickNameOrRemark('@openim')).length,2)
  assert.deepEqual((await repository.getByNickNameOrRemark('%')).map(row=>row.userName),['percent'])
  assert.deepEqual((await repository.getByNickNameOrRemark('_')).map(row=>row.userName),['worker_123@openim'])
  assert.deepEqual((await repository.getByNickNameOrRemark('\\')).map(row=>row.userName),['slash'])
  assert.equal((await repository.getByNickNameOrRemark('\' OR 1=1 --')).length,0)
  const groupRepository = Object.create(WxRoomRepository.prototype)
  groupRepository.WxRoomRepository = rooms
  for(const query of ['team_123@chatroom','测试组','项目群']) assert.deepEqual((await groupRepository.getByNickNameOrRemark(query)).map(row=>row.chatroomId),['team_123@chatroom'])
  assert.equal((await groupRepository.getByNickNameOrRemark('@openim')).length,0)
})