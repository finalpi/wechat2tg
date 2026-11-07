import {useEffect,useState} from 'react'
import {Menu,Settings,Sun,Moon,Download,RefreshCw,LogOut,Maximize,Minimize} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Dialog,DialogTrigger,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogClose} from '@/components/ui/dialog'
import {Alert,AlertDescription} from '@/components/ui/alert'
import type {usePwa} from '@/lib/use-pwa'

export function ChatMenu({theme,onToggleTheme,onManage,onLogout,miniApp,pwa}:{
  theme:'light'|'dark';onToggleTheme:()=>void;onManage:()=>void;onLogout:()=>void;miniApp:boolean;pwa:ReturnType<typeof usePwa>
}) {
  const [help,setHelp] = useState(false)
  const [fullscreen,setFullscreen] = useState(Boolean(document.fullscreenElement))
  const [error,setError] = useState('')
  useEffect(()=>{const changed=()=>setFullscreen(Boolean(document.fullscreenElement));document.addEventListener('fullscreenchange',changed);return()=>document.removeEventListener('fullscreenchange',changed)},[])
  const toggleFullscreen = async()=>{
    try {if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}
    catch {setError('当前浏览器无法进入全屏，聊天专注模式仍可正常使用。')}
  }
  return <Dialog><DialogTrigger asChild><Button variant="ghost" size="icon" aria-label="聊天菜单"><Menu /></Button></DialogTrigger>
    <DialogContent><DialogHeader><DialogTitle>聊天</DialogTitle><DialogDescription>聊天与管理共用同一账号。切换页面不会清空当前聊天草稿。</DialogDescription></DialogHeader>
      <div className="flex flex-col gap-2">
        <DialogClose asChild><Button variant="outline" onClick={onManage}><Settings data-icon="inline-start" />管理设置</Button></DialogClose>
        <Button variant="outline" aria-label="切换主题" onClick={onToggleTheme}>{theme==='dark'?<Sun data-icon="inline-start" />:<Moon data-icon="inline-start" />}切换主题</Button>
        {!miniApp && document.fullscreenEnabled && <Button variant="outline" onClick={()=>void toggleFullscreen()}>{fullscreen?<Minimize />:<Maximize />}{fullscreen?'退出浏览器全屏':'浏览器全屏'}</Button>}
        {!miniApp && !pwa.installed && <Button variant="outline" onClick={()=>{setHelp(true);void pwa.install().then(ok=>{if(ok)setHelp(false)})}}><Download data-icon="inline-start" />安装应用</Button>}
        {!miniApp && pwa.installed && <p className="text-sm text-muted-foreground">已在独立应用窗口中打开</p>}
        {!miniApp && pwa.updateReady && <Button onClick={()=>void pwa.applyUpdate()}><RefreshCw data-icon="inline-start" />更新应用</Button>}
        {help && <Alert><AlertDescription>{window.isSecureContext?'Chrome / Edge 可从浏览器菜单安装。iPhone / iPad 请在 Safari 中点分享，再选择“添加到主屏幕”。安装后默认进入聊天。':'安装需要受信任的 HTTPS 地址。普通内网 HTTP 地址只能作为网页使用；请用已有的 HTTPS 入口打开。'}</AlertDescription></Alert>}
        {(error || pwa.error) && <Alert variant="destructive"><AlertDescription>{error || pwa.error}</AlertDescription></Alert>}
        <Button variant="ghost" onClick={onLogout}><LogOut data-icon="inline-start" />退出登录</Button>
      </div>
    </DialogContent>
  </Dialog>
}
