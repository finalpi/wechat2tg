import {wechatEmojiByText} from './wechat-emoji'

const isBlock = (node: Node) => node instanceof Element && ['DIV', 'P'].includes(node.tagName)

/** The message model retains WeChat aliases while the editor displays image atoms. */
export function editorText(root: Node): string {
  const read = (node: Node): string => {
    if (node.nodeType === 3) return node.textContent || ''
    if (node instanceof Element) {
      const emoji = node.getAttribute('data-wechat-emoji')
      if (emoji && wechatEmojiByText.has(emoji)) return emoji
      if (node.tagName === 'BR') {
        if (node.hasAttribute('data-editor-placeholder')) return ''
        if (node.parentNode && isBlock(node.parentNode) && node.parentNode.childNodes.length === 1) return ''
        return '\n'
      }
    }
    let value = ''
    Array.from(node.childNodes).forEach((child, index, children) => {
      if (index > 0 && (isBlock(child) || isBlock(children[index - 1]))) value += '\n'
      value += read(child)
    })
    return value
  }
  return read(root)
}

export function editorHasPlainEmoji(root: Node): boolean {
  if (root.nodeType === 3) return (root.textContent?.match(/\[[^\[\]\r\n]{1,30}\]/gu) || []).some(text => wechatEmojiByText.has(text))
  return Array.from(root.childNodes).some(editorHasPlainEmoji)
}

export function renderEditor(root: HTMLElement, value: string) {
  const document = root.ownerDocument, fragment = document.createDocumentFragment()
  for (const part of value.split(/(\[[^\[\]\r\n]{1,30}\]|\n)/u)) {
    if (!part) continue
    const emoji = wechatEmojiByText.get(part)
    if (emoji) {
      const image = document.createElement('img')
      image.src = emoji.url; image.alt = emoji.text; image.title = emoji.name
      image.setAttribute('data-wechat-emoji', emoji.text)
      image.contentEditable = 'false'; image.draggable = false
      image.className = 'inline-block size-6 select-none align-text-bottom object-contain'
      fragment.append(image)
    } else fragment.append(part === '\n' ? document.createElement('br') : document.createTextNode(part))
  }
  if (!value || value.endsWith('\n')) {
    const placeholder = document.createElement('br')
    placeholder.setAttribute('data-editor-placeholder', '')
    fragment.append(placeholder)
  }
  root.replaceChildren(fragment)
}

export function editorSelection(root: HTMLElement): {start: number; end: number} | null {
  const selection = root.ownerDocument.getSelection()
  if (!selection?.rangeCount) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  const prefix = root.ownerDocument.createRange()
  prefix.setStart(root, 0); prefix.setEnd(range.startContainer, range.startOffset)
  const length = editorText(root).length
  const start = Math.min(length, editorText(prefix.cloneContents()).length)
  prefix.setEnd(range.endContainer, range.endOffset)
  return {start, end: Math.min(length, editorText(prefix.cloneContents()).length)}
}

export function setEditorSelection(root: HTMLElement, start: number, end = start) {
  const range = root.ownerDocument.createRange()
  const locate = (target: number): {node: Node; offset: number} => {
    let position = 0
    for (const [index, child] of Array.from(root.childNodes).entries()) {
      const length = editorText(child).length
      if (child.nodeType === 3 && target <= position + length) return {node: child, offset: Math.max(0, target - position)}
      if (target < position + length) return {node: root, offset: index + (target - position >= length / 2 ? 1 : 0)}
      position += length
    }
    return {node: root, offset: root.childNodes.length}
  }
  const first = locate(start), last = locate(end)
  range.setStart(first.node, first.offset); range.setEnd(last.node, last.offset)
  const selection = root.ownerDocument.getSelection()
  selection?.removeAllRanges(); selection?.addRange(range)
}
