export class MessageTypeUtils {
    // 不接收的消息类型
    static SKIP_TYPE_LIST = ['file_start', 'unknown', 'function_msg']

    static getTypeName(type: string): string{
        return Type[type as keyof typeof Type] || '未知类型'
    }
}

enum Type {
    unknown = '未知类型',
    file_start = '文件开始',
    file = '文件发送结束',
    voice = '语音',
    contact = '名片',
    emoji = '表情',
    image = '图片',
    text = '文本',
    video = '视频',
    room_invitation = '群邀请',
    mini_app = '小程序',
    app_msg = 'app',
    link = '公众号链接',
    add_friend = '添加好友通知',
    quote = '引用',
    transfer = '转账',
    red_packet = '红包',
    video_account = '视频号',
    revoke = '撤回',
    pat = '拍一拍',
    location = '位置',
    function_msg = '微信团队',
    new_monment_timeline = '朋友圈更新',
    chat_histroy = '聊天记录',
    voip = '视频/语音',
    real_time_location = '实时位置共享'
}