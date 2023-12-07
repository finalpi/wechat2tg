# WeChat Message Forwarding to Telegram

English | [中文](README_zh.md)

This project is based on [wechaty](https://github.com/wechaty/wechaty) and aims to forward WeChat messages to a Telegram bot. It is currently in the testing phase and uses the UOS protocol's puppet implementation, which can bypass some issues with certain accounts not being able to log in to the WeChat web version.

![](https://s1.imagehub.cc/images/2023/06/30/imagea3d9cbc1eb0fa6c7.png)

Currently implemented features include:

1. Forwarding group messages that @ you in WeChat to a Telegram bot
2. Forwarding private WeChat messages containing images, voice messages, text, or videos to a Telegram bot
3. Group message whitelist

## Usage

### Using Node.js v16 or higher

1. Install dependencies:

   ```shell
   npm install
   ```

2. Configure the Telegram bot's token and proxy information in the `.env` file.

3. Run the program:

   ```shell
   npm start
   ```

4. Scan the QR code to log in to your WeChat account.

### Using Docker

```shell
docker run -itd --env BOT_TOKEN="" --env HOST="" --env PORT="" --env USERNAME="" --env PASSWORD="" --env PROTOCOL="socks5" finalpi/wechat2tg:latest
```

### Using docker-compose

```shell
docker-compose up -d
```

## Configuration

`BOT_TOKEN`(required): Telegram bot's token, created through [BotFather](https://t.me/BotFather)

### Using a Proxy

Use a proxy to forward Telegram bot requests leave it blank if not using a proxy:
```
# Protocol can be socks5, http, or https
PROTOCOL=socks5
HOST=
PORT=
USERNAME=
PASSWORD=
```

## Disclaimer

This project is only for technical research and learning purposes, and must not be used for illegal activities.

## License

[MIT](LICENSE)

## Thanks
Thanks to JetBrains for their support of this project.
[![Jetbrains](https://resources.jetbrains.com/storage/products/company/brand/logos/jb_beam.png)](https://www.jetbrains.com)