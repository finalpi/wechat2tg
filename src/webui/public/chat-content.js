(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(()=>require('./wechat-emoji.js'));else root.ChatContent=factory(()=>root.WechatEmojiManifest||{})})(typeof globalThis!=='undefined'?globalThis:this,function(emojiManifest){
    const clipboardImage=clipboard=>{
        for(const item of Array.from(clipboard?.items||[]))if(item.kind==='file'&&/^image\/(png|jpeg|webp|gif|bmp)$/i.test(item.type)){const file=item.getAsFile();if(file)return file}
        return Array.from(clipboard?.files||[]).find(file=>/^image\/(png|jpeg|webp|gif|bmp)$/i.test(file.type))||null
    }
    const isTranscript=(body,type)=>type==='chat_histroy'||/\[聊天记录\]|\[Chat history\]/i.test(body||'')&&/<blockquote\b/i.test(body||'')
    const summary=body=>String(body||'').replace(/<[^>]*>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim()
    const inline=(document,text)=>{
        const fragment=document.createDocumentFragment(),value=String(text??''),known=emojiManifest()
        // Keep literal code and visible URL strings intact. Matching labels are
        // display-only; composer values and wire message text are never edited.
        const tokens=/(```[\s\S]*?(?:```|$)|`[^`\r\n]*(?:`|$)|(?:[a-z][a-z0-9+.-]*:\/\/|www\.|mailto:)[^\s<>"']+)|(\[[^\[\]\r\n]{1,64}\])/gi
        let position=0
        for(const match of value.matchAll(tokens)){
            fragment.append(document.createTextNode(value.slice(position,match.index)))
            const label=match[0],src=!match[1]&&Object.prototype.hasOwnProperty.call(known,label)?known[label]:''
            if(typeof src==='string'&&/^\/assets\/wechat-emoji\/emoji-[a-f0-9]{16}\.webp$/.test(src)){
                const image=document.createElement('img');image.className='wechat-emoji';image.src=src;image.alt=label;image.title=label;image.draggable=false;image.decoding='async';image.width=22;image.height=22
                image.addEventListener('error',()=>image.replaceWith(document.createTextNode(label)),{once:true})
                fragment.append(image)
            }else fragment.append(document.createTextNode(label))
            position=match.index+label.length
        }
        fragment.append(document.createTextNode(value.slice(position)))
        return fragment
    }
    const decorate=(document,parent)=>{
        for(const child of Array.from(parent.childNodes)){
            if(child.nodeType===3){if(child.textContent.includes('['))child.replaceWith(inline(document,child.textContent))}
            else if(child.nodeType===1&&!['CODE','PRE','A','SCRIPT','STYLE','TEXTAREA','IMG'].includes(child.tagName))decorate(document,child)
        }
        return parent
    }
    const render=(document,body,format,richText)=>{
        const fragment=document.createDocumentFragment()
        if(format==='telegram_html')fragment.append(richText(document,body))
        else fragment.append(document.createTextNode(body||''))
        return decorate(document,fragment)
    }
    return {clipboardImage,isTranscript,summary,inline,decorate,render}
})
