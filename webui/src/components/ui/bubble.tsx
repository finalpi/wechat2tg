import * as React from 'react'
import {cva, type VariantProps} from 'class-variance-authority'
import {Slot} from '@radix-ui/react-slot'
import {cn} from '@/lib/utils'

// shadcn Bubble, adapted to this application's Tailwind 3 / HSL tokens.
const bubbleVariants = cva(
  'group/bubble relative flex min-w-0 flex-col gap-1 data-[align=end]:self-end',
  {variants: {layout: {chat:'w-fit max-w-[95%] md:max-w-[85%]',card:'w-full max-w-full'},variant: {
    default: '[&>[data-slot=bubble-content]]:bg-primary [&>[data-slot=bubble-content]]:text-primary-foreground',
    sent: '[&>[data-slot=bubble-content]]:bg-primary/10 [&>[data-slot=bubble-content]]:text-foreground',
    received: '[&>[data-slot=bubble-content]]:border-border [&>[data-slot=bubble-content]]:bg-muted/40',
    secondary: '[&>[data-slot=bubble-content]]:bg-secondary [&>[data-slot=bubble-content]]:text-secondary-foreground',
    muted: '[&>[data-slot=bubble-content]]:bg-muted',
    outline: '[&>[data-slot=bubble-content]]:border-border [&>[data-slot=bubble-content]]:bg-background',
    ghost: '[&>[data-slot=bubble-content]]:border-none [&>[data-slot=bubble-content]]:bg-transparent [&>[data-slot=bubble-content]]:p-0',
    destructive: '[&>[data-slot=bubble-content]]:bg-destructive/10 [&>[data-slot=bubble-content]]:text-destructive',
  }}, defaultVariants: {variant: 'default',layout:'chat'} },
)
function Bubble({variant, layout, align = 'start', className, ...props}: React.ComponentProps<'div'> & VariantProps<typeof bubbleVariants> & {align?: 'start' | 'end'}) {
  return <div data-slot="bubble" data-variant={variant} data-align={align} className={cn(bubbleVariants({variant,layout}), className)} {...props} />
}
function BubbleContent({asChild = false, layout = 'default', className, ...props}: React.ComponentProps<'div'> & {asChild?: boolean;layout?:'default'|'card'|'conversation'}) {
  const Comp = asChild ? Slot : 'div'
  return <Comp data-slot="bubble-content" className={cn('max-w-full min-w-0 break-words overflow-hidden border border-transparent text-base leading-relaxed',layout==='card'?'w-full rounded-2xl p-0':layout==='conversation'?'chat-bubble w-fit rounded-2xl px-3 py-2 text-[15px] leading-[1.5]':'w-fit rounded-xl px-3 py-2 md:text-sm', className)} {...props} />
}
export {Bubble, BubbleContent}
