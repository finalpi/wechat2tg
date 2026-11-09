/** Only public WeChat avatar CDN URLs may be proxied or embedded in rich messages. */
export function allowedAvatarURL(value: string): boolean {
    try {
        const url = new URL(value)
        return value.length <= 2048 && ['http:', 'https:'].includes(url.protocol)
            && !url.username && !url.password && (!url.port || ['80', '443'].includes(url.port))
            && ['qlogo.cn', 'qpic.cn'].some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain))
    } catch {return false}
}