/* eslint-disable @typescript-eslint/no-var-requires */
const sharp = require('sharp')
// Two complete 1x1 GIF frames (black, then white), not a filename-only fixture.
const animatedGif = Buffer.from('47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030100000021f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b','hex')
const image = (format = 'png',options = {})=>sharp({create:{width:16,height:12,channels:4,background:'#ff000080',...options}})[format]().toBuffer()
function pngChunk(type,data){
  const name = Buffer.from(type),payload = Buffer.concat([name,data])
  let crc = 0xffffffff
  for(const byte of payload){crc ^= byte;for(let bit = 0;bit < 8;bit++)crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)}
  const header = Buffer.alloc(4),trailer = Buffer.alloc(4)
  header.writeUInt32BE(data.length);trailer.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([header,payload,trailer])
}
async function animatedPng(){
  const first = await image('png'),second = await image('png',{background:'#0000ff'})
  const chunks = buffer=>{
    const result = [];for(let offset = 8;offset + 12 <= buffer.length;){const length = buffer.readUInt32BE(offset);result.push({type:buffer.toString('ascii',offset + 4,offset + 8),data:buffer.subarray(offset + 8,offset + 8 + length)});offset += 12 + length}
    return result
  }
  const a = chunks(first),b = chunks(second),animation = Buffer.alloc(8);animation.writeUInt32BE(2)
  const frame = sequence=>{const data = Buffer.alloc(26);data.writeUInt32BE(sequence);data.writeUInt32BE(16,4);data.writeUInt32BE(12,8);data.writeUInt16BE(1,20);data.writeUInt16BE(10,22);return pngChunk('fcTL',data)}
  const secondFrame = Buffer.alloc(4);secondFrame.writeUInt32BE(2)
  return Buffer.concat([first.subarray(0,8),pngChunk('IHDR',a.find(x=>x.type === 'IHDR').data),pngChunk('acTL',animation),frame(0),
    pngChunk('IDAT',Buffer.concat(a.filter(x=>x.type === 'IDAT').map(x=>x.data))),frame(1),
    pngChunk('fdAT',Buffer.concat([secondFrame,...b.filter(x=>x.type === 'IDAT').map(x=>x.data)])),pngChunk('IEND',Buffer.alloc(0))])
}
module.exports = {image,animatedGif,animatedPng,pngChunk}