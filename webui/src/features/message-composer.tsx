import {useEffect, useRef, useState} from 'react'
import {AtSign, Paperclip, Send, X} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Textarea} from '@/components/ui/textarea'
import {Switch} from '@/components/ui/switch'
import {Badge} from '@/components/ui/badge'
import {Spinner} from '@/components/ui/spinner'
import {Alert, AlertDescription} from '@/components/ui/alert'
import {Field, FieldGroup, FieldLabel} from '@/components/ui/field'
import {Attachment, AttachmentMedia, AttachmentContent, AttachmentTitle, AttachmentDescription, AttachmentActions} from '@/components/ui/attachment'
import {messagesApi, messageError, type ChatMessage, type Contact, type Member, type SendMessage} from '@/lib/messages-api'

export interface ComposerDraft {
  body?: string
  quote?: ChatMessage | null
  file?: File | null
  voice?: boolean
  selected?: Member[]
  all?: boolean
  attempt?: {parts: SendMessage[]; next: number} | null
  inFlight?: boolean
}

export function MessageComposer({token, contact, online, quote, draft, onClearQuote, onSent, onAuthError}: {
  token: string; contact: Contact; online: boolean; quote: ChatMessage | null; draft: ComposerDraft
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
  const input = useRef<HTMLInputElement>(null)
  const memberGeneration = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {mounted.current = true; return () => {mounted.current = false}}, [])
  useEffect(() => {if (!draft.inFlight) Object.assign(draft, {body, file, voice, selected, all, attempt: attempt.current})}, [draft, body, file, voice, selected, all, pending])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {if (draft.body?.trim() || draft.file || draft.attempt || draft.inFlight) {event.preventDefault(); event.returnValue = ''}}
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [draft])
  useEffect(() => {
    if (quote && !draft.inFlight && !attempt.current) {setFile(null); setSelected([]); setAll(false); setShowMembers(false)}
  }, [quote, draft])

  useEffect(() => {
    if (!showMembers) return
    const controller = new AbortController()
    const generation = ++memberGeneration.current
    setMembersBusy(true); setMemberError(''); setMembers([])
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

  const submit = async () => {
    if (busyRef.current || draft.inFlight || !online || (!attempt.current && !body.trim() && !file)) return
    busyRef.current = true; draft.inFlight = true; setBusy(true); setError('')
    try {
      if (!attempt.current) {
        const attachment = file ? await messagesApi.upload(token, file, voice) : undefined
        const id = crypto.randomUUID()
        const parts: SendMessage[] = []
        if (body.trim()) parts.push({wxId: contact.wxId, body, requestId: `${id}-text`,
          ...(quote ? {replyToId: quote.id} : {}),
          ...(all ? {mentions: {all: true}} : selected.length ? {mentions: {memberIds: selected.map(member => member.wxId)}} : {}),
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
      Object.assign(draft, {body: '', quote: null, file: null, voice: false, selected: [], all: false, attempt: null})
      if (!mounted.current) return
      setPending(false); setBody(''); setFile(null); setVoice(false); setSelected([]); setAll(false); setShowMembers(false); onClearQuote()
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
      update(value => value + 1); window.clearInterval(timer)
    }, 200)
    return () => window.clearInterval(timer)
  }, [draft])
  const locked = busy || pending || Boolean(draft.inFlight)
  const chooseFile = (candidate?: File) => {
    if (!candidate) return
    if (!candidate.size || candidate.size > 50 * 1024 * 1024) {setError('请选择 0～50 MB 的非空文件。'); return}
    if (quote || all || selected.length) {setError('引用或 @ 消息仅支持文字，请先取消。'); return}
    setError(''); setFile(candidate)
  }

  return <div className="flex shrink-0 flex-col gap-3 border-t bg-background p-4">
    {!online && <Alert><AlertDescription>微信未连接，暂时无法发送。</AlertDescription></Alert>}
    {quote && <div className="flex min-w-0 items-center gap-2">
      <Badge variant="secondary">引用</Badge><span className="min-w-0 flex-1 truncate text-sm">{quote.body || `[${quote.type}]`}</span>
      <Button variant="ghost" size="icon" aria-label="取消引用" disabled={locked} onClick={onClearQuote}><X /></Button>
    </div>}
    {(all || selected.length > 0) && <div className="flex flex-wrap gap-2">
      {all ? <Button size="sm" variant="secondary" disabled={locked} onClick={() => setAll(false)}>@所有人 <X /></Button>
        : selected.map(member => <Button key={member.wxId} size="sm" variant="secondary" disabled={locked} onClick={() => setSelected(rows => rows.filter(row => row.wxId !== member.wxId))}>@{member.displayName || member.name} <X /></Button>)}
    </div>}
    {showMembers && <div className="flex max-h-64 flex-col gap-2 overflow-y-auto rounded-lg border p-3">
      <Input aria-label="搜索群成员" placeholder="搜索群成员" maxLength={100} value={memberQuery} disabled={locked} onChange={e => setMemberQuery(e.target.value)} />
      <FieldGroup className="gap-2">
        <Field orientation="horizontal"><input id="mention-all" type="checkbox" checked={all} disabled={locked} onChange={e => {setAll(e.target.checked); setSelected([])}} /><FieldLabel htmlFor="mention-all">@所有人</FieldLabel></Field>
        {members.map(member => <Field key={member.wxId} orientation="horizontal">
          <input id={`member-${member.wxId}`} type="checkbox" checked={selected.some(row => row.wxId === member.wxId)} disabled={locked || (!selected.some(row => row.wxId === member.wxId) && selected.length >= 20)} onChange={e => {setAll(false); setSelected(rows => e.target.checked ? [...rows, member] : rows.filter(row => row.wxId !== member.wxId))}} />
          <FieldLabel htmlFor={`member-${member.wxId}`}>{member.displayName || member.name || member.wxId}</FieldLabel>
        </Field>)}
      </FieldGroup>
      {membersBusy && <Spinner />}
      {memberError && <span role="alert" className="text-sm text-destructive">{memberError}</span>}
      {!membersBusy && !memberError && !members.length && <span className="text-sm text-muted-foreground">未找到群成员。</span>}
      {hasMoreMembers && <Button variant="ghost" size="sm" disabled={membersBusy} onClick={moreMembers}>更多成员</Button>}
    </div>}
    {file && <Attachment state={busy ? 'uploading' : 'idle'}>
      <AttachmentMedia><Paperclip /></AttachmentMedia>
      <AttachmentContent><AttachmentTitle>{file.name}</AttachmentTitle><AttachmentDescription>{(file.size / 1024 / 1024).toFixed(1)} MB</AttachmentDescription></AttachmentContent>
      <AttachmentActions><Button variant="ghost" size="icon" aria-label="移除附件" disabled={locked} onClick={() => setFile(null)}><X /></Button></AttachmentActions>
    </Attachment>}
    <FieldGroup className="gap-2"><Field>
      <FieldLabel htmlFor="message-body" className="sr-only">消息内容</FieldLabel>
      <Textarea id="message-body" placeholder="输入消息，Ctrl / ⌘ + Enter 发送" maxLength={4000} rows={3} value={body} disabled={locked || !online}
        onChange={e => setBody(e.target.value)} onPaste={e => {const pasted = e.clipboardData.files[0]; if (pasted && !locked) {e.preventDefault(); chooseFile(pasted)}}}
        onKeyDown={e => {if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.nativeEvent.isComposing) {e.preventDefault(); void submit()}}} />
    </Field></FieldGroup>
    {error && <Alert variant="destructive"><AlertDescription>{error}{pending && ' 重试会使用同一请求，不会重新提交已受理的部分。'}</AlertDescription></Alert>}
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1">
        <input ref={input} type="file" className="hidden" aria-label="选择附件" onChange={e => {chooseFile(e.target.files?.[0]); e.target.value = ''}} />
        <Button variant="ghost" size="sm" disabled={locked || !online || Boolean(quote) || all || selected.length > 0} onClick={() => input.current?.click()}><Paperclip /> 附件</Button>
        {contact.kind === 'group' && <Button variant="ghost" size="sm" aria-expanded={showMembers} disabled={locked || !online || Boolean(quote) || Boolean(file)} onClick={() => setShowMembers(value => !value)}><AtSign /> 成员</Button>}
        {file && <Field orientation="horizontal"><Switch id="send-as-voice" checked={voice} disabled={locked} onCheckedChange={setVoice} /><FieldLabel htmlFor="send-as-voice">语音</FieldLabel></Field>}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{body.length}/4000</span>
        {pending && <Button variant="outline" size="sm" disabled={busy} onClick={() => {if (window.confirm('部分消息可能已发送。放弃后再次发送可能重复，仍要放弃？')) {attempt.current = null; draft.attempt = null; setPending(false); setError('')}}}>放弃重试</Button>}
        <Button disabled={busy || Boolean(draft.inFlight) || !online || (!pending && !body.trim() && !file)} onClick={submit}>{busy ? <Spinner /> : <Send />} {pending ? '重试请求' : '发送'}</Button>
      </div>
    </div>
  </div>
}
