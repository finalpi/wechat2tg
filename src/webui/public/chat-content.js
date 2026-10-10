(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ChatContent=factory()})(typeof globalThis!=='undefined'?globalThis:this,function(){
    const clipboardImage=clipboard=>{
        for(const item of Array.from(clipboard?.items||[]))if(item.kind==='file'&&/^image\/(png|jpeg|webp|gif|bmp)$/i.test(item.type)){const file=item.getAsFile();if(file)return file}
        return Array.from(clipboard?.files||[]).find(file=>/^image\/(png|jpeg|webp|gif|bmp)$/i.test(file.type))||null
    }
    const isTranscript=(body,type)=>type==='chat_histroy'||/\[聊天记录\]|\[Chat history\]/i.test(body||'')&&/<blockquote\b/i.test(body||'')
    const summary=body=>String(body||'').replace(/<[^>]*>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim()
    const render=(document,body,format,richText)=>{
        const fragment=document.createDocumentFragment()
        if(format==='telegram_html')fragment.append(richText(document,body))
        else fragment.append(document.createTextNode(body||''))
        return fragment
    }
    return {clipboardImage,isTranscript,summary,render}
})
