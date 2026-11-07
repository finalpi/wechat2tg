import {Worker} from 'node:worker_threads'
import path from 'node:path'
import {AutomationError, AutomationEvent, Permission, SandboxResult} from './contracts'

export function sandbox(source:string,event:AutomationEvent,params:Record<string,unknown>,permissions:Permission[],state:Record<string,unknown> = {},validateOnly = false):Promise<SandboxResult> {
    if (Buffer.byteLength(source) > 20000 || Buffer.byteLength(JSON.stringify({event,params,state})) > 64000) return Promise.reject(new AutomationError('scriptInputTooLarge'))
    return new Promise((resolve,reject) => {
        // Empty environment and no inherited NODE_OPTIONS/preloads. QuickJS has
        // no host function bridge: only JSON input and a proposed JSON plan.
        const worker = new Worker(path.join(__dirname,'worker.js'),{workerData:{source,event,params,permissions,state:permissions.includes('state') ? state : {},validateOnly},env:{},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:64,maxYoungGenerationSizeMb:16,stackSizeMb:2}})
        let settled = false
        const finish = (error?:Error,value?:SandboxResult) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            void worker.terminate()
            if (error) reject(error)
            else resolve(value)
        }
        const timer = setTimeout(() => finish(new AutomationError('scriptTimeout')),2000)
        worker.once('error',() => finish(new AutomationError('scriptWorkerFailed')))
        worker.once('exit',() => {if (!settled) finish(new AutomationError('scriptWorkerExited'))})
        worker.once('message',message => {
            if (message?.ok !== true) return finish(new AutomationError(String(message?.error || 'scriptFailed').slice(0,300)))
            finish(undefined,message.value)
        })
    })
}