import {useEffect,useRef,useState} from 'react'
import {Card,CardHeader,CardTitle,CardDescription,CardContent} from '@/components/ui/card'
import {Separator} from '@/components/ui/separator'
import {Spinner} from '@/components/ui/spinner'
import {messagesApi,type Article} from '@/lib/messages-api'
import {cn} from '@/lib/utils'

function Cover({token,path,hero}:{token:string;path?:string;hero:boolean}) {
  const host = useRef<HTMLDivElement>(null)
  const [visible,setVisible] = useState(false),[url,setUrl] = useState(''),[failed,setFailed] = useState(false)
  const valid = Boolean(path && /^\/api\/media\/article\/[1-9]\d*\/\d{1,2}$/.test(path))
  useEffect(()=>{
    if(!valid || !host.current)return
    if(!('IntersectionObserver' in window)){setVisible(true);return}
    const observer = new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect()}},{rootMargin:'200px'})
    observer.observe(host.current)
    return()=>observer.disconnect()
  },[valid,path])
  useEffect(()=>{
    if(!valid || !visible)return
    const controller = new AbortController()
    let objectUrl = ''
    setUrl('');setFailed(false)
    messagesApi.blob(token,path!,controller.signal).then(blob=>{
      if(controller.signal.aborted)return
      objectUrl = URL.createObjectURL(blob);setUrl(objectUrl)
    }).catch(()=>{if(!controller.signal.aborted)setFailed(true)})
    return()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl)}
  },[token,path,valid,visible])
  if(!valid || failed)return null
  return <div ref={host} data-article-cover={hero?'hero':'thumbnail'} aria-busy={!url} className={cn('flex items-center justify-center overflow-hidden bg-muted',hero?'aspect-[2.35/1] w-full':'size-20 shrink-0 rounded-lg')}>
    {url?<img src={url} alt="" className="size-full object-cover" onError={()=>setFailed(true)} />:<Spinner />}
  </div>
}
function link(value?:string) {
  try {const url = new URL(value || '');return ['http:','https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined} catch {return undefined}
}

/** WeChat-style article bundle, without invented counters or remote browser requests. */
export function ArticleCards({token,articles}:{token:string;articles:Article[]}) {
  return <Card className="overflow-hidden" data-slot="article-bundle">
    <CardContent className="p-0">
      {articles.map((article,index)=>{
        const href = link(article.url),Wrapper = href?'a':'div'
        return <section key={index} data-slot="article-item">
          {index>0 && <Separator />}
          <Wrapper href={href} aria-label={href?article.title || article.url:undefined} target={href?'_blank':undefined} rel={href?'noopener noreferrer':undefined}
            className={cn('outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',index===0?'block':'flex items-center gap-4 p-4')}>
            {index===0 && <Cover key={article.coverPath} token={token} path={article.coverPath} hero />}
            <CardHeader className={cn('min-w-0 flex-1',index===0?'gap-2 p-4':'gap-2 p-0')}>
              <CardTitle variant="article" className="break-words">{article.title || article.url || '文章'}</CardTitle>
              {article.description && <CardDescription className="line-clamp-2 whitespace-pre-wrap">{article.description}</CardDescription>}
            </CardHeader>
            {index>0 && <Cover key={article.coverPath} token={token} path={article.coverPath} hero={false} />}
          </Wrapper>
        </section>
      })}
    </CardContent>
  </Card>
}
