import {GeweBot} from 'gewechaty'

export class WeChatClient {


    private readonly _client: GeweBot

    constructor() {
        this._client = new GeweBot({
            debug: true, // 是否开启调试模式 默认false
            base_api: 'http://192.168.1.245:2531/v2/api',
            file_api: 'http://192.168.1.245:2532/download',
        })
    }
}