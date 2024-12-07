import * as fs from 'node:fs'
import {LogUtils} from '../util/LogUtils'
import {EmojiSetting} from '../enums/SettingEnums'

export class VariableContainer {
    public static instance: VariableContainer

    public static getInstance(): VariableContainer {
        if (!VariableContainer.instance) {
            VariableContainer.instance = new VariableContainer()
            VariableContainer.instance.parseFromFile()
        }
        return VariableContainer.instance
    }

    private constructor() {
    }

    private variables: {
        [VariableType.SETTING_NOTION_MODE]: NotionMode,
        [VariableType.SETTING_WHITE_LIST]: NotionListType [],
        [VariableType.SETTING_BLACK_LIST]: NotionListType [],
        [VariableType.SETTING_REPLY_SUCCESS]: boolean,
        [VariableType.SETTING_AUTO_SWITCH]: boolean,
        [VariableType.SETTING_CHAT_ID]: string,
        [VariableType.SETTING_BLOCK_OFFICIAL_ACCOUNT]: boolean,
        [VariableType.SETTING_BLOCK_EMOTICON]: boolean,
        [VariableType.SETTING_FORWARD_SELF]: boolean,
        [VariableType.SETTING_COMPRESSION]: boolean,
        [VariableType.SETTING_AUTO_GROUP]: boolean,
        [VariableType.SETTING_AUTO_TRANSCRIPT]: boolean,
        [VariableType.SETTING_LANGUAGE]: string,
        [VariableType.SETTING_EMOJI_CONVERT]: number,
    } = {
        [VariableType.SETTING_NOTION_MODE]: NotionMode.BLACK,
        [VariableType.SETTING_WHITE_LIST]: [],
        [VariableType.SETTING_BLACK_LIST]: [],
        [VariableType.SETTING_REPLY_SUCCESS]: false,
        [VariableType.SETTING_AUTO_SWITCH]: false,
        [VariableType.SETTING_CHAT_ID]: '',
        [VariableType.SETTING_BLOCK_OFFICIAL_ACCOUNT]: false,
        [VariableType.SETTING_BLOCK_EMOTICON]: false,
        [VariableType.SETTING_FORWARD_SELF]: true,
        [VariableType.SETTING_COMPRESSION]: true,
        [VariableType.SETTING_AUTO_GROUP]: false,
        [VariableType.SETTING_AUTO_TRANSCRIPT]: false,
        [VariableType.SETTING_LANGUAGE]: 'zh',
        [VariableType.SETTING_EMOJI_CONVERT]: EmojiSetting.EMOJI,
    }

    setVariable<T extends VariableType>(key: T, value: VariableMap[T]) {
        this.variables[key] = value
    }

    getVariable<T extends VariableType>(key: T): VariableMap[T] {
        return this.variables[key]
    }

    getAllVariables() {
        return this.variables
    }

    // 解析文件为属性
    parseFromFile(): void {
        try {
            if (!fs.existsSync(StorageSettings.STORAGE_FOLDER)) {
                fs.mkdirSync(StorageSettings.STORAGE_FOLDER)
            }
            const wechatParsedData = fs.existsSync(`${StorageSettings.STORAGE_FOLDER}/${StorageSettings.SETTING_FILE_NAME}`) ? JSON.parse(fs.readFileSync(`${StorageSettings.STORAGE_FOLDER}/${StorageSettings.SETTING_FILE_NAME}`, 'utf8')) : {}
            const tgParsedData = fs.existsSync(`${StorageSettings.STORAGE_FOLDER}/${StorageSettings.OWNER_FILE_NAME}`) ? JSON.parse(fs.readFileSync(`${StorageSettings.STORAGE_FOLDER}/${StorageSettings.OWNER_FILE_NAME}`, 'utf8')) : {}

            this.variables = {...this.variables, ...wechatParsedData, ...tgParsedData}
        } catch (error) {
            console.error('Error parsing file:', error)
        }
    }

    // 将内容写入文件
    writeToFile(filePath = `${StorageSettings.STORAGE_FOLDER}/${StorageSettings.SETTING_FILE_NAME}`): void {
        try {
            const data: { [key: string]: any } = {}
            for (const key in this.variables) {
                if (Object.prototype.hasOwnProperty.call(this.variables, key)) {
                    data[key] = this.variables[key]
                }
            }
            fs.writeFileSync(filePath, JSON.stringify(data), 'utf8')
            LogUtils.debugLog().debug('Write to file:', data)
        } catch (error) {
            LogUtils.errorLog().error('Write to file error:', error)
        }
    }
}

export enum VariableType {
    // 转发消息的模式 -- 黑名单 --白名单
    SETTING_NOTION_MODE = 'Setting_Noting_Mode',
    // 白名单
    SETTING_WHITE_LIST = 'Setting_White_List',
    // 黑名单
    SETTING_BLACK_LIST = 'Setting_Black_List',
    // 是否反馈发送成功
    SETTING_REPLY_SUCCESS = 'Setting_Reply_Success',
    // 自动切换回复用户
    SETTING_AUTO_SWITCH = 'Setting_Auto_Switch',
    // tg的chatID
    SETTING_CHAT_ID = 'chat_id',
    // 禁止公众号消息
    SETTING_BLOCK_OFFICIAL_ACCOUNT = 'Setting_Block_Official_Account',
    // 屏蔽表情包
    SETTING_BLOCK_EMOTICON = 'SETTING_BLOCK_EMOTICON',
    // 是否自动转文字
    SETTING_AUTO_TRANSCRIPT = 'Setting_Auto_Transcript',
    // 转发自己发的消息
    SETTING_FORWARD_SELF = 'Setting_Forward_Self',
    // 媒体是否压缩
    SETTING_COMPRESSION = 'Setting_Compression',
    // 是否自动创建群组
    SETTING_AUTO_GROUP = 'Setting_Auto_Group',
    // 语言设置
    SETTING_LANGUAGE = 'Setting_Language',
    // 表情转换方法
    SETTING_EMOJI_CONVERT = 'SETTING_EMOJI_CONVERT',
}

export enum NotionMode {
    BLACK = 'black',
    WHITE = 'white',
}

// 定义一个类型映射，用来描述每个键对应的值类型
type VariableMap = {
    [VariableType.SETTING_NOTION_MODE]: NotionMode,
    [VariableType.SETTING_WHITE_LIST]: NotionListType [],
    [VariableType.SETTING_BLACK_LIST]: NotionListType [],
    [VariableType.SETTING_REPLY_SUCCESS]: boolean,
    [VariableType.SETTING_AUTO_SWITCH]: boolean,
    [VariableType.SETTING_CHAT_ID]: string,
    [VariableType.SETTING_BLOCK_OFFICIAL_ACCOUNT]: boolean,
    [VariableType.SETTING_BLOCK_EMOTICON]: boolean,
    [VariableType.SETTING_FORWARD_SELF]: boolean,
    [VariableType.SETTING_COMPRESSION]: boolean,
    [VariableType.SETTING_AUTO_GROUP]: boolean,
    [VariableType.SETTING_AUTO_TRANSCRIPT]: boolean,
    [VariableType.SETTING_LANGUAGE]: string,
    [VariableType.SETTING_EMOJI_CONVERT]: number,
};

export enum StorageSettings {
    STORAGE_FOLDER = 'storage',
    OWNER_FILE_NAME = 'telegram-owner.json',
    SETTING_FILE_NAME = 'wechat-forward.json',
}

export type NotionListType = {
    id: string,
    name: string,
}