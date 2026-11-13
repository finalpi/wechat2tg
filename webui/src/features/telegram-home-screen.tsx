import {useEffect,useRef,useState} from 'react'
import {Download} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Alert,AlertDescription} from '@/components/ui/alert'
import {loadTelegramSDK} from '@/lib/telegram-mini-app'
import {createTelegramHomeScreen,initialHomeScreenState} from '@/lib/telegram-home-screen'

export function TelegramHomeScreen() {
  const [state,setState] = useState(initialHomeScreenState)
  const controller = useRef<ReturnType<typeof createTelegramHomeScreen>|undefined>(undefined)
  useEffect(()=>{
    let disposed = false
    loadTelegramSDK().then(app=>{
      if(disposed)return
      controller.current = createTelegramHomeScreen(app,setState)
    }).catch(()=>{if(!disposed)setState({status:'unsupported',checking:false,pending:false,message:'Telegram 接口不可用，请关闭后从机器人菜单重新打开。'})})
    return()=>{disposed = true;controller.current?.dispose();controller.current = undefined}
  },[])
  const disabled = state.checking || state.pending || state.status === 'added' || state.status === 'unsupported'
  return <>
    <Button variant="outline" disabled={disabled} onClick={()=>controller.current?.add()}><Download data-icon="inline-start" />{state.status === 'added' ? '已添加到主屏幕' : '添加到主屏幕'}</Button>
    {state.message && <Alert><AlertDescription aria-live="polite">{state.message}</AlertDescription></Alert>}
  </>
}
