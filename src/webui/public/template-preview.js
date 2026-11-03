/* The replacement order matches src/util/FormatUtils.ts. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory()
    else root.TemplatePreview = factory()
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const title = (template, alias, name, topic) => String(template || '').replace(/#\[(.*?)\]/g, (match, part) => {
        const values = {alias_first: alias || name || topic, alias, name, topic}
        for (const key of ['alias_first', 'alias', 'name', 'topic']) {
            if (part.includes(key)) return values[key] ? part.replaceAll(key, values[key]) : ''
        }
        return match
    })
    const message = (template, identity, body) => String(template || '').replace(/#\[(.*?)\]/g, (match, part) => {
        if (part.includes('identity')) return identity ? part.replaceAll('identity', identity) : ''
        if (part.includes('body')) return body ? part.replaceAll('body', body) : ''
        if (part.includes('br')) return part.replaceAll('br', '\n')
        return match
    })
    const example = (key, values, sample, scenario = 'contact') => {
        if (key === 'CREATE_CONTACT_NAME') return {text: title(values[key], sample.alias, sample.name, ''), plain: true}
        if (key === 'CREATE_ROOM_NAME') return {text: title(values[key], sample.groupAlias, '', sample.topic), plain: true}
        const prefixKey = key === 'MESSAGE_DISPLAY' ? {contact: 'CONTACT_MESSAGE_GROUP', group: 'ROOM_MESSAGE_GROUP', official: 'OFFICIAL_MESSAGE_GROUP'}[scenario] : key
        const kind = prefixKey.startsWith('ROOM_') ? 'group' : prefixKey.startsWith('OFFICIAL_') ? 'official' : 'contact'
        const alias = kind === 'official' ? '' : sample.alias
        const name = kind === 'official' ? sample.official : sample.name
        const topic = kind === 'group' ? sample.topic : ''
        const identity = title(values[prefixKey], alias, name, topic)
        return {text: message(values.MESSAGE_DISPLAY, identity, sample.body), plain: false}
    }
    // Never attach template-supplied nodes or attributes to the page. Rebuild only
    // supported formatting; links are displayed without enabling navigation.
    const richText = (document, text) => {
        const template = document.createElement('template')
        template.innerHTML = String(text)
        const result = document.createDocumentFragment()
        const supported = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'INS', 'S', 'STRIKE', 'DEL', 'CODE', 'PRE', 'BLOCKQUOTE'])
        const blocked = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'IMG', 'SVG', 'MATH', 'VIDEO', 'AUDIO', 'SOURCE', 'LINK', 'META', 'FORM', 'INPUT', 'BUTTON'])
        const append = (source, destination) => {
            for (const child of source.childNodes) {
                if (child.nodeType === 3) destination.append(document.createTextNode(child.textContent))
                else if (child.nodeType === 1 && !blocked.has(child.tagName)) {
                    let target = destination
                    if (supported.has(child.tagName)) {
                        target = document.createElement(child.tagName.toLowerCase())
                        destination.append(target)
                    } else if (child.tagName === 'A') {
                        target = document.createElement('span')
                        target.className = 'preview-link'
                        destination.append(target)
                    } else if (child.tagName === 'TG-SPOILER' || (child.tagName === 'SPAN' && child.classList.contains('tg-spoiler'))) {
                        target = document.createElement('span')
                        target.className = 'preview-spoiler'
                        destination.append(target)
                    }
                    append(child, target)
                }
            }
        }
        append(template.content, result)
        return result
    }
    return {title, message, example, richText}
})
