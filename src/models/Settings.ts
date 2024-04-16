import {Contact} from "wechaty";
import * as fs from "node:fs";

export class VariableContainer {

    private variables: {
        [VariableType.SETTING_NOTION_MODE]: string,
        [VariableType.SETTING_WHITE_LIST]: Contact [],
        [VariableType.SETTING_BLACK_LIST]: Contact [],
        [VariableType.SETTING_REPLY_SUCCESS]: boolean
    } = {
        [VariableType.SETTING_NOTION_MODE]: 'black',
        [VariableType.SETTING_WHITE_LIST]: [],
        [VariableType.SETTING_BLACK_LIST]: [],
        [VariableType.SETTING_REPLY_SUCCESS]: false
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
    parseFromFile(filePath: string): void {
        try {
            const data = fs.readFileSync(filePath, 'utf8');
            const parsedData = JSON.parse(data);
            this.variables = parsedData;
        } catch (error) {
            console.error('Error parsing file:', error);
        }
    }

    // 将内容写入文件
    writeToFile(filePath: string): void {
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
}

// 定义一个类型映射，用来描述每个键对应的值类型
type VariableMap = {
    [VariableType.SETTING_NOTION_MODE]: string,
    [VariableType.SETTING_WHITE_LIST]: Contact [],
    [VariableType.SETTING_BLACK_LIST]: Contact [],
    [VariableType.SETTING_REPLY_SUCCESS]: boolean
};

export class GroupListSave {

}

export enum StorageSettings {
    STORAGE_FOLDER = 'storage',
    OWNER_FILE_NAME = 'telegram-owner.json',
    SETTING_FILE_NAME = 'wechat-forward.json',
}
