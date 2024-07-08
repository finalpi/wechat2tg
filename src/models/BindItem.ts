export interface BindItem {
    name: string
    chat_id: number
    // 类型:0-用户,1-群组
    type: number | 0 | 1
    // 绑定的id
    bind_id: string
    // 别名
    alias: string
    // 微信的动态id
    wechat_id: string
    // 头像
    avatar: string
    // 是否绑定成功:0-否,1-是
    has_bound: 0 | 1
}

export type ChatMapping = {
    id: number
    wx_id: string
    // 0 联系人 1 公众号 3 群组
    wx_contact_type: number | 0 | 1 | 2
    wx_contact_hash: string
    tg_chat_id: number
    // 头像后面带的序号
    avatar_seq?: number
    name: string
    gender?: number
    alias?: string
    province?: string
    signature?: string
    city?: string
}

export class BindItemConstants {
    static readonly OFFICIAL_BIND_ID = '##official_bind_id'
}