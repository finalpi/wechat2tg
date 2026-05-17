import { MessageTypeUtils } from './MessageTypeUtils'

export interface NestedChatHistory {
  id: string
  title: string
  content: string
  nestedRecords: NestedChatHistory[]
  attachments: ChatHistoryAttachment[]
}

export interface ChatHistoryAttachment {
  id: string
  type: 'image' | 'file'
  title: string
  fileName: string
  sourceName: string
  payload: any
}

export interface ChatHistoryResult {
  content: string
  nestedRecords: NestedChatHistory[]
  attachments: ChatHistoryAttachment[]
}

// 处理聊天记录
export async function getChatHistory(
  recordJson: any,
  msg: { type: () => any; text: () => string },
  typeName: { [key: string]: string },
  xmlToJson?: (xml: string) => any,
  idPrefix = ''
): Promise<ChatHistoryResult> {
    try {
      // 获取标题
      // const title = recordJson.msg.appmsg.title;
      const title = `[${MessageTypeUtils.getTypeName(msg.type() + '')}]`;
      // 获取条数
      const itemCount = recordJson.recordinfo.datalist.count;
      const dataItems = normalizeDataItems(recordJson.recordinfo.datalist.dataitem);
      if (dataItems.length === 0) {
        return {
          content: `<blockquote expandable>${title}\n件数: ${itemCount}\n</blockquote>`,
          nestedRecords: [],
          attachments: []
        }
      }
      // 获取第一项的日期
      const firstItemDate = dataItems[0].sourcetime.split(' ')[0].replace(/-/g, '/');
      // 获取最后一项的日期
      const datalistLength = dataItems.length;
      const lastIndex = datalistLength - 1;
      const lastItemDate = dataItems[lastIndex].sourcetime.split(' ')[0].replace(/-/g, '/');
      let titleDate = firstItemDate;
      let multiDays = false;
      if (firstItemDate !== lastItemDate) {
        multiDays = true;
        titleDate = `${firstItemDate}～${lastItemDate}`;
      }
      // 构建聊天记录
      let chatHistory = `${title}\n${titleDate}\n件数: ${itemCount}\n`;
      const nestedRecords: NestedChatHistory[] = []
      const attachments: ChatHistoryAttachment[] = []
  
      // 创建数据类型映射
      let chatContent;
      const dataTypeMap = {
        1: typeName.Text,
        2: typeName.Image,
        4: typeName.Video,
        5: typeName.Link,
        19: typeName.MiniApp
      };
      for (const [index, item] of dataItems.entries()) {
        // 获取数据类型
        const dataType = Number(item.datatype);  
        const dataTypeName = MessageTypeUtils.getTypeName(dataTypeMap[dataType as keyof typeof dataTypeMap] + '')
        chatContent = item.datadesc ?? "";
        if (dataType === 1) {
          chatContent = item.datadesc;
        } else if (dataType === 5) {
          chatContent = `<a href="${item.link}">${item.datatitle}</a>`
        } else if (isNestedChatHistory(item)) {
          const nestedRecordJson = normalizeRecordJson(item.recordxml, xmlToJson)
          const nestedTitle = item.datatitle || `[${MessageTypeUtils.getTypeName(msg.type() + '')}]`
          const nestedId = buildNestedId(idPrefix, index + 1)
          const nestedChatHistory = await buildChatHistoryText(nestedRecordJson, msg, typeName, xmlToJson, nestedId)
          nestedRecords.push({
            id: nestedId,
            title: nestedTitle,
            content: nestedChatHistory.content,
            nestedRecords: nestedChatHistory.nestedRecords,
            attachments: nestedChatHistory.attachments
          })
          chatContent = `[${MessageTypeUtils.getTypeName(msg.type() + '')}]\n${nestedTitle}`
        } else if (dataType === 2) {
          const attachment = buildImageAttachment(item, index)
          if (attachment) {
            attachments.push(attachment)
          }
          chatContent = `[${dataTypeName}]`
        } else if (dataType === 8) {
          const attachment = buildFileAttachment(item, index)
          if (attachment) {
            attachments.push(attachment)
          }
          chatContent = `[文件]\n${item.datatitle || ''}`.trim()
        } else if (dataType === 19) {
          chatContent = `[${dataTypeName}]\n${item.datatitle}`;
        } else {
          chatContent = `[${dataTypeName || "不明"}]`
        }
        // 正确解析时间
        const timestamp = item.sourcetime;
        const { date, time } = await formatTime(timestamp);
        
        let chatTime = time;
        if (multiDays === true) {
          chatTime = `${date} ${time}`;
        }
        
        chatHistory += `👤${item.sourcename}(${chatTime})\n${chatContent}\n`;
      }
      // 适配Telegram的HTML模式
  
      // 标题独立
      const lines = chatHistory.split('\n');
      // 前两行合成一个引用块
      let chatLines: string[] = [];
      const titleText = `${lines[0]}\n<blockquote>${lines[1]}</blockquote>`;
      // 处理剩余行
      for (let i = 2; i < lines.length; i++) {
        // 发送者匹配：任意文本(时间)
        if (/^.+\(\d{2}:\d{2}\)$/.test(lines[i]) || /^.+\(\d{2}\/\d{2} \d{2}:\d{2}\)$/.test(lines[i])) {
          chatLines.push(`${lines[i]}`);
        } else {
          chatLines.push(lines[i]);
        }
      }
      const chatText = chatLines.join('\n');
      // const htmlText = `${titleText}\n<blockquote expandable>${chatText}</blockquote>`;
  
      // 标题合并
      const htmlText = `<blockquote expandable>${chatHistory}</blockquote>`;
  
      return {
        content: htmlText,
        nestedRecords,
        attachments
      };
      
    } catch (error) {
      console.error('チャット履歴処理エラー:', error);
      return {
        content: `[${MessageTypeUtils.getTypeName(msg.type() + '')}]`,
        nestedRecords: [],
        attachments: []
      };
    }
  }

function isNestedChatHistory(item: any): boolean {
  return Number(item.datatype) === 17 && Boolean(item.recordxml)
}

function normalizeDataItems(dataitem: any): any[] {
  if (!dataitem) {
    return []
  }

  return Array.isArray(dataitem) ? dataitem : [dataitem]
}

function normalizeRecordJson(recordXmlOrJson: any, xmlToJson?: (xml: string) => any): any {
  if (typeof recordXmlOrJson === 'string') {
    if (!xmlToJson) {
      throw new Error('xmlToJson parser is required for nested chat history')
    }

    return xmlToJson(recordXmlOrJson)
  }

  if (recordXmlOrJson?.recordinfo) {
    return recordXmlOrJson
  }

  return {recordinfo: recordXmlOrJson}
}

function buildImageAttachment(item: any, index: number): ChatHistoryAttachment | undefined {
  const fileNo = item.cdndataurl
  const rawFileAesKey = item.cdndatakey
  const fileAesKey = decodeCdnKey(rawFileAesKey)
  const dataLen = Number(item.datasize || item.fullsize || 0)
  if (!fileNo || !rawFileAesKey) {
    return undefined
  }

  const dataFormat = normalizeImageFormat(item.datafmt)
  return {
    id: `${index + 1}`,
    type: 'image',
    title: '图片',
    fileName: `${item.dataid || `image-${index + 1}`}.${dataFormat}`,
    sourceName: item.sourcename || '',
    payload: {
      fileAesKey,
      rawFileAesKey,
      fileNo,
      attachId: buildCdnAttachId(fileNo, fileAesKey),
      dataLen,
      fullMd5: item.fullmd5 || '',
      thumbFullMd5: item.thumbfullmd5 || '',
      msgId: item.srcMsgCreateTime || item.fromnewmsgid || '',
      newMsgId: item.fromnewmsgid || '',
      toWxid: item.dataitemsource?.hashusername || '',
      userName: item.dataitemsource?.hashusername || item.sourcename || ''
    }
  }
}

function buildFileAttachment(item: any, index: number): ChatHistoryAttachment | undefined {
  const cdnDataUrl = item.cdndataurl
  const rawCdnDataKey = item.cdndatakey
  const cdnDataKey = decodeCdnKey(rawCdnDataKey)
  const attachId = buildCdnAttachId(cdnDataUrl, cdnDataKey)
  const dataLen = Number(item.datasize || 0)
  if (!attachId || !dataLen) {
    return undefined
  }

  return {
    id: `${index + 1}`,
    type: 'file',
    title: item.datatitle || '文件',
    fileName: item.datatitle || `file-${index + 1}`,
    sourceName: item.sourcename || '',
    payload: {
      appId: item.appid || '',
      attachId,
      cdnDataUrl,
      cdnDataKey,
      rawCdnDataKey,
      dataLen,
      fullMd5: item.fullmd5 || '',
      userName: item.dataitemsource?.hashusername || item.sourcename || ''
    }
  }
}

function decodeCdnKey(key: string): string {
  if (!key || !/^[\da-f]+$/i.test(key) || key.length % 2 !== 0) {
    return key || ''
  }

  try {
    const decoded = Buffer.from(key, 'hex').toString('utf8')
    return /^[\x20-\x7E]+$/.test(decoded) ? decoded : key
  } catch {
    return key
  }
}

function normalizeImageFormat(format: string): string {
  const normalized = String(format || '').toLowerCase()
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(normalized)) {
    return normalized
  }

  return 'jpg'
}

function buildCdnAttachId(cdnDataUrl: string, cdnDataKey: string): string {
  if (!cdnDataUrl) {
    return ''
  }

  if (cdnDataUrl.startsWith('@cdn_')) {
    return cdnDataUrl
  }

  return cdnDataKey ? `@cdn_${cdnDataUrl}_${cdnDataKey}_1` : cdnDataUrl
}

async function buildChatHistoryText(
  recordJson: any,
  msg: { type: () => any; text: () => string },
  typeName: { [key: string]: string },
  xmlToJson?: (xml: string) => any,
  idPrefix = ''
): Promise<ChatHistoryResult> {
  return await getChatHistory(recordJson, msg, typeName, xmlToJson, idPrefix)
}

function buildNestedId(parentId: string, index: number): string {
  return parentId ? `${parentId}.${index}` : `${index}`
}
  
// 处理小程序
export async function getMiniprogram(
  msgJson: any,
  msg: { type: () => any; text: () => string }
): Promise<string> {
    try {
      // 获取标题
      const miniprogramTitle = msgJson.msg.appmsg.title;
      
      // 适配Telegram的HTML模式
      const htmlText = `[${MessageTypeUtils.getTypeName(msg.type() + '')}]\n${miniprogramTitle}`;
  
      return htmlText;
      
    } catch (error) {
      console.error('小程序信息处理出错:', error);
      return `[${MessageTypeUtils.getTypeName(msg.type() + '')}]`;
    }
  }
  
  // 时间格式处理函数
  async function formatTime(timestamp: string) {
    // 拆分日期和时间部分
    const [datePart, timePart] = timestamp.split(' ');
  
    // 从日期部分获取月/日
    const [year, month, day] = datePart ? datePart.split('-') : ['', '', ''];
    const date = `${month}/${day}`;
  
    // 从时间部分获取小时:分钟
    const [hour, minute] = timePart ? timePart.split(':') : ['', ''];
    const time = `${hour}:${minute}`;
  
    // 返回包含值的对象
    return {
      year,
      date,
      time
    };
  }
