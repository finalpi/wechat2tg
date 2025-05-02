import { MessageTypeUtils } from './MessageTypeUtils'

// 处理聊天记录
export async function getChatHistory(
  recordJson: any,
  msg: { type: () => any; text: () => string },
  typeName: { [key: string]: string }
): Promise<string> {
    try {
      // 获取标题
      // const title = recordJson.msg.appmsg.title;
      const title = `[${MessageTypeUtils.getTypeName(msg.type() + '')}]`;
      // 获取条数
      const itemCount = recordJson.recordinfo.datalist.count;
      // 获取第一项的日期
      const firstItemDate = recordJson.recordinfo.datalist.dataitem[0].sourcetime.split(' ')[0].replace(/-/g, '/');
      // 获取最后一项的日期
      const datalistLength = recordJson.recordinfo.datalist.dataitem.length;
      const lastIndex = datalistLength - 1;
      const lastItemDate = recordJson.recordinfo.datalist.dataitem[lastIndex].sourcetime.split(' ')[0].replace(/-/g, '/');
      let titleDate = firstItemDate;
      let multiDays = false;
      if (firstItemDate !== lastItemDate) {
        multiDays = true;
        titleDate = `${firstItemDate}～${lastItemDate}`;
      }
      // 构建聊天记录
      let chatHistory = `${title}\n${titleDate}\n件数: ${itemCount}\n`;
  
      const dataItems = recordJson.recordinfo.datalist.dataitem;
      // 创建数据类型映射
      let chatContent;
      const dataTypeMap = {
        1: typeName.Text,
        2: typeName.Image,
        4: typeName.Video,
        5: typeName.Link,
        19: typeName.MiniApp
      };
      for (const item of dataItems) {
        // 获取数据类型
        const dataType = Number(item.datatype);  
        const dataTypeName = MessageTypeUtils.getTypeName(dataTypeMap[dataType as keyof typeof dataTypeMap] + '')
        chatContent = item.datadesc ?? "";
        if (dataType === 1) {
          chatContent = item.datadesc;
        } else if (dataType === 5) {
          chatContent = `<a href="${item.link}">${item.datatitle}</a>`
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
  
      return htmlText;
      
    } catch (error) {
      console.error('チャット履歴処理エラー:', error);
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