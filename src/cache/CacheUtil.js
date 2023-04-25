import fs from "fs";

const jsonFileName = 'data.json';

export const loadConfig = function () {
    return new Promise((resolve, reject) => {
        fs.readFile(jsonFileName, 'utf8', (err, data) => {
            if (err) {
                resolve({}); // 返回空对象
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
                // 如果读取文件出错，并且不是文件不存在的错误，则返回错误信息
                reject(`读取 JSON 文件失败: ${err}`);
                return;
            }

            let jsonObject = {};
            if (!err) {
                try {
                    jsonObject = JSON.parse(data); // 将 JSON 字符串解析为对象
                } catch (error) {
                    reject(`解析 JSON 文件失败: ${error}`);
                    return;
                }
            }

            // 替换传入的 key 对应的值
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
