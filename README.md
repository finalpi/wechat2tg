# [wechat2tg](https://github.com/finalpi/wechat2tg)

English | [中文](https://github.com/finalpi/wechat2tg/blob/master/README_zh.md)

This project forwards WeChat messages to a Telegram bot, based on [wechaty](https://github.com/wechaty/wechaty).  
By using [puppet-wechat4u](https://github.com/wechaty/puppet-wechat4u) (which implements the UOS protocol), it
circumvents the login issue with the WeChat Web version.

# Main Features

1. Forwards individual WeChat chat messages, group messages, and public account messages to Telegram.
2. Allows Telegram to reply to specific WeChat users.
3. Supports blacklisting and whitelisting modes for group chats.
4. Supports sending videos, files, stickers, images, and voice messages.
5. By configuring `API_ID` and `API_HASH`, it can automatically create a group chat for forwarding.

# Notes

1. This project is for research and educational purposes only. It should not be used for illegal activities.
2. Feel free to submit issues for any problems encountered.
3. Due to Telegram Bot API limitations, files larger than **20MB** cannot be sent, and files larger than **50MB** cannot
   be received (this can be resolved by configuring `API_ID` and `API_HASH`).
4. This project attempts to support only messages compatible with **WeChat Web**. Unsupported messages are beyond its
   capabilities.
5. Currently, message loss due to network or technical issues cannot be completely avoided, so please be cautious with
   important messages!

## Main Bot Commands

`/login`: Get a login QR code.

`/user`: Get a user list with reply options (you can search by name or note, e.g., `/user Zhang` will find users with "
Zhang" in their name or notes).

`/room`: Get a group list with reply options (you can search by name or note, e.g., `/room Takeout` will find groups
with "Takeout" in their name or notes).

`/recent`: Get a list of recent users or groups who sent messages, with reply options.

`/setting`: Program settings.

# Usage

## Configuration

`BOT_TOKEN` **Required**: The token for your Telegram Bot, created via [BotFather](https://t.me/BotFather).

### Using a Proxy

Configure a Telegram proxy. Leave fields blank to not use a proxy:

```
# Proxy configuration (optional)
# Protocol: socks5, http, https
PROXY_PROTOCOL=socks5
PROXY_HOST=
PROXY_PORT=
PROXY_USERNAME=
PROXY_PASSWORD=
```

## docker-compose (Recommended)

`docker-compose.yml` file:

```yaml
version: '3'

services:
  wechat2tg:
    image: finalpi/wechat2tg:latest
    container_name: wx2tg
    volumes:
      - ./config:/app/storage
      - ./save-files:/app/save-files # Stickers won’t need to be re-converted once saved here
    # use env file or you can just set environment here
    # env_file: ".env"
    environment:
      BOT_TOKEN: ''
      # PROXY_HOST: ''
      # PROXY_PORT: ''
      # Proxy type: socks5, http, https
      # PROXY_PROTOCOL: 'socks5'
      # Username and password (optional)
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
      # Group message format (in groups)
      ROOM_MESSAGE_GROUP: '<b>👤#[(alias)] #[name]: </b>'
      # Official account message format (in groups)
      OFFICIAL_MESSAGE_GROUP: '<b>📣#[name]: </b>'
      # Contact message format (in groups)
      CONTACT_MESSAGE_GROUP: '<b>👤#[alias_first]: </b>'
    restart: unless-stopped
```

Run

```shell
docker-compose up -d
```

## docker

```shell
docker run -itd --env BOT_TOKEN="" --env PROXY_HOST="" --env PROXY_PORT="" --env PROXY_USERNAME="" --env PROXY_PASSWORD="" --env PROXY_PROTOCOL="socks5" finalpi/wechat2tg:latest
```

## Node.js 18 or above

1. Install dependencies:

   ```shell
   npm install
   ```

2. Configure the Telegram Bot's token and proxy information in the `.env` file.

3. Run the program:

   ```shell
   npm start
   ```

4. In Telegram, send `/start` to the bot to begin, or `/login` to log in.

### Message Mode Switching

Switch between blacklist mode and whitelist mode:

Whitelist Mode - Only accept messages from groups in the whitelist.

Blacklist Mode - Do not accept messages from groups in the blacklist.

**Send Success Feedback**: Whether to display a message send status feedback (leave off if not necessary, since failures
will prompt by default).

**Automatic Contact Switching**: Automatically switches to the user or group who last replied. **Note: If a message is
received right before sending, it could result in sending to the wrong recipient!**

**Receive Public Account Messages**: Whether to receive messages from public accounts.

**Forward Self-Sent Messages**: Whether to forward messages you send using the WeChat mobile client.

**Media Compression**: If enabled, all received media messages will be processed as images or videos, which may reduce
the original quality. If disabled, all messages will be received as files.

## Special Notes

Messages can be recalled within 2 minutes by replying to your own message with `&rm`. Media messages can only be
recalled after the message has been successfully sent.

### Sending and Receiving Large Files

Due to Telegram Bot API limitations, files larger than 20MB cannot be sent, and files larger than 50MB cannot be
received. If you need to send or receive larger files, configure `API_ID` and `API_HASH`.

**Note: Testing showed that the web protocol returns an error when sending files over 25MB using chunked uploads. (This
has been fixed in the project.)**

To get `API_ID` and `API_HASH`:

1. Log in to your [Telegram account](https://my.telegram.org/).

2. Click "API development tools" and fill in your application details (only the app title and short name are required).

3. Click "Create application" to complete.

### Manual Grouping of Messages

**Note:** Since `wechaty-puppet-wechat4u` changes the ID with each login,  
there's no way to get a unique key for each contact and group.  
Whether a contact or group is the same is determined by the contact's note and nickname.  
If these aren't unique, or if their name changes, it may lead to incorrect binding after relogin.  
In such cases, re-binding will be required.

1. Disable the bot's privacy mode. Open BotFather, type `/mybots`, select your bot,
   click `Bot Settings` - `Group Privacy` - `Turn off`. If you see "Privacy mode is disabled for xxx", it was
   successful.
2. Create a Telegram group, add the bot to it, and follow the prompts to bind contacts or groups. After binding,
   messages from those contacts or groups will be forwarded to the group.

`/bind`: View the current group’s bound contacts or groups.

`/unbind`: Unbind contacts or groups from the current group.

`/cgdata`: Set the group’s avatar and nickname to match the corresponding WeChat contact or group (requires admin
rights).

### Automatic Grouping of Messages

1. Configure `API_ID` and `API_HASH`.
2. Disable the bot's privacy mode.
3. Use the `/autocg` command to enable automatic grouping, and follow the prompts to log in to Telegram.

### Custom Message Templates

If you want to modify the sender's format, you can change the environment variables in docker or the `.env` file.

Custom message template placeholders:

`#[alias]`: Contact note.

`#[name]`: Contact nickname.

`#[topic]`: Group chat nickname.

`#[alias_first]`: Note first; if there’s no note, the contact's nickname will be shown.

## License

[MIT](LICENSE)

## Thanks

Thanks to JetBrains for supporting this project.

[<img src="https://resources.jetbrains.com/storage/products/company/brand/logos/jetbrains.png" width="200">](https://www.jetbrains.com)