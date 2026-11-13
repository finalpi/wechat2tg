/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('node:fs'),path = require('node:path'),vm = require('node:vm'),ts = require('typescript')
// Isolate the actual policy/renderer for legacy transport/routing contracts.
// Explicit enhanced + text fallback preserves those tests' chosen presentation;
// auto/compatible and real permission fallback have dedicated integration tests.
module.exports = function presentationFixture({mode = 'enhanced',fallback = 'text',policy} = {}){
  const source = fs.readFileSync(path.join(__dirname,'../../src/util/TelegramPresentation.ts'),'utf8')
  const compiled = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.CommonJS}}).outputText
  const dependencies = {
    'node:timers':require('node:timers'),
    '../config':{config:{TELEGRAM_DISPLAY_MODE:mode,TELEGRAM_EMOJI_FALLBACK:fallback}},
    './TelegramDisplayPolicy':{...require('../../dist/util/TelegramDisplayPolicy'),
      ...(policy ? {TelegramDisplayPolicy:class {constructor(){return policy}}} : {})},
    './WechatCustomEmoji':require('../../dist/util/WechatCustomEmoji'),
    './DirectoryPageDelivery':require('../../dist/util/DirectoryPageDelivery'),
  }
  const exports = {}
  vm.runInNewContext(compiled,{exports,require:name=>{
    if(!Object.hasOwn(dependencies,name))throw Error(`Unexpected presentation dependency ${name}`)
    return dependencies[name]
  }})
  return exports
}
