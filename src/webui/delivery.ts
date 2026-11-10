// Only explicit pre-connection failures prove that Telegram did not receive a
// request. A generic timeout/reset is NOT evidence that retrying is safe.
function beforeConnection(error:any):boolean {
    return ['ECONNREFUSED','ENOTFOUND','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','ERR_PROXY_CONNECTION_FAILED'].includes(error?.code)
        || error?.code === 'ETIMEDOUT' && error?.syscall === 'connect'
}
export function telegramRetryable(error:any):boolean {
    return beforeConnection(error) || Number(error?.response?.error_code || error?.error_code) === 429
}
export function telegramDeliveryUncertain(error:any):boolean {
    if(beforeConnection(error))return false
    const apiCode = Number(error?.response?.error_code || error?.response?.data?.error_code || error?.response?.status || (typeof error?.code === 'number' ? error.code : 0))
    if(apiCode >= 400 && apiCode < 500)return false
    return true
}