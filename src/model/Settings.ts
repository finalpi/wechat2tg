import * as fs from 'node:fs'

export class VariableContainer {

    private variables: {
        [VariableType.SETTING_NOTION_MODE]: NotionMode,
        [VariableType.SETTING_WHITE_LIST]: NotionListType [],
        [VariableType.SETTING_BLACK_LIST]: NotionListType [],
        [VariableType.SETTING_REPLY_SUCCESS]: boolean,
        [VariableType.SETTING_AUTO_SWITCH]: boolean,
        [VariableType.SETTING_CHAT_ID]: string,
        [VariableType.SETTING_ACCEPT_OFFICIAL_ACCOUNT]: boolean,
        [VariableType.SETTING_BLOCK_EMOTICON]: boolean,
        [VariableType.SETTING_FORWARD_SELF]: boolean,
        [VariableType.SETTING_COMPRESSION]: boolean,
        [VariableType.SETTING_AUTO_GROUP]: boolean,
        [VariableType.SETTING_AUTO_TRANSCRIPT]: boolean,
        [VariableType.SETTING_LANGUAGE]: string,
    } = {
        [VariableType.SETTING_NOTION_MODE]: NotionMode.BLACK,
        [VariableType.SETTING_WHITE_LIST]: [],
        [VariableType.SETTING_BLACK_LIST]: [],
        [VariableType.SETTING_REPLY_SUCCESS]: false,
        [VariableType.SETTING_AUTO_SWITCH]: true,
        [VariableType.SETTING_CHAT_ID]: '',
        [VariableType.SETTING_ACCEPT_OFFICIAL_ACCOUNT]: false,
        [VariableType.SETTING_BLOCK_EMOTICON]: false,
        [VariableType.SETTING_FORWARD_SELF]: false,
        [VariableType.SETTING_COMPRESSION]: false,
        [VariableType.SETTING_AUTO_GROUP]: false,
        [VariableType.SETTING_AUTO_TRANSCRIPT]: false,
        [VariableType.SETTING_LANGUAGE]: 'zh',
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

            this.variables = {...wechatParsedData, ...tgParsedData}
        } catch (error) {
            console.error('Error parsing file:', error)
        }
    }

    // 将内容写入文件
    writeToFile(filePath = `${StorageSettings.STORAGE_FOLDER}/${StorageSettings.SETTING_FILE_NAME}`): void {
        try {
            const data = {
                [VariableType.SETTING_NOTION_MODE]: this.variables[VariableType.SETTING_NOTION_MODE] ? this.variables[VariableType.SETTING_NOTION_MODE] : NotionMode.BLACK,
                [VariableType.SETTING_WHITE_LIST]: this.variables[VariableType.SETTING_WHITE_LIST] ? this.variables[VariableType.SETTING_WHITE_LIST] : [],
                [VariableType.SETTING_BLACK_LIST]: this.variables[VariableType.SETTING_BLACK_LIST] ? this.variables[VariableType.SETTING_BLACK_LIST] : [],
                [VariableType.SETTING_REPLY_SUCCESS]: this.variables[VariableType.SETTING_REPLY_SUCCESS] ? this.variables[VariableType.SETTING_REPLY_SUCCESS] : false,
                [VariableType.SETTING_AUTO_SWITCH]: this.variables[VariableType.SETTING_AUTO_SWITCH] ? this.variables[VariableType.SETTING_AUTO_SWITCH] : false,
                [VariableType.SETTING_FORWARD_SELF]: this.variables[VariableType.SETTING_FORWARD_SELF] ? this.variables[VariableType.SETTING_FORWARD_SELF] : false,
                [VariableType.SETTING_COMPRESSION]: this.variables[VariableType.SETTING_COMPRESSION] ? this.variables[VariableType.SETTING_COMPRESSION] : false,
                [VariableType.SETTING_ACCEPT_OFFICIAL_ACCOUNT]: this.variables[VariableType.SETTING_ACCEPT_OFFICIAL_ACCOUNT] ? this.variables[VariableType.SETTING_ACCEPT_OFFICIAL_ACCOUNT] : false,
                [VariableType.SETTING_BLOCK_EMOTICON]: this.variables[VariableType.SETTING_BLOCK_EMOTICON] ? this.variables[VariableType.SETTING_BLOCK_EMOTICON] : false,
                [VariableType.SETTING_AUTO_GROUP]: this.variables[VariableType.SETTING_AUTO_GROUP] ? this.variables[VariableType.SETTING_AUTO_GROUP] : false,
                [VariableType.SETTING_LANGUAGE]: this.variables[VariableType.SETTING_LANGUAGE] ? this.variables[VariableType.SETTING_LANGUAGE] : 'zh',
            }
            fs.writeFileSync(filePath, JSON.stringify(data), 'utf8')
            console.log('File written successfully.')
        } catch (error) {
            console.error('Error writing to file:', error)
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
    // 接受公众号消息
    SETTING_ACCEPT_OFFICIAL_ACCOUNT = 'Setting_Accept_Official_Account',
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
    [VariableType.SETTING_ACCEPT_OFFICIAL_ACCOUNT]: boolean,
    [VariableType.SETTING_BLOCK_EMOTICON]: boolean,
    [VariableType.SETTING_FORWARD_SELF]: boolean,
    [VariableType.SETTING_COMPRESSION]: boolean,
    [VariableType.SETTING_AUTO_GROUP]: boolean,
    [VariableType.SETTING_AUTO_TRANSCRIPT]: boolean,
    [VariableType.SETTING_LANGUAGE]: string,
};

export class GroupListSave {

}

export enum StorageSettings {
    STORAGE_FOLDER = 'storage',
    OWNER_FILE_NAME = 'telegram-owner.json',
    SETTING_FILE_NAME = 'wechat-forward.json',
}

export type NotionListType = {
    id: string,
    name: string,
    // shot_id: string,
    // type: string,
}