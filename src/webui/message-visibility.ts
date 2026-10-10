export function isNoiseMessage(type:string,body:string,source=''):boolean {
    // Device handoff packets are control-plane events, including ones which the
    // SDK currently classifies as unknown. Never expose their XML as chat text.
    if(!['text','0'].includes(String(type).toLowerCase())&&/<name>\s*HandOffMaster\s*<\/name>|<handofflist\b|<msg\b[^>]*>\s*<op\b/i.test(source))return true
    if(['file_start','new_monment_timeline'].includes(type))return true
    return ['unknown','text','0'].includes(type)&&!String(body||'').trim()&&!source
}
