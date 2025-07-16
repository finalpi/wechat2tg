# wechat2tg-v3

[中文](README_zh.md) | English

Transmit WeChat messages on Telegram, supporting multiple WeChat protocols (iPad, Mac, Car, Windows, Pad)

## Telegram Group: [@Wx2TgUserGroup](https://t.me/+AD02MEZa-og3ZGY1)

## Main Features

1. Receive messages from WeChat personal chats, group chats, official accounts, and enterprise WeChat
2. Send messages via Telegram to specific WeChat users, groups, and official accounts
3. Flexible group message blocking functionality

## Supported Message Types

### WeChat Message Type Support List

+ [x] Text messages
+ [x] Enterprise WeChat messages
+ [x] WeChat stickers
+ [x] Image messages
+ [x] Video messages
+ [x] Audio/Video calls (notification only)
+ [x] File messages
+ [x] Link messages
+ [x] Group chat messages
+ [x] Group chat @mentions (converts @everyone and @you to Telegram @you)
+ [x] Official account messages
+ [x] Emoji
+ [x] Location messages
+ [x] Message recall
+ [x] Voice messages
+ [ ] Red packet messages (notification only, cannot retrieve content)
+ [ ] Mini program messages

### Telegram Message Type Support List

+ [x] Text messages
+ [x] Sticker emotes
+ [x] Image messages
+ [x] Video messages
+ [x] File messages
+ [x] Voice messages

## Precautions

1. This project is for technical research and learning purposes only, strictly prohibited for illegal use
2. Welcome to submit issues for any problems encountered during use
3. Ensure that the IP of wx2tg-server matches the login region, otherwise verification code may be required
4. On arm-64 architecture, due to missing dependencies, the wx2tg-server image cannot be used.
5. After logging in, you may be logged out once after one day; after logging in again, the connection will remain stable.

## Installation & Deployment

First, copy `.env.example` to `.env` and configure the environment variables.

Copy `app.conf.example` to `app.conf` in the `conf` directory and set the Redis address to your deployed Redis address.

### docker-compose

Create a `docker-compose.yml` file:

```yaml
version: '3'

services:
  wx2tg-v3:
    image: finalpi/wechat2tg-v3:latest
    container_name: wx2tg-v3
    # ports:
       # - "8056:8056" # Only needed for callback mode
    volumes:
      - ./config:/app/storage
      - ./save-files:/app/save-files # After mounting save-files folder, sticker files do not need to be converted again
    env_file: ".env"
    restart: unless-stopped

  wx2tg-server:
    image: finalpi/wx2tg-server:v3-latest # Pull image
    container_name: wx2tg-server
    ports:
      - "8058:8058"
    volumes:
      - ./conf:/usr/wic-go/conf
    restart: unless-stopped

  wx2tg-redis:
    image: redis:7.2
    container_name: wx2tg-redis
    ports:
      - "16379:6379"
    volumes:
      - ./redis-data:/data
    command: ["redis-server", "--appendonly", "yes"]
    restart: unless-stopped
```

#### Run

```shell
docker-compose up -d
```

#### Disable Bot Privacy Mode

Disable the bot's privacy mode. Open BotFather, enter `/mybots`, select your bot. Click `Bot Settings` - `Group Privacy` - `Turn off`. When `Privacy mode is disabled for xxx` appears, it means the disabling is successful.

## Bot Commands

- `/login`: Get login QR code; the first person to send this command during initial deployment will become the bot owner

- `/flogin`: Get file transfer assistant login QR code, supports receiving videos and files

- `/update`: Update group avatar and nickname information

- `/message`: Toggle group message reception

- `/forward`: Toggle forwarding of messages from other people or bots in the group

- `/user`: Get WeChat user list; click the button to create a new group or bind a user (can search by name or remarks, e.g., `/user Zhang` to find WeChat users containing "Zhang")

- `/room`: Get WeChat group list; click the button to create a new group or bind a WeChat group (can search by name or remarks, e.g., `/room takeout` to find WeChat groups containing "takeout")

- `/settings`: Program settings

- `/unbind`: Unbind WeChat group or WeChat user (only supported in group usage)

## Environment Variables

| Name | Required | Description                                                         |
|------|----------|---------------------------------------------------------------------|
|`BOT_TOKEN`| Yes | Telegram Bot token, created via [BotFather](https://t.me/BotFather) |
|`API_ID`| Yes | Telegram API ID                                                     |
|`API_HASH`| Yes | Telegram API HASH                                                   |
|`DEVICE_TYPE`| Yes | WeChat login protocol: ipad, car, mac, pad, win, ipadX              |
|`BASE_API`| Yes | wx2tg-server container API request address, full path required      | |
|`PROXY_PROTOCOL`| No | Proxy type optional values (socks5, http, https)                    |
|`PROXY_HOST`| No | Proxy URL                                                           |
|`PROXY_PORT`| No | Proxy port number                                                   |
|`PROXY_USERNAME`| No | Proxy username                                                      |
|`PROXY_PASSWORD`| No | Proxy password                                                      |
|`ROOM_MESSAGE`| No | Display format of WeChat group messages in Bot                      |
|`OFFICIAL_MESSAGE`| No | Display format of official account messages in Bot                  |
|`CONTACT_MESSAGE`| No | Display format of WeChat user messages in Bot                       |
|`ROOM_MESSAGE_GROUP`| No | Display format of WeChat group messages in group                    |
|`CONTACT_MESSAGE_GROUP`| No | Display format of WeChat user messages in group                     |
|`OFFICIAL_MESSAGE_GROUP`| No | Display format of official account messages in group                |
|`CREATE_ROOM_NAME`| No | Format of group name when automatically creating WeChat groups      |
|`CREATE_CONTACT_NAME`| No | Format of group name when automatically creating WeChat contacts    |
|`MESSAGE_DISPLAY`| No | Display format of text messages                                     |

## Settings Command `/settings`

1. WeChat emoji display as image links: When enabled, friend-sent Minions emojis will be converted to image links

2. Synchronize group information on startup: When enabled, all user information will be synchronized when the program starts, updating group avatars and names

## Voice-to-Text

1. Configure `TENCENT_SECRET_ID` and `TENCENT_SECRET_KEY`, which can be activated in the Tencent [Speech Recognition Console](https://console.cloud.tencent.com/asr). Free usage quota is available.

2. Enable automatic text-to-speech function in `/settings`

## Obtaining `API_ID` and `API_HASH`

1. Log in to [telegram account](https://my.telegram.org/)

2. Click "API development tools" and fill in application details (only application title and short name are required)

3. Finally, click "Create application"

## Custom Message Templates

If you want to modify the message sender's format, you can modify the environment variables in docker or the `.env` file

Custom message template placeholders:

`#[alias]`: Contact remarks

`#[name]`: Contact nickname

`#[topic]`: Group chat nickname

`#[alias_first]`: Remarks priority, if no remarks, display contact's nickname

`#[identity]`: Identity information text

`#[body]`: Message body text

`#[br]`: Line break

## How to @everyone

Send a message starting with `@all` to @everyone, only supports text messages @everyone

## Participating in Development

1. Fork the project, switch to the `wx2tg-v3-dev` branch, or create a new branch. Please do not directly submit code to the main branch.

2. Submit a Pull Request to the `wx2tg-v3-dev` branch

## License

[MIT](LICENSE)

## Thanks

Thanks to Jetbrains for supporting this project

[<img src="https://resources.jetbrains.com/storage/products/company/brand/logos/jetbrains.png" width="200">](https://www.jetbrains.com)