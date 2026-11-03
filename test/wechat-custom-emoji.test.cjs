/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const {Parser} = require('htmlparser2')
const {HTMLParser} = require('telegram/extensions/html')
const {Api} = require('telegram')

// Exercise the actual source and actual pack mapping without loading any clients
// or depending on a previous dist build. No Telegram API calls are made.
function loadSource(name, dependencies = {}) {
  const filename = path.join(__dirname, '../src/util', name + '.ts')
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS},
  }).outputText
  const exports = {}
  vm.runInNewContext(compiled, {
    exports,
    require: name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name),
  }, {filename})
  return exports
}
const data = loadSource('WechatCustomEmojiData')
const {WECHAT_CUSTOM_EMOJI: mapping} = data
const {renderWechatCustomEmojiHtml: render, stripTelegramCustomEmoji: strip, splitTelegramHtml: split} =
  loadSource('WechatCustomEmoji', {'./WechatCustomEmojiData': data})
const customEntities = entities => entities.filter(entity => entity instanceof Api.MessageEntityCustomEmoji)
const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const markup = alias => `<tg-emoji emoji-id="${mapping[alias].id}">${escape(mapping[alias].emoji)}</tg-emoji>`
const plain = html => {
  let text = ''
  new Parser({ontext: value => {text += value}}).end(html)
  return text
}
const array = value => Array.from(value)

function assertChunks(html, maxLength) {
  const chunks = array(split(html, maxLength))
  assert.ok(chunks.length > 0)
  assert.equal(chunks.map(plain).join(''), plain(html))
  for (const chunk of chunks) {
    assert.notEqual(chunk, '')
    assert.ok(plain(chunk).length <= maxLength)
    assert.doesNotMatch(plain(chunk), /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u)
    const stack = []
    for (const tag of chunk.matchAll(/<(\/?)([\w-]+)(?:\s[^>]*?)?>/g)) {
      if (tag[1]) assert.equal(stack.pop(), tag[2], `unbalanced chunk: ${chunk}`)
      else if (tag[2] !== 'br') stack.push(tag[2])
    }
    assert.deepEqual(stack, [])
  }
  return chunks
}

test('all pinned mappings belong to the public pack and preserve its exact fallback', () => {
  const snapshot = require('./fixtures/wechatpack.json')
  assert.equal(snapshot.name, 'WeChatPack')
  const documents = new Map(snapshot.stickers.map(s => [s.id, s.emoji]))
  for (const custom of Object.values(mapping)) {
    assert.equal(typeof custom.id, 'string')
    assert.equal(documents.get(custom.id), custom.emoji)
    assert.ok(BigInt(custom.id) > BigInt(Number.MAX_SAFE_INTEGER))
  }
  assert.equal(mapping['[微笑]'].id, '5461028200781979412')
  assert.equal(mapping['[皱眉]'].id, '5458403181195173438')
  assert.equal(mapping['[微笑]'].emoji, mapping['[皱眉]'].emoji)
  assert.notEqual(mapping['[微笑]'].id, mapping['[皱眉]'].id, 'same alt emoji must not collapse different WeChat expressions')
  assert.equal(mapping['[笑脸]'].emoji, mapping['[憨笑]'].emoji)
  assert.notEqual(mapping['[笑脸]'].id, mapping['[憨笑]'].id)
  assert.equal(render('[發][爆竹]', true), '[發][爆竹]', 'unverified pack matches must not be guessed')
})

test('custom mode defers legacy image conversion until final rendering', () => {
  const {EmojiConverter} = loadSource('EmojiUtils')
  const converter = new EmojiConverter()
  const input = '🙂 [微笑] [Facepalm]'
  assert.equal(converter.convert(input, {emojiPicture: true}, true), input)
  assert.equal(converter.convert(input, {emojiPicture: false}, true), input)
  assert.equal(converter.convert(input, {emojiPicture: false}), input)
  assert.match(converter.convert(input, {emojiPicture: true}), /<a href=/)
  assert.equal(render(converter.convert(input, {emojiPicture: true}, true), true),
    '🙂 ' + markup('[微笑]') + ' ' + markup('[Facepalm]'))
})

test('real WeChat aliases retain string IDs and exact pack fallbacks', () => {
  for (const alias of ['[微笑]', '[捂脸]']) {
    assert.ok(mapping[alias], `missing approved alias ${alias}`)
    assert.equal(typeof mapping[alias].id, 'string')
    assert.match(mapping[alias].id, /^\d+$/)
    assert.ok(mapping[alias].emoji)
    const html = render(alias, true)
    assert.equal(html, markup(alias))
    const [text, entities] = HTMLParser.parse(html)
    assert.equal(text, mapping[alias].emoji)
    assert.equal(customEntities(entities).length, 1)
    assert.equal(String(entities[0].documentId), mapping[alias].id)
    assert.equal(entities[0].offset, 0)
    assert.equal(entities[0].length, mapping[alias].emoji.length)
  }
})

test('GramJS sees correct UTF-16 entity offsets next to non-BMP Unicode and nested styles', () => {
  const smile = mapping['[微笑]'].emoji
  const face = mapping['[捂脸]'].emoji
  const source = '<b>😀[微笑]<i>𠮷[捂脸]</i>!</b>'
  const [text, entities] = HTMLParser.parse(render(source, true))
  assert.equal(text, `😀${smile}𠮷${face}!`)
  const custom = customEntities(entities).sort((a, b) => a.offset - b.offset)
  assert.deepEqual(custom.map(entity => [entity.offset, entity.length, String(entity.documentId)]), [
    [2, smile.length, mapping['[微笑]'].id],
    [4 + smile.length, face.length, mapping['[捂脸]'].id],
  ])
  const bold = entities.find(entity => entity instanceof Api.MessageEntityBold)
  const italic = entities.find(entity => entity instanceof Api.MessageEntityItalic)
  assert.deepEqual([bold.offset, bold.length], [0, text.length])
  assert.deepEqual([italic.offset, italic.length], [2 + smile.length, 2 + face.length])
})

test('disabled, unknown, ordinary Unicode, escaped text, and repeated aliases', () => {
  const untouched = '😀🙂🤦‍♂️♥️ [DefinitelyUnknown] &amp; &lt; &#91;微笑&#93;'
  assert.equal(render(untouched, true), untouched)
  const source = `${untouched} [微笑][微笑][捂脸]`
  assert.equal(render(source, false), source)
  const rendered = render(source, true)
  assert.equal(rendered, `${untouched} ${markup('[微笑]')}${markup('[微笑]')}${markup('[捂脸]')}`)
  assert.equal(render(rendered, true), rendered)
  if (mapping['[Facepalm]']) assert.equal(render('[Facepalm]', true), markup('[Facepalm]'))
})

test('attributes, comments, links, code/pre and existing custom emoji are protected', () => {
  const protectedHtml = '<a href="https://example.invalid/[微笑]?x=>" title="[捂脸]"><b>[微笑]</b></a>' +
    '<CODE>[微笑]</CODE><pre><code class="language-js">[捂脸]</code></pre>' +
    '<tg-emoji emoji-id="1234567890123456789">[微笑]</tg-emoji><!-- [捂脸] -->'
  const source = protectedHtml + '<b title="[微笑]">[微笑]</b><br>[捂脸]'
  assert.equal(render(source, true), protectedHtml + `<b title="[微笑]">${markup('[微笑]')}</b><br>${markup('[捂脸]')}`)
})

test('a longer pack fallback cannot overflow an otherwise-valid media caption', () => {
  assert.ok(mapping['[捂脸]'].emoji.length > '[捂脸]'.length)
  const source = '<b>' + 'x'.repeat(1020) + '[捂脸]</b>'
  assert.equal(render(source, true, 1024), source, 'preserve whole original caption, never truncate it')
  const fits = '<b>' + 'x'.repeat(1019) + '[捂脸]</b>'
  assert.equal(render(fits, true, 1024), '<b>' + 'x'.repeat(1019) + markup('[捂脸]') + '</b>')
  assert.equal(plain(render(fits, true, 1024)).length, 1024)
})

test('strip removes only actual custom wrappers, preserving fallback, attributes and escaping', () => {
  const source = '<b data-x="<tg-emoji>">A&amp;' + markup('[微笑]') + '</b>' +
    '<TG-EMOJI emoji-id="123"><i>👨‍👩‍👧‍👦</i></TG-EMOJI>&lt;tg-emoji&gt;<!-- <tg-emoji> -->'
  assert.equal(strip(source), '<b data-x="<tg-emoji>">A&amp;' + escape(mapping['[微笑]'].emoji) +
    '</b><i>👨‍👩‍👧‍👦</i>&lt;tg-emoji&gt;<!-- <tg-emoji> -->')
  assert.equal(strip(strip(source)), strip(source))
})

test('budget caps generated entities at 100 and overflows to exact mapped fallback', () => {
  const rendered = render('[捂脸]'.repeat(105), true)
  const [text, entities] = HTMLParser.parse(rendered)
  assert.equal(customEntities(entities).length, 100)
  assert.equal(text, mapping['[捂脸]'].emoji.repeat(105))
  assert.equal(rendered, markup('[捂脸]').repeat(100) + escape(mapping['[捂脸]'].emoji).repeat(5))
  assert.equal(render(rendered, true), rendered)
  // Existing entities reserve budget regardless of their position in the source.
  const existing = markup('[微笑]')
  const mixed = render('[捂脸]'.repeat(101) + existing, true)
  assert.equal(customEntities(HTMLParser.parse(mixed)[1]).length, 100)
  assert.ok(mixed.endsWith(existing))
  assert.equal(plain(mixed), mapping['[捂脸]'].emoji.repeat(101) + mapping['[微笑]'].emoji)
})

test('fitting HTML is byte-identical even when markup and escapes exceed raw source limit', () => {
  const html = '<B title="keep single quotes & punctuation">&amp;&#x1f600;<i>x</i></B>'
  assert.deepEqual(array(split(html, 4)), [html])
  assert.deepEqual(array(split('')), [])
  assert.deepEqual(array(split('a'.repeat(4096))), ['a'.repeat(4096)])
  assert.deepEqual(array(split('a'.repeat(4097))), ['a'.repeat(4096), 'a'])
})

test('long nested formatting reopens with original attributes and keeps custom entities whole', () => {
  const html = '<b>😀' + `<i title="original">${render('[微笑][捂脸]', true).repeat(20)}</i>` + '𠮷</b>'
  const chunks = assertChunks(html, 16)
  assert.ok(chunks.length > 1)
  const combinedText = chunks.map(chunk => HTMLParser.parse(chunk)[0]).join('')
  assert.equal(combinedText, HTMLParser.parse(html)[0])
  let count = 0
  for (const chunk of chunks) {
    const [text, entities] = HTMLParser.parse(chunk)
    const bold = entities.find(entity => entity instanceof Api.MessageEntityBold)
    assert.deepEqual([bold.offset, bold.length], [0, text.length])
    for (const entity of customEntities(entities)) {
      count++
      const fallback = text.slice(entity.offset, entity.offset + entity.length)
      assert.ok([mapping['[微笑]'].emoji, mapping['[捂脸]'].emoji].includes(fallback))
      assert.ok(entities.some(style => style instanceof Api.MessageEntityItalic && style.offset <= entity.offset &&
        style.offset + style.length >= entity.offset + entity.length))
    }
  }
  assert.equal(count, 40)
  assert.ok(chunks.slice(1).some(chunk => chunk.includes('<i title="original">')))
})

test('ZWJ/VS custom fallback is indivisible; references and surrogate pairs survive boundaries', () => {
  const fallback = '👩‍❤️‍💋‍👨'
  const custom = `<tg-emoji emoji-id="${mapping['[微笑]'].id}">${fallback}</tg-emoji>`
  const html = '<u>' + 'a'.repeat(14) + custom + '&#x1f600;&amp;𠮷z</u>'
  const chunks = assertChunks(html, 16)
  assert.equal(chunks.filter(chunk => chunk.includes(custom)).length, 1)
  const entity = customEntities(HTMLParser.parse(chunks.find(chunk => chunk.includes(custom)))[1])[0]
  assert.equal(entity.length, fallback.length)
  assertChunks('<i>A&amp;&#x1F600;&NotEqualTilde;B&#128512;C</i>', 4)
  assertChunks('a&notit;b', 2)
  assertChunks('a&NotEqualTilde;b', 1)
})

test('whitespace, unknown references and adjacent tags preserve plain-text concatenation', () => {
  assertChunks('<b> A  B\n</b><i> C &unknown; D\t E </i>', 5)
  assertChunks('<b>abc</b><i>def</i><u>ghi</u>', 3)
  assertChunks('<pre><code class="language-js">abcdef😀ghijk</code></pre>', 5)
})

test('default limit splits final expanded HTML rather than cutting its raw markup at 9000', () => {
  const html = '<b>' + render('[微笑]'.repeat(100), true) + 'x'.repeat(8500) + '</b>'
  assert.ok(html.length > 9000)
  const chunks = assertChunks(html, 4096)
  assert.equal(chunks.length, 3)
  assert.equal(chunks.flatMap(chunk => customEntities(HTMLParser.parse(chunk)[1])).length, 100)
  assert.equal(chunks.map(chunk => HTMLParser.parse(chunk)[0]).join(''), HTMLParser.parse(html)[0])
})

test('large text nodes do not overflow the JavaScript argument stack', () => {
  const html = '<i>' + '字'.repeat(150000) + '</i>'
  const chunks = assertChunks(html, 4096)
  assert.equal(chunks.length, Math.ceil(150000 / 4096))
})

test('invalid limits and impossible indivisible units fail explicitly, never emit oversized chunks', () => {
  for (const limit of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => split('a', limit), {name: 'RangeError'})
  assert.throws(() => split('😀x', 1), {name: 'RangeError'})
  assert.throws(() => split('<tg-emoji emoji-id="1">👨‍👩‍👧‍👦</tg-emoji>x', 2), {name: 'RangeError'})
})