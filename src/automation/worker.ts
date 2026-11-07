// This trusted worker hosts QuickJS/WASM. User source never executes in Node/vm.
import {parentPort, workerData} from 'node:worker_threads'
import {getQuickJS} from 'quickjs-emscripten'

async function main() {
    const QuickJS = await getQuickJS()
    const runtime = QuickJS.newRuntime()
    runtime.setMemoryLimit(16 * 1024 * 1024)
    runtime.setMaxStackSize(256 * 1024)
    const deadline = Date.now() + 200
    runtime.setInterruptHandler(() => Date.now() > deadline)
    runtime.setModuleLoader(name => {
        if (name !== 'user-script') throw new Error('importsDisabled')
        return workerData.source
    })
    const vm = runtime.newContext()
    try {
        const input = JSON.stringify({event:workerData.event,params:workerData.params,state:workerData.state || {},permissions:workerData.permissions || []})
        const bootstrap = `
          const input = JSON.parse(${JSON.stringify(input)});
          const freeze = value => {if(value && typeof value === 'object'){Object.values(value).forEach(freeze);Object.freeze(value)};return value};
          const clone = value => JSON.parse(JSON.stringify(value));
          const output = {actions:[],logs:[],state:clone(input.state)};
          const check = kind => {if(!input.permissions.includes(kind))throw Error('permissionDenied:'+kind)};
          const add = action => {check(action.kind);if(output.actions.length>=5)throw Error('tooManyActions');output.actions.push(clone(action));return {planned:true}};
          globalThis.__event = freeze(input.event);
          globalThis.__params = freeze(input.params);
          globalThis.__api = Object.freeze({
            replyText:text => add({kind:'reply',text}),
            sendText:(target,text) => add({kind:'send',target,text}),
            solitaire:Object.freeze({join:args=>add({kind:'solitaire.join',...args}),create:args=>add({kind:'solitaire.create',...args})}),
            state:Object.freeze({get:key=>{check('state');return Object.hasOwn(output.state,key)?clone(output.state[key]):undefined},set:(key,value)=>{check('state');if(typeof key!=='string'||key.length>100||['__proto__','constructor','prototype'].includes(key))throw Error('invalidStateKey');output.state[key]=clone(value)}}),
            log:value=>{if(output.logs.length>=20)throw Error('tooManyLogs');output.logs.push(String(value).slice(0,500))}
          });
          globalThis.__result = () => JSON.stringify(output);
        `
        vm.unwrapResult(vm.evalCode(bootstrap)).dispose()
        const source = workerData.validateOnly
            ? 'import handler from "user-script"; if(typeof handler!=="function")throw Error("defaultHandlerRequired");'
            : 'import handler from "user-script"; if(typeof handler!=="function")throw Error("defaultHandlerRequired"); globalThis.__done=Promise.resolve(handler(__event,__api,__params));'
        vm.unwrapResult(vm.evalCode(source,'automation-entry.mjs',{type:'module'})).dispose()
        let steps = 0
        while (runtime.hasPendingJob()) {
            if (++steps > 1000 || Date.now() > deadline) throw new Error('scriptTimeout')
            runtime.executePendingJobs(1).unwrap()
        }
        if (!workerData.validateOnly) {
            const promise = vm.getProp(vm.global,'__done')
            try {
                const state = vm.getPromiseState(promise)
                if (state.type === 'pending') throw new Error('pendingPromiseNotSupported')
                vm.unwrapResult(state).dispose()
            } finally {promise.dispose()}
        }
        const result = vm.unwrapResult(vm.evalCode('__result()'))
        try {
            const text = vm.getString(result)
            if (Buffer.byteLength(text) > 32000) throw new Error('scriptOutputTooLarge')
            parentPort.postMessage({ok:true,value:JSON.parse(text)})
        } finally {result.dispose()}
    } finally {vm.dispose();runtime.dispose()}
}
void main().catch(error => {
    // QuickJS errors can include script text. Never log to the application console.
    const message = typeof error?.message === 'string' ? error.message.slice(0,300) : 'scriptFailed'
    parentPort.postMessage({ok:false,error:message})
})