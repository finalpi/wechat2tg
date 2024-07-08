# [wechat2tg](https://github.com/finalpi/wechat2tg)

English | [中文](README_zh.md)

This project is based on [wechaty](https://github.com/wechaty/wechaty) and implements a WeChat message forwarding to Telegram bot using the [puppet-wechat4u](https://github.com/wechaty/puppet-wechat4u) protocol UOS. Thus, it can circumvent the issue where some accounts are unable to log in to the WeChat web version.

# Main Features

1. Forward WeChat individual messages, group messages, and official account messages to Telegram.
2. Reply to messages on Telegram to specified users.
3. Support group blacklist and whitelist modes.
4. Support for sending videos, files, stickers, images, and voice messages.

## Notice

1. This project is intended only for technical research and learning and must not be used for illegal purposes.
2. Please submit any issues you encounter to the issue tracker.
3. Due to limitations in the Telegram Bot API, it is not possible to send files larger than 20MB or receive files larger than 50MB.

## Installation

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
         - ./save-files:/app/save-files # After mounting the save folder, emojis do not need to be reconverted
      # Use env file or you can just set environment here
      env_file: ".env"
      environment:
         BOT_TOKEN:
         # Proxy settings (uncomment and fill in if needed)
         # PROXY_HOST: ''
         # PROXY_PORT: ''
         # Proxy type: socks5, http, https
         # PROXY_PROTOCOL: 'socks5'
         # Optional username and password
         # PROXY_USERNAME: ''
         # PROXY_PASSWORD: ''
         # Telegram API configuration for sending large files (optional)
         # API_ID: ''
         # API_HASH: ''
         # Group message format
         ROOM_MESSAGE: '<i>🌐#[topic]</i> ---- <b>👤#[(alias)] #[name]: </b>'
         # Official account message format
         OFFICIAL_MESSAGE: '<b>📣#[name]: </b>'
         # Contact message format
         CONTACT_MESSAGE: '<b>👤#[alias_first]: </b>'
         # Group message format (under group context)
         ROOM_MESSAGE_GROUP: '<b>👤#[(alias)] #[name]: </b>'
         # Official account message format (under group context)
         OFFICIAL_MESSAGE_GROUP: '<b>📣#[name]: </b>'
         # Contact message format (under group context)
         CONTACT_MESSAGE_GROUP: '<b>👤#[alias_first]: </b>'
      restart: unless-stopped
```

```shell
docker-compose up -d
```

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

Automatic contact switch: Automatically switches back to replying to a user or group if they reply. **Please note that having a message sent to you just before sending may result in an incorrectly sent message!**

Receive official account messages: Whether to accept messages from official accounts

## Special Response Instructions
Messages sent within 2 minutes can be recalled. The recall method is to reply to your own sent message with the content "&rm".
Media messages need to wait until they are successfully sent before they can be recalled.

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

### Receiving and Sending Large Files

Due to Telegram Bot API limitations, files larger than 20MB cannot be sent, and files larger than 50MB cannot be received. If you need to send or receive larger files, please configure your `API_ID` and `API_HASH`.

**!! Testing found that sending files over 25MB via the web protocol causes the server to return an error upon slicing upload.**

How to obtain `API_ID` and `API_HASH`:

1. Log in to your [telegram account](https://my.telegram.org/)

2. Click on "API development tools" and fill in your application details (only the application title and short name are required).

3. Finally, click "Create application."

### Manual grouping of messages

**Note:** Because wechaty-puppet-wechat4u changes the ID each time it logs in again, it is not possible to obtain a unique key for each contact and group. The method to determine whether it is the same contact or group is by the contact's remark and nickname. This method may incorrectly bind to contacts and groups upon the next login if the remarks or nicknames are not unique, or if the name of the contact or group changes, which might cause binding failure. In such cases, re-binding is required.

1. Turn off the bot's privacy mode. Open BotFather, enter /mybots, select your bot, click Bot Settings - Group Privacy - Turn off. When you see Privacy mode is disabled for xxx, it means it has been successfully turned off.

2. Create a telegram group, add the bot to the group, and bind according to the prompts. Afterward, messages from the contact or group will be forwarded to the group.

`/bind`: View the contacts or groups currently bound to the group.

`/unbind`: Unbind the contacts or groups currently bound to the group.

`/cgdata`: Set the group avatar and nickname to the WeChat contact or group (requires admin privileges).

### Automatic Grouping of Messages

1. Configure `API_ID` and `API_HASH`
2. Turn off the bot's privacy mode. Open BotFather, enter `/mybots`, select your bot, click `Bot Settings` -> `Group Privacy` -> `Turn off`. When you see the message `Privacy mode is disabled for xxx`, it means the privacy mode has been successfully turned off.
3. Use the `/autocg` command to enable automatic grouping mode. Follow the prompts to log in to Telegram.

### Custom Message Templates

If you want to modify the format of message senders, you can adjust the environment variables in Docker or the .env file.

Custom message template placeholders:

`#[alias]`: Contact alias

`#[name]`: Contact nickname

`#[topic]`: Group chat nickname

`#[alias_first]`: Alias preferred; if alias is not available, displays contact nickname


## License
MIT

## Thanks

Thanks to JetBrains for supporting this project

[<img src="https://resources.jetbrains.com/storage/products/company/brand/logos/jb_beam.png" width="200" height="200">](https://www.jetbrains.com)