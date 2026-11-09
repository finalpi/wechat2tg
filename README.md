# wechat2tg (v6)

> **Development preview: v6.0.40-dev.6.** Fixes chat actions and sync hints covering messages: controls now follow the message body in normal layout. `/members` lists names only; selecting a person opens their details with a small named avatar, not a large gallery. SDK stays at `6.0.18-dev.1`. See [chat appearance](docs/chat-appearance.md). **WebUI chat remains a limited, basic message viewer, not a complete WeChat client; see the limitations below.** Stable `v6` is unchanged. Do not run stable and dev instances against the same writable storage or account sessions.

[中文](README_zh.md) | English

Transmit WeChat messages on Telegram, supporting multiple WeChat protocols (iPad, Mac, Car, Windows, Pad)

## Telegram Group: [@Wx2TgUserGroup](https://t.me/+AD02MEZa-og3ZGY1)

> [!WARNING]
> According to feedback, the Windows protocol has the risk of account suspension, please do not use this protocol

## v6 versions and channels

**Use one maintenance branch, `v6`; tags distinguish stable and development releases. There is no `v6-dev` maintenance branch.** The current stable Bot is `v6.0.39`, using puppet `v6.0.17` and wx2tg-server `v6.0.16`. Components release independently and need only share major version `v6`. Do not mix it with server v7.

### Which WeChat version does each server release emulate?

**`v6`, `v7`, and `v51` are this project's release versions, not WeChat 6.x, 7.x, or 5.1.** The table describes the **iPad / iPhone WeChat client protocol emulated by the server**, not a required WeChat version for your phone.

| Server release / family | Origin | iPad / iPhone WeChat version | Selection for this Bot |
| --- | --- | --- | --- |
| **`finalpi/wx2tg-server:v6.0.16`** (`v6` family) | `875` → `v6` | **8.0.75.33** (`0x18004b21`) | **Used by the current Bot `v6.0.39`**; the server image supports `linux/amd64` only |
| Historical `875` / server `v51.0.0`–`v51.0.13` | `875` protocol family | **8.0.75.33** | Historical releases; `v51` does not mean WeChat 5.1 |
| Server Git tag **`v7`** | `878` protocol family | **8.0.78.34** (WeChat release 8.0.78, `0x18004e22`) | A separate release family, **not part of this deployment; do not mix it with or directly replace the existing v6 server** |

- These versions apply to the iPad / iPhone main protocol only. **Windows, Mac, Car, and Android Pad have separate parameters**; this does not mean every protocol was upgraded to WeChat 8.0.75 / 8.0.78. The Bot's `pad` means Android Pad, not `ipad`.
- The `v7` target client parameters and offline tests have been checked, but **real WeChat login and complete business compatibility have not thereby been verified**.
- Historical Bot/SDK names such as `wx2tg-v3` and `860-v3` do not determine the WeChat version. The old `860` source also has a mismatch between an active value and its comment. See [fixed-tag evidence and historical limitations](docs/server-wechat-versions.md).

Current Bot changes: [v6.0.39 Release](https://github.com/finalpi/wechat2tg/releases/tag/v6.0.39).

### Release channels

| Channel | Full Git / Docker version | Rolling bot alias |
| --- | --- | --- |
| Stable | `v6.X.Y` (no dev suffix) | `v6` |
| Development | `v6.X.Y-dev.N` | `v6-dev` |

Bot images use **`finalpi/wechat2tg`** with the full Git tag, including the leading `v`: `finalpi/wechat2tg:v6.0.13-dev.3` for development or `finalpi/wechat2tg:v6.0.39` for stable. Rolling aliases are major-scoped: `v6` for stable and `v6-dev` for development; this unversioned repository never receives global `latest` or `dev` aliases from this workflow. Manual snapshots from `v6` use `v6-dev-<short SHA>` with no rolling aliases. The old `finalpi/wechat2tg-v3` repository and its existing images/tags are preserved and never updated by this workflow.

Native amd64 and arm64 builds publish independently as the Docker version plus `-amd64` / `-arm64`, with `v6-amd64` / `v6-arm64` for stable releases and `v6-dev-amd64` / `v6-dev-arm64` for development releases. Manual snapshots only add the architecture suffix, without updating aliases. amd64 is usable as soon as its job succeeds; the combined tag waits for both. Historical tags are never moved. Branch HEAD is not necessarily the latest stable release. See [release rules (Chinese)](docs/releases.md).

## Main Features

1. Receive messages from WeChat personal chats, group chats, official accounts, and enterprise WeChat
2. Send messages via Telegram to specific WeChat users, groups, and official accounts
3. Flexible group message blocking functionality
4. AI reply suggestions based on the current WeChat chat context
5. WebUI configuration, message-template previews and model discovery/testing (current React UI is primarily Chinese)
6. Basic WebUI message viewing, limited operations, categorized contacts and Telegram synchronization tracking; message-type support is incomplete
7. Eleven MCP tools and WebUI token management; client setup is documented separately

## Automatic chat-folder overflow

New groups are organized into `WeChat`, `WeChat 2`, `WeChat 3`, and so on using the logged-in account’s Telegram limits. If no folder slot remains, group creation, binding, and forwarding still succeed; the chat stays available in All Chats. Existing settings and unrelated/shared folders are preserved. See [folder allocation and failure behavior (Chinese)](docs/telegram-chat-folders.md).

## Official accounts in forum topics

Optionally set `OFFICIAL_ACCOUNT_TOPICS_ENABLED=true` and restart. The first official-account message automatically provisions one private forum, with a separate topic per account. Future messages use those topics and replies route back to the matching account; General never routes to WeChat. The feature defaults off, retains old groups/bindings, and restores old routing when disabled. See [official-account topics (Chinese)](docs/official-account-topics.md).

## Inline WeChat custom emoji

`WECHAT_CUSTOM_EMOJI_ENABLED=true` renders native `[微笑]` / `[Facepalm]` tokens inline using [WeChatPack](https://t.me/addemoji/WeChatPack), preserving rich text and ordinary Unicode emoji. Requires a Premium bot owner or eligible Fragment username. Defaults off and takes priority over legacy image links; unknown tokens remain unchanged. See [mapping, coverage and limits (Chinese)](docs/wechat-custom-emoji.md). Available starting with `v6.0.13-dev.3`.

## WebUI and message center

The WebUI starts with the application; the current React interface is primarily Chinese. Docker Compose exposes **TCP 17863 on all host interfaces by default**: open `http://<server-address>:17863/`. Local development listens on loopback by default: `http://127.0.0.1:17863/`. WebUI and MCP share the same port; the MCP path is `/mcp`.

### Telegram Mini App and live messages

The same WebUI can open from the owner’s private-chat **控制台** menu. Configure `WEBUI_MINI_APP_URL=https://your-domain/` and restart the Bot: the backend verifies Telegram signatures and permits **only the existing bot owner**, without entering a WebUI token. Ordinary browser login remains available. The message page uses SSE change notifications instead of five-second polling. A reachable HTTPS root URL and an SSE-compatible reverse proxy are required; see [setup and security boundaries](docs/telegram-mini-app.md). Available since v6.0.35; use **v6.0.36 or later** for the private-chat menu fix.

### Configuration console

- Configure Telegram / WeChat connections, forwarding preferences, message templates, proxies, AI / speech recognition, retries, retention, and logging.
- Existing-field validation, unsaved-change tracking, conflict detection, responsive layouts and restart feedback are available. Telegram bot language settings do not imply equivalent WebUI language switching.
- Telegram and WeChat proxies are presented separately. Message templates have live contact, group, and official-account previews, including missing-alias examples. Previews use sample data and never send messages.
- Sign in with `WEBUI_TOKEN` (at least 16 characters), or the generated `storage/webui-token`. Sign-in opens chat by default. Ordinary browsers save the access token locally for refresh/reopen; Mini App sessions remain separate and memory-only. Signing out or a rejected token clears saved credentials.
- Configuration secret fields remain blank: leave blank to retain the saved value, enter a new value to replace it, or explicitly clear an optional secret. MCP tokens have separate reveal/regeneration controls.

### Chat capabilities and current limitations — read first

> [!IMPORTANT]
> **WebUI chat is currently intended mainly for viewing simple messages such as text, with limited send, quote, recall and synchronization operations. It does not fully support every WeChat message type and is not a replacement for the WeChat client.** A summary, link or attachment entry does not mean that a message type is fully decoded, interactive or comprehensively verified. Use WeChat for the complete experience.

- **Rendering is partial.** Images, audio/video, files, official-account articles and merged histories have some preview/download/decoding paths. Protocol responses, expired media, cache availability and nested formats can still produce summaries, placeholders, missing attachments or failures. Red packets, transfers, mini-programs, Channels content, special cards and real-time voice/video calls are not fully supported Web features.
- **History is not your complete WeChat history.** The page reads records this project has saved or synchronized; it does not retrieve all old messages from WeChat. Telegram forwarding support must not be confused with WebUI rendering support.
- **Operations are type-dependent.** Text, some attachment sends and eligible quote/recall operations are available; uploads are limited to 50 MiB and captions are sent separately. Quotes cannot include attachments or native mentions; use the member picker for group mentions. Recalls require native receipts and remain subject to WeChat limits. Native interactions on complex cards are not guaranteed.
- **Status is not a read receipt.** Submitted means a WeChat-side receipt was returned, not that the recipient received/read the message. Pending Telegram synchronization is not WeChat unread state. Uncertain outcomes are not automatically resent.
- **Contacts are a cached directory.** dev.4 adds WeChat-style categories, alphabetical sections, avatars, search and paging. Service accounts require an explicit protocol field; remaining official accounts are not asserted to be confirmed subscription accounts. Counts are neither page lengths nor authoritative real-time WeChat totals. Cached groups are not necessarily saved-to-contacts groups. New-friend management, My Enterprise, and contact add/delete/approval are not implemented in WebUI.
- **Official-account menus are only partially supported.** dev.4 displays synchronized menus/submenus and opens ordinary HTTP(S) links in a new window. Event clicks, mini-programs and WeChat authorization/QR actions remain disabled. Button text is never sent as a fake menu click. Missing cached menus do not prove an account has no menu, and links may still require WeChat to complete their workflow.
- **PWA installation is not offline WeChat or background delivery.** Trusted HTTPS is required. Only public shell assets are cached, never protected APIs, chat bodies or attachments. Drafts live in the current signed-in window's memory; closing or forcing a reload does not guarantee recovery. There is no offline send replay or reliable closed-window push. Native mobile installation, keyboard and Telegram WebView behavior still need device testing.
- **The UI migration is incomplete.** The current React UI is primarily Chinese. Independent UI-language switching, global configuration search, inline keyboard mention selection and one-click MCP client-configuration export from the old UI are not fully migrated.

Use `/chat` for chat and `/manage` for settings. Implemented features retain SSE-driven updates without periodic message/contact polling; desktop focus mode and chat/settings switching preserve in-window chat drafts and reading position. See [PWA/chat boundaries](docs/pwa-chat.md), [directory/menu capabilities](docs/research/wechat-contact-classification.md) and [WebUI development](docs/webui-development.md).

### AI and speech

Enter an OpenAI-compatible API URL and key, read the provider's model list, select a model, and test the connection before saving. The current model tools use the saved key; do not assume an unsaved replacement key is being tested. Save and review configuration when changing provider origin. Checks use a generic test prompt, never conversation history. `/ai` generates contextual reply suggestions; it does not automatically send them.

Configure Tencent Cloud ASR credentials and enable automatic voice transcription through WebUI or `/settings`.

### MCP access and installation

Manage MCP directly in the WebUI **MCP access** page:

- Enable or disable MCP immediately; set the client endpoint and local bridge script path. The endpoint is for client configuration, not the server listener.
- Reveal or regenerate independent read-only and read/send tokens; update connected clients after rotation.
- Complete one-click client-configuration export is not present in the current React page. Configure Streamable HTTP / stdio manually using the MCP documentation and keep credentials private.
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
| `storage/db/wx2tg.db` | Bot bindings and runtime preferences | Preferences apply immediately; startup synchronization runs on next startup |
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

> [!IMPORTANT]
> The current stable Bot is **`v6.0.39`**: fixes message-history HTTP 500 errors caused by SSE change tracking, adds safe error/startup diagnostics, and bundles SDK `v6.0.17` to handle contact initialization failures. The fixes have passed user verification. Server remains at `v6.0.16`.

For a new deployment, copy `.env.example` to `.env` and configure the environment variables. Never overwrite existing private configuration, including the user’s `home_202.env`; merge required changes manually.

Copy `app.conf.example` to `app.conf` in the `conf` directory and set the Redis address to your deployed Redis address. For existing deployments, merge the new settings instead of overwriting your ports, Redis credentials, and callback URL.

Keep `MODE=polling` in `.env` and `syncmessage=false`, `msgpush=false` on the server. Server-side message archiving now defaults to SQLite at host path `./server-data/messages`, independent of the bot database under `./config`. Puppet `6.0.12` supports message-bearing callbacks and binary file sections. To switch to callback mode, also configure `msgpush=true` and a reachable callback URL on the server; see the linked notes.

Use Docker Engine with Docker Compose v2, or Node.js 18+ for local development. Native SQLite, image-processing, and media-conversion dependencies must match the runtime platform.

### Docker Compose

This development checkout pins `finalpi/wechat2tg:v6.0.40-dev.6` in `docker-compose.yml`; no WebUI override is needed. For the current stable deployment, use the Compose file from tag `v6.0.39` instead. amd64 users may use the matching `-amd64` image once its build succeeds, without waiting for ARM.

The commands below initialize a new stack. For an existing deployment, preserve old images and private configuration; update only the bot with `docker compose pull wechat2tg` and `docker compose up -d --no-deps wechat2tg` after reviewing your local Compose. The `wx2tg-server` image, namespace, and version in this example are unchanged; do not replace or restart the existing production backend as part of this bot naming correction.

```bash
test -e .env || cp .env.example .env
mkdir -p conf
test -e conf/app.conf || cp app.conf.example conf/app.conf
docker compose pull
docker compose up -d
docker compose exec wechat2tg cat storage/webui-token
```

In `.env`, fill in `BOT_TOKEN`, `API_ID`, and `API_HASH`, or enter them through WebUI and restart the app after saving. The bundled example uses `BASE_API=http://wx2tg-server:8058/api` and `redislink=wx2tg-redis:6379`. Keep those Compose service names if using the bundled stack.

Open `http://<server-address>:17863/` and sign in with the token. Then use Telegram `/login` to sign in to WeChat. Missing credentials leave the configuration page available. After saving environment settings in WebUI:

```bash
docker compose restart wechat2tg
```

The default Compose file is:

```yaml
services:
  wechat2tg:
    image: finalpi/wechat2tg:v6.0.40-dev.6
    container_name: wechat2tg-v6
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
    image: finalpi/wx2tg-server:v6.0.16
    container_name: wx2tg-server
    ports:
      - "8058:8058"
    volumes:
      - ./conf:/usr/wic-go/conf
      - ./server-data:/usr/wic-go/data
      - ./server-logs:/usr/wic-go/logs
    environment:
      MESSAGE_STORE_POSTGRES_DSN: "${MESSAGE_STORE_POSTGRES_DSN:-}"
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
docker compose logs --tail=100 wechat2tg
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

- `/user`: List WeChat contacts, excluding official accounts; search by name or remark, e.g. `/user Zhang`, then create a group or bind the contact.

- `/official`: List official accounts separately; search by name or remark, e.g. `/official WeChat Pay`, then create a group or bind the account to the current Telegram group.

- `/room`: Get WeChat group list; click the button to create a new group or bind a WeChat group (can search by name or remarks, e.g., `/room takeout` to find WeChat groups containing "takeout")

- `/contacts [name or remark]`: Read-only contact directory. Select a name to view cached WeChat ID, username, remark, region, signature and other available details; pagination and Back preserve your position. Never binds or creates groups. Without arguments in a Telegram group/topic bound to an individual contact, shows that contact directly (also with `/contacts@your_bot`). An explicit search still opens the list.

- `/members [group name or remark]`: Select a WeChat group, browse its members and open member details. Supports pagination and returning to the original group list. Without arguments in a bound Telegram group or topic, opens the corresponding WeChat group directly. Only known profile fields are displayed.

- `/revoke`: Revoke message (reply to the message to be revoked)

- `/relogin`: Secondary login (use only when unexpectedly logged out after login, try to login with previously cached login information)

- `/getqr`: Get personal QR code information

- `/settings`: Program settings

- `/ai`: Generate AI reply suggestions from the current WeChat chat context (for example, `/ai make it more polite`; use `/ai context 30` to save the default context message count, or `/ai -n 30 make it more polite` to override it for one request)

- `/unbind`: Unbind WeChat group or WeChat user (only supported in group usage)

- `/quit`: Exit and disband group

Contact, official-account, and group searches also support bot mentions in groups:

```text
/user@your_bot Zhang San
/official@your_bot WeChat Pay
/room@your_bot Project A (Development)
```

Replace `@your_bot` with your bot username. Queries preserve internal spaces and punctuation. List buttons show names or remarks without an added emoji prefix.

Starting with v6.0.15, directories use native Telegram RichMessage: click names and navigation directly inside the message, without duplicate lists or start-link redirects. Pages retain 30 entries, search and Back state. An explicit compatibility mode uses a compact ordinary keyboard, with bounded safe fallback. See [directory pagination (Chinese)](docs/directory-pagination.md).

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
|`DB_SQLITE_PATH`| No | Legacy compatibility setting; the current bot binding database is fixed at `storage/db/wx2tg.db` |
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

If you want to modify the message sender's format, edit the Docker environment variables, your `.env` file, or **Message style** in the WebUI.

Default templates (no decorative emoji; emoji inside the message body are preserved):

```dotenv
CONTACT_MESSAGE='<b>#[alias_first]: </b>'
OFFICIAL_MESSAGE='<b>#[name]: </b>'
ROOM_MESSAGE='<b>#[member_name]: </b>'
CONTACT_MESSAGE_GROUP='<b>#[alias_first]: </b>'
OFFICIAL_MESSAGE_GROUP='<b>#[name]: </b>'
ROOM_MESSAGE_GROUP='<b>#[member_name]: </b>'
MESSAGE_DISPLAY='#[identity]#[br]#[body]'
```

A template that is unset, empty, or whitespace-only uses its default. `CREATE_ROOM_NAME` / `CREATE_CONTACT_NAME` name groups and are not affected by the message-template reset.

Custom message template placeholders:

`#[alias]`: Contact remarks

`#[name]`: Contact nickname

`#[topic]`: Group chat nickname

`#[member_name]`: The nickname the member set inside that WeChat group; falls back to their WeChat nickname. It **never uses your contact remark** and works in `ROOM_MESSAGE`, `ROOM_MESSAGE_GROUP` and `MESSAGE_DISPLAY`.

`#[alias_first]`: Remarks priority, if no remarks, display contact's nickname

`#[identity]`: Identity information text

`#[body]`: Message body text

`#[br]`: Line break

Notes:

- Group nicknames come from the WeChat group-member API and are cached per account and group for 60 seconds. A failed or slower-than-1.5-second lookup falls back to the WeChat nickname immediately, so forwarding is never blocked or dropped; the same account/group then falls back directly for 60 seconds.
- Group members are only queried when a template actually contains `#[member_name]`.
- Group nicknames are HTML-escaped, so an administrator-defined group name cannot break the message format.
- When upgrading from an older version, those 7 message display templates are **reset to the defaults once** (including old values from `.env` and the environment). The previous values of these 7 templates only are backed up to `webui-config.json.message-templates-v1.json` before the reset, and later customizations are never overwritten again. Group naming templates, avatars and bindings are unchanged.

`#[identity]`: Identity information text

`#[body]`: Message body text

`#[br]`: Line break

- Forwarded solitaires (groups and one-to-one chats) include a **Join solitaire** button (bot owner only, group nickname preferred). It calls the server `POST /Msg/SendSolitaire` join mode and never auto-retries an uncertain result. See [solitaire messages (Chinese)](docs/solitaire-messages.md).
- **Custom entry** and `/join 2 seats` join with your own text (it replaces the nickname); `/solitaire title | first entry | footer` starts a solitaire in a bound group. Success stays silent: WeChat publishes the updated solitaire and the bot forwards it. See [solitaire messages (Chinese)](docs/solitaire-messages.md).

## How to @everyone

Send a message starting with `@all` to @everyone, only supports text messages @everyone

---

## Frequently Asked Questions

### Why am I prompted to enter a verification code

wx2tg-server needs to be in the same region as your login. If you encounter a verification code prompt, check if they are in the same region.

If not in the same region, you can configure WeChat proxy login in environment variables, or migrate already logged Redis data.

## Participating in Development

1. Fork the project and create a feature branch from `v6`; keep v7 work separate.

2. Submit a Pull Request to the matching maintenance branch and follow the [release rules (Chinese)](docs/releases.md).

## License

[MIT](LICENSE)
