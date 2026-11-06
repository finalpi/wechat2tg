import * as React from 'react'
import {cva, type VariantProps} from 'class-variance-authority'
import {Slot} from '@radix-ui/react-slot'
import {cn} from '@/lib/utils'

// shadcn Bubble, adapted to this application's Tailwind 3 / HSL tokens.
const bubbleVariants = cva(
  'group/bubble relative flex w-fit max-w-[90%] min-w-0 flex-col gap-1 data-[align=end]:self-end md:max-w-[80%]',
  {variants: {variant: {
    default: '[&>[data-slot=bubble-content]]:bg-primary [&>[data-slot=bubble-content]]:text-primary-foreground',
    secondary: '[&>[data-slot=bubble-content]]:bg-secondary [&>[data-slot=bubble-content]]:text-secondary-foreground',
    muted: '[&>[data-slot=bubble-content]]:bg-muted',
    outline: '[&>[data-slot=bubble-content]]:border-border [&>[data-slot=bubble-content]]:bg-background',
    ghost: '[&>[data-slot=bubble-content]]:border-none [&>[data-slot=bubble-content]]:bg-transparent [&>[data-slot=bubble-content]]:p-0',
    destructive: '[&>[data-slot=bubble-content]]:bg-destructive/10 [&>[data-slot=bubble-content]]:text-destructive',
  }}, defaultVariants: {variant: 'default'}},
)
function Bubble({variant, align = 'start', className, ...props}: React.ComponentProps<'div'> & VariantProps<typeof bubbleVariants> & {align?: 'start' | 'end'}) {
  return <div data-slot="bubble" data-variant={variant} data-align={align} className={cn(bubbleVariants({variant}), className)} {...props} />
}
function BubbleContent({asChild = false, className, ...props}: React.ComponentProps<'div'> & {asChild?: boolean}) {
  const Comp = asChild ? Slot : 'div'
  return <Comp data-slot="bubble-content" className={cn('w-fit max-w-full min-w-0 break-words overflow-hidden rounded-xl border border-transparent px-3 py-2 text-sm leading-relaxed', className)} {...props} />
}
export {Bubble, BubbleContent}
