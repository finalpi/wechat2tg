export type MessageChange = {type:'messages'|'contacts'|'status';wxId?:string;ids?:number[]}

export function createMessageEvents() {
    const listeners = new Set<{listener:(event:MessageChange)=>void}>()
    return {
        subscribe(listener:(event:MessageChange)=>void):()=>void {
            const subscription = {listener}
            listeners.add(subscription)
            return ()=>{listeners.delete(subscription)}
        },
        publish(event:MessageChange):void {
            if(!['messages','contacts','status'].includes(event.type))return
            // Copy only public invalidation hints, never arbitrary caller data.
            const safe:MessageChange = {type:event.type}
            if(typeof event.wxId === 'string' && event.wxId.length <= 256)safe.wxId = event.wxId
            if(event.ids?.length && event.ids.length <= 100){
                safe.ids = [...new Set(event.ids.filter(id=>Number.isSafeInteger(id) && id > 0))]
                Object.freeze(safe.ids)
            }
            Object.freeze(safe)
            // Synchronous delivery has no accumulating queue. Each subscription
            // is independent; throwing/rejecting listeners cannot break a write.
            for(const subscription of [...listeners]){
                if(!listeners.has(subscription))continue
                try{void Promise.resolve(subscription.listener(safe)).catch(()=>undefined)}catch{ /* Subscribers must not affect writers or other subscribers. */ }
            }
        },
    }
}

// Directory/connectivity publishers use this bus. Inbox changes stay on their
// store instance so test stores and independent databases cannot cross-talk.
export const messageEvents = createMessageEvents()