import {Entity, Column, PrimaryColumn} from 'typeorm'
import { Language } from '../i18n'

@Entity()
export class Configuration {
    @PrimaryColumn()
    id: number

    @Column({
        default: 0
    })
    chatId: number

    @Column({
        default: 0
    })
    botId: number

    // 媒体是否压缩
    @Column({
        default: true
    })
    compression: boolean

    // 是否使用文件传输助手接收文件
    @Column({
        default: true
    })
    useFileHelper: boolean

    // 是否接收公众号消息
    @Column({
        default: true
    })
    receivePublicAccount: boolean

    // 原始 emoji 是否以图片链接方式显示
    @Column({
        default: false
    })
    emojiPicture: boolean

    // 转发自己发送的消息
    @Column({
        default: true
    })
    selfMessage: boolean

    // 启动时同步群组信息
    @Column({
        default: true
    })
    syncWechat: boolean

    // 语音转文字
    @Column({
        default: true
    })
    autoTranscript: boolean

    // 界面语言设置
    @Column({
        default: 'zh-CN'
    })
    language: Language
}