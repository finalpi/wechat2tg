import manifest from '../../../src/webui/public/emoji/manifest.json'

export const wechatEmoji = manifest.files.map(file => ({
  name: file.source.replace(/\.webp$/, ''),
  text: `[${file.source.replace(/\.webp$/, '')}]`,
  url: `/assets/wechat-emoji/${file.file}`,
}))
export const wechatEmojiByText = new Map(wechatEmoji.map(emoji => [emoji.text, emoji]))
