import axios from 'axios'
import {createHash} from 'node:crypto'
import {Readable,Transform,Writable} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {parser} from 'stream-json'
import {XMLParser} from 'fast-xml-parser'
import type {Message} from 'wx2tg-puppet'

const LARGE_FILE = 80 * 1024 * 1024
const MAX_FILE = 256 * 1024 * 1024 // server CDN frame limit
const xmlParser = new XMLParser({parseTagValue:false})
interface FileMeta {size:number;md5?:string}

/** Decode only Data.Image / Data.FileData, not diagnostics, thumbnails or keys.
 * Stream the JSON string rather than materializing hundreds of MB of base64. */
export async function decodeFileResponse(source:Readable,{size,md5}:FileMeta):Promise<Buffer> {
    if(!Number.isSafeInteger(size) || size < 1 || size > MAX_FILE)throw new Error('微信文件大小无效或超过服务端限制')
    let wire = 0,depth = 0,key = '',inData = false,reading = false,success = false,code = '',offset = 0,carry = '',padded = false
    let output:Buffer|undefined
    const invalid = ()=>new Error('微信文件响应不完整或格式不正确')
    const maxWire = Math.ceil(size / 3) * 4 + 128 * 1024
    await pipeline(source,new Transform({transform(chunk,_enc,cb){
        wire += chunk.length
        if(wire > maxWire)return cb(invalid())
        cb(null,chunk)
    }}),parser({packKeys:true,streamKeys:false,packStrings:false,packNumbers:true,streamNumbers:false}),new Writable({objectMode:true,write(token,_enc,cb){
        try {
            switch(token.name){
                case 'keyValue':key = token.value;break
                case 'startObject':case 'startArray':
                    if(depth === 1)inData = key === 'Data' && token.name === 'startObject'
                    depth++;key = '';break
                case 'endObject':case 'endArray':depth--;if(depth < 2)inData = false;break
                case 'numberValue':if(depth === 1 && key === 'Code')code = token.value;break
                case 'trueValue':case 'falseValue':if(depth === 1 && key === 'Success')success = token.name === 'trueValue';break
                case 'startString':
                    reading = inData && depth === 2 && ['Image','FileData','fileData'].includes(key)
                    if(reading){if(output)throw invalid();output = Buffer.allocUnsafe(size)}
                    break
                case 'stringChunk':
                    if(reading){
                        const data = carry + token.value,n = data.length - data.length % 4,part = data.slice(0,n)
                        if(padded || !/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw invalid()
                        if(part){
                            padded = part.endsWith('=')
                            const bytes = Buffer.from(part,'base64')
                            if(offset + bytes.length > size)throw invalid()
                            bytes.copy(output,offset);offset += bytes.length
                        }
                        carry = data.slice(n)
                    }
                    break
                case 'endString':if(reading && (carry || offset !== size))throw invalid();reading = false;break
            }
            cb()
        } catch(error){cb(error)}
    }}))
    if(!success || code !== '0' || !output || offset !== size)throw new Error('微信服务端未返回完整文件')
    if(md5 && createHash('md5').update(output).digest('hex') !== md5.toLowerCase())throw new Error('微信文件 MD5 校验失败')
    return output
}

/** Preserve the original numeric JSON token for Go's int64 field. The bound
 * conversation is the talker (not the sender of an outgoing/group message). */
export function fileMessageRequest(account:string,talker:string,id:unknown,xml:string,localId?:string) {
    if(!account || !talker || !xml || (typeof id !== 'string' && !(typeof id === 'number' && Number.isSafeInteger(id))))throw new Error('缺少微信文件定位信息')
    const decimal = String(id)
    if(!/^[1-9]\d{0,18}$/.test(decimal) || BigInt(decimal) > 9223372036854775807n)throw new Error('微信文件消息 ID 无效')
    const local = Number(localId)
    const MsgID = Number.isInteger(local) && local > 0 && local <= 0x7fffffff ? local : undefined
    return `{"NewMsgID":${decimal},${JSON.stringify({Wxid:account,Talker:talker,MsgID,MsgType:49,Xml:xml}).slice(1)}`
}

// The SDK retains the raw sender-prefixed XML on incoming room messages.
// Only remove the specific WeChat room envelope, not arbitrary leading text.
export function wechatFileXml(msg:Message) {
    return String(msg._xml || msg.text() || '').replace(/^[^<>\s:]+:\r?\n(?=\s*<)/,'')
}

export function storedFileTalker(account:string,conversation:string,sender:string,to:string) {
    if(conversation && conversation !== 'app')return conversation
    if(to?.endsWith('@chatroom'))return to
    return [sender,to].find(value=>value && value !== account) || ''
}

export async function downloadWechatMedia(msg:Message,account:string,talker:string,baseURL:string) {
    if(msg.type() !== 'file')return msg.toFileBox()
    const xml = wechatFileXml(msg),app = xmlParser.parse(xml)?.msg?.appmsg
    const size = Number(app?.appattach?.totallen)
    if(!(size > LARGE_FILE))return msg.toFileBox()
    if(!Number.isSafeInteger(size) || size > MAX_FILE)throw new Error('微信文件超过服务端下载限制（256 MiB）')
    const body = fileMessageRequest(account,talker,msg.newMsgId,xml,msg._msgId)
    if(!baseURL)throw new Error('微信服务端未配置')
    let buffer:Buffer
    try {
        const response = await axios.post<Readable>(baseURL.replace(/\/+$/,'') + '/Tools/DownloadFileMessage',body,{
            headers:{'Content-Type':'application/json'},timeout:180000,signal:AbortSignal.timeout(180000),maxRedirects:0,responseType:'stream',
        })
        const hash = app.md5 || app.appattach.filemd5
        buffer = await decodeFileResponse(response.data,{size,md5:/^[0-9a-f]{32}$/i.test(hash) ? hash : undefined})
    } catch(error){
        // Axios errors may contain the entire XML and CDN credentials.
        if(error instanceof Error && error.message.startsWith('微信文件'))throw new Error(error.message)
        throw new Error('微信大文件下载失败或数据不完整，请检查文件是否已过期后重试')
    }
    return {name:String(app.title || 'attachment.bin'),toBuffer:async()=>buffer}
}