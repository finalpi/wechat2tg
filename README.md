# wechat2tg

English | [中文](README_zh.md)

This project is based on [wechaty](https://github.com/wechaty/wechaty) and implements a WeChat message forwarding to Telegram bot using the [puppet-wechat4u](https://github.com/wechaty/puppet-wechat4u) protocol UOS. Thus, it can circumvent the issue where some accounts are unable to log in to the WeChat web version.

## Notice

1. This project is intended only for technical research and learning and must not be used for illegal purposes.
2. Please submit any issues you encounter to the issue tracker.

## TODO LIST

- [ ] Accept friend requests
- [ ] Send location
- [ ] Receive location messages
- [ ] Group, individual, official account icons

## Installation

### Using in Node.js v16 or higher

1. Install dependencies:
   ```shell
   npm install
    ```
2. Configure the Telegram bot token and proxy information in the `.env` file.

3. Run the program:

   ```shell
   npm start
   ```

4. In Telegram, send `/start` to begin or `/login` to log in.

### Using in Docker

```shell
docker run -itd --env BOT_TOKEN="" --env PROXY_HOST="" --env PROXY_PORT="" --env PROXY_USERNAME="" --env PROXY_PASSWORD="" --env PROXY_PROTOCOL="socks5" finalpi/wechat2tg:latest
```

### Using in docker-compose
create file `docker-compose.yml`:
```yaml
version: '3'

services:
  wechat2tg:
    image: finalpi/wechat2tg:latest
    container_name: wx2tg
    volumes:
      - ./config:/app/storage
    environment:
      - BOT_TOKEN=
      # - PROXY_HOST=
      # - PROXY_PORT=
      # 代理类型:socks5,http,https
      # - PROXY_PROTOCOL=socks5
      # 用户名密码可选
      # - PROXY_USERNAME=
      # - PROXY_PASSWORD=
    restart: unless-stopped

```
```shell
docker-compose up -d
```

## BOT Commands Explanation

`/login`: Retrieve the login QR code

`/user`: Fetch the user list, click to reply

`/room`: Fetch the group list, click to reply

`/recent`: Fetch the most recent users or groups that have sent messages, click to reply

`/setting`: Program settings:

Message mode switch:

Switch between blacklist or whitelist mode

Whitelist mode: Only receive messages from groups in the whitelist

Blacklist mode: Do not receive messages from groups in the blacklist

Feedback on successful delivery: Whether to provide feedback on the message delivery status

Automatic contact switch: Automatically switches back to replying to a user or group if they reply

Receive official account messages: Whether to accept messages from official accounts

## Configuration Explanation
`BOT_TOKEN` (required): Telegram bot token, created via BotFather

### Using a Proxy
Use a proxy to forward requests to the Telegram bot, leave blank if not using a proxy:
```
# Proxy configuration (optional)
# Protocol socks5, http, https
PROXY_PROTOCOL=socks5
PROXY_HOST=
PROXY_PORT=
PROXY_USERNAME=
PROXY_PASSWORD=
```

## License
MIT

## Thanks

Thanks to JetBrains for supporting this project

[![Jetbrains](https://resources.jetbrains.com/storage/products/company/brand/logos/jb_beam.png)](https://www.jetbrains.com)