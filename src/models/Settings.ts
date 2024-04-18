import {Contact} from "wechaty";
import * as fs from "node:fs";

export class VariableContainer {

    private variables: {
        [VariableType.SETTING_NOTION_MODE]: NotionMode,
        [VariableType.SETTING_WHITE_LIST]: Contact [],
        [VariableType.SETTING_BLACK_LIST]: Contact [],
        [VariableType.SETTING_REPLY_SUCCESS]: boolean,
        [VariableType.SETTING_CHAT_ID]: string
    } = {
        [VariableType.SETTING_NOTION_MODE]: NotionMode.BLACK,
        [VariableType.SETTING_WHITE_LIST]: [],
        [VariableType.SETTING_BLACK_LIST]: [],
        [VariableType.SETTING_REPLY_SUCCESS]: false,
        [VariableType.SETTING_CHAT_ID]: ''
    };

    setVariable<T extends VariableType>(key: T, value: VariableMap[T]) {
        this.variables[key] = value;
    }

    getVariable<T extends VariableType>(key: T): VariableMap[T] {
        return this.variables[key];
    }

    getAllVariables() {
        return this.variables;
    }

    // 解析文件为属性
    parseFromFile(): void {
        try {
            if (!fs.existsSync(StorageSettings.STORAGE_FOLDER)) {
                fs.mkdirSync(StorageSettings.STORAGE_FOLDER);
            }
            const wechatParsedData = fs.existsSync(`${StorageSettings.STORAGE_FOLDER}/${StorageSettings.SETTING_FILE_NAME}`)?JSON.parse(fs.readFileSync(`${StorageSettings.STORAGE_FOLDER}/${StorageSettings.SETTING_FILE_NAME}`, 'utf8')):{};
            const tgParsedData = JSON.parse(fs.readFileSync(`${StorageSettings.STORAGE_FOLDER}/${StorageSettings.OWNER_FILE_NAME}`, 'utf8'));

            this.variables = {...wechatParsedData, ...tgParsedData};
        } catch (error) {
            console.error('Error parsing file:', error);
        }
    }

    // 将内容写入文件
    writeToFile(filePath = `${StorageSettings.STORAGE_FOLDER}/${StorageSettings.SETTING_FILE_NAME}`): void {
        try {
            const data = JSON.stringify(this.variables, null, 2);
            fs.writeFileSync(filePath, data, 'utf8');
            console.log('File written successfully.');
        } catch (error) {
            console.error('Error writing to file:', error);
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
    // tg的chatID
    SETTING_CHAT_ID = 'chat_id',
}

export enum NotionMode {
    BLACK = 'black',
    WHITE = 'white',
}

// 定义一个类型映射，用来描述每个键对应的值类型
type VariableMap = {
    [VariableType.SETTING_NOTION_MODE]: NotionMode,
    [VariableType.SETTING_WHITE_LIST]: Contact [],
    [VariableType.SETTING_BLACK_LIST]: Contact [],
    [VariableType.SETTING_REPLY_SUCCESS]: boolean,
    [VariableType.SETTING_CHAT_ID]: string
};

export class GroupListSave {

}

export enum StorageSettings {
    STORAGE_FOLDER = 'storage',
    OWNER_FILE_NAME = 'telegram-owner.json',
    SETTING_FILE_NAME = 'wechat-forward.json',
}
