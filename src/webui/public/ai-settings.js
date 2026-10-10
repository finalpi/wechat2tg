window.AISettingsUI={
    render(container,{t,node,request,getValues,onModel}){
        const card=node('section','ai-connect-card'),heading=node('div','ai-connect-heading');heading.append(node('h3','',t('aiToolsTitle')),node('span','ai-tools-tag','API'));card.append(heading,node('p','',t('aiToolsHelp')))
        const actions=node('div','ai-connect-actions'),models=node('button','button secondary',t('aiReadModels')),test=node('button','button primary',t('aiTestModel'));models.type=test.type='button';actions.append(models,test);card.append(actions)
        const status=node('p','ai-connect-status');status.setAttribute('role','status');card.append(status)
        const label=node('label','ai-model-selector-label',t('aiChooseModel')),select=node('select','ai-model-selector');select.setAttribute('aria-label',t('aiChooseModel'));select.disabled=true;card.append(label,select)
        select.addEventListener('change',()=>{if(select.value)onModel(select.value)})
        let busy=false
        const execute=async action=>{
            if(busy)return;busy=true;models.disabled=test.disabled=true;status.textContent=t('aiWorking');status.classList.remove('error-text')
            try{
                const values=getValues(),result=await request('POST','/api/ai/'+action,{url:values.url,key:values.key,model:values.model})
                if(action==='models'){
                    select.replaceChildren(node('option','',t('aiChooseModel')));select.firstChild.value=''
                    for(const name of result.models){const option=node('option','',name);option.value=name;select.append(option)}
                    select.disabled=!result.models.length;status.textContent=`${result.models.length} ${t('aiModelsLoaded')}`
                }else status.textContent=`${t('aiTestSuccess')} · ${result.model} · ${result.elapsedMs} ms${result.reply?' · '+result.reply:' · '+t('aiEmptyReply')}`
            }catch(error){status.textContent=error.message;status.classList.add('error-text')}finally{busy=false;models.disabled=test.disabled=false}
        }
        models.addEventListener('click',()=>execute('models'));test.addEventListener('click',()=>execute('test'));container.prepend(card)
    },
}
