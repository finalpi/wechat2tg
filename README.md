# WeChat Message Forwarding to Telegram

English | [中文](README_zh.md)

This project is a WeChat message forwarding to Telegram bot based on [wechaty](https://github.com/wechaty/wechaty). It uses the UOS protocol puppet, which allows bypassing the issue of certain WeChat web accounts unable to log in.
![](https://s1.imagehub.cc/images/2023/06/30/imagea3d9cbc1eb0fa6c7.png)

Currently implemented features:
1. Forwarding group messages that @ you in WeChat to the Telegram bot.
2. Forwarding WeChat private chat messages (images, voice, text, videos) to the Telegram bot.

Planned features for future implementation:
1. Sending messages to specified individuals on the Telegram bot.

## Instructions

### Usage in Node.js versions 16 and above

1. Install dependencies:

   ```shell
   npm install
   ```

2. Configure the Telegram bot token and proxy information in the `.env` file.

3. Run the program:

   ```shell
   npm start
   ```

4. Scan the QR code to log in to your WeChat account.

### Usage in Docker
```shell
docker run -itd --env BOT_TOKEN="" --env HOST="" --env PORT="" --env USERNAME="" --env PASSWORD="" --env PROTOCOL="socks5" finalpi/wechat2tg:latest
```

### Usage with docker-compose
```shell
docker-compose up -d
```

## Disclaimer

This project is for technical research and learning purposes only. It must not be used for illegal activities.

## License

[MIT](LICENSE)

GitHub (https://github.com/wechaty/wechaty)
GitHub - wechaty/wechaty: Conversational RPA SDK for Chatbot Makers
Conversational RPA SDK for Chatbot Makers. Contribute to wechaty/wechaty development by creating an account on GitHub.

## Thanks
Thanks to Jetbrains for supporting this project
[![Jetbrains](https://resources.jetbrains.com/storage/products/company/brand/logos/jb_beam.png)](https://www.jetbrains.com)