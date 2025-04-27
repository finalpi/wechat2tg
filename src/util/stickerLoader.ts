import fs from 'fs';
import path from 'path';

// 定义类型
interface StickerInfo {
  md5: string;
  size: number;
  name: string;
}

export interface StickerData {
  stickerToEmojiMap: {
    [stickerId: string]: StickerInfo;
  };
}

// 缓存变量
let stickerDataCache: StickerData | null = null;
let lastModified = 0;

// 使用本地相对路径
const stickerInfoPath = path.join(__dirname, '../../sticker/sticker.json');

// 获取贴纸信息，带缓存机制
export function getStickerData(forceReload = false): StickerData {
  try {
    // 检查文件是否存在
    if (!fs.existsSync(stickerInfoPath)) {
      console.error('贴纸信息文件未找到:', stickerInfoPath);
      return { stickerToEmojiMap: {} };
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
export function getStickerToEmojiMap(): { [stickerId: string]: StickerInfo } {
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