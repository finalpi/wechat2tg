# wechat2tg-v3

[中文](README_zh.md) | English

Transmit WeChat messages on Telegram, supporting multiple WeChat protocols (iPad, Mac, Car, Windows, Pad)

## Telegram Group: [@Wx2TgUserGroup](https://t.me/+AD02MEZa-og3ZGY1)

> [!WARNING]
> According to feedback, the Windows protocol has the risk of account suspension, please do not use this protocol

## Main Features

1. Receive messages from WeChat personal chats, group chats, official accounts, and enterprise WeChat
2. Send messages via Telegram to specific WeChat users, groups, and official accounts
3. Flexible group message blocking functionality
4. AI reply suggestions based on the current WeChat chat context
5. Chinese / English WebUI with live message-template previews and model discovery/testing
6. WebUI contact search, multi-type messaging, attachment downloads, and Telegram delivery tracking
7. Eleven MCP tools with WebUI token management and client configuration export

## WebUI and message center

The Chinese / English WebUI starts with the application. Docker Compose exposes **TCP 17863 on all host interfaces by default**: open `http://<server-address>:17863/`. Local development listens on loopback by default: `http://127.0.0.1:17863/`. WebUI and MCP share the same port; the MCP path is `/mcp`.

### Configuration console

- Configure Telegram / WeChat connections, forwarding preferences, message templates, proxies, AI / speech recognition, retries, retention, and logging.
- Switch UI language independently of the Telegram bot language. Global settings search, validation, unsaved-change tracking, conflict detection, responsive layouts, and restart feedback are included.
- Telegram and WeChat proxies are presented separately. Message templates have live contact, group, and official-account previews, including missing-alias examples. Previews use sample data and never send messages.
- Sign in with `WEBUI_TOKEN` (at least 16 characters), or the generated `storage/webui-token`. Sign-in opens Messages by default. Refreshing the current tab preserves login; optional Remember access token also restores login after reopening the browser. Signing out or a rejected token clears saved credentials.
- Configuration secret fields remain blank: leave blank to retain the saved value, enter a new value to replace it, or explicitly clear an optional secret. MCP tokens have separate, explicit reveal/export controls.

### Conversations and attachments

- Search contacts and groups by nickname, remark, or WeChat ID. The All / Recent view sorts by latest message activity and shows real avatars with initial-letter fallback.
- In a group, type `@` or select **@ Group members** to search and select up to 20 members, or mention everyone. Native mentions apply to text; WeChat enforces owner/admin permissions for @Everyone. Mentioned text mirrors to Telegram.
- Use arrow keys and Enter to select a member; the mention is inserted at the cursor and the picker closes automatically. Editing a selected mention removes its member ID binding.
- Quote a saved message using **Reply**, then send a native WeChat text reply. Quotes mirror to Telegram. Click a quote to locate and highlight the original, loading its saved context when needed; return to the latest messages with one click. Quoted replies cannot currently include native mentions or attachments.
- Recall your own confirmed messages within WeChat's limits: ordinary messages within 2 minutes; documents, MP3 files and archives within 3 hours. The limit follows the actual WeChat message type (voice messages remain 2 minutes). Expired messages or messages missing native receipts cannot be recalled. Successful recalls create one separate reply notice referencing the original in WebUI and Telegram. Original content and attachments remain available; clicking the WebUI reference locates the original. Failed Telegram notices can be retried separately. See [WeChat's explanation, republished by The Paper](https://www.thepaper.cn/newsDetail_forward_33209118).
- Read and search saved history, load older messages, and see incoming updates every 5 seconds. First opening a conversation shows the latest 60 imported records first and fills older history in the background (up to 500 records); it does not retrieve all historical messages from WeChat.
- Built-in WeChat emoji (such as `[抱拳]`) render using bundled local WebP assets in messages, quotes, nested histories and official-account posts, with Chinese and English aliases. Web rendering is independent of Telegram conversion settings; Unicode and unknown labels remain intact, and failed assets fall back to their labels.
- Send text, images, GIF, MP4 video, audio, voice, and files. Attachments are limited to 50 MiB. Paste clipboard images with Ctrl / ⌘ + V; preview first, then explicitly send with the button or Ctrl / ⌘ + Enter. Attachment and text are sent as separate messages.
- Images automatically load previews; images inside merged histories load when their record is expanded. Failed previews offer a manual retry. Files and other media load on demand. Click images to open a large preview with wheel/button zoom, rotation, fit-to-window and drag-to-pan; press Esc or click the backdrop to close. Official-account posts display one or more articles with clickable titles, summaries and read-more links. Links, locations, and contact cards have rich cards. Group messages separate sender, avatar, and content; merged chat histories expand into cards with downloadable embedded files and images, including nested attachments. Nested histories expand one level at a time. Media transport XML and non-chat function, game-badge and counter control packets are excluded from conversation display and retry.
- Messages sent from WebUI or MCP also appear in WebUI and synchronize to Telegram. Request IDs prevent duplicate sends. `submitted` means WeChat returned a message ID, not that the recipient read it. Uncertain send results are never retried automatically.
- Videos in shared chat histories, including nested records, can be downloaded as Telegram videos or played and downloaded in WebUI. Full MP4 downloads use RecordItem `DataType=4`, keeping record uint64 IDs out of the ordinary video API. The server must support record video downloads (v6.0.6 or later in the v6 series); the existing `wx2tg-puppet 3.0.8` API passes these parameters through without an additional SDK release.
- Messages sent to WeChat through a bound Telegram conversation also appear in WebUI, including text, quoted replies and media. They show their Telegram origin and WeChat send status without being forwarded back to Telegram or counted as unread Telegram deliveries. Attachments and captions are separate WeChat messages; cached media can be previewed or downloaded. If caching fails, WebUI prompts you to view the attachment in Telegram.
- Red conversation counters mean tracked Telegram deliveries that are pending, in flight, or definitely failed. Successful synchronization clears them. Unverified historical receipts and uncertain delivery results are displayed separately and do not count as unread. Opening a conversation does not clear unsent Telegram deliveries.
- Retry to Telegram only without resending to WeChat. Parallel retries are blocked; an uncertain Telegram outcome requires explicit confirmation before another attempt.

### AI and speech

Enter an OpenAI-compatible API URL and key, read the provider's model list, select a model, and test the connection before saving. A blank key uses the saved key; switching provider origin requires explicitly entering a key. Checks use the current unsaved inputs and a generic test prompt, never conversation history. `/ai` generates contextual reply suggestions; it does not automatically send them.

Configure Tencent Cloud ASR credentials and enable automatic voice transcription through WebUI or `/settings`.

### MCP access and installation

Manage MCP directly in the WebUI **MCP access** page:

- Enable or disable MCP immediately; set the client endpoint and local bridge script path. The endpoint is for client configuration, not the server listener.
- Reveal, download, generate, or manually replace independent read-only and read/send tokens. Rotation takes effect on the next request; update connected clients afterward.
- Copy or download Streamable HTTP or stdio client configurations. Preview uses `<TOKEN>`; explicit export includes the selected credential. Export defaults to read-only permissions.
- The stdio bridge supports local file uploads and downloads; paths in repository examples are placeholders. Keep actual installation paths and credentials in private client configuration outside this repository.

| Tool | Purpose |
|---|---|
| `wechat_status` | WeChat / Telegram connection status |
| `wechat_search_contacts` | Search contacts and groups |
| `wechat_get_group_members` | Search group members and obtain IDs for native mentions |
| `wechat_list_conversations` | List saved conversations by recent activity |
| `wechat_read_messages` | Search and paginate conversation history |
| `wechat_get_new_messages` | Read new incoming messages using a persistent cursor |
| `wechat_send_text` | Send authorized text with an idempotent request ID |
| `wechat_revoke_message` | Recall an eligible own message with explicit confirmation |
| `wechat_send_media` | Send an uploaded attachment, or a local file through the bridge |
| `wechat_download_attachment` | Download ordinary or merged-history attachments |
| `wechat_get_send_status` | Check WeChat submission and Telegram synchronization |

MCP uses the existing WeChat login and send queue. Reading messages does not wake an idle AI or enable automatic replies. Cursor-based reception is separate from Telegram unread counters. See [MCP setup, parameters, and client examples](docs/MCP.md).

### Persistence and configuration precedence

| Storage file / directory | Purpose | When changes apply |
|---|---|---|
| `storage/webui-config.json` | WebUI environment overrides | Restart the application |
| `storage/db/wechat2Tg.db` | Bot bindings and runtime preferences | Preferences apply immediately; startup synchronization runs on next startup |
| `storage/db/webui-messages.db` | Message center history and delivery tracking | Immediately |
| `storage/webui-media` / `storage/webui-avatars` | Attachments and avatar cache | Immediately |
| `storage/mcp-settings.json` | MCP enablement, client settings, and tokens | Immediately, including token rotation |
| `storage/webui-token`, `storage/mcp-token`, `storage/mcp-read-token` | Generated access credentials | Used for their respective interfaces |

Docker mounts `./config` as `/app/storage`; back it up with `save-files`, `conf`, and `redis-data`. WebUI environment overrides take priority over `.env` and container environment variables. To restore an environment default, stop the app, remove that key from `webui-config.json`, and restart. Saved MCP settings take priority over `MCP_ENABLED`, `MCP_TOKEN`, and `MCP_READ_TOKEN`; these variables initialize settings before the first WebUI MCP save. `WEBUI_CONFIG_PATH` relocates the WebUI file and MCP settings/token directory.

Normal startup leaves the WebUI available if Telegram credentials are missing. For setup without clients or a database, use `npm run build` then `npm run webui`; stop the standalone process before starting the normal app. Standalone mode cannot manage bot database preferences or send messages.

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
3. Ensure that the IP of wx2tg-server matches the login region, otherwise a verification code may be required
4. On arm-64 architecture, due to missing dependencies, the wx2tg-server image cannot be used.
5. After logging in, you may be logged out once after one day; after logging in again, the connection will remain stable.

## Installation & Deployment

Use Docker Engine with Docker Compose v2, or Node.js 18+ for local development. Native SQLite, image-processing, and media-conversion dependencies must match the runtime platform.

### Docker Compose

Use the repository's `docker-compose.yml`; no WebUI override file is required. It uses the published image `finalpi/wechat2tg-v3:latest`, with no local build required.

```bash
cp .env.example .env
mkdir -p conf
cp app.conf.example conf/app.conf
docker compose pull
docker compose up -d
docker compose exec wx2tg-v3 cat storage/webui-token
```

In `.env`, fill in `BOT_TOKEN`, `API_ID`, and `API_HASH`, or enter them through WebUI and restart the app after saving. The bundled example uses `BASE_API=http://wx2tg-server:8058/api` and `redislink=wx2tg-redis:6379`. Keep those Compose service names if using the bundled stack.

Open `http://<server-address>:17863/` and sign in with the token. Then use Telegram `/login` to sign in to WeChat. Missing credentials leave the configuration page available. After saving environment settings in WebUI:

```bash
docker compose restart wx2tg-v3
```

The default Compose file is:

```yaml
services:
  wx2tg-v3:
    image: finalpi/wechat2tg-v3:latest
    container_name: wx2tg-v3
    environment:
      WEBUI_ENABLED: "${WEBUI_ENABLED:-true}"
      WEBUI_HOST: "0.0.0.0"
      WEBUI_PORT: "${WEBUI_PORT:-17863}"
    ports:
      - "${WEBUI_BIND_ADDRESS:-0.0.0.0}:${WEBUI_PORT:-17863}:${WEBUI_PORT:-17863}"
      # - "8056:8056" # callback 模式且需宿主机访问时启用 / Optional callback exposure
    volumes:
      - ./config:/app/storage
      - ./save-files:/app/save-files # 保存文件夹挂载后贴纸文件不需要重新转换
    env_file: ".env"
    restart: unless-stopped
    depends_on:
      - wx2tg-server

  wx2tg-server:
    # image: finalpi/wx2tg-server:v3-latest # v3 稳定版
    image: finalpi/wx2tg-server:v5-latest
    container_name: wx2tg-server
    ports:
      - "8058:8058"
    volumes:
      - ./conf:/usr/wic-go/conf
    restart: unless-stopped
    depends_on:
      - wx2tg-redis

  wx2tg-redis:
    image: redis:7.2
    container_name: wx2tg-redis
    ports:
      - "16379:6379"
    volumes:
      - ./redis-data:/data
    command: ["redis-server", "--appendonly", "yes"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped
```

| Host port | Service | Default exposure |
|---|---|---|
| TCP `17863` | WebUI and MCP (`/mcp`) | All host interfaces |
| TCP `8058` | WeChat protocol service | As defined in Compose |
| TCP `16379` | Redis (`6379` inside the container) | As defined in Compose |
| TCP `8056` | Optional callback mode | Commented out; enable only if needed |

Set `WEBUI_PORT` in `.env` to change both the container listener and published WebUI port. Set `WEBUI_BIND_ADDRESS=127.0.0.1` for local-only access. Compose always uses `WEBUI_HOST=0.0.0.0` inside the container. Port/binding or `.env` changes require recreating the container (`docker compose up -d`); a process restart alone does not change Docker port mappings.

For Internet access, route a configured HTTPS endpoint to the WebUI port and set that public `/mcp` URL in the MCP access page. Allow the chosen TCP port through your firewall and router/forwarding setup as applicable. A self-signed deployment needs its CA trusted by the client; the stdio bridge can use `NODE_EXTRA_CA_CERTS=/absolute/path/to/ca.pem` while retaining TLS validation. Deployment-specific IPs, ports, paths, and certificates belong in private configuration.

### Local development

```bash
npm install
npm run build
npm run dev
```

Open `http://127.0.0.1:17863/`. `npm start` runs compiled production code. Use `.env.example` for configuration and keep native dependencies aligned with your OS.

### Verification and logs

```bash
npm run test:webui
npm run test:mcp
docker compose logs --tail=100 wx2tg-v3
```

Tests use isolated message fixtures; they do not send to real WeChat contacts.

#### Disable Bot Privacy Mode

Disable the bot's privacy mode. Open BotFather, enter `/mybots`, select your bot. Click `Bot Settings` - `Group Privacy` - `Turn off`. When `Privacy mode is disabled for xxx` appears, it means the disabling is successful.

## Bot Commands

- `/login`: Get login QR code; the first person to send this command during initial deployment will become the bot owner

- `/logout`: Logout and delete login cache

- `/update`: Update group avatar and nickname information

- `/message`: Toggle group message reception

- `/forward`: Toggle forwarding of messages from other people or bots in the group

- `/user`: Get WeChat user list; click the button to create a new group or bind a user (can search by name or remarks, e.g., `/user Zhang` to find WeChat users containing "Zhang")

- `/room`: Get WeChat group list; click the button to create a new group or bind a WeChat group (can search by name or remarks, e.g., `/room takeout` to find WeChat groups containing "takeout")

- `/revoke`: Revoke message (reply to the message to be revoked)

- `/relogin`: Secondary login (use only when unexpectedly logged out after login, try to login with previously cached login information)

- `/getqr`: Get personal QR code information

- `/settings`: Program settings

- `/ai`: Generate AI reply suggestions from the current WeChat chat context (for example, `/ai make it more polite`; use `/ai context 30` to save the default context message count, or `/ai -n 30 make it more polite` to override it for one request)

- `/unbind`: Unbind WeChat group or WeChat user (only supported in group usage)

- `/quit`: Exit and disband group

## Environment Variables

| Name | Required | Description                                                         |
|------|----------|---------------------------------------------------------------------|
|`BOT_TOKEN`| Yes | Telegram Bot token, created via [BotFather](https://t.me/BotFather) |
|`API_ID`| Yes | Telegram API ID                                                     |
|`API_HASH`| Yes | Telegram API HASH                                                   |
|`DEVICE_TYPE`| Yes | WeChat login protocol: ipad, car, mac, pad, win, ipadX              |
|`BASE_API`| Yes | wx2tg-server container API request address, full path required      |
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
|`AI_API_KEY`| No | OpenAI-compatible API key for `/ai` reply suggestions               |
|`AI_API_URL`| No | OpenAI-compatible chat completions URL, e.g. `https://api.openai.com/v1/chat/completions` |
|`AI_MODEL`| No | AI model name, default: `gpt-4o-mini`                               |
|`AI_CONTEXT_LIMIT`| No | Fallback default number of recent WeChat conversation messages used as AI context, default: `20`; runtime default can be saved with `/ai context <count>` and overridden per request with `/ai -n <count>` |
|`MODE`, `CALLBACK_PORT`, `CALLBACK_API`, `FILE_API`| No | Message delivery mode, callback listener/URL, and optional file service |
|`WX_PROXY_HOST`, `WX_PROXY_USERNAME`, `WX_PROXY_PASSWORD`| No | Independent WeChat SOCKS login proxy |
|`TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY`| No | Tencent Cloud ASR credentials |
|`SEND_TO_WX_MAX_RETRIES`, `SEND_TO_WX_TIMEOUT`| No | Existing WeChat forwarding retries (`3`) and timeout (`30000` ms) |
|`SEND_TO_TG_MAX_RETRIES`, `SEND_TO_TG_RETRY_DELAY`| No | Existing Telegram forwarding retries (`3`) and backoff base (`5000` ms) |
|`MESSAGE_BUFFER_EXPIRE_TIME`| No | Message buffer lifetime (`300000` ms) |
|`AUTO_DELETE_OLD_MESSAGES`, `MESSAGE_RETENTION_DAYS`| No | Cleanup existing bot message history; defaults `false` / `7` days |
|`LOG_LEVEL`, `DEBUG_MODE`| No | Logging level and debug mode; defaults `info` / `false` |
|`DB_SQLITE_PATH`| No | Bot SQLite path; default `storage/db/wechat2Tg.db` |
|`WEBUI_ENABLED`| No | Enable WebUI; default `true`. MCP uses the same listener |
|`WEBUI_HOST`| No | Local listener defaults to `127.0.0.1`; Compose overrides to `0.0.0.0` |
|`WEBUI_PORT`| No | WebUI and MCP port; default `17863` |
|`WEBUI_BIND_ADDRESS`| No | Compose host bind address; default `0.0.0.0` |
|`WEBUI_TOKEN`| No | WebUI access credential, minimum 16 characters; generated if omitted |
|`WEBUI_CONFIG_PATH`| No | WebUI override file; default `storage/webui-config.json` |
|`MCP_ENABLED`| No | Initial MCP enablement; default `true`, then overridden by saved MCP settings |
|`MCP_TOKEN`, `MCP_READ_TOKEN`| No | Initial read/send and read-only credentials; generated if omitted, must differ |
|`WECHAT_MCP_URL`, `WECHAT_MCP_TOKEN_FILE`, `WECHAT_MCP_TOKEN`| Client | stdio bridge endpoint and token source; URL required, token value takes precedence over token file |
|`NODE_EXTRA_CA_CERTS`| Client | Optional CA PEM file for a self-signed HTTPS deployment |

## Settings Command `/settings`

1. WeChat emoji display as image links: When enabled, friend-sent Minions emojis will be converted to image links

2. Synchronize group information on startup: When enabled, all user information will be synchronized when the program starts, updating group avatars and names

## Voice-to-Text

1. Configure `TENCENT_SECRET_ID` and `TENCENT_SECRET_KEY`, which can be activated in the Tencent [Speech Recognition Console](https://console.cloud.tencent.com/asr). Free usage quota is available.

2. Enable automatic voice-to-text transcription in `/settings`

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

---

## Frequently Asked Questions

### Why am I prompted to enter a verification code

wx2tg-server needs to be in the same region as your login. If you encounter a verification code prompt, check if they are in the same region.

If not in the same region, you can configure WeChat proxy login in environment variables, or migrate already logged Redis data.

## Participating in Development

1. Fork the project, switch to the `wx2tg-v3-dev` branch, or create a new branch. Please do not directly submit code to the main branch.

2. Submit a Pull Request to the `wx2tg-v3-dev` branch

## License

[MIT](LICENSE)
