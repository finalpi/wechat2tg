import {XMLParser} from 'fast-xml-parser'
import type BaseMessage from '../base/BaseMessage'
import {FormatUtils} from './FormatUtils'

const parser = new XMLParser({parseTagValue:false})

export function parseWechatFileMeta(source:string):{xml:string;title:string;size:string} {
    const xml = String(source || '').replace(/^[^<>\s:]+:\r?\n(?=\s*<)/,'')
    let title = '未知文件',size = '未知'
    try {
        const app = parser.parse(xml)?.msg?.appmsg,bytes = Number(app?.appattach?.totallen)
        if(typeof app?.title === 'string' && app.title)title = app.title.slice(0,256)
        if(Number.isSafeInteger(bytes) && bytes >= 0){
            const units = ['B','KiB','MiB','GiB','TiB'],i = bytes ? Math.min(Math.floor(Math.log2(bytes) / 10),units.length - 1) : 0
            size = `${i ? (bytes / 1024 ** i).toFixed(2) : bytes} ${units[i]}`
        }
    } catch { /* Even malformed metadata must not trigger an automatic download. */ }
    return {xml,title,size}
}

/** Queue metadata only. The original XML stays private for a later explicit click. */
export function setWechatFileNotice(message:BaseMessage,source:string):void {
    const {xml,title,size} = parseWechatFileMeta(source)
    message.type = 0
    message.source_text = xml
    message.source_type = 'file'
    message.content = `[文件]\n${FormatUtils.escapeHtml(title)}\n大小: ${size}`
    message.param = {...message.param,inline_keyboard:[{text:'下载文件',callback_data:`wfd:${message.id}`}]}
}