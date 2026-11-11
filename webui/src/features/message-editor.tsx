import {forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, type KeyboardEvent, type ClipboardEvent} from 'react'
import {cn} from '@/lib/utils'
import {editorHasPlainEmoji, editorSelection, editorText, renderEditor, setEditorSelection} from '@/lib/rich-editor'

export interface MessageEditorHandle {
  element: HTMLDivElement | null
  focus: () => void
  setSelectionRange: (start: number, end: number) => void
  readonly selectionStart: number
  readonly selectionEnd: number
}
interface MessageEditorProps {
  value: string
  disabled: boolean
  group: boolean
  expanded: boolean
  controls?: string
  activeDescendant?: string
  onChange: (value: string, start: number, end: number) => void
  onSelect: (value: string, start: number, end: number) => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  onPaste: (event: ClipboardEvent<HTMLDivElement>) => void
  onCompositionStart: () => void
  onCompositionEnd: () => void
}

export const MessageEditor = forwardRef<MessageEditorHandle, MessageEditorProps>(function MessageEditor(props, forwardedRef) {
  const element = useRef<HTMLDivElement>(null)
  const composing = useRef(false)
  const caret = useRef({start: props.value.length, end: props.value.length})
  const latest = useRef(props)
  latest.current = props
  const readCaret = () => element.current && editorSelection(element.current) || caret.current
  useImperativeHandle(forwardedRef, () => ({
    get element() {return element.current},
    focus: () => element.current?.focus(),
    setSelectionRange: (start, end) => {
      caret.current = {start, end}
      if (element.current) setEditorSelection(element.current, start, end)
    },
    get selectionStart() {return readCaret().start},
    get selectionEnd() {return readCaret().end},
  }), [])
  useLayoutEffect(() => {
    const root = element.current
    if (!root || composing.current) return
    if (editorText(root) !== props.value || editorHasPlainEmoji(root) || !root.childNodes.length) {
      const selection = readCaret(), focused = root.ownerDocument.activeElement === root
      renderEditor(root, props.value)
      caret.current = {start: Math.min(selection.start, props.value.length), end: Math.min(selection.end, props.value.length)}
      if (focused) setEditorSelection(root, caret.current.start, caret.current.end)
    }
  }, [props.value])
  useEffect(() => {
    const changed = () => {
      const root = element.current
      if (!root) return
      const selection = editorSelection(root)
      if (!selection) return
      caret.current = selection
      latest.current.onSelect(editorText(root), selection.start, selection.end)
    }
    document.addEventListener('selectionchange', changed)
    return () => document.removeEventListener('selectionchange', changed)
  }, [])
  const changed = () => {
    const root = element.current
    if (!root) return
    const value = editorText(root), selection = readCaret()
    if (value.length > 4000) {
      if (composing.current) return
      renderEditor(root, props.value)
      setEditorSelection(root, Math.min(selection.start, props.value.length))
      return
    }
    caret.current = selection
    if (!composing.current && editorHasPlainEmoji(root)) {
      renderEditor(root, value)
      setEditorSelection(root, selection.start, selection.end)
    }
    props.onChange(value, selection.start, selection.end)
  }
  return <div ref={element} id="message-body" role={props.group ? 'combobox' : 'textbox'} aria-label="消息内容" aria-multiline="true" aria-disabled={props.disabled}
    aria-autocomplete={props.group ? 'list' : undefined} aria-haspopup={props.group ? 'listbox' : undefined}
    aria-expanded={props.group ? props.expanded : undefined} aria-controls={props.controls} aria-activedescendant={props.activeDescendant}
    contentEditable={!props.disabled} suppressContentEditableWarning data-placeholder="输入消息…" data-empty={!props.value}
    title="Ctrl / ⌘ + Enter 发送" spellCheck={false}
    className={cn('relative min-h-11 w-full overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-input bg-transparent px-3 py-2 text-base leading-6 shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm',
      'before:pointer-events-none before:absolute before:text-muted-foreground data-[empty=true]:before:content-[attr(data-placeholder)]', props.disabled && 'cursor-not-allowed opacity-50')}
    onInput={changed}
    onKeyDown={props.onKeyDown}
    onCompositionStart={() => {composing.current = true; props.onCompositionStart()}}
    onCompositionEnd={() => {composing.current = false; props.onCompositionEnd(); changed()}}
    onCopy={event => {
      const selection = readCaret()
      if (selection.start === selection.end) return
      event.preventDefault()
      event.clipboardData.setData('text/plain', props.value.slice(selection.start, selection.end))
    }}
    onCut={event => {
      const selection = readCaret()
      if (props.disabled || selection.start === selection.end) return
      event.preventDefault()
      event.clipboardData.setData('text/plain', props.value.slice(selection.start, selection.end))
      const value = props.value.slice(0, selection.start) + props.value.slice(selection.end)
      renderEditor(element.current!, value)
      setEditorSelection(element.current!, selection.start)
      caret.current = {start: selection.start, end: selection.start}
      props.onChange(value, selection.start, selection.start)
    }}
    onPaste={event => {
      props.onPaste(event)
      if (event.defaultPrevented || props.disabled) return
      event.preventDefault()
      const selection = readCaret(), current = element.current!
      const available = 4000 - props.value.length + selection.end - selection.start
      const text = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n').slice(0, Math.max(0, available)).replace(/[\uD800-\uDBFF]$/, '')
      const value = props.value.slice(0, selection.start) + text + props.value.slice(selection.end)
      renderEditor(current, value)
      const position = selection.start + text.length
      setEditorSelection(current, position)
      caret.current = {start: position, end: position}
      props.onChange(value, position, position)
    }} />
})
