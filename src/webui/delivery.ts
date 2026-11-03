// No connection was established for these errors. Timeouts/resets after a request
// may have delivered the message, so they must remain uncertain.
export function telegramDeliveryUncertain(error:any):boolean {
    if(['ECONNREFUSED','ENOTFOUND','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','ERR_PROXY_CONNECTION_FAILED'].includes(error?.code))return false
    const apiCode=Number(error?.response?.error_code||error?.response?.data?.error_code||error?.response?.status|| (typeof error?.code==='number'?error.code:0))
    if(apiCode>=400&&apiCode<500)return false
    return true
}
