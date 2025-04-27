import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { Emoji } from 'gewechaty'
import { StickerData, getStickerToEmojiMap } from './stickerLoader';

export async function handleSticker(ctx: any): Promise<any> {
    // 获取TG贴纸ID
    const stickerId = ctx.message.sticker.file_id;
    
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

    // 读取现有的 sticker.json 文件（如果存在）
    const stickerJsonPath = path.join(__dirname, '../../sticker/sticker.json');
    let stickerData: StickerData = { stickerToEmojiMap: {} };
    if (fs.existsSync(stickerJsonPath)) {
      try {
        const fileContent = fs.readFileSync(stickerJsonPath, 'utf8');
        stickerData = JSON.parse(fileContent);
      } catch (error) {
        console.error('读取 sticker.json 文件失败:', error);
        // 如果文件损坏，使用空对象继续
      }
    }
    
    // 确保 stickerToEmojiMap 存在
    if (!stickerData.stickerToEmojiMap) {
      stickerData.stickerToEmojiMap = {};
    }

    // 检查 emoji.md5 是否已存在
    let emojiExists = false;
    for (const key in stickerData.stickerToEmojiMap) {
      if (stickerData.stickerToEmojiMap[key].md5 === emoji.md5) {
        console.log(`Emoji ${emoji.md5} 已存在于 sticker.json 中，跳过添加和下载操作`);
        emojiExists = true;
        return emoji.md5;
      }
    }
    if (emojiExists) {
      return emoji.md5;
    }
    
    // 添加新的 emoji 信息
    stickerData.stickerToEmojiMap[emoji.md5] = {
      md5: emoji.md5,
      size: Number(emoji.len),
      name: timeId
    };
    fs.writeFileSync(stickerJsonPath, JSON.stringify(stickerData, null, 2), 'utf8');
    console.log(`已将 emoji 信息写入 sticker.json，ID: ${emoji.md5}`);
    verifyJsonFile();
    
    // 确保 sticker 文件夹存在
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

// 检查贴纸 JSON 文件信息
export function verifyJsonFile(filePath?: string): void {
  const jsonPath = path.join(__dirname, '../../sticker/sticker.json');

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