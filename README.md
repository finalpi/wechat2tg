# [wechat2tg](https://github.com/finalpi/wechat2tg)

English | [中文](https://github.com/finalpi/wechat2tg/blob/master/README_zh.md)

This project, based on [wechaty](https://github.com/wechaty/wechaty) , enables sending and receiving WeChat messages through Telegram.By utilizing [puppet-wechat4u](https://github.com/wechaty/puppet-wechat4u)  (which uses the UOS protocol), it bypasses the restriction preventing certain accounts from logging into the WeChat Web version.

## Features

1. Forward single chat, group chat, and official account messages from WeChat to a Telegram bot.

2. Send messages from Telegram to specific WeChat users, groups, or official accounts.

3. Support for setting group chat blacklists or whitelists.

4. Send videos, files, stickers, images, and voice messages from Telegram.

5. Support message recall.

6. Automatically create forwarding groups by configuring `API_ID` and `API_HASH` for message grouping.

7. Voice-to-text conversion for WeChat voice messages.


## Supported Features

### Supported WeChat Message Types

+ [x] Text messages (emojis within text can be converted to Telegram emojis, but many mappings are not available)
+ [x] Non-official stickers
+ [x] Image messages
+ [x] Audio/Video calls (only message notifications)
+ [x] File messages
+ [x] Voice messages
+ [x] Message recall
+ [x] Link messages
+ [x] Mini program messages (partially supported)
+ [x] Location messages (converted to location text)
+ [x] Red packet messages (notification only, cannot retrieve red packet content)
+ [x] Group chat messages
+ [x] Group chat @ messages (@all and @you will be converted to Telegram @you)
+ [x] Official account messages
+ [ ] Store stickers
+ [ ] Messages sent by WeChat Work users

## Notes

1. This project is for technical research and learning purposes only and must not be used for illegal purposes.

2. Feel free to submit issues for any problems you encounter.

3. Due to Telegram Bot API limitations, it cannot send files larger than **20MB**  or receive files larger than **50MB**  (this limitation can be resolved by configuring API_ID and API_HASH).

4. This project attempts to support message types allowed by the **WeChat Web**  protocol. Unsupported types, such as native WeChat stickers and red packets, are not available.

5. Message loss might occur due to network or technical issues. For critical messages, proceed cautiously!

## Installation

### docker-compose (Recommended)
Create a `docker-compose.yml` file:

```yaml
version: '3'

services:
  wechat2tg:
    image: finalpi/wechat2tg:latest
    container_name: wx2tg
    volumes:
      - ./config:/app/storage
      - ./save-files:/app/save-files # Saves converted files to avoid re-conversion for stickers
    # use env file or you can just set environment here
    # env_file: ".env"
    environment:
      BOT_TOKEN: ''
      # PROXY_HOST: ''
      # PROXY_PORT: ''
      # Proxy type: socks5, http, https
      # PROXY_PROTOCOL: 'socks5'
      # Optional username and password
      # PROXY_USERNAME: ''
      # PROXY_PASSWORD: ''
      # Telegram API configuration for sending large files (optional)
      API_ID: ''
      API_HASH: ''
      # Group message formats
      ROOM_MESSAGE: '<i>🌐#[topic]</i> ---- <b>👤#[(alias)] #[name]: </b>'
      OFFICIAL_MESSAGE: '<b>📣#[name]: </b>'
      CONTACT_MESSAGE: '<b>👤#[alias_first]: </b>'
      ROOM_MESSAGE_GROUP: '<b>👤#[(alias)] #[name]: </b>'
      OFFICIAL_MESSAGE_GROUP: '<b>📣#[name]: </b>'
      CONTACT_MESSAGE_GROUP: '<b>👤#[alias_first]: </b>'
      CREATE_ROOM_NAME: '#[topic]'
      CREATE_CONTACT_NAME: '#[alias]#[[name]]'
      MESSAGE_DISPLAY: '#[identity]#[br]#[body]'
      TENCENT_SECRET_ID: ''
      TENCENT_SECRET_KEY: ''
    restart: unless-stopped
```

Run:


```bash
docker-compose up -d
```

### Docker


```bash
docker run -itd --env BOT_TOKEN="" --env PROXY_HOST="" --env PROXY_PORT="" --env PROXY_USERNAME="" --env PROXY_PASSWORD="" --env PROXY_PROTOCOL="socks5" finalpi/wechat2tg:latest
```

### Node.js (v18 or above)

1. Install dependencies:


```bash
npm install
```

2. Configure the Telegram Bot token and proxy information in the `.env` file.

3. Run the program:


```bash
npm start
```

4. Send `/start` or `/login` to the bot in Telegram to begin.

## Usage

### BOT Commands

- `/login`: Retrieve the login QR code. The first person to send this command becomes the `BOT` owner.

- `/user`: List WeChat users and send messages by clicking their buttons (search by name or alias, e.g., `/user Zhang` for "Zhang").

- `/room`: List WeChat groups and send messages by clicking their buttons (search by name or alias, e.g., `/room Delivery` for "Delivery").

- `/recent`: List recent users or groups with messages for quick replies.

- `/settings`: Access settings.

- `/bind`: Check group bindings for WeChat users or groups (group-only command).

- `/unbind`: Unbind groups from WeChat users or groups (group-only command).

- `/order`: Set quick commands for sending preset messages to official accounts.

- `/cgdata`: Update group avatar and name (group-only command; admin permissions required).

- `/autocg`: Enable auto-grouping mode (requires API_ID and API_HASH; **recommended** ).

- `/check`: Check the current WeChat login status.

- `/source`: Retrieve the original file of compressed media by replying with `/source` (media-only).

- `/aad`: Forward messages from other members within the group. Use the `/aad all` command to enable forwarding messages from all members of the group. Alternatively, use `/aad @username` to forward messages from a specific user (only supported in groups and requires the auto-create group mode to be enabled).

- `/als`: View and manage the forwarding list (only supported in groups and requires the auto-create group mode to be enabled).

### Environment Variables
| Name | Required | Description | 
| --- | --- | --- | 
| BOT_TOKEN | Yes | Telegram Bot token from BotFather | 
| PROXY_PROTOCOL | No | Proxy type (socks5, http, https) | 
| PROXY_HOST | No | Proxy URL | 
| PROXY_PORT | No | Proxy port | 
| PROXY_USERNAME | No | Proxy username | 
| PROXY_PASSWORD | No | Proxy password | 
| API_ID | No | Telegram API ID | 
| API_HASH | No | Telegram API HASH | 
| ROOM_MESSAGE | No | Group chat message format in the bot | 
| OFFICIAL_MESSAGE | No | Official account message format in the bot | 
| CONTACT_MESSAGE | No | User message format in the bot | 
| ROOM_MESSAGE_GROUP | No | Group chat message format in groups | 
| CONTACT_MESSAGE_GROUP | No | User message format in groups | 
| OFFICIAL_MESSAGE_GROUP | No | Official account message format in groups | 
| CREATE_ROOM_NAME | No | Group name format for auto-created WeChat groups | 
| CREATE_CONTACT_NAME | No | Group name format for auto-created WeChat contacts | 
| MESSAGE_DISPLAY | No | Message display format | 
| TENCENT_SECRET_ID | No | Tencent voice-to-text API Secret ID | 
| TENCENT_SECRET_KEY | No | Tencent voice-to-text API Secret Key | 

### `/settings` Command Description

1. **Switch Between Blacklist or Whitelist Mode**
   - **Whitelist Mode** : Only accepts messages from WeChat groups listed in the whitelist.

   - **Blacklist Mode** : Does not accept messages from WeChat groups listed in the blacklist.

2. **Feedback on Message Delivery**
   Indicates whether to provide feedback on the message delivery status. (Recommended to leave it off unless necessary, as failure notifications are shown by default.)

3. **Auto-Switch Reply Target**
   Automatically switches the reply target to the WeChat user or group that last sent you a message.
   **Note:**  Messages sent right after receiving one might be misdirected due to an automatic switch.

4. **Receive Official Account Messages**
   Toggles receiving messages from WeChat Official Accounts.

5. **Forward Self-Sent Messages**
   Enables forwarding of messages sent via the WeChat mobile client.

6. **Media Compression**
   Compresses received media (images, videos) for transmission, potentially losing original quality.
   If disabled, all media will be sent as files. Replying to a compressed message with `/source` retrieves the original file.

7. **Auto Voice-to-Text Conversion**
   Converts WeChat voice messages into text.

8. **Block Emojis**
   Blocks WeChat emoji messages.



### Message Recall
Messages sent within 2 minutes can be recalled by replying `&rm` to the message.
Media messages must be successfully sent before recall.
If `API_ID` and `API_HASH` are configured, deleting a message will also recall it.


Obtaining `API_ID` and `API_HASH`
1. Log in to your [Telegram account](https://my.telegram.org/) .

2. Click **API development tools**  and provide basic app details (only title and short name are required).

3. Click **Create application**  to generate the credentials.



### Handling Large Files

Due to Telegram Bot API limitations:

- Files larger than 20MB cannot be sent.

- Files larger than 50MB cannot be received.
  To handle larger files, configure `API_ID` and `API_HASH`.
  **Note:**  Web protocol testing shows uploads beyond 25MB may fail. This project includes a fix for this issue.


### Manual Message Grouping
**Important:**
Each time `wechaty-puppet-wechat4u` re-logs in, IDs change. Group or contact uniqueness is determined by remarks or nicknames.
- If remarks or nicknames are non-unique, re-binding may be needed after re-login.

- Changes in contact or group names may also require re-binding.
  **Steps to Manually Bind:**
1. Disable bot privacy mode:

- Open BotFather, type `/mybots`, and select your bot.

- Navigate to **Bot Settings**  → **Group Privacy**  → **Turn off** .

- Success is indicated by `Privacy mode is disabled for xxx`.

2. Create a Telegram group, add the bot, and follow instructions to bind contacts or groups to it.

Commands:

- `/bind`: View current group bindings.

- `/unbind`: Unbind the current group.

- `/cgdata`: Update group avatar and nickname to match the corresponding WeChat contact or group (requires admin permissions).



### Auto Message Grouping

1. Configure `API_ID` and `API_HASH`.

2. Disable bot privacy mode.

3. Use the `/autocg` command to enable auto-grouping mode, and follow prompts to log in to Telegram.



### Voice-to-Text Conversion

1. Configure `TENCENT_SECRET_ID` and `TENCENT_SECRET_KEY` (obtainable from Tencent's [Speech Recognition Console](https://console.cloud.tencent.com/asr) ).
   Free usage quota is available.

2. Enable auto voice-to-text conversion in `/settings`.

### USE OPENAI TO AUTOMATICALLY REPLY TO USER MESSAGES

1. Configure 'OPENAI_API_KEY'
2. Turn on 'Group AI Auto Reply' or 'Contact AI Auto Reply' in '/settings'


### Custom Message Templates
You can modify message sender formats via Docker environment variables or the `.env` file.
Available placeholders:

- `#[alias]`: Contact's remark.

- `#[name]`: Contact's nickname.

- `#[topic]`: Group chat name.

- `#[alias_first]`: Prioritizes remark; defaults to nickname if no remark.

- `#[identity]`: Identity text.

- `#[body]`: Message content.

- `#[br]`: Line break.


---


### Contribution Guide

1. Fork the project, switch to the `refactor/ts-single-dev` branch, or create a new branch.
   Avoid direct commits to the `master` branch.

2. Submit a Pull Request to the `refactor/ts-single-dev` branch.


---


### License
Licensed under the [MIT License](https://chatgpt.com/c/LICENSE) .

---


### Acknowledgments

Special thanks to JetBrains for supporting this project!

[<img src="https://resources.jetbrains.com/storage/products/company/brand/logos/jetbrains.png" width="200">](https://www.jetbrains.com/)