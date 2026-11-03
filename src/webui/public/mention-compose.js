(function(root){
    const queryAt=(text,cursor)=>{
        const before=text.slice(0,cursor),match=before.match(/(?:^|[^A-Za-z0-9_@])@([^\s@]*)$/u)
        if(!match)return null
        const start=before.lastIndexOf('@'),rest=text.slice(cursor).match(/^[^\s@]*/u)?.[0]||''
        return {start,end:cursor+rest.length,query:match[1]}
    }
    const reconcile=(previous,text,tokens=[],edit)=>{
        let start=0;while(start<previous.length&&start<text.length&&previous[start]===text[start])start++
        let suffix=0;while(suffix<previous.length-start&&suffix<text.length-start&&previous[previous.length-1-suffix]===text[text.length-1-suffix])suffix++
        let end=previous.length-suffix
        const delta=text.length-previous.length
        let explicit=false
        if(edit&&Number.isInteger(edit.start)&&Number.isInteger(edit.end)&&edit.start>=0&&edit.end>=edit.start&&edit.end<=previous.length){
            const added=edit.end-edit.start+delta
            if(added>=0&&previous.slice(0,edit.start)===text.slice(0,edit.start)&&previous.slice(edit.end)===text.slice(edit.start+added)){start=edit.start;end=edit.end;explicit=true}
        }
        const ambiguous=new Set()
        if(!explicit&&previous!==text)for(const token of tokens){if(token.start<end&&token.end>start&&tokens.some(other=>other.text===token.text&&other.wxId!==token.wxId))ambiguous.add(token.text)}
        return tokens.flatMap(token=>{
            if(ambiguous.has(token.text))return []
            let next
            if(token.end<=start)next={...token}
            else if(token.start>=end)next={...token,start:token.start+delta,end:token.end+delta}
            else return []
            return text.slice(next.start,next.end)===next.text?[next]:[]
        })
    }
    const remove=(text,tokens,predicate,cursor=text.length)=>{
        let next=text,position=cursor
        for(const token of tokens.filter(predicate).sort((a,b)=>b.start-a.start)){
            next=next.slice(0,token.start)+next.slice(token.end)
            if(position>=token.end)position-=token.end-token.start;else if(position>token.start)position=token.start
        }
        let shift=0
        const kept=[...tokens].sort((a,b)=>a.start-b.start).flatMap(token=>{
            if(predicate(token)){shift+=token.end-token.start;return []}
            return [{...token,start:token.start-shift,end:token.end-shift}]
        })
        return {text:next,tokens:kept,cursor:position}
    }
    const insert=(text,tokens,range,member)=>{
        const value='@'+member.name+'\u2005',next=text.slice(0,range.start)+value+text.slice(range.end),kept=reconcile(text,next,tokens,range)
        const token={...member,text:value,start:range.start,end:range.start+value.length}
        return {text:next,tokens:[...kept,token].sort((a,b)=>a.start-b.start),cursor:token.end}
    }
    const api={queryAt,reconcile,remove,insert}
    if(typeof module==='object'&&module.exports)module.exports=api;else root.MentionCompose=api
})(typeof window==='undefined'?globalThis:window)
