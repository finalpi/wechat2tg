/** Old shared history must not authorize a payment against a newly logged-in account. */
export function redPacketOwnedBy(source:unknown,accountId:string):boolean {
    if(!accountId || typeof source !== 'string')return false
    try {
        const raw = JSON.parse(source)
        return Boolean(raw && [raw.FromUserName,raw.ToUserName].some(value=>value === accountId))
    } catch {return false}
}