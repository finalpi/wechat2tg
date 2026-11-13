import type {TelegramHomeScreenStatus,TelegramWebApp} from './telegram-mini-app'

export interface HomeScreenState {status:TelegramHomeScreenStatus;checking:boolean;pending:boolean;message:string}
export const initialHomeScreenState:HomeScreenState = {status:'unknown',checking:true,pending:false,message:''}
const unsupported = '当前 Telegram 客户端不支持添加到主屏幕。请更新手机端 Telegram；也可在手机浏览器中打开本站并安装网页应用。'

/** Native Mini App shortcut, deliberately independent of PWA/SW/localStorage. */
export function createTelegramHomeScreen(app:TelegramWebApp,notify:(state:HomeScreenState)=>void) {
  let disposed = false, request = 0, confirmed = false
  let state:HomeScreenState = {...initialHomeScreenState}
  let checkTimer:ReturnType<typeof setTimeout>|undefined, addTimer:ReturnType<typeof setTimeout>|undefined
  const emit = (patch:Partial<HomeScreenState>)=>{if(!disposed){state = {...state,...patch};notify(state)}}
  const accept = (value:unknown)=>{
    if(disposed)return
    clearTimeout(checkTimer)
    const status = ['unsupported','unknown','added','missed'].includes(String(value)) ? value as TelegramHomeScreenStatus : 'unknown'
    if(status === 'added')confirmed = true
    if(confirmed){clearTimeout(addTimer);emit({status:'added',checking:false,pending:false,message:'已添加到主屏幕。'});return}
    emit({status,checking:false,...(status === 'unsupported' ? {pending:false,message:unsupported} : {})})
  }
  const added = ()=>accept('added')
  const checked = (event?:{status?:unknown})=>accept(event?.status)
  let supported = typeof app.addToHomeScreen === 'function' && typeof app.checkHomeScreenStatus === 'function'
  try {if(app.isVersionAtLeast && !app.isVersionAtLeast('8.0'))supported = false} catch {supported = false}
  const check = ()=>{
    if(disposed || !supported || state.pending)return
    const revision = ++request
    clearTimeout(checkTimer)
    emit({checking:true})
    checkTimer = setTimeout(()=>{if(revision === request)accept('unknown')},2500)
    try {app.checkHomeScreenStatus?.(status=>{if(revision === request)accept(status)})}
    catch {accept('unknown');emit({message:'无法确认主屏幕状态，可手动尝试添加；不会把未知状态当成已安装。'})}
  }
  if(supported){app.onEvent('homeScreenAdded',added);app.onEvent('homeScreenChecked',checked);check()}
  else emit({status:'unsupported',checking:false,message:unsupported})
  return {
    check,
    add(){
      if(disposed || !supported || state.checking || state.pending || state.status === 'added' || state.status === 'unsupported')return
      ++request;clearTimeout(checkTimer)
      emit({status:'unknown',pending:true,message:'请按 Telegram 的提示完成添加。部分设备不会回传结果，请查看手机主屏幕；未收到确认时不会显示已添加。'})
      try {
        // Must remain synchronous within the click, preserving user activation.
        app.addToHomeScreen?.()
        if(!confirmed)addTimer = setTimeout(()=>emit({pending:false}),2500)
      } catch {emit({pending:false,message:'无法打开添加提示，请更新 Telegram 或使用手机浏览器安装。'})}
    },
    dispose(){disposed = true;++request;clearTimeout(checkTimer);clearTimeout(addTimer);if(supported){app.offEvent('homeScreenAdded',added);app.offEvent('homeScreenChecked',checked)}},
  }
}
