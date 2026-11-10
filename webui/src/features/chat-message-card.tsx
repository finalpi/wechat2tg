import type {ReactNode} from 'react'
import {Message,MessageContent,MessageHeader,MessageAvatar} from '@/components/ui/message'
import {Bubble,BubbleContent} from '@/components/ui/bubble'
import {Card,CardHeader,CardTitle,CardContent,CardFooter} from '@/components/ui/card'
import {cn} from '@/lib/utils'

/** One shared container for text, articles, media, quotes and recalled messages. */
export function ChatMessageCard({author,avatar,outgoing,publication,externalAvatar = false,highlighted,children,footer}:{
  author:string;avatar:ReactNode;outgoing:boolean;publication:boolean;externalAvatar?:boolean;highlighted:boolean;children:ReactNode;footer:ReactNode
}) {
  return <Message align={outgoing?'end':'start'} data-layout={publication?'publication':'conversation'}>
    {!outgoing && externalAvatar && <MessageAvatar position="start">{avatar}</MessageAvatar>}
    <MessageContent>
      <Bubble variant={outgoing?'sent':'received'} layout={publication?'card':'chat'} align={outgoing?'end':'start'} className={cn(highlighted && 'rounded-2xl ring-2 ring-ring')}>
        <BubbleContent asChild layout="card">
          <Card data-message-card>
            {!outgoing && <CardHeader className="flex-row items-center gap-3 px-4 py-3 md:px-5 md:py-4">
              {!externalAvatar && avatar}
              <MessageHeader variant="card" className="min-w-0 flex-1"><CardTitle className="truncate" title={author}>{author}</CardTitle></MessageHeader>
            </CardHeader>}
            <CardContent data-slot="message-body" className={cn('px-4 pb-3 md:px-5',outgoing?'pt-3 md:pt-4':'pt-0')}>{children}</CardContent>
            <CardFooter className="px-4 pb-3 pt-0 md:px-5">{footer}</CardFooter>
          </Card>
        </BubbleContent>
      </Bubble>
    </MessageContent>
  </Message>
}
