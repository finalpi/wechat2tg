import {useEffect, useId, useLayoutEffect, useRef, useState} from 'react'
import {createRequestId} from '@/lib/request-id'
import {AtSign, Paperclip, Send, Smile, X} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Switch} from '@/components/ui/switch'
import {Badge} from '@/components/ui/badge'
import {Spinner} from '@/components/ui/spinner'
import {Alert, AlertDescription} from '@/components/ui/alert'
import {Field, FieldGroup, FieldLabel} from '@/components/ui/field'
import {Attachment, AttachmentMedia, AttachmentContent, AttachmentTitle, AttachmentDescription, AttachmentActions} from '@/components/ui/attachment'
import {messagesApi, messageError, type ChatMessage, type Contact, type Member, type SendMessage} from '@/lib/messages-api'
import {ContactAvatar} from './message-content'
import {EmojiPicker} from './emoji-picker'
import {MessageEditor, type MessageEditorHandle} from './message-editor'
import {composerMentions, editMentions, insertMention, mentionQuery, replaceMentionRange, type InlineMention, type MentionQuery} from '@/lib/composer-mentions'

export interface ComposerDraft {
  body?: string
  quote?: ChatMessage | null
  file?: File | null
  voice?: boolean
  selected?: Member[]
  all?: boolean
  inlineMentions?: InlineMention[]
  attempt?: {parts: SendMessage[]; next: number} | null
  inFlight?: boolean
}

export function MessageComposer({token, contact, online, quote, draft, onClearQuote, onSent, onAuthError, offlineReason}: {
  token: string; contact: Contact; online: boolean; quote: ChatMessage | null; draft: ComposerDraft; offlineReason?:string
  onClearQuote: () => void; onSent: (row: ChatMessage) => void; onAuthError: (error: unknown) => void
}) {
  const [body, setBody] = useState(draft.body || '')
  const [file, setFile] = useState<File | null>(draft.file || null)
  const [voice, setVoice] = useState(draft.voice || false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(Boolean(draft.attempt))
  const attempt = useRef<ComposerDraft['attempt']>(draft.attempt)
  const [showMembers, setShowMembers] = useState(false)
  const [memberQuery, setMemberQuery] = useState('')
  const [members, setMembers] = useState<Member[]>([])
  const [memberOffset, setMemberOffset] = useState(0)
  const [hasMoreMembers, setHasMoreMembers] = useState(false)
  const [membersBusy, setMembersBusy] = useState(false)
  const [memberError, setMemberError] = useState('')
  const [selected, setSelected] = useState<Member[]>(draft.selected || [])
  const [all, setAll] = useState(draft.all || false)
  const [inlineMentions, setInlineMentions] = useState<InlineMention[]>(draft.inlineMentions || [])
  const [mentionTarget, setMentionTarget] = useState<MentionQuery | null>(null)
  const [activeMember, setActiveMember] = useState(0)
  const [showEmoji, setShowEmoji] = useState(false)
  const selection = useRef({start: body.length, end: body.length})
  const composing = useRef(false)
  const dismissedMention = useRef('')
  const composer = useRef<HTMLDivElement>(null)
  const listId = useId()
  const input = useRef<HTMLInputElement>(null)
  const textarea = useRef<MessageEditorHandle>(null)
  const resizeInput = () => {
    const field=textarea.current?.element
    if(!field)return
    field.style.height='44px'
    const maximum=Math.min(160,Math.max(44,(window.visualViewport?.height || window.innerHeight)*0.25))
    field.style.height=`${Math.min(maximum,Math.max(44,field.scrollHeight+2))}px`
  }
  useLayoutEffect(resizeInput,[body])
  useEffect(()=>{
    let width=0
    const observer=new ResizeObserver(entries=>{const next=entries[0]?.contentRect.width || 0;if(next!==width){width=next;resizeInput()}})
    if(textarea.current?.element)observer.observe(textarea.current.element)
    window.visualViewport?.addEventListener('resize',resizeInput)
    return()=>{observer.disconnect();window.visualViewport?.removeEventListener('resize',resizeInput)}
  },[])
  const memberGeneration = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {mounted.current = true; return () => {mounted.current = false}}, [])
  useEffect(() => {if (!draft.inFlight) Object.assign(draft, {body, file, voice, selected, all, inlineMentions, attempt: attempt.current})}, [draft, body, file, voice, selected, all, inlineMentions, pending])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {if (draft.body?.trim() || draft.file || draft.attempt || draft.inFlight) {event.preventDefault(); event.returnValue = ''}}
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [draft])
  useEffect(() => {
    if (quote && !draft.inFlight && !attempt.current) {setFile(null); setSelected([]); setAll(false); setInlineMentions([]); setShowMembers(false); setMentionTarget(null)}
  }, [quote, draft])

  const closeMembers = () => {
    dismissedMention.current = `${body}:${textarea.current?.selectionStart}`
    setShowMembers(false); setMentionTarget(null)
  }
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!composer.current?.contains(event.target as Node)) {setShowMembers(false); setMentionTarget(null); setShowEmoji(false)}
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [])
  useEffect(() => {
    if (showMembers) document.getElementById(`${listId}-${activeMember}`)?.scrollIntoView({block: 'nearest'})
  }, [showMembers, activeMember, listId])

  useEffect(() => {
    if (!showMembers) return
    const controller = new AbortController()
    const generation = ++memberGeneration.current
    setMembersBusy(true); setMemberError(''); setMembers([]); setActiveMember(0); setHasMoreMembers(false)
    const timer = window.setTimeout(() => {
      messagesApi.members(token, contact.wxId, memberQuery, 0, false, controller.signal).then(page => {
        if (controller.signal.aborted || generation !== memberGeneration.current) return
        setMembers(page.members); setMemberOffset(page.offset); setHasMoreMembers(page.hasMore)
      }).catch(e => {
        if (!controller.signal.aborted) {setMemberError(messageError(e)); onAuthError(e)}
      }).finally(() => {if (!controller.signal.aborted && generation === memberGeneration.current) setMembersBusy(false)})
    }, 250)
    return () => {window.clearTimeout(timer); controller.abort(); memberGeneration.current++}
  }, [showMembers, token, contact.wxId, memberQuery, onAuthError])

  const moreMembers = async () => {
    if (membersBusy) return
    const generation = memberGeneration.current
    setMembersBusy(true)
    try {
      const page = await messagesApi.members(token, contact.wxId, memberQuery, memberOffset)
      if (!mounted.current || generation !== memberGeneration.current) return
      setMembers(rows => [...rows, ...page.members]); setMemberOffset(page.offset); setHasMoreMembers(page.hasMore)
    } catch (e) {if (generation === memberGeneration.current) {setMemberError(messageError(e)); onAuthError(e)}}
    finally {if (generation === memberGeneration.current) setMembersBusy(false)}
  }

  const updateMentionQuery = (value: string, start: number, end: number, tokens = inlineMentions) => {
    selection.current = {start, end}
    if (contact.kind !== 'group' || quote || file || composing.current || locked || !online || dismissedMention.current === `${value}:${start}`) return
    const target = mentionQuery(value, start, end, tokens)
    setMentionTarget(target); setShowMembers(Boolean(target))
    if (target) {
      setShowEmoji(false)
      if (target.query !== memberQuery) {setMembers([]); setHasMoreMembers(false); setMembersBusy(true)}
      setMemberQuery(target.query); setActiveMember(0)
    }
  }
  const changeBody = (value: string, start: number, end: number) => {
    const tokens = editMentions(body, value, inlineMentions)
    setBody(value); setInlineMentions(tokens); updateMentionQuery(value, start, end, tokens)
  }
  const insertText = (text: string) => {
    const {start, end} = textarea.current ? {start: textarea.current.selectionStart, end: textarea.current.selectionEnd} : selection.current
    const value = body.slice(0, start) + text + body.slice(end)
    if (value.length > 4000) {setError('消息不能超过 4000 个字符。'); return}
    const tokens = replaceMentionRange(inlineMentions, start, end, text.length)
    setBody(value); setInlineMentions(tokens); updateMentionQuery(value, start + text.length, start + text.length, tokens)
    requestAnimationFrame(() => {textarea.current?.focus(); textarea.current?.setSelectionRange(start + text.length, start + text.length)})
  }
  const canMentionAll = !memberQuery || ['所有人', 'all', 'everyone'].some(value => value.includes(memberQuery.toLocaleLowerCase()))
  const memberOptions: Pick<Member, 'wxId' | 'name' | 'displayName' | 'hasAvatar'>[] = [
    ...(canMentionAll ? [{wxId: 'notify@all', name: '所有人', displayName: '所有人', hasAvatar: false}] : []), ...members,
  ]
  const chooseMember = (member: Pick<Member, 'wxId' | 'name' | 'displayName'>) => {
    if (!mentionTarget || locked || !online || quote || file) return
    const ids = new Set([...selected.map(item => item.wxId), ...inlineMentions.map(item => item.wxId)].filter(id => id !== 'notify@all'))
    if (member.wxId !== 'notify@all' && !ids.has(member.wxId) && ids.size >= 20) {setMemberError('每条消息最多 @ 20 位成员。'); return}
    const result = insertMention(body, mentionTarget, member, inlineMentions)
    if (result.body.length > 4000) {setMemberError('消息不能超过 4000 个字符。'); return}
    setBody(result.body); setInlineMentions(result.mentions); setShowMembers(false); setMentionTarget(null)
    selection.current = {start: result.caret, end: result.caret}
    requestAnimationFrame(() => {textarea.current?.focus(); textarea.current?.setSelectionRange(result.caret, result.caret)})
  }

  const submit = async () => {
    if (busyRef.current || draft.inFlight || !online || (!attempt.current && !body.trim() && !file)) return
    busyRef.current = true; draft.inFlight = true; setBusy(true); setError('')
    try {
      if (!attempt.current) {
        const id = createRequestId()
        const attachment = file ? await messagesApi.upload(token, file, voice) : undefined
        const parts: SendMessage[] = []
        const content = composerMentions(body, selected, all, inlineMentions)
        if (body.trim()) parts.push({wxId: contact.wxId, body: content.body, requestId: `${id}-text`,
          ...(quote ? {replyToId: quote.id} : {}),
          ...(content.mentions ? {mentions: content.mentions} : {}),
        })
        if (attachment) parts.push({wxId: contact.wxId, body: '', attachmentId: attachment.id, requestId: `${id}-file`})
        attempt.current = {parts, next: 0}
        draft.attempt = attempt.current
      }
      const current = attempt.current
      while (current.next < current.parts.length) {
        const row = await messagesApi.send(token, current.parts[current.next])
        current.next++
        onSent(row)
      }
      attempt.current = null
      Object.assign(draft, {body: '', quote: null, file: null, voice: false, selected: [], all: false, inlineMentions: [], attempt: null})
      if (!mounted.current) return
      selection.current = {start: 0, end: 0}
      setPending(false); setBody(''); setFile(null); setVoice(false); setSelected([]); setAll(false); setInlineMentions([]); setShowMembers(false); setMentionTarget(null); setShowEmoji(false); onClearQuote()
    } catch (e) {
      if (mounted.current) {setError(messageError(e)); setPending(Boolean(attempt.current)); onAuthError(e)}
    } finally {busyRef.current = false; draft.inFlight = false; if (mounted.current) setBusy(false)}
  }

  const [, update] = useState(0)
  useEffect(() => {
    // A send started before switching conversations can finish while this form is remounted.
    if (!draft.inFlight || busyRef.current) return
    const timer = window.setInterval(() => {
      if (draft.inFlight) return
      attempt.current = draft.attempt
      setPending(Boolean(draft.attempt)); setBody(draft.body || ''); setFile(draft.file || null)
      setSelected(draft.selected || []); setAll(draft.all || false); setVoice(draft.voice || false)
      setInlineMentions(draft.inlineMentions || [])
      update(value => value + 1); window.clearInterval(timer)
    }, 200)
    return () => window.clearInterval(timer)
  }, [draft])
  const locked = busy || pending || Boolean(draft.inFlight)
  useEffect(() => {
    if (locked || !online || quote || file) {setShowMembers(false); setMentionTarget(null)}
    if (locked) setShowEmoji(false)
  }, [locked, online, quote, file])
  const chooseFile = (candidate?: File) => {
    if (!candidate) return
    if (!candidate.size || candidate.size > 50 * 1024 * 1024) {setError('请选择 0～50 MB 的非空文件。'); return}
    if (quote || all || selected.length || inlineMentions.length) {setError('引用或 @ 消息仅支持文字，请先取消。'); return}
    setError(''); setFile(candidate)
  }

  return <div ref={composer} className="relative flex shrink-0 flex-col gap-2 border-t bg-background px-2 py-2 md:px-4">
    {showEmoji && <EmojiPicker onClose={() => {setShowEmoji(false); textarea.current?.focus()}} onPick={text => {insertText(text); setShowEmoji(false)}} />}
    {!online && <Alert><AlertDescription>{offlineReason || '微信未连接，暂时无法发送。'}</AlertDescription></Alert>}
    {quote && <div className="flex min-w-0 items-center gap-2">
      <Badge variant="secondary">引用</Badge><span className="min-w-0 flex-1 truncate text-sm">{quote.body || `[${quote.type}]`}</span>
      <Button variant="ghost" size="icon" aria-label="取消引用" disabled={locked} onClick={onClearQuote}><X /></Button>
    </div>}
    {(all || selected.length > 0) && <div className="flex flex-wrap gap-2">
      {all ? <Button size="sm" variant="secondary" disabled={locked} onClick={() => setAll(false)}>@所有人 <X /></Button>
        : selected.map(member => <Button key={member.wxId} size="sm" variant="secondary" disabled={locked} onClick={() => setSelected(rows => rows.filter(row => row.wxId !== member.wxId))}>@{member.displayName || member.name} <X /></Button>)}
    </div>}
    {showMembers && <div className="absolute bottom-full left-2 z-20 mb-2 flex max-h-72 w-80 max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl md:left-4" aria-label="群成员候选">
      <header className="flex items-center gap-2 border-b px-3 py-2"><span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{memberQuery ? `搜索“${memberQuery}”` : '选择要 @ 的成员'}</span><Button variant="ghost" size="icon" aria-label="关闭成员候选" onClick={closeMembers}><X /></Button></header>
      <div id={listId} role="listbox" aria-label="群成员" aria-busy={membersBusy} className="min-h-0 overflow-y-auto overscroll-contain p-1">
        {memberOptions.map((member, index) => <button key={member.wxId} id={`${listId}-${index}`} type="button" role="option" aria-selected={activeMember === index}
          onPointerDown={event => event.preventDefault()} onMouseEnter={() => setActiveMember(index)} onClick={() => chooseMember(member)}
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-none ${activeMember === index ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'}`}>
          {member.wxId === 'notify@all' ? <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><AtSign className="size-4" /></span>
            : <ContactAvatar token={token} wxId={member.wxId} name={member.displayName || member.name} available={member.hasAvatar} roomId={contact.wxId} />}
          <span className="min-w-0"><span className="block truncate text-sm">{member.displayName || member.name || member.wxId}</span><span className="block truncate text-xs text-muted-foreground">{member.wxId === 'notify@all' ? '提醒群内所有成员' : member.wxId}</span></span>
        </button>)}
        {membersBusy && <div role="status" className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground"><Spinner />搜索成员中…</div>}
        {memberError && <span role="alert" className="block p-3 text-sm text-destructive">{memberError}</span>}
        {!membersBusy && !memberError && !memberOptions.length && <span className="block p-3 text-sm text-muted-foreground">未找到群成员。</span>}
        {hasMoreMembers && <Button variant="ghost" size="sm" disabled={membersBusy} onPointerDown={event => event.preventDefault()} onClick={moreMembers}>更多成员</Button>}
      </div>
      <p className="border-t px-3 py-2 text-xs text-muted-foreground">↑ ↓ 选择 · Enter 确认 · Esc 关闭</p>
    </div>}
    {file && <Attachment state={busy ? 'uploading' : 'idle'}>
      <AttachmentMedia><Paperclip /></AttachmentMedia>
      <AttachmentContent><AttachmentTitle>{file.name}</AttachmentTitle><AttachmentDescription>{(file.size / 1024 / 1024).toFixed(1)} MB</AttachmentDescription></AttachmentContent>
      <AttachmentActions><Button variant="ghost" size="icon" aria-label="移除附件" disabled={locked} onClick={() => setFile(null)}><X /></Button></AttachmentActions>
    </Attachment>}
    {error && <Alert variant="destructive"><AlertDescription>{error}{pending && ' 重试会使用同一请求，不会重新提交已受理的部分。'}</AlertDescription></Alert>}
    {file && <Field orientation="horizontal"><Switch id="send-as-voice" checked={voice} disabled={locked} onCheckedChange={setVoice} /><FieldLabel htmlFor="send-as-voice">语音</FieldLabel></Field>}
    {pending && <Button variant="outline" size="sm" disabled={busy} onClick={() => {if (window.confirm('部分消息可能已发送。放弃后再次发送可能重复，仍要放弃？')) {attempt.current = null; draft.attempt = null; setPending(false); setError('')}}}>放弃重试</Button>}
    <div className="flex items-end gap-1 md:gap-2">
      <input ref={input} type="file" className="hidden" aria-label="选择附件" onChange={e => {chooseFile(e.target.files?.[0]); e.target.value = ''}} />
      <Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label="附件" disabled={locked || !online || Boolean(quote) || all || selected.length > 0 || inlineMentions.length > 0} onClick={() => input.current?.click()}><Paperclip /></Button>
      <Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label="微信表情" aria-expanded={showEmoji} disabled={locked} onClick={() => {setShowEmoji(value => !value); closeMembers()}}><Smile /></Button>
      <FieldGroup className="min-w-0 flex-1 gap-2"><Field>
        <FieldLabel htmlFor="message-body" className="sr-only">消息内容</FieldLabel>
        <MessageEditor ref={textarea} value={body} disabled={locked} group={contact.kind === 'group'} expanded={showMembers}
          controls={showMembers ? listId : undefined} activeDescendant={showMembers && memberOptions[activeMember] ? `${listId}-${activeMember}` : undefined}
          onChange={changeBody}
          onSelect={updateMentionQuery}
          onCompositionStart={() => {composing.current = true; setShowMembers(false)}}
          onCompositionEnd={() => {composing.current = false}}
          onPaste={e => {const pasted = e.clipboardData.files[0]; if (pasted && !locked) {e.preventDefault(); chooseFile(pasted)}}}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing || composing.current || e.keyCode === 229) return
            if (showMembers) {
              if (e.key === 'Escape') {e.preventDefault(); closeMembers(); return}
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {e.preventDefault(); setActiveMember(value => memberOptions.length ? (value + (e.key === 'ArrowDown' ? 1 : memberOptions.length - 1)) % memberOptions.length : 0); return}
              if (e.key === 'Enter' || e.key === 'Tab') {
                if (e.key === 'Tab' && !memberOptions[activeMember]) {closeMembers(); return}
                e.preventDefault(); if (memberOptions[activeMember]) chooseMember(memberOptions[activeMember]); return
              }
            }
            if (e.key === 'Escape' && showEmoji) {e.preventDefault(); setShowEmoji(false); return}
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {e.preventDefault(); void submit()}
          }} />
      </Field></FieldGroup>
      <Button size="icon" className="size-11 shrink-0" aria-label={pending?'重试请求':'发送'} disabled={busy || Boolean(draft.inFlight) || !online || (!pending && !body.trim() && !file)} onClick={submit}>{busy ? <Spinner /> : <Send />}</Button>
    </div>
    {body.length>3600 && <span className="text-right text-xs text-muted-foreground">{body.length}/4000</span>}
  </div>
}
