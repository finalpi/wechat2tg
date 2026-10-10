'use strict'
window.MessageCenterUI = {
    create({request,transfer,t,node,icon,isActive,notify}) {
        let root, refs={},contacts=[],active=null,items=[],status={available:false,wechatOnline:false},query='',kind='all',messageQuery='',offset=0,moreContacts=false,moreMessages=false,before=0,loadingContacts=false,sending=false,contactSequence=0,historySequence=0
        const drafts=new Map()
        const blobs=new Map()
        const mediaCards=new Map()
        const avatars=new Map()
        const avatarQueue=[]
        let avatarWorkers=0
        const pumpAvatars=()=>{while(avatarWorkers<6&&avatarQueue.length){const job=avatarQueue.shift();avatarWorkers++;job().finally(()=>{avatarWorkers--;pumpAvatars()})}}
        const avatarFor=(id,name,hasAvatar,className='contact-avatar')=>{
            const holder=node('span',className,Array.from(name||'?')[0])
            if(!id||!hasAvatar)return holder
            if(!avatars.has(id))avatars.set(id,new Promise(resolve=>{avatarQueue.push(async()=>{try{const blob=await transfer('/api/avatar?wxId='+encodeURIComponent(id));resolve(URL.createObjectURL(blob))}catch{resolve(null)}});pumpAvatars()}))
            avatars.get(id).then(url=>{if(url){const image=node('img');image.src=url;image.alt=name||'';holder.replaceChildren(image)}})
            return holder
        }
        let lastDrawSignature=''
        let uploading=false
        let contactTimer,historyTimer
        const currentDraft=()=>active?drafts.get(active.wxId)||{text:'',requestId:''}:{text:'',requestId:''}
        const requestId=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('')
        const button=(label,cls,action)=>{const b=node('button',cls,label);b.type='button';b.addEventListener('click',action);return b}
        const updateControls=()=>{
            if(!root)return
            refs.connection.textContent=t(status.available?(status.wechatOnline?'wechatConnected':'wechatOffline'):'messagesUnavailable')
            refs.connection.classList.toggle('offline',!status.wechatOnline)
            refs.send.disabled=!active||!status.wechatOnline||sending||uploading||(!currentDraft().text.trim()&&!currentDraft().attachment)
            refs.composer.disabled=!active||sending
            refs.send.textContent=t(sending?'sendingMessage':'sendMessage')
            refs.counter.textContent=`${currentDraft().text.length} / 4000`
            refs.attach.disabled=refs.voice.disabled=!active||sending||uploading
            refs.attachment.replaceChildren()
            if(uploading)refs.attachment.append(node('span','',t('uploadingMedia')))
            else if(currentDraft().attachment){const file=currentDraft().attachment;if(currentDraft().previewURL){const image=node('img','draft-image');image.src=currentDraft().previewURL;image.alt=t('pastedImage');refs.attachment.append(image)}refs.attachment.append(node('span','',`${t('mediaType_'+file.kind)} · ${file.name}`),button('×','remove-attachment',()=>{const d=currentDraft();if(d.previewURL)URL.revokeObjectURL(d.previewURL);delete d.previewURL;delete d.attachment;d.requestId='';drafts.set(active.wxId,d);updateControls()}))}
        }
        const refreshStatus=async()=>{try{status=await request('GET','/api/messages/status');updateControls()}catch(error){refs.connection.textContent=error.message}}
        const drawContacts=()=>{
            refs.contacts.replaceChildren()
            for(const contact of contacts){
                const b=button('',`conversation-item${active?.wxId===contact.wxId?' selected':''}`,()=>{
                    active=contact;items=[];messageQuery='';before=0;moreMessages=false;refs.historySearch.value='';refs.composer.value=currentDraft().text;drawContacts();drawMessages();updateHeader();updateControls();loadHistory()
                })
                const avatar=avatarFor(contact.wxId,contact.name,contact.hasAvatar,`contact-avatar${contact.kind==='group'?' group-avatar':''}`),body=node('div','conversation-copy')
                body.append(node('strong','',contact.name),node('small','',ChatContent.summary(contact.lastBody)|| (contact.lastActivity?t('mediaType_'+(contact.lastType||'unknown')):`${t(contact.kind==='group'?'groupChat':'contactChat')} · ${contact.nickname||contact.wxId}`)));b.append(avatar,body)
                const activity=node('div','conversation-activity');if(contact.lastActivity)activity.append(node('small','',new Date(contact.lastActivity*1000).toLocaleDateString(document.documentElement.lang,{month:'numeric',day:'numeric'})))
                if(contact.unsyncedCount){const badge=node('span','unsynced-badge',String(contact.unsyncedCount));badge.title=t('unsyncedLabel');badge.setAttribute('aria-label',`${contact.unsyncedCount} ${t('unsyncedLabel')}`);activity.append(badge)}
                b.append(activity);refs.contacts.append(b)
            }
            if(!contacts.length)refs.contacts.append(node('div','inbox-empty',t(loadingContacts?'loadingContacts':'noContacts')))
            if(moreContacts)refs.contacts.append(button(t('loadMoreContacts'),'load-more',()=>loadContacts(true)))
            refs.total.textContent=`${contacts.length} ${t('contactsCount')}`
        }
        const loadContacts=async(more=false,poll=false)=>{
            const sequence=++contactSequence;loadingContacts=true;drawContacts()
            try{
                const result=await request('GET',`/api/contacts?q=${encodeURIComponent(query)}&kind=${kind}&offset=${more?offset:0}`)
                if(sequence!==contactSequence)return
                contacts=more?[...new Map([...contacts,...result.contacts].map(c=>[c.wxId,c])).values()]:result.contacts;offset=result.offset;moreContacts=result.hasMore
                refs.directoryNote.classList.toggle('hidden',result.directoryAvailable)
            }catch(error){if(!poll)notify(error.message,true)}finally{if(sequence===contactSequence){loadingContacts=false;drawContacts()}}
        }
        const updateHeader=()=>{
            refs.chatName.textContent=active?.name||t('chooseConversation')
            refs.chatSubtitle.textContent=active?`${t(active.kind==='group'?'groupChat':'contactChat')} · ${active.wxId}`:t('chooseConversationHelp')
            refs.chatAvatar.replaceChildren();if(active)refs.chatAvatar.append(avatarFor(active.wxId,active.name,active.hasAvatar,'header-avatar'))
            refs.historySearch.disabled=!active
        }
        const drawMessages=()=>{
            const signature=JSON.stringify({active:active?.wxId,moreMessages,items})
            if(signature===lastDrawSignature)return
            lastDrawSignature=signature
            const scrollBottom=refs.history.scrollHeight-refs.history.scrollTop-refs.history.clientHeight<80
            const previousHeight=refs.history.scrollHeight
            refs.history.replaceChildren()
            if(!active){const empty=node('div','chat-welcome');empty.append(icon('message'),node('h3','',t('chooseConversation')),node('p','',t('chooseConversationHelp')));refs.history.append(empty);return}
            if(moreMessages)refs.history.append(button(t('loadOlderMessages'),'load-more',()=>loadHistory(true)))
            if(!items.length)refs.history.append(node('div','inbox-empty',t('noMessages')))
            let day=''
            for(const message of items){
                const date=message.timestamp?new Date(message.timestamp*1000):null
                const formattedDay=date?date.toLocaleDateString(document.documentElement.lang):t('unknownDate')
                if(formattedDay!==day){refs.history.append(node('div','chat-date',formattedDay));day=formattedDay}
                const row=node('div',`chat-row ${message.direction}${active.kind==='group'?' group-message':''}`),bubble=node('div','chat-bubble'),column=node('div','chat-message-column')
                const senderName=message.senderDisplayName||ChatContent.summary(message.senderName||message.senderId)||active.name
                const avatarId=message.senderId|| (message.direction==='incoming'&&active.kind!=='group'?active.wxId:null)
                row.append(avatarFor(avatarId,senderName,message.senderHasAvatar||avatarId===active.wxId&&active.hasAvatar,'message-avatar'))
                if(message.direction!=='outgoing'&&active.kind==='group')column.append(node('div','chat-sender',senderName))
                if(['image','emoji','video','audio','voice','file'].includes(message.type)){
                    const saved=mediaCards.get(message.id)
                    const card=saved||node('div','chat-media-card');if(!saved)card.append(node('strong','',t('mediaType_'+message.type)),node('span','',message.details?.title||''))
                    const view=button(t(message.type==='file'?'downloadFile':'viewMedia'),'view-media',async()=>{
                        view.disabled=true
                        try{
                            const file=await request('GET',`/api/media/message/${message.id}`)
                            let cached=blobs.get(file.id)
                            if(!cached){const blob=await transfer(`/api/media/${file.id}`);cached={url:URL.createObjectURL(blob),mime:blob.type};blobs.set(file.id,cached)}
                            if(message.type==='image'||message.type==='emoji'){const image=node('img','chat-media-image');image.src=cached.url;image.alt=file.name;card.replaceChildren(image)}
                            else if(['video','voice','audio'].includes(message.type)){const player=node(message.type==='video'?'video':'audio','chat-media-player');player.controls=true;player.preload='metadata';player.src=cached.url;card.replaceChildren(player)}
                            const download=node('a','download-media',`${t('downloadFile')} · ${file.name}`);download.href=cached.url;download.download=file.name;card.append(download)
                        }catch(e){notify(e.message,true)}finally{view.disabled=false}
                    });if(!saved)card.append(view);mediaCards.set(message.id,card);bubble.append(card)
                }else if(message.type==='link'&&message.details){const card=node('div','rich-message-card');card.append(node('strong','',message.details.title||t('mediaType_link')),node('p','',message.details.description||''));if(/^https?:\/\//i.test(message.details.url||'')){const link=node('a','preview-link',message.details.url);link.href=message.details.url;link.target='_blank';link.rel='noopener noreferrer';card.append(link)}bubble.append(card)}
                else if(['location','contact'].includes(message.type)){const card=node('div','rich-message-card');card.append(node('strong','',t('mediaType_'+message.type)),node('p','',message.details?.title||''),node('small','',message.type==='contact'?(message.details?.wxId||''):[message.details?.latitude,message.details?.longitude].filter(v=>Number.isFinite(v)).join(', ')));bubble.append(card)}
                if(message.body||!['image','emoji','video','audio','voice','file','contact','location','link'].includes(message.type)){
                    const content=node('div','chat-text');content.append(ChatContent.render(document,message.body||t('mediaMessage'),message.bodyFormat,TemplatePreview.richText))
                    if(ChatContent.isTranscript(message.body,message.type)){
                        const details=node('details','chat-transcript'),summary=node('summary','',t('transcriptTitle'));details.append(summary,content)
                        for(const attachment of message.transcriptAttachments||[]){
                            const card=node('div','transcript-attachment');card.append(node('strong','',`${t(attachment.type==='image'?'mediaType_image':'mediaType_file')} · ${attachment.name}`))
                            const action=button(t(attachment.type==='image'?'viewMedia':'downloadFile'),'view-media',async()=>{
                                action.disabled=true
                                try{
                                    const file=await request('GET',`/api/media/transcript/${message.id}?path=${encodeURIComponent(attachment.path)}&id=${encodeURIComponent(attachment.id)}`)
                                    let cached=blobs.get(file.id)
                                    if(!cached){const blob=await transfer(`/api/media/${file.id}`);cached={url:URL.createObjectURL(blob),mime:blob.type};blobs.set(file.id,cached)}
                                    if(attachment.type==='image'){const img=node('img','chat-media-image');img.src=cached.url;img.alt=file.name;card.append(img)}
                                    const download=node('a','download-media',t('downloadFile')+' · '+file.name);download.href=cached.url;download.download=file.name;card.append(download)
                                    if(attachment.type==='file')download.click()
                                }catch(error){notify(error.message,true)}finally{action.disabled=false}
                            });card.append(action);details.append(card)
                        }
                        bubble.append(details)
                    }else bubble.append(content)
                }
                const meta=node('div',`chat-meta${message.status==='unknown'?' uncertain':''}`)
                meta.textContent=[date?date.toLocaleTimeString(document.documentElement.lang,{hour:'2-digit',minute:'2-digit'}):'',message.direction==='outgoing'?t(`messageStatus_${message.status}`):'',message.telegramStatus&&message.telegramStatus!=='none'?t(`telegramStatus_${message.telegramStatus}`):''].filter(Boolean).join(' · ')
                meta.classList.toggle('sync-alert',['pending','syncing','failed'].includes(message.telegramStatus))
                if(message.telegramStatus==='synced'){meta.textContent=date?date.toLocaleTimeString(document.documentElement.lang,{hour:'2-digit',minute:'2-digit'}):'';const sent=node('span','receipt-confirmed');sent.append(icon('check'));sent.title=t('telegramStatus_synced');sent.setAttribute('aria-label',t('telegramStatus_synced'));meta.append(sent)}
                column.append(bubble,meta);row.append(column);refs.history.append(row)
                if(['pending','failed','unknown','unverified'].includes(message.telegramStatus)&&['received','submitted'].includes(message.status)){
                    const retry=button(t('retryTelegramOnly'),'retry-telegram',async()=>{
                        const uncertain=['unknown','unverified'].includes(message.telegramStatus)
                        const confirmed=!uncertain||window.confirm(t('confirmTelegramRetry'));if(!confirmed)return
                        retry.disabled=true
                        try{const result=await request('POST',`/api/messages/${message.id}/sync`,{confirm:uncertain});message.telegramStatus=result.telegramStatus;await loadHistory();await loadContacts(false,true)}catch(e){notify(e.message,true)}finally{retry.disabled=false}
                    });bubble.append(retry)
                }
            }
            if(scrollBottom)refs.history.scrollTop=refs.history.scrollHeight
            else if(previousHeight&&refs.history.scrollHeight>previousHeight)refs.history.scrollTop+=refs.history.scrollHeight-previousHeight
        }
        const loadHistory=async(older=false,poll=false)=>{
            if(!active)return
            const wxId=active.wxId,sequence=++historySequence,previousMore=moreMessages
            try{
                const result=await request('GET',`/api/messages?wxId=${encodeURIComponent(wxId)}&before=${older?before:0}&q=${encodeURIComponent(messageQuery)}`)
                if(active?.wxId!==wxId||sequence!==historySequence)return
                const merged=[...new Map([...items,...result.messages].map(m=>[m.id,m])).values()].sort((a,b)=>a.timestamp-b.timestamp||a.id-b.id)
                // Retain loaded history while replacing the status of queued messages.
                items=merged;before=items[0]?.id||0;moreMessages=older?result.hasMore:items.length>50?previousMore:result.hasMore;drawMessages()
            }catch(error){if(!poll)notify(error.message,true)}
        }
        const submit=async()=>{
            if(!active||sending||uploading||!status.wechatOnline||(!currentDraft().text.trim()&&!currentDraft().attachment))return
            const wxId=active.wxId,draft=currentDraft();if(!draft.requestId)draft.requestId=requestId();drafts.set(wxId,draft);sending=true;updateControls()
            try{
                const results=[]
                if(draft.attachment)results.push(await request('POST','/api/messages',{wxId,body:'',requestId:draft.requestId+'-file',attachmentId:draft.attachment.id}))
                if(draft.text.trim())results.push(await request('POST','/api/messages',{wxId,body:draft.text,requestId:draft.attachment?draft.requestId+'-text':draft.requestId}))
                const result=results.at(-1)
                if(draft.previewURL)URL.revokeObjectURL(draft.previewURL);drafts.set(wxId,{text:'',requestId:''})
                if(active?.wxId===wxId){refs.composer.value='';items=[...new Map([...items,...results].map(m=>[m.id,m])).values()];drawMessages();await loadHistory()}
                notify(t(result.status==='unknown'?'messageStatus_unknown':result.status==='submitted'?'messageStatus_submitted':'messageQueued'))
                await loadContacts(false,true)
            }catch(error){notify(error.message,true)}finally{sending=false;updateControls()}
        }
        const upload=async(file,preference)=>{
            if(!active||!file)return
            if(uploading||sending){notify(t('uploadInProgress'),true);return}
            if(file.size>50*1024*1024){notify(t('mediaTooLarge'),true);return}
            const wxId=active.wxId;uploading=true;updateControls()
            try{const attachment=await transfer(`/api/media?name=${encodeURIComponent(file.name)}&type=${preference}`,file);const d=drafts.get(wxId)||{text:'',requestId:''};if(d.previewURL)URL.revokeObjectURL(d.previewURL);d.previewURL=/^image\//.test(file.type)?URL.createObjectURL(file):null;d.attachment=attachment;d.requestId='';drafts.set(wxId,d)}catch(e){notify(e.message,true)}finally{uploading=false;updateControls()}
        }
        const show=container=>{
            lastDrawSignature='';for(const card of mediaCards.values())card.querySelectorAll('audio,video').forEach(p=>p.pause());mediaCards.clear()
            root=container;root.replaceChildren();root.className='message-center'
            const directory=node('aside','inbox-directory'),directoryHeader=node('div','directory-header')
            directoryHeader.append(node('h2','',t('conversations')),button('↻','icon-button',()=>{loadContacts();refreshStatus()}));directory.append(directoryHeader)
            refs.connection=node('div','inbox-connection');directory.append(refs.connection)
            const contactSearch=node('label','inbox-search');contactSearch.append(icon('search'));const input=node('input');input.type='search';input.placeholder=t('searchContacts');input.setAttribute('aria-label',t('searchContacts'));input.value=query;input.maxLength=100;input.addEventListener('input',()=>{query=input.value;clearTimeout(contactTimer);contactTimer=setTimeout(()=>loadContacts(),250)});contactSearch.append(input);directory.append(contactSearch)
            const tabs=node('div','directory-tabs');for(const value of ['all','contact','group']){const b=button(t(`filter_${value}`),`directory-tab${value===kind?' active':''}`,()=>{kind=value;show(root)});b.setAttribute('aria-pressed',String(value===kind));tabs.append(b)}directory.append(tabs)
            refs.total=node('div','directory-count');refs.contacts=node('div','conversation-list');refs.directoryNote=node('p','directory-note hidden',t('directoryPending'));directory.append(refs.total,refs.contacts,refs.directoryNote)
            const chat=node('section','inbox-chat'),header=node('div','chat-header'),title=node('div')
            refs.chatAvatar=node('div','chat-header-avatar');refs.chatName=node('h2');refs.chatSubtitle=node('p');title.append(refs.chatName,refs.chatSubtitle);header.append(refs.chatAvatar,title,node('span','live-chat-badge',t('liveUpdates')));chat.append(header)
            const toolbar=node('div','chat-toolbar');refs.historySearch=node('input');refs.historySearch.type='search';refs.historySearch.maxLength=100;refs.historySearch.placeholder=t('searchMessages');refs.historySearch.setAttribute('aria-label',t('searchMessages'));refs.historySearch.value=messageQuery;refs.historySearch.addEventListener('input',()=>{messageQuery=refs.historySearch.value;clearTimeout(historyTimer);historyTimer=setTimeout(()=>{items=[];before=0;loadHistory()},250)});toolbar.append(icon('search'),refs.historySearch);chat.append(toolbar)
            refs.history=node('div','chat-history');refs.history.setAttribute('role','log');refs.history.setAttribute('aria-label',t('messageHistory'));chat.append(refs.history)
            const composer=node('form','chat-composer');composer.addEventListener('submit',e=>{e.preventDefault();submit()})
            const tools=node('div','composer-tools'),pick=node('input'),voicePick=node('input');pick.type=voicePick.type='file';pick.className=voicePick.className='hidden';voicePick.accept='audio/*,.webm';pick.addEventListener('change',()=>{upload(pick.files[0],'auto');pick.value=''});voicePick.addEventListener('change',()=>{upload(voicePick.files[0],'voice');voicePick.value=''})
            refs.attach=button(t('attachMedia'),'composer-tool',()=>pick.click());refs.voice=button(t('attachVoice'),'composer-tool',()=>voicePick.click());tools.append(refs.attach,refs.voice,node('small','',t('mediaLimit')),pick,voicePick);refs.attachment=node('div','selected-attachment');composer.append(tools,refs.attachment)
            refs.composer=node('textarea');refs.composer.rows=3;refs.composer.maxLength=4000;refs.composer.placeholder=t('writeMessage');refs.composer.setAttribute('aria-label',t('writeMessage'));refs.composer.value=currentDraft().text;refs.composer.addEventListener('input',()=>{if(active)drafts.set(active.wxId,{...currentDraft(),text:refs.composer.value,requestId:''});updateControls()});refs.composer.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();submit()}})
            const composerFooter=node('div','composer-footer');refs.counter=node('span');const tips=node('div','composer-tips');tips.append(node('span','',t('sendShortcut')),refs.counter);refs.send=node('button','button primary',t('sendMessage'));refs.send.type='submit';composerFooter.append(tips,refs.send);composer.append(refs.composer,composerFooter,node('p','send-note',t('sendStatusNote')));chat.append(composer);root.append(directory,chat)
            refs.composer.addEventListener('paste',event=>{const file=ChatContent.clipboardImage(event.clipboardData);if(file&&active){event.preventDefault();upload(file,'auto')}})
            refs.composer.title=t('pasteHint');refs.directoryNote.insertAdjacentElement('afterend',node('p','delivery-legend',t('deliveryLegend')))
            updateHeader();updateControls();drawContacts();drawMessages();refreshStatus();loadContacts();if(active)loadHistory()
        }
        setInterval(()=>{if(isActive()&&!document.hidden){refreshStatus();loadHistory(false,true);if(!loadingContacts&&offset<=60)loadContacts(false,true)}},5000)
        const hasDraft=()=>uploading||[...drafts.values()].some(draft=>draft.text.trim()||draft.attachment)
        const clear=()=>{for(const blob of blobs.values())URL.revokeObjectURL(blob.url);for(const d of drafts.values())if(d.previewURL)URL.revokeObjectURL(d.previewURL);for(const promise of avatars.values())promise.then(url=>{if(url)URL.revokeObjectURL(url)});avatars.clear();blobs.clear();mediaCards.clear();lastDrawSignature='';drafts.clear();contacts=[];items=[];active=null;status={available:false,wechatOnline:false};root?.replaceChildren();root=null}
        return {show,hasDraft,clear}
    },
}
