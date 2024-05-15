export interface BindItem{
    name: string
    chat_id: number
    // 类型:0-用户,1-群组
    type: number
    // 绑定的id
    bind_id: string
}