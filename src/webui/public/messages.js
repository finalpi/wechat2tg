'use strict'
window.MessageCenterUI = {
    create({request,transfer,t,node,icon,isActive,notify}) {
        let root, refs={},contacts=[],active=null,items=[],status={available:false,wechatOnline:false},query='',kind='all',messageQuery='',offset=0,moreContacts=false,moreMessages=false,before=0,loadingContacts=false,sending=false,contactSequence=0,historySequence=0
        const drafts=new Map()
        const pendingHistory=new Set()
        let historyContext=false,locatingQuote=false,locateSequence=0,historyGeneration=0,highlightedMessage=null,highlightTimer
        const blobs=new Map()
        const mediaCards=new Map()
        const mediaStates=new Map(),blobLoads=new Map(),mediaQueue=[]
        let mediaWorkers=0,mediaEpoch=0
        const expandedTranscripts=new Set()
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
        let uploading=false,mentionSequence=0,mentionTimer,mentionRange=null,memberChoices=[],highlighted=0,beforeEdit=null
        const withdrawing=new Set()
        let serverClockOffset=0
        const updateRevokeButtons=()=>{if(!root)return;for(const b of root.querySelectorAll('.message-revoke')){const expired=Number(b.dataset.deadline)<= (Date.now()+serverClockOffset)/1000;b.disabled=b.dataset.available!=='true'||expired||withdrawing.has(Number(b.dataset.id));if(expired)b.title=t('revokeExpired')}}
        const isGroup=contact=>Boolean(contact&&(contact.wxId.endsWith('@chatroom')||contact.kind==='group'))
        let contactTimer,historyTimer
        const currentDraft=()=>active?drafts.get(active.wxId)||{text:'',requestId:''}:{text:'',requestId:''}
        const requestId=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('')
        const button=(label,cls,action)=>{const b=node('button',cls,label);b.type='button';b.addEventListener('click',action);return b}
        const inlineNode=(tag,cls,text)=>{const element=node(tag,cls);element.append(ChatContent.inline(document,text));return element}
        const articleURL=value=>{if(typeof value!=='string'||value.length>4096||/[\u0000-\u001f\u007f]/.test(value))return '';try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:''}catch{return ''}}
        const articleCard=article=>{
            const card=node('article','official-article-card'),url=articleURL(article.url),title=inlineNode(url?'a':'strong','article-title',article.title||t('mediaType_link'))
            if(url){title.href=url;title.target='_blank';title.rel='noopener noreferrer'}
            card.append(title)
            if(article.description)card.append(inlineNode('blockquote','article-summary',article.description))
            if(url){const read=node('a','article-read-more',t('readArticle'));read.href=url;read.target='_blank';read.rel='noopener noreferrer';card.append(read)}
            return card
        }
        let viewer={zoom:1,rotation:0,x:0,y:0},viewerResize,viewerDrag=null
        const fitImage=()=>{
            if(!refs.imageDialog?.open||!refs.largeImage.naturalWidth)return
            const w=refs.largeImage.naturalWidth,h=refs.largeImage.naturalHeight,sw=refs.imageStage.clientWidth,sh=refs.imageStage.clientHeight
            const turned=Math.abs(viewer.rotation%180)===90,fit=Math.min(sw/(turned?h:w),sh/(turned?w:h))
            refs.largeImage.style.width=`${w*fit}px`;refs.largeImage.style.height=`${h*fit}px`
            refs.largeImage.style.transform=`translate(calc(-50% + ${viewer.x}px),calc(-50% + ${viewer.y}px)) rotate(${viewer.rotation}deg) scale(${viewer.zoom})`
            refs.imageZoom.textContent=`${Math.round(viewer.zoom*100)}%`;refs.imageStage.classList.toggle('zoomed',viewer.zoom>1)
            refs.zoomOut.disabled=viewer.zoom<=.25;refs.zoomIn.disabled=viewer.zoom>=4
        }
        const changeZoom=amount=>{viewer.zoom=Math.min(4,Math.max(.25,viewer.zoom*amount));if(viewer.zoom<=1)viewer.x=viewer.y=0;fitImage()}
        const rotateImage=angle=>{viewer.rotation=(viewer.rotation+angle)%360;viewer.x=viewer.y=0;fitImage()}
        const openImage=image=>{
            if(!image?.src||!refs.imageDialog)return
            viewer={zoom:1,rotation:0,x:0,y:0};refs.largeImage.src=image.src;refs.largeImage.alt=image.alt||t('viewMedia')
            refs.imageDialog.showModal();fitImage();refs.imageClose.focus()
        }
        const updateControls=()=>{
            if(!root)return
            refs.connection.textContent=t(status.available?(status.wechatOnline?'wechatConnected':'wechatOffline'):'messagesUnavailable')
            refs.connection.classList.toggle('offline',!status.wechatOnline)
            refs.send.disabled=!active||!status.wechatOnline||sending||uploading||(!currentDraft().text.trim()&&!currentDraft().attachment)
            if((currentDraft().mentionAll||currentDraft().mentionedMembers?.length)&&!currentDraft().text.trim())refs.send.disabled=true
            if(currentDraft().replyTo&&!currentDraft().text.trim())refs.send.disabled=true
            refs.composer.disabled=!active||sending
            refs.send.textContent=t(sending?'sendingMessage':'sendMessage')
            refs.counter.textContent=`${currentDraft().text.length} / 4000`
            refs.attach.disabled=refs.voice.disabled=!active||sending||uploading
            refs.mention.disabled=!isGroup(active)||sending
            refs.mention.classList.toggle('hidden',!isGroup(active))
            refs.selectedMentions.replaceChildren()
            const d=currentDraft()
            if(d.mentionAll)refs.selectedMentions.append(button('@'+t('mentionEveryone')+' ×','mention-chip',()=>applyDraft(MentionCompose.remove(d.text,d.tokens||[],m=>m.all,refs.composer.selectionStart))))
            for(const member of d.mentionedMembers||[])refs.selectedMentions.append(button('@'+member.name+' ×','mention-chip',()=>applyDraft(MentionCompose.remove(d.text,d.tokens||[],m=>m.wxId===member.wxId,refs.composer.selectionStart))))
            refs.replyPreview.replaceChildren()
            if(d.replyTo){const content=node('div');content.append(inlineNode('strong','',t('quoteReplyTo')+' '+d.replyTo.name),inlineNode('p','',d.replyTo.preview));refs.replyPreview.append(content,button('×','icon-button',()=>{delete d.replyTo;d.requestId='';drafts.set(active.wxId,d);updateControls();refs.composer.focus()}))}
            refs.replyPreview.classList.toggle('hidden',!d.replyTo)
            refs.attachment.replaceChildren()
            if(uploading)refs.attachment.append(node('span','',t('uploadingMedia')))
            else if(currentDraft().attachment){const file=currentDraft().attachment;if(currentDraft().previewURL){const image=node('img','draft-image');image.src=currentDraft().previewURL;image.alt=t('pastedImage');refs.attachment.append(image)}refs.attachment.append(node('span','',`${t('mediaType_'+file.kind)} · ${file.name}`),button('×','remove-attachment',()=>{const d=currentDraft();if(d.previewURL)URL.revokeObjectURL(d.previewURL);delete d.previewURL;delete d.attachment;d.requestId='';drafts.set(active.wxId,d);updateControls()}))}
        }
        const refreshStatus=async()=>{try{status=await request('GET','/api/messages/status');updateControls()}catch(error){refs.connection.textContent=error.message}}
        const drawContacts=()=>{
            refs.contacts.replaceChildren()
            for(const contact of contacts){
                const b=button('',`conversation-item${active?.wxId===contact.wxId?' selected':''}`,()=>{
                    resetHistoryContext();active=contact;items=[];messageQuery='';before=0;moreMessages=false;refs.historySearch.value='';refs.composer.value=currentDraft().text;drawContacts();drawMessages();updateHeader();updateControls();loadHistory()
                    closeMentions()
                })
                const avatar=avatarFor(contact.wxId,contact.name,contact.hasAvatar,`contact-avatar${isGroup(contact)?' group-avatar':''}`),body=node('div','conversation-copy')
                body.append(node('strong','',contact.name),inlineNode('small','',contact.lastType==='revoke_notice'?t('messageRevoked'):ChatContent.summary(contact.lastBody)|| (contact.lastActivity?t('mediaType_'+(contact.lastType||'unknown')):`${t(isGroup(contact)?'groupChat':'contactChat')} · ${contact.nickname||contact.wxId}`)));b.append(avatar,body)
                const activity=node('div','conversation-activity')
                if(contact.lastActivity){
                    const date=new Date(contact.lastActivity*1000),time=node('time','conversation-time')
                    time.dateTime=date.toISOString();time.title=date.toLocaleString(document.documentElement.lang);time.setAttribute('aria-label',time.title)
                    time.append(node('span','',date.toLocaleDateString(document.documentElement.lang,{month:'numeric',day:'numeric'})),node('span','',date.toLocaleTimeString(document.documentElement.lang,{hour:'2-digit',minute:'2-digit',hour12:false})))
                    activity.append(time)
                }
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
                if(active){const current=contacts.find(c=>c.wxId===active.wxId);if(current){active={...active,...current};updateHeader();updateControls()}}
                refs.directoryNote.classList.toggle('hidden',result.directoryAvailable)
            }catch(error){if(!poll)notify(error.message,true)}finally{if(sequence===contactSequence){loadingContacts=false;drawContacts()}}
        }
        const updateHeader=()=>{
            refs.chatName.textContent=active?.name||t('chooseConversation')
            refs.chatSubtitle.textContent=active?`${t(isGroup(active)?'groupChat':'contactChat')} · ${active.wxId}`:t('chooseConversationHelp')
            refs.chatAvatar.replaceChildren();if(active)refs.chatAvatar.append(avatarFor(active.wxId,active.name,active.hasAvatar,'header-avatar'))
            refs.historySearch.disabled=!active
        }
        const closeMentions=()=>{clearTimeout(mentionTimer);mentionSequence++;mentionRange=null;memberChoices=[];refs.mentionPanel?.classList.add('hidden')}
        const syncDraft=(d,text,tokens)=>{
            d.text=text;d.tokens=tokens;d.mentionAll=tokens.some(m=>m.all);d.mentionedMembers=[...new Map(tokens.filter(m=>!m.all).map(m=>[m.wxId,{wxId:m.wxId,name:m.name}])).values()];d.requestId='';drafts.set(active.wxId,d)
        }
        const applyDraft=result=>{syncDraft(currentDraft(),result.text,result.tokens);beforeEdit=null;refs.composer.value=result.text;closeMentions();updateControls();refs.composer.focus();refs.composer.setSelectionRange(result.cursor,result.cursor)}
        const chooseMember=member=>{
            if(!mentionRange||!isGroup(active))return
            const d=currentDraft(),remove=m=>member.all?!m.all:m.all
            if(d.replyTo){notify(t('quoteMentionsUnsupported'),true);return}
            const start=MentionCompose.remove(d.text,d.tokens||[],remove,mentionRange.start),end=MentionCompose.remove(d.text,d.tokens||[],remove,mentionRange.end)
            if(!member.all&&!start.tokens.some(m=>m.wxId===member.wxId)&&new Set(start.tokens.filter(m=>!m.all).map(m=>m.wxId)).size>=20){notify(t('mentionLimit'),true);return}
            const result=MentionCompose.insert(start.text,start.tokens,{start:start.cursor,end:end.cursor},member)
            if(result.text.length>4000){notify(t('mentionTextTooLong'),true);return}
            applyDraft(result)
        }
        const highlightMember=()=>{refs.memberResults.querySelectorAll('.mention-member').forEach((b,i)=>{const on=i===highlighted;b.classList.toggle('highlighted',on);b.setAttribute('aria-selected',String(on));if(on){refs.memberSearch.setAttribute('aria-activedescendant',b.id);b.scrollIntoView({block:'nearest'})}})}
        const pickerKey=event=>{
            if(refs.mentionPanel.classList.contains('hidden')||event.isComposing)return false
            if(event.key==='Escape'){event.preventDefault();closeMentions();refs.composer.focus();return true}
            if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();highlighted=Math.max(0,Math.min(memberChoices.length-1,highlighted+(event.key==='ArrowDown'?1:-1)));highlightMember();return true}
            if(event.key==='Enter'){event.preventDefault();if(memberChoices[highlighted])chooseMember(memberChoices[highlighted]);return true}
            return false
        }
        const openMentions=(range,focusSearch=false)=>{
            const same=mentionRange?.start===range.start
            clearTimeout(mentionTimer);mentionSequence++;memberChoices=[];refs.memberResults.replaceChildren();highlighted=0
            mentionRange=range;refs.mentionPanel.classList.remove('hidden');refs.memberSearch.value=range.query||'';refs.memberStatus.textContent=t('mentionLoading')
            if(same&&!focusSearch)mentionTimer=setTimeout(()=>loadMembers(),180);else loadMembers()
            if(focusSearch)refs.memberSearch.focus()
        }
        const loadMembers=async(more=false)=>{
            if(!isGroup(active)||!mentionRange)return
            const wxId=active.wxId,sequence=++mentionSequence,query=refs.memberSearch.value
            refs.memberStatus.textContent=t('mentionLoading')
            if(!more){refs.memberResults.replaceChildren();memberChoices=[];highlighted=0}else refs.memberResults.querySelector('.load-more')?.remove()
            try{
                const result=await request('GET',`/api/groups/members?wxId=${encodeURIComponent(wxId)}&q=${encodeURIComponent(query)}&offset=${more?refs.memberOffset||0:0}`)
                if(sequence!==mentionSequence||active?.wxId!==wxId)return
                refs.memberOffset=result.offset;refs.memberStatus.textContent=result.members.length?'':t('mentionEmpty')
                for(const m of result.members){
                    memberChoices.push(m)
                    const b=button('','mention-member',()=>chooseMember(m));b.id='mention-option-'+memberChoices.length;b.setAttribute('role','option');b.append(node('strong','',m.name),node('small','',m.remark?m.remark+' · '+m.wxId:m.wxId));refs.memberResults.append(b)
                }
                if(['all','everyone','所有人'].includes(query.toLowerCase())&&!more){const m={all:true,name:t('mentionEveryone')};memberChoices.push(m);const b=button('','mention-member mention-everyone-option',()=>chooseMember(m));b.id='mention-option-'+memberChoices.length;b.setAttribute('role','option');b.append(node('strong','','@'+m.name));refs.memberResults.append(b)}
                if(result.hasMore)refs.memberResults.append(button(t('loadMoreContacts'),'load-more',()=>loadMembers(true)))
                highlightMember()
            }catch(e){if(sequence===mentionSequence)refs.memberStatus.textContent=e.message}
        }
        const resetHistoryContext=()=>{historyContext=false;locatingQuote=false;locateSequence++;historyGeneration++;highlightedMessage=null;clearTimeout(highlightTimer)}
        const highlightMessage=id=>{
            const target=refs.history.querySelector(`[data-message-id="${id}"]`)
            if(!target)return false
            refs.history.querySelectorAll('.quote-target').forEach(row=>row.classList.remove('quote-target'))
            highlightedMessage=id;target.classList.add('quote-target');target.tabIndex=-1;target.focus({preventScroll:true})
            const box=target.getBoundingClientRect(),container=refs.history.getBoundingClientRect()
            refs.history.scrollTo({top:Math.max(0,refs.history.scrollTop+box.top-container.top-(refs.history.clientHeight-box.height)/2),behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})
            clearTimeout(highlightTimer);highlightTimer=setTimeout(()=>{highlightedMessage=null;refs.history?.querySelectorAll('.quote-target').forEach(row=>row.classList.remove('quote-target'))},4500)
            return true
        }
        const returnToLatest=()=>{
            resetHistoryContext();historySequence++;messageQuery='';refs.historySearch.value='';items=[];before=0;moreMessages=false;drawMessages();void loadHistory()
        }
        const locateQuote=async reference=>{
            if(!active)return
            const localId=Number.isSafeInteger(Number(reference.id))&&Number(reference.id)>0?Number(reference.id):null
            const remoteId=/^[1-9][0-9]{0,19}$/.test(String(reference.remoteId||''))?String(reference.remoteId):''
            if(!localId&&!remoteId){notify(t('quoteOriginalUnavailable'),true);return}
            const existing=items.find(item=>(!localId||item.id===localId)&&(!remoteId||item.remoteId===remoteId))
            if(existing&&!messageQuery){locateSequence++;locatingQuote=false;historyGeneration++;historySequence++;if(highlightMessage(existing.id))return}
            const wxId=active.wxId,sequence=++locateSequence;locatingQuote=true;historyGeneration++;historySequence++
            const params=new URLSearchParams({wxId});if(localId)params.set('id',String(localId));if(remoteId)params.set('remoteId',remoteId)
            try{
                const result=await request('GET',`/api/messages/locate?${params}`)
                if(active?.wxId!==wxId||sequence!==locateSequence)return
                if(!result.targetId||!result.messages?.some(m=>m.id===result.targetId))throw new Error(t('quoteOriginalUnavailable'))
                if(result.serverTime)serverClockOffset=result.serverTime*1000-Date.now()
                historyContext=true;messageQuery='';refs.historySearch.value='';items=result.messages;before=result.before||items[0]?.id||0;moreMessages=result.hasMore
                drawMessages();highlightMessage(result.targetId)
            }catch(error){if(active?.wxId===wxId&&sequence===locateSequence)notify(error.message,true)}finally{if(sequence===locateSequence)locatingQuote=false}
        }
        const fetchMediaBlob=(file,epoch)=>{
            if(blobs.has(file.id))return Promise.resolve(blobs.get(file.id))
            if(blobLoads.has(file.id))return blobLoads.get(file.id)
            const promise=transfer(`/api/media/${file.id}`).then(blob=>{
                if(epoch!==mediaEpoch)throw new Error('cancelled')
                const cached={url:URL.createObjectURL(blob),mime:blob.type};blobs.set(file.id,cached);return cached
            })
            blobLoads.set(file.id,promise)
            void promise.finally(()=>{if(blobLoads.get(file.id)===promise)blobLoads.delete(file.id)}).catch(()=>{})
            return promise
        }
        const pumpMedia=()=>{
            while(mediaWorkers<3&&mediaQueue.length){
                const job=mediaQueue.shift(),{state,epoch}=job
                if(epoch!==mediaEpoch)continue
                if(!state.visible()){state.status='idle';state.render();continue}
                mediaWorkers++;state.status='loading';state.render()
                void(async()=>{
                    try{
                        const file=await request('GET',state.endpoint)
                        if(epoch!==mediaEpoch)return
                        const cached=await fetchMediaBlob(file,epoch)
                        if(epoch!==mediaEpoch)return
                        state.result={file,...cached};state.status='loaded';state.render()
                        if(job.download&&state.visible())state.card.querySelector('.download-media')?.click()
                    }catch(error){if(epoch===mediaEpoch){state.status='error';state.error=error.message;state.render()}}
                    finally{mediaWorkers--;pumpMedia()}
                })()
            }
        }
        const queueMedia=(state,retry=false,download=false)=>{
            if(['queued','loading','loaded'].includes(state.status)||state.status==='error'&&!retry)return
            state.status='queued';state.error='';mediaQueue.push({state,epoch:mediaEpoch,download});state.render();pumpMedia()
        }
        const mediaCard=(key,endpoint,kind,name,wxId,transcript=false)=>{
            if(mediaCards.has(key))return mediaCards.get(key)
            let state=mediaStates.get(key)
            if(!state){state={status:'idle',endpoint,kind,wxId,result:null};mediaStates.set(key,state)}
            const card=node('div',transcript?'transcript-attachment':'chat-media-card'),image=['image','emoji'].includes(kind)
            state.card=card
            state.visible=()=>{
                if(!root?.contains(card)||active?.wxId!==wxId||!isActive())return false
                for(let parent=card.parentElement;parent&&parent!==root;parent=parent.parentElement)if(parent.tagName==='DETAILS'&&!parent.open)return false
                return true
            }
            state.render=()=>{
                // A finished request may fill the cache after switching chats,
                // but cannot alter the newly selected conversation or toast.
                if(state.card!==card||active?.wxId!==wxId||!root?.contains(card))return
                if(card.mediaSignature===`${state.status}:${state.result?.url||''}:${state.error||''}`)return
                drawCard()
            }
            const drawCard=()=>{
                card.mediaSignature=`${state.status}:${state.result?.url||''}:${state.error||''}`
                card.classList.toggle('media-loading',['queued','loading'].includes(state.status))
                card.classList.toggle('media-error',state.status==='error');card.setAttribute('aria-busy',String(['queued','loading'].includes(state.status)))
                card.replaceChildren()
                if(state.status==='loaded'){
                    const {file,url}=state.result
                    if(image){
                        const preview=node('img','chat-media-image');preview.src=url;preview.alt=file.name;preview.decoding='async';preview.tabIndex=0;preview.setAttribute('role','button');preview.setAttribute('aria-label',t('enlargeImage'));preview.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openImage(preview)}})
                        preview.addEventListener('error',()=>{if(state.result?.url!==url)return;const cached=blobs.get(file.id);if(cached?.url===url){URL.revokeObjectURL(url);blobs.delete(file.id)}state.status='error';state.error=t('imagePreviewFailed');state.result=null;state.render()},{once:true})
                        card.append(preview)
                    }else if(['video','voice','audio'].includes(kind)){const player=node(kind==='video'?'video':'audio','chat-media-player');player.controls=true;player.preload='metadata';player.src=url;card.append(player)}
                    else card.append(node('strong','',name||file.name||t('mediaType_'+kind)))
                    const download=node('a','download-media',`${t('downloadFile')} · ${file.name}`);download.href=url;download.download=file.name;card.append(download)
                    return
                }
                if(!image)card.append(node('strong','',transcript?`${t('mediaType_'+kind)} · ${name}`:t('mediaType_'+kind)),node('span','',transcript?'':name||''))
                const busy=['queued','loading'].includes(state.status)
                if(image&&busy){const placeholder=node('div','image-loading-placeholder');placeholder.append(node('span','image-placeholder-icon','▧'),node('span','',t('loadingImage')));placeholder.setAttribute('role','status');card.append(placeholder)}
                else{
                    const action=button(t(state.status==='error'?'retryMedia':kind==='file'?'downloadFile':'viewMedia'),'view-media',()=>queueMedia(state,true,transcript&&kind==='file'));action.disabled=busy
                    if(state.status==='error'){const error=node('span','media-error-text',t(image?'imagePreviewFailed':'mediaLoadFailed'));error.title=state.error||'';card.append(error)}
                    card.append(action)
                }
            }
            card.activateMedia=()=>{state.render();if(image&&state.visible())queueMedia(state)}
            drawCard();mediaCards.set(key,card);return card
        }
        const activateImages=()=>{if(!refs.history)return;for(const card of refs.history.querySelectorAll('.chat-media-card,.transcript-attachment'))card.activateMedia?.()}
        const transcriptAttachmentCard=(message,attachment)=>mediaCard(`transcript:${active.wxId}:${message.id}:${attachment.path}:${attachment.id}`,`/api/media/transcript/${message.id}?path=${encodeURIComponent(attachment.path)}&id=${encodeURIComponent(attachment.id)}`,attachment.type,attachment.name,active.wxId,true)
        const transcriptView=(message,record,depth=0)=>{
            const key=`${active.wxId}:${message.id}:${record.path}`,details=node('details',`chat-transcript${depth?' nested-transcript':''}`)
            details.dataset.transcriptPath=record.path;details.open=expandedTranscripts.has(key)
            const summary=inlineNode('summary','',depth?(record.title||t('nestedTranscriptTitle')):t('transcriptTitle'));details.append(summary)
            details.addEventListener('toggle',e=>{if(e.target!==details)return;if(details.open){expandedTranscripts.add(key);activateImages()}else expandedTranscripts.delete(key)})
            if(record.content)details.append(inlineNode('div','chat-text transcript-content',record.content))
            for(const attachment of record.attachments||[])details.append(transcriptAttachmentCard(message,attachment))
            if(depth<6)for(const child of record.children||[])details.append(transcriptView(message,child,depth+1))
            if(record.truncated||depth>=6&&record.children?.length)details.append(node('p','transcript-limit',t('transcriptTruncated')))
            return details
        }
        const drawMessages=()=>{
            const signature=JSON.stringify({active:active?.wxId,moreMessages,historyContext,items})
            if(signature===lastDrawSignature)return
            lastDrawSignature=signature
            const scrollBottom=refs.history.scrollHeight-refs.history.scrollTop-refs.history.clientHeight<80
            const previousHeight=refs.history.scrollHeight
            refs.history.replaceChildren()
            if(!active){const empty=node('div','chat-welcome');empty.append(icon('message'),node('h3','',t('chooseConversation')),node('p','',t('chooseConversationHelp')));refs.history.append(empty);return}
            if(historyContext)refs.history.append(button(t('backToLatestMessages'),'return-latest-messages',returnToLatest))
            if(moreMessages)refs.history.append(button(t('loadOlderMessages'),'load-more',()=>loadHistory(true)))
            if(!items.length)refs.history.append(node('div','inbox-empty',t('noMessages')))
            let day=''
            for(const message of items){
                const articles=message.type==='link'&&Array.isArray(message.details?.articles)?message.details.articles.filter(article=>article&&typeof article==='object'):[]
                const structuredLink=message.type==='link'&&Boolean(articles.length||message.details?.title||message.details?.description||articleURL(message.details?.url))
                const date=message.timestamp?new Date(message.timestamp*1000):null
                const formattedDay=date?date.toLocaleDateString(document.documentElement.lang):t('unknownDate')
                if(formattedDay!==day){refs.history.append(node('div','chat-date',formattedDay));day=formattedDay}
                const row=node('div',`chat-row ${message.direction}${isGroup(active)?' group-message':''}`),bubble=node('div','chat-bubble'),column=node('div','chat-message-column')
                row.dataset.messageId=message.id;if(highlightedMessage===message.id)row.classList.add('quote-target')
                if(message.details?.replyTo){const ref=message.details.replyTo,quote=button('','message-quote',()=>locateQuote(ref));quote.title=t('locateQuotedMessage');quote.setAttribute('aria-label',`${t('locateQuotedMessage')} · ${ref.name||ref.senderId||''} · ${ref.preview||''}`);quote.append(inlineNode('strong','',ref.name||ref.senderId||t('quoteMessage')),inlineNode('p','',ref.preview||''),node('span','quote-jump-hint',t('locateQuotedMessage')));bubble.append(quote)}
                const senderName=message.senderDisplayName||ChatContent.summary(message.senderName||message.senderId)||active.name
                const avatarId=message.senderId|| (message.direction==='incoming'&&!isGroup(active)?active.wxId:null)
                row.append(avatarFor(avatarId,senderName,message.senderHasAvatar||avatarId===active.wxId&&active.hasAvatar,'message-avatar'))
                if(message.direction!=='outgoing'&&isGroup(active))column.append(node('div','chat-sender',senderName))
                const recallNotice=message.type==='revoke_notice'
                if(recallNotice){row.classList.add('revoke-notice-row');bubble.append(node('p','revoke-notice-text',t('messageRevoked')))}
                if(['image','emoji','video','audio','voice','file'].includes(message.type)){
                    if(message.details?.attachmentUnavailable===true&&!message.attachmentId){
                        const card=node('div','chat-media-card media-error');card.append(node('strong','',message.details?.title||t('mediaType_'+message.type)),node('span','media-error-text',t('telegramAttachmentUnavailable')));bubble.append(card)
                    }else bubble.append(mediaCard(`message:${active.wxId}:${message.id}`,`/api/media/message/${message.id}`,message.type,message.details?.title||'',active.wxId))
                }else if(message.type==='link'&&message.details){
                    if(articles.length){const list=node('div','official-article-list');for(const article of articles)list.append(articleCard(article));bubble.append(list)}
                    else{const card=node('div','rich-message-card');card.append(inlineNode('strong','',message.details.title||t('mediaType_link')),inlineNode('p','',message.details.description||''));const url=articleURL(message.details.url);if(url){const link=node('a','preview-link',t('readArticle'));link.href=url;link.target='_blank';link.rel='noopener noreferrer';card.append(link)}bubble.append(card)}
                }
                else if(['location','contact'].includes(message.type)){const card=node('div','rich-message-card');card.append(node('strong','',t('mediaType_'+message.type)),node('p','',message.details?.title||''),node('small','',message.type==='contact'?(message.details?.wxId||''):[message.details?.latitude,message.details?.longitude].filter(v=>Number.isFinite(v)).join(', ')));bubble.append(card)}
                if(message.transcript){
                    bubble.append(transcriptView(message,message.transcript))
                }else if(!structuredLink&&message.type!=='revoke_notice'&&(message.body||!['image','emoji','video','audio','voice','file','contact','location','link'].includes(message.type))){
                    const content=node('div','chat-text');content.append(ChatContent.render(document,message.body||message.details?.title||t('mediaMessage'),message.bodyFormat,TemplatePreview.richText))
                    if(ChatContent.isTranscript(message.body,message.type)){
                        const details=node('details','chat-transcript');details.append(node('summary','',t('transcriptTitle')),content)
                        for(const attachment of message.transcriptAttachments||[])details.append(transcriptAttachmentCard(message,attachment))
                        details.addEventListener('toggle',()=>{if(details.open)activateImages()});bubble.append(details)
                    }else bubble.append(content)
                }
                const fromTelegram=message.details?.origin==='telegram'
                const meta=node('div',`chat-meta${message.status==='unknown'?' uncertain':''}`)
                meta.textContent=[date?date.toLocaleTimeString(document.documentElement.lang,{hour:'2-digit',minute:'2-digit'}):'',fromTelegram?t('messageFromTelegram'):'',message.direction==='outgoing'?t(`messageStatus_${message.status}`):'',!fromTelegram&&message.telegramStatus&&message.telegramStatus!=='none'?t(`telegramStatus_${message.telegramStatus}`):''].filter(Boolean).join(' · ')
                if(message.details?.error)meta.textContent+=' · '+t(message.details.error)
                if(message.revokeStatus&&!['none','revoked'].includes(message.revokeStatus))meta.textContent+=' · '+t('revokeStatus_'+message.revokeStatus)
                meta.classList.toggle('sync-alert',fromTelegram?['failed','unknown'].includes(message.status):['pending','syncing','failed'].includes(message.telegramStatus))
                if(message.telegramStatus==='synced'&&!fromTelegram){meta.textContent=date?date.toLocaleTimeString(document.documentElement.lang,{hour:'2-digit',minute:'2-digit'}):'';const sent=node('span','receipt-confirmed');sent.append(icon('check'));sent.title=t('telegramStatus_synced');sent.setAttribute('aria-label',t('telegramStatus_synced'));meta.append(sent)}
                if(recallNotice){meta.textContent=date?date.toLocaleTimeString(document.documentElement.lang,{hour:'2-digit',minute:'2-digit'}):'';meta.className='chat-meta'}
                else if(message.revokeStatus==='revoked')meta.append(node('span','recalled-badge',t('recalledLabel')))
                column.append(bubble,meta);row.append(column);refs.history.append(row)
                if(recallNotice)continue
                const canQuote=message.type!=='revoke_notice'&&message.revokeStatus!=='revoked'&&/^\d{1,30}$/.test(message.remoteId||'')&&!/^0+$/.test(message.remoteId)&&['received','submitted'].includes(message.status)
                const reply=button(t('quoteMessage'),'message-reply',()=>{
                    const d=currentDraft();if(d.mentionAll||d.mentionedMembers?.length){notify(t('quoteMentionsUnsupported'),true);return}
                    d.replyTo={id:message.id,name:message.senderDisplayName||ChatContent.summary(message.senderName)||message.senderId||active.name,preview:ChatContent.summary(message.body)||message.details?.title||t('mediaType_'+message.type)};d.requestId='';drafts.set(active.wxId,d);closeMentions();updateControls();refs.composer.focus()
                });reply.disabled=!canQuote;if(!canQuote)reply.title=t('quoteUnavailable');meta.append(reply)
                if(message.direction==='outgoing'&&message.revokeStatus!=='revoked'){
                    const revoke=button(t('revokeMessage'),'message-revoke',async()=>{
                        if(withdrawing.has(message.id)||!window.confirm(t(message.revokeStatus==='unknown'?'confirmRevokeUnknown':'confirmRevoke')))return
                        withdrawing.add(message.id);revoke.disabled=true
                        try{const result=await request('POST',`/api/messages/${message.id}/revoke`,{requestId:requestId(),confirm:true,confirmUncertain:message.revokeStatus==='unknown'});notify(t('revokeStatus_'+result.revokeStatus),result.revokeStatus!=='revoked');await loadHistory();await loadContacts(false,true)}catch(e){notify(e.message,true)}finally{withdrawing.delete(message.id);revoke.disabled=!message.canRevoke}
                    });revoke.dataset.id=message.id;revoke.dataset.deadline=message.revokeDeadline;revoke.dataset.available=String(Boolean(message.canRevoke));revoke.disabled=!message.canRevoke||withdrawing.has(message.id);if(!message.canRevoke)revoke.title=t(message.revokeUnavailableReason||'revokeUnavailable');meta.append(revoke)
                }
                if(message.revokeStatus==='revoked'&&message.revokeTelegramStatus==='failed')meta.append(button(t('syncRevokeTelegram'),'retry-telegram',async()=>{try{await request('POST',`/api/messages/${message.id}/sync`,{confirm:true});await loadHistory()}catch(e){notify(e.message,true)}}))
                if(!fromTelegram&&message.revokeStatus!=='revoked'&&['pending','failed','unknown','unverified'].includes(message.telegramStatus)&&['received','submitted'].includes(message.status)){
                    const retry=button(t('retryTelegramOnly'),'retry-telegram',async()=>{
                        const uncertain=['unknown','unverified'].includes(message.telegramStatus)
                        const confirmed=!uncertain||window.confirm(t('confirmTelegramRetry'));if(!confirmed)return
                        retry.disabled=true
                        try{const result=await request('POST',`/api/messages/${message.id}/sync`,{confirm:uncertain});message.telegramStatus=result.telegramStatus;await loadHistory();await loadContacts(false,true)}catch(e){notify(e.message,true)}finally{retry.disabled=false}
                    });bubble.append(retry)
                }
            }
            activateImages();updateRevokeButtons()
            if(scrollBottom)refs.history.scrollTop=refs.history.scrollHeight
            else if(previousHeight&&refs.history.scrollHeight>previousHeight)refs.history.scrollTop+=refs.history.scrollHeight-previousHeight
        }
        const loadHistory=async(older=false,poll=false)=>{
            if(!active||poll&&(historyContext||locatingQuote))return
            const generation=historyGeneration,wxId=active.wxId,key=`${wxId}:${generation}:${older?before:0}:${messageQuery}`
            if(pendingHistory.has(key))return
            pendingHistory.add(key)
            const sequence=++historySequence,previousMore=moreMessages
            try{
                const result=await request('GET',`/api/messages?wxId=${encodeURIComponent(wxId)}&before=${older?before:0}&q=${encodeURIComponent(messageQuery)}`)
                if(result.serverTime)serverClockOffset=result.serverTime*1000-Date.now()
                if(active?.wxId!==wxId||sequence!==historySequence||generation!==historyGeneration)return
                const merged=[...new Map([...items,...result.messages].map(m=>[m.id,m])).values()].sort((a,b)=>a.timestamp-b.timestamp||a.id-b.id)
                // Retain loaded history while replacing the status of queued messages.
                items=merged;before=items[0]?.id||0;moreMessages=older?result.hasMore:items.length>50?previousMore:result.hasMore;drawMessages()
            }catch(error){if(!poll)notify(error.message,true)}finally{pendingHistory.delete(key)}
        }
        const submit=async()=>{
            if(!active||sending||uploading||!status.wechatOnline||(!currentDraft().text.trim()&&!currentDraft().attachment))return
            if(currentDraft().replyTo&&!currentDraft().text.trim())return
            const wxId=active.wxId,draft=currentDraft();if(!draft.requestId)draft.requestId=requestId();drafts.set(wxId,draft);sending=true;updateControls()
            try{
                const results=[]
                if(draft.text.trim())results.push(await request('POST','/api/messages',{wxId,body:draft.text,requestId:draft.attachment?draft.requestId+'-text':draft.requestId,mentions:{all:Boolean(draft.mentionAll),memberIds:(draft.mentionedMembers||[]).map(m=>m.wxId),inline:true},...(draft.replyTo?{replyToId:draft.replyTo.id}:{})}))
                if(draft.attachment)results.push(await request('POST','/api/messages',{wxId,body:'',requestId:draft.requestId+'-file',attachmentId:draft.attachment.id}))
                const result=results.at(-1)
                if(draft.previewURL)URL.revokeObjectURL(draft.previewURL);drafts.set(wxId,{text:'',requestId:''})
                if(active?.wxId===wxId){refs.composer.value='';if(historyContext)returnToLatest();else{items=[...new Map([...items,...results].map(m=>[m.id,m])).values()];drawMessages();await loadHistory()}}
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
            mentionSequence++
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
            const toolbar=node('div','chat-toolbar');refs.historySearch=node('input');refs.historySearch.type='search';refs.historySearch.maxLength=100;refs.historySearch.placeholder=t('searchMessages');refs.historySearch.setAttribute('aria-label',t('searchMessages'));refs.historySearch.value=messageQuery;refs.historySearch.addEventListener('input',()=>{resetHistoryContext();messageQuery=refs.historySearch.value;clearTimeout(historyTimer);historyTimer=setTimeout(()=>{items=[];before=0;loadHistory()},250)});toolbar.append(icon('search'),refs.historySearch);chat.append(toolbar)
            refs.history=node('div','chat-history');refs.history.setAttribute('role','log');refs.history.setAttribute('aria-label',t('messageHistory'));chat.append(refs.history)
            const composer=node('form','chat-composer');composer.addEventListener('submit',e=>{e.preventDefault();submit()})
            const tools=node('div','composer-tools'),pick=node('input'),voicePick=node('input');pick.type=voicePick.type='file';pick.className=voicePick.className='hidden';voicePick.accept='audio/*,.webm';pick.addEventListener('change',()=>{upload(pick.files[0],'auto');pick.value=''});voicePick.addEventListener('change',()=>{upload(voicePick.files[0],'voice');voicePick.value=''})
            refs.attach=button(t('attachMedia'),'composer-tool',()=>pick.click());refs.voice=button(t('attachVoice'),'composer-tool',()=>voicePick.click());refs.mention=button(t('mentionMembers'),'composer-tool',()=>{if(!refs.mentionPanel.classList.contains('hidden'))closeMentions();else openMentions({start:refs.composer.selectionStart,end:refs.composer.selectionEnd,query:''},true)});tools.append(refs.attach,refs.voice,refs.mention,node('small','',t('mediaLimit')),pick,voicePick);refs.attachment=node('div','selected-attachment');refs.selectedMentions=node('div','selected-mentions');refs.replyPreview=node('div','quote-preview hidden');composer.append(tools,refs.attachment,refs.selectedMentions,refs.replyPreview)
            refs.mentionPanel=node('section','mention-panel hidden');const mentionHead=node('div','mention-panel-heading');mentionHead.append(node('strong','',t('mentionMembers')),button('×','icon-button',()=>{closeMentions();refs.composer.focus()}))
            refs.memberSearch=node('input');refs.memberSearch.type='search';refs.memberSearch.maxLength=100;refs.memberSearch.placeholder=t('mentionSearch');refs.memberSearch.setAttribute('aria-label',t('mentionSearch'));refs.memberSearch.setAttribute('aria-autocomplete','list');refs.memberSearch.addEventListener('keydown',pickerKey);refs.memberSearch.addEventListener('input',()=>{clearTimeout(mentionTimer);mentionSequence++;memberChoices=[];refs.memberResults.replaceChildren();mentionTimer=setTimeout(()=>loadMembers(),180)})
            const all=button('@'+t('mentionEveryone'),'mention-all',()=>chooseMember({all:true,name:t('mentionEveryone')}));refs.memberStatus=node('p','mention-status');refs.memberStatus.setAttribute('role','status');refs.memberResults=node('div','mention-results');refs.memberResults.setAttribute('role','listbox');refs.memberResults.setAttribute('aria-label',t('mentionMembers'));refs.mentionPanel.append(mentionHead,refs.memberSearch,all,node('small','',t('mentionKeyboardHelp')),refs.memberStatus,refs.memberResults);composer.append(refs.mentionPanel)
            refs.composer=node('textarea');refs.composer.rows=3;refs.composer.maxLength=4000;refs.composer.placeholder=t('writeMessage');refs.composer.setAttribute('aria-label',t('writeMessage'));refs.composer.value=currentDraft().text
            refs.composer.addEventListener('beforeinput',event=>{beforeEdit={start:refs.composer.selectionStart,end:refs.composer.selectionEnd,type:event.inputType}})
            refs.composer.addEventListener('input',()=>{if(!active)return;const d=currentDraft(),text=refs.composer.value,edit=beforeEdit;beforeEdit=null;if(edit&&edit.start===edit.end&&edit.type?.startsWith('delete')){const deleted=d.text.length-text.length;if(edit.type.endsWith('Backward'))edit.start-=deleted;else edit.end+=deleted}syncDraft(d,text,MentionCompose.reconcile(d.text,text,d.tokens||[],edit));updateControls();const range=isGroup(active)?MentionCompose.queryAt(text,refs.composer.selectionStart):null;if(range)openMentions(range);else closeMentions()})
            refs.composer.addEventListener('keydown',e=>{if(pickerKey(e))return;if(!e.isComposing&&(e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();submit()}})
            const composerFooter=node('div','composer-footer');refs.counter=node('span');const tips=node('div','composer-tips');tips.append(node('span','',t('sendShortcut')),refs.counter);refs.send=node('button','button primary',t('sendMessage'));refs.send.type='submit';composerFooter.append(tips,refs.send);composer.append(refs.composer,composerFooter,node('p','send-note',t('sendStatusNote')));chat.append(composer);root.append(directory,chat)
            refs.composer.addEventListener('paste',event=>{const file=ChatContent.clipboardImage(event.clipboardData);if(file&&active){event.preventDefault();upload(file,'auto')}})
            refs.composer.addEventListener('click',()=>{if(!refs.mentionPanel.classList.contains('hidden')){const range=MentionCompose.queryAt(refs.composer.value,refs.composer.selectionStart);if(range)mentionRange=range;else closeMentions()}})
            refs.composer.title=t('pasteHint');refs.directoryNote.insertAdjacentElement('afterend',node('p','delivery-legend',t('deliveryLegend')))
            viewerResize?.disconnect()
            refs.imageDialog=node('dialog','image-lightbox');refs.imageDialog.setAttribute('aria-label',t('viewMedia'))
            const imageToolbar=node('div','lightbox-toolbar'),imageTools=node('div','lightbox-tools')
            const control=(label,symbol,action)=>{const b=button(symbol,'lightbox-control',action);b.title=label;b.setAttribute('aria-label',label);return b}
            refs.zoomOut=control(t('imageZoomOut'),'−',()=>changeZoom(1/1.25));refs.zoomIn=control(t('imageZoomIn'),'+',()=>changeZoom(1.25));refs.imageZoom=node('span','lightbox-zoom','100%')
            imageTools.append(refs.zoomOut,refs.imageZoom,refs.zoomIn,control(t('imageRotateLeft'),'↶',()=>rotateImage(-90)),control(t('imageRotateRight'),'↷',()=>rotateImage(90)),control(t('imageFit'),'⤢',()=>{viewer={zoom:1,rotation:0,x:0,y:0};fitImage()}))
            refs.imageClose=control(t('closeImagePreview'),'×',()=>refs.imageDialog.close());refs.imageClose.classList.add('lightbox-close');imageToolbar.append(imageTools,refs.imageClose)
            refs.imageStage=node('div','lightbox-stage');refs.largeImage=node('img','lightbox-image');refs.largeImage.draggable=false;refs.largeImage.addEventListener('load',fitImage);refs.imageStage.append(refs.largeImage);refs.imageDialog.append(imageToolbar,refs.imageStage);root.append(refs.imageDialog)
            viewerResize=new ResizeObserver(fitImage);viewerResize.observe(refs.imageStage)
            refs.imageStage.addEventListener('wheel',e=>{e.preventDefault();changeZoom(e.deltaY<0?1.1:1/1.1)},{passive:false})
            refs.imageStage.addEventListener('pointerdown',e=>{if(viewer.zoom<=1)return;viewerDrag={id:e.pointerId,x:e.clientX,y:e.clientY,originX:viewer.x,originY:viewer.y};refs.imageStage.setPointerCapture(e.pointerId)})
            refs.imageStage.addEventListener('pointermove',e=>{if(!viewerDrag||viewerDrag.id!==e.pointerId)return;viewer.x=viewerDrag.originX+e.clientX-viewerDrag.x;viewer.y=viewerDrag.originY+e.clientY-viewerDrag.y;fitImage()})
            const endDrag=()=>{viewerDrag=null};refs.imageStage.addEventListener('pointerup',endDrag);refs.imageStage.addEventListener('pointercancel',endDrag);refs.imageDialog.addEventListener('close',endDrag)
            refs.imageDialog.addEventListener('click',e=>{if(e.target===refs.imageDialog)refs.imageDialog.close()})
            refs.imageDialog.addEventListener('keydown',e=>{if(e.key==='+'||e.key==='='){e.preventDefault();changeZoom(1.25)}else if(e.key==='-'){e.preventDefault();changeZoom(1/1.25)}})
            root.addEventListener('click',e=>{const image=e.target.closest('.chat-media-image,.draft-image');if(image)openImage(image)})
            updateHeader();updateControls();drawContacts();drawMessages();refreshStatus();loadContacts();if(active)loadHistory()
        }
        setInterval(()=>{if(isActive()&&!document.hidden){refreshStatus();loadHistory(false,true);if(!loadingContacts&&offset<=60)loadContacts(false,true)}},5000)
        setInterval(()=>{if(isActive()&&!document.hidden)updateRevokeButtons()},1000)
        const hasDraft=()=>uploading||[...drafts.values()].some(draft=>draft.text.trim()||draft.attachment||draft.replyTo||draft.mentionAll||draft.mentionedMembers?.length)
        const clear=()=>{mediaEpoch++;mediaQueue.length=0;mediaStates.clear();blobLoads.clear();resetHistoryContext();historySequence++;viewerResize?.disconnect();for(const blob of blobs.values())URL.revokeObjectURL(blob.url);for(const d of drafts.values())if(d.previewURL)URL.revokeObjectURL(d.previewURL);for(const promise of avatars.values())promise.then(url=>{if(url)URL.revokeObjectURL(url)});avatars.clear();blobs.clear();mediaCards.clear();expandedTranscripts.clear();lastDrawSignature='';drafts.clear();contacts=[];items=[];active=null;status={available:false,wechatOnline:false};root?.replaceChildren();root=null}
        return {show,hasDraft,clear}
    },
}
