import type {ReactNode} from 'react'
import {Message,MessageContent,MessageHeader} from '@/components/ui/message'
import {Bubble,BubbleContent} from '@/components/ui/bubble'
import {Card,CardHeader,CardTitle,CardContent,CardFooter} from '@/components/ui/card'

/** Publications keep their article cards; ordinary chats use compact bubbles.
 * The message-group parent owns the single sticky sender avatar. */
export function ChatMessageCard({author,avatar,outgoing,publication,showAuthor = true,first = true,last = true,children,footer}:{
  author:string;avatar:ReactNode;outgoing:boolean;publication:boolean;showAuthor?:boolean;first?:boolean;last?:boolean;children:ReactNode;footer:ReactNode
}) {
  return <Message align={outgoing?'end':'start'} data-layout={publication?'publication':'conversation'} data-group-first={first} data-group-last={last}>
    <MessageContent className="gap-0">
      <Bubble variant={outgoing?'sent':'received'} layout={publication?'card':'chat'} align={outgoing?'end':'start'} className="rounded-2xl">
        {publication ? <BubbleContent asChild layout="card">
          <Card data-message-card>
            <CardHeader className="flex-row items-center gap-3 px-4 py-3 md:px-5 md:py-4">
              {avatar}
              <MessageHeader variant="card" className="min-w-0 flex-1"><CardTitle className="truncate" title={author}>{author}</CardTitle></MessageHeader>
            </CardHeader>
            <CardContent data-slot="message-body" className="px-4 pb-3 pt-0 md:px-5">{children}</CardContent>
            <CardFooter className="px-4 pb-3 pt-0 md:px-5">{footer}</CardFooter>
          </Card>
        </BubbleContent> : <BubbleContent layout="conversation" data-message-card>
          {!outgoing && showAuthor && <MessageHeader variant="sender" title={author}>{author}</MessageHeader>}
          <div data-slot="message-body" className="min-w-0">{children}</div>
          {footer}
        </BubbleContent>}
      </Bubble>
    </MessageContent>
  </Message>
}
