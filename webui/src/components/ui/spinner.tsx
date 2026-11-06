import {cn} from '@/lib/utils'

export function Spinner({className}: {className?: string}) {
  return (
    <span className={cn('size-4 animate-spin rounded-full border-2 border-current border-t-transparent', className)} aria-hidden="true" />
  )
}
