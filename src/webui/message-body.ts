const mediaTags: Record<string, string> = {
    image: 'img', '3': 'img', video: 'videomsg', '43': 'videomsg',
    voice: 'voicemsg', '34': 'voicemsg', emoji: 'emoji', '47': 'emoji',
    file: 'appmsg', audio: 'appmsg', '49': 'appmsg'
}

function packetText(value: string): string {
    return value.trim().replace(/^wxid_[\w.-]+:\r?\n\s*/, '').replace(/^<\?xml\b[^?]*\?>\s*/i, '')
}

function isMediaPacket(type: string, value: string): boolean {
    const tag = mediaTags[type], xml = packetText(value)
    if (!tag || !/^<msg\b[^>]*>[\s\S]*<\/msg>$/i.test(xml)) return false
    // The media payload must be a direct child of the WeChat envelope, not
    // an XML example embedded in a caption, title, quote or ordinary text.
    if (!new RegExp(`^<msg\\b[^>]*>\\s*<${tag}\\b`, 'i').test(xml)) return false
    if (tag !== 'appmsg') return true
    const app = xml.match(/^<msg\b[^>]*>\s*<appmsg\b[^>]*>([\s\S]*?)<\/appmsg>/i)?.[1]
    // App messages also represent links and quoted replies; only subtype 6
    // contains a file attachment whose transport XML is not a caption.
    return Boolean(app && /<type>\s*(?:<!\[CDATA\[\s*)?6\s*(?:\]\]>)?\s*<\/type>/i.test(app.split(/<appattach\b/i)[0]))
}

/** Hide transport XML accidentally imported as media text, retaining source for downloads. */
export function cleanMediaBody(type: string, body: string, source?: string): string {
    if (!body || !mediaTags[type]) return body
    let candidates: string[]
    if (source) {
        if (source.trimStart().startsWith('{')) {
            try {
                const parsed = JSON.parse(source)
                candidates = [parsed.Content, parsed.xml].filter(value => typeof value === 'string' && value.length > 0)
            } catch { return body }
        } else candidates = [source]
    } else candidates = [body]
    const visible = packetText(body)
    for (const candidate of candidates) {
        if (!isMediaPacket(type, candidate)) continue
        const packet = packetText(candidate)
        // Earlier imports clipped the transport body to 8000 characters.
        // Match that exact boundary rather than discarding arbitrary captions.
        if (visible === packet || body.length === 8000 && packet.startsWith(visible)) return ''
    }
    return body
}
