import fs from "fs";
import path from "path";

const configDir = 'config';
const jsonFileName = path.join(configDir, 'data.json');

// 创建文件夹的函数
const createConfigDir = function () {
    return new Promise((resolve, reject) => {
        fs.mkdir(configDir, { recursive: true }, (err) => {
            if (err) {
                reject(`创建配置文件夹失败: ${err}`);
            } else {
                resolve();
            }
        });
    });
}

export const loadConfig = function () {
    return new Promise((resolve, reject) => {
        fs.readFile(jsonFileName, 'utf8', (err, data) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    createConfigDir()
                        .then(() => resolve({})) // 创建文件夹成功后返回空对象
                        .catch(reject); // 创建文件夹失败则返回错误信息
                } else {
                    reject(`读取 JSON 文件失败: ${err}`);
                }
                return;
            }

            try {
                const jsonObject = JSON.parse(data);
                resolve(jsonObject);
            } catch (error) {
                reject(`解析 JSON 文件失败: ${error}`);
            }
        });
    });
}

export const saveConfig = function (key, value) {
    return new Promise((resolve, reject) => {
        fs.readFile(jsonFileName, 'utf8', (err, data) => {
            if (err && err.code !== 'ENOENT') {
                reject(`读取 JSON 文件失败: ${err}`);
                return;
            }

            let jsonObject = {};
            if (!err) {
                try {
                    jsonObject = JSON.parse(data);
                } catch (error) {
                    reject(`解析 JSON 文件失败: ${error}`);
                    return;
                }
            }

            jsonObject[key] = value;

            fs.writeFile(jsonFileName, JSON.stringify(jsonObject), 'utf8', err => {
                if (err) {
                    reject(`保存 JSON 文件失败: ${err}`);
                } else {
                    resolve();
                }
            });
        });
    });
}