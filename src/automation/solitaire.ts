import {createHash} from 'node:crypto'
import {parseDocument,DomUtils} from 'htmlparser2'
import {XMLValidator} from 'fast-xml-parser'

export interface NativeSolitaire {id?:string;joined:boolean;entryCount?:number}

/** Decode only native solitaire metadata, never infer a round from message ID,
 * title, date or XML item order. No private XML or participant IDs leave here. */
export function nativeSolitaire(xml:string,accountId:string):NativeSolitaire {
    const empty:NativeSolitaire = {joined:false}
    if(typeof xml !== 'string' || xml.length > 524288 || /<!DOCTYPE|<!ENTITY/i.test(xml))return empty
    try {
        const source = xml.replace(/^[A-Za-z0-9_.@-]{1,200}:\r?\n/,'').trim()
        if(XMLValidator.validate(source) !== true)return empty
        const outer = parseDocument(source,{xmlMode:true,decodeEntities:true})
        const outerRoots = outer.children.filter(DomUtils.isTag)
        if(outerRoots.length !== 1 || !['msg','appmsg','solitaire_info'].includes(outerRoots[0].name))return empty
        const envelopes = DomUtils.getElementsByTagName('solitaire_info',outer.children,true,2)
        if(envelopes.length !== 1)return empty
        const raw = DomUtils.textContent(envelopes[0]).trim()
        if(!raw || raw.length > 262144 || /<!DOCTYPE|<!ENTITY/i.test(raw) || XMLValidator.validate(raw) !== true)return empty
        const roots = parseDocument(raw,{xmlMode:true,decodeEntities:true}).children.filter(DomUtils.isTag)
        if(roots.length !== 1 || roots[0].name !== 'solitaire')return empty
        const root = roots[0]
        const children = (node:typeof root,name:string)=>node.children.filter(DomUtils.isTag).filter(child=>child.name === name)
        const text = (node:typeof root,name:string)=>{
            const values = children(node,name)
            return values.length === 1 && !values[0].children.some(DomUtils.isTag) ? DomUtils.textContent(values[0]).trim() : ''
        }
        const contents = children(root,'content')
        if(contents.length !== 1)return empty
        const items = children(contents[0],'i')
        if(!items.length || items.length > 4096)return empty
        const users = items.map(item=>text(item,'u'))
        const joined = Boolean(accountId && users.includes(accountId))
        if(users.some(user=>!user || user.length > 200))return {joined}
        const result:NativeSolitaire = {joined,entryCount:items.length}
        const fields = root.children.filter(DomUtils.isTag).filter(child=>['id','solitaire_id','solitaireid','solitaireId'].includes(child.name))
        if(fields.length){
            if(fields.length === 1){
                const id = text(root,fields[0].name)
                if(/^[a-zA-Z0-9_.:-]{1,160}$/.test(id))result.id = id
            }
            return result // Invalid/conflicting explicit IDs must not be bypassed.
        }
        // Native cards without an explicit ID preserve au (author) and each
        // participant's t (creation time). Accept only a unique author entry
        // with a valid earliest timestamp; an edited/newer/absent author is ambiguous.
        const author = text(root,'au'),authors = items.filter(item=>text(item,'u') === author)
        const times = items.map(item=>text(item,'t'))
        if(!author || author.length > 200 || authors.length !== 1 || times.some(time=>!/^\d{10}$/.test(time) || Number(time) <= 0))return result
        const origin = text(authors[0],'t')
        if(times.some(time=>Number(time) < Number(origin)))return result
        result.id = 'author-time-v1:' + createHash('sha256').update(JSON.stringify([author,origin])).digest('hex')
        return result
    } catch {return empty}
}