import {parseDocument,DomUtils} from 'htmlparser2'
import {XMLValidator} from 'fast-xml-parser'

/** ilinkvoip mixes real invites with silent protocol housekeeping. Match the
 * complete structure; never decode or log the opaque call credentials. */
function isSilentCallControl(xml:string):boolean {
    if(xml.length > 131072 || !/^<sysmsg\b/.test(xml) || !xml.includes('ilinkvoip')
        || /<!DOCTYPE|<!ENTITY/i.test(xml))return false
    try {
        if(XMLValidator.validate(xml) !== true)return false
        const roots = parseDocument(xml,{xmlMode:true,decodeEntities:true}).children.filter(DomUtils.isTag)
        const root = roots[0]
        if(roots.length !== 1 || root.type !== 'tag' || root.name !== 'sysmsg' || root.attribs.type !== 'ilinkvoip')return false
        const children = root.children.filter(DomUtils.isTag),container = children[0]
        if(children.length !== 1 || container.type !== 'tag' || container.name !== 'voipmt')return false
        if([...root.children,...container.children].some(node=>DomUtils.isText(node) && node.data.trim()))return false
        const events = container.children.filter(DomUtils.isTag)
        return events.length > 0 && events.every(event=>event.type === 'tag' && ['cancel','dismissapns'].includes(event.name)
            && !event.children.some(node=>node.type === 'tag'))
    } catch {return false}
}

function sourceXML(source:string):string[] {
    if(source.trimStart().startsWith('{')){
        try{const parsed = JSON.parse(source);return [parsed.xml,parsed.Content].filter(value=>typeof value === 'string')}catch{return []}
    }
    return [source]
}

export function isControlMessage(type:string,source = ''):boolean {
    const kind = String(type).toLowerCase()
    // A user may send a protocol example as text. Its content remains text.
    if(['text','0','1'].includes(kind))return false
    if(['file_start','new_monment_timeline'].includes(kind))return true
    // Device handoff packets are control-plane events, including ones which the
    // SDK currently classifies as unknown. Never expose their XML as chat text.
    return sourceXML(source).some(value=>{
        const xml = value.trim().replace(/^<\?xml\b[^?]*\?>\s*/i,'')
        if(isSilentCallControl(xml))return true
        if(/<name>\s*HandOffMaster\s*<\/name>|<handofflist\b|^<msg\b[^>]*>\s*<op\b/i.test(xml))return true
        // Function-message fetch/retry requests and game-centre badge/config
        // updates contain no chat payload. Keep all other system subtypes.
        if(/^<sysmsg\b[^>]*\btype\s*=\s*(["'])(functionmsg|gamecenter)\1[^>]*>\s*<\2\b[\s\S]*<\/sysmsg>$/i.test(xml))return true
        return /^<newcount>\s*\d+\s*<\/newcount>\s*<version>\s*\d+\s*<\/version>$/i.test(xml)
    })
}

export function isNoiseMessage(type:string,body:string,source = ''):boolean {
    if(type === 'revoke' || sourceXML(source).some(xml=>/<sysmsg\b[^>]*\btype\s*=\s*["']revokemsg["']/i.test(xml)))return true
    if(isControlMessage(type,source))return true
    return ['unknown','text','0'].includes(type) && !String(body || '').trim() && !source
}