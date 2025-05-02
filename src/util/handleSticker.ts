import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { Emoji } from 'gewechaty'

// 定义类型
interface StickerInfo {
  md5: string;
  size: number;
  name: string;
}

interface StickerData {
  stickerToEmojiMap: {
    [stickerId: string]: StickerInfo;
  };
}

// 缓存变量
let stickerDataCache: StickerData | null = null;
let lastModified = 0;

// 指定贴纸json路径
const stickerInfoPath = path.join(__dirname, '../../sticker/sticker.json');

// 获取贴纸信息，带缓存机制
function getStickerData(forceReload = false): StickerData {
  try {
    // 检查文件是否存在
    if (!fs.existsSync(stickerInfoPath)) {
      console.error('贴纸信息文件未找到:', stickerInfoPath);
      initJsonFile(stickerInfoPath);
    }

    // 获取文件状态
    const stats = fs.statSync(stickerInfoPath);
    const currentModified = stats.mtimeMs;

    // 如果有缓存且文件未更新且不强制重载，返回缓存
    if (!forceReload && stickerDataCache && lastModified === currentModified) {
      return stickerDataCache;
    }

    // 读取并解析文件
    const fileContent = fs.readFileSync(stickerInfoPath, 'utf8');
    const data: StickerData = JSON.parse(fileContent);

    // 更新缓存和时间戳
    stickerDataCache = data;
    lastModified = currentModified;

    console.log('贴纸信息已从文件加载');
    return data;
  } catch (error) {
    console.error('加载贴纸信息时出错:', error);
    
    // 如果出错但有缓存，返回缓存
    if (stickerDataCache) {
      console.log('由于错误，使用缓存的贴纸数据');
      return stickerDataCache;
    }
    
    // 否则返回空对象
    return { stickerToEmojiMap: {} };
  }
}

// 获取贴纸映射
function getStickerToEmojiMap(): { [stickerId: string]: StickerInfo } {
  return getStickerData().stickerToEmojiMap;
}

// 添加文件监听，自动更新缓存
try {
  fs.watchFile(stickerInfoPath, { interval: 1000 }, (curr, prev) => {
    if (curr.mtime !== prev.mtime) {
      console.log('贴纸信息文件已更改，下次访问时将更新缓存');
      // 可选：直接清除缓存，强制下次访问重新加载
      stickerDataCache = null;
      lastModified = 0;
    }
  });
  console.log('已设置文件监听:', stickerInfoPath);
} catch (error) {
  console.warn('无法监视贴纸信息文件的更改:', error);
}

// 应用退出时清理
process.on('exit', () => {
  fs.unwatchFile(stickerInfoPath);
});


// 生成发送所需的Emoji对象
export async function handleSticker(ctx: any): Promise<any> {
    // 获取TG贴纸ID
    const stickerId = ctx.message.sticker.file_unique_id;
    
    // 如果没有贴纸ID，直接返回 false 继续后续操作
    if (!stickerId) {
        return null;
    }

    // 获取贴纸映射
    const stickerToEmojiMap = getStickerToEmojiMap();
    
    // 遍历映射表查找匹配的贴纸
    for (const [mappedStickerId, emojiInfo] of Object.entries(stickerToEmojiMap)) {
        if (stickerId === mappedStickerId) {
        try {
            // 创建表情对象
            const emoji = new Emoji({
                emojiMd5: emojiInfo.md5,
                emojiSize: emojiInfo.size
            });
            
            // 返回 true 表示已处理，中断后续操作
            return emoji;
        } catch (error) {
            console.error('贴纸发送失败:', error);
            return null;
        }
        }
    }

    // 没有找到匹配的贴纸，返回 false 继续后续操作
    return null;
}

// 定义 Emoji 类型接口
interface wxEmoji {
  md5: string;
  len: number;
  cdnurl: string;
}

// 保存微信贴纸信息
export async function saveEmoji(emoji: wxEmoji): Promise<string> {
  try {
    // 生成时间戳格式的 ID (MMDDHHMMSS)
    const now = new Date();
    const timeId = now.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).replace(/[\/\s:]/g, ''); // 格式化为 MMDDHHMMSS

    // 定义需要检查的文件列表
    const stickerFiles = [
      path.join(__dirname, '../../sticker/sticker.json'),
      path.join(__dirname, '../../sticker/stickerSave.json')
    ];

    // 用于存储所有文件的数据
    const allStickerData: { [filePath: string]: StickerData } = {};

    // 读取所有文件
    for (const filePath of stickerFiles) {
      let fileData: StickerData = { stickerToEmojiMap: {} };
      
      if (fs.existsSync(filePath)) {
        try {
          const fileContent = fs.readFileSync(filePath, 'utf8');
          fileData = JSON.parse(fileContent);
        } catch (error) {
          console.error(`读取文件 ${path.basename(filePath)} 失败:`, error);
          // 如果文件损坏，使用空对象继续
        }
      } else {
        initJsonFile(filePath);
      }
      
      // 确保 stickerToEmojiMap 存在
      if (!fileData.stickerToEmojiMap) {
        fileData.stickerToEmojiMap = {};
      }
      
      allStickerData[filePath] = fileData;
    }

    // 检查 emoji.md5 是否已存在于任何文件中
    let emojiExists = false;
    for (const filePath in allStickerData) {
      const data = allStickerData[filePath];
      
      for (const key in data.stickerToEmojiMap) {
        if (data.stickerToEmojiMap[key].md5 === emoji.md5) {
          console.log(`Emoji ${emoji.md5} 已存在于 ${path.basename(filePath)} 中，跳过添加和下载操作`);
          emojiExists = true;
          return emoji.md5;
        }
      }
    }

    if (emojiExists) {
      return emoji.md5;
    }

    // 添加新的 emoji 信息到 stickerSave.json
    const stickerSaveJsonPath = stickerFiles[1]; // stickerSave.json 的路径
    allStickerData[stickerSaveJsonPath].stickerToEmojiMap[emoji.md5] = {
      md5: emoji.md5,
      size: Number(emoji.len),
      name: timeId
    };
    fs.writeFileSync(stickerSaveJsonPath, JSON.stringify(allStickerData[stickerSaveJsonPath], null, 2), 'utf8');
    console.log(`已将 emoji 信息写入 stickerSave.json，ID: ${emoji.md5}`);

    verifyJsonFile(stickerSaveJsonPath);

    // 确保保存图片的 sticker 文件夹存在
    const stickerFolderPath = path.join(__dirname, '../../sticker');
    if (!fs.existsSync(stickerFolderPath)) {
      fs.mkdirSync(stickerFolderPath, { recursive: true });
    }
    
    // 下载并保存 emoji 图片
    const imagePath = path.join(stickerFolderPath, `${emoji.md5}.gif`);
    await downloadImage(emoji.cdnurl, imagePath);
    
    return emoji.md5;
  } catch (error) {
    console.error('保存 emoji 失败:', error);
    throw error;
  }
}

// 下载图片并保存到本地
async function downloadImage(url: string, outputPath: string): Promise<void> {
  try {
    // 检查文件是否已存在，如果存在则跳过下载
    if (fs.existsSync(outputPath)) {
      console.log(`文件已存在: ${outputPath}，跳过下载`);
      return;
    }
    
    // 使用 axios 下载图片
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream'
    });
    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer);
    
    // 返回 Promise，在写入完成或出错时解析
    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log(`图片已保存到: ${outputPath}`);
        resolve();
      });
      writer.on('error', reject);
    });
  } catch (error) {
    console.error('下载图片失败:', error);
    throw error;
  }
}

// 初始化 JSON 文件
function initJsonFile(filePath: string): void {
  // 检查文件是否存在
  if (!fs.existsSync(filePath)) {
    console.log(`文件 ${path.basename(filePath)} 不存在，正在初始化...`);
    
    // 创建初始化数据
    const initialData = {
      "stickerToEmojiMap": {
        "Telegram贴纸ID（输出在容器log中）": {
          "md5": "微信贴纸md5（新接收到的微信贴纸md5和size信息将自动存储在stickerSave.json中，gif文件将保存在sticker文件夹中）",
          "size": 27053,
          "name": "备注名（可选）"
        }
      }
    };
    
    try {
      // 确保目录存在
      const directory = path.dirname(filePath);
      if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
      }
      
      // 写入初始化数据
      fs.writeFileSync(filePath, JSON.stringify(initialData, null, 2), 'utf8');
      console.log(`已成功初始化文件 ${path.basename(filePath)}`);
    } catch (error) {
      console.error(`初始化文件 ${path.basename(filePath)} 失败:`, error);
    }
  }
}

// 检查贴纸 JSON 文件信息
function verifyJsonFile(filePath?: string): void {
  const jsonPath = filePath;

  console.log('验证 JSON 文件:');
  console.log(`检查路径: ${jsonPath}`);
  
  if (fs.existsSync(jsonPath)) {
    try {
      const content = fs.readFileSync(jsonPath, 'utf8');
      console.log(`- 文件存在，大小: ${content.length} 字节`);
      
      try {
        const data = JSON.parse(content);
        console.log(`- JSON 解析成功，包含 ${Object.keys(data.stickerToEmojiMap || {}).length} 个贴纸`);
      } catch (e) {
        console.log(`- JSON 解析失败: ${e.message}`);
      }
    } catch (e) {
      console.log(`- 文件读取失败: ${e.message}`);
    }
  } else {
    console.log('- 文件不存在');
  }
}