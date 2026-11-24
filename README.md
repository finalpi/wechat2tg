# wechat2tg (v6)

[中文](README_zh.md) | English

A self-hosted bridge for sending and receiving WeChat messages through Telegram.

## Warnings

> [!WARNING]
> **Use the iPad protocol.** It is the main protocol maintained by this project. Use other protocols with caution. Users have reported account suspensions with the Windows protocol; do not use it.
>
> This is an unofficial integration for research and learning. WeChat may reject logins, end sessions, or restrict accounts. A successful login does not guarantee continued access. Do not use it for illegal purposes.
>
> Keep bot and WebUI tokens, Telegram and WeChat sessions, passwords, verification codes, and login QR codes private. The first person to run `/login` in a private chat with an unbound bot becomes its owner. Complete that step yourself before sharing the bot. The default Compose setup exposes the WebUI on port `17863`; restrict access or use HTTPS for remote access.

## What you need

| Requirement | What it is for |
|---|---|
| A Telegram bot and its `BOT_TOKEN` | Create the bot with [@BotFather](https://t.me/BotFather). The token authenticates the bot. |
| Telegram `API_ID` and `API_HASH` | Create an application at [my.telegram.org](https://my.telegram.org/). These credentials identify the application, not a personal login session. |
| A personal Telegram account | The current `/login` flow signs in to this account first if there is no usable session. Telegram may ask for a verification code and, if enabled, a two-step verification password. The session is used for features such as creating groups, adding the bot to them and organizing chat folders. There is no Bot-only login mode in this release. |
| A WeChat account and your main device | Keep the WeChat client available to scan or confirm the login after Telegram sign-in. The protocol selected in `DEVICE_TYPE` is separate from the WeChat version and model of your main device. |
| A host with Docker Compose v2 (or Node.js 18+ for local development) | The standard stack includes the `wechat2tg` bot, `wx2tg-server`, and Redis. `BASE_API` points to the WeChat service API. |

**Login order:** configure the bot → send `/login` in its private chat → complete Telegram user sign-in if prompted → scan or confirm the WeChat login. A Telegram code prompt does not mean that the Bot Token or API ID/hash is wrong. Large-file transfer uses the bot's own MTProto session, not the personal account.

Current stable release: **v6.0.41**. See the [release notes and upgrade guidance](docs/releases.md) for stable and development builds. Community: [Telegram group](https://t.me/+AD02MEZa-og3ZGY1).

## What works and what does not

### WeChat login compatibility

The iPad protocol is the recommended option, not a guarantee. If a recent WeChat protocol change causes the server to reject a login, there may be no working fix for that device or version in the current release. Changing the Bot Token or Telegram API credentials will not fix a WeChat-side rejection.

If you cannot sign in, please submit a [WeChat login compatibility report](https://github.com/finalpi/wechat2tg/issues/new?template=wechat-login.yml). Include the **device model and exact WeChat app version on the main device you normally use with that account**, the selected `DEVICE_TYPE`, the exact running `wx2tg-server` version, the bot version, and where login stopped. Reports help identify patterns; they do not guarantee a fix. Do not post account details, login secrets, QR codes, or raw logs.

### Main features

1. Receive messages from WeChat personal chats, group chats, official accounts, and enterprise WeChat
2. Send messages via Telegram to specific WeChat users, groups, and official accounts
3. Flexible group message blocking functionality
4. AI reply suggestions based on the current WeChat chat context
5. WebUI configuration, message-template previews and model discovery/testing (current React UI is primarily Chinese)
6. Basic WebUI message viewing, limited operations, categorized contacts and Telegram synchronization tracking; message-type support is incomplete
7. Eleven MCP tools and WebUI token management; client setup is documented separately

### Supported message types

#### WeChat messages

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
+ [x] Red packet messages: display text and an available cover; the bot owner can manually claim eligible packets and see the amount when confirmed. No automatic claiming. [Details and limits](docs/red-packets.md).
+ [ ] Mini program messages

#### Telegram messages

+ [x] Text messages
+ [x] Sticker emotes
+ [x] Image messages
+ [x] Video messages
+ [x] File messages
+ [x] Voice messages

### Automatic chat-folder overflow

New groups are organized into `WeChat`, `WeChat 2`, `WeChat 3`, and so on using the logged-in account’s Telegram limits. If no folder slot remains, group creation, binding, and forwarding still succeed; the chat stays available in All Chats. Existing settings and unrelated/shared folders are preserved. See [folder allocation and failure behavior (Chinese)](docs/telegram-chat-folders.md).

### Official accounts in forum topics

Optionally set `OFFICIAL_ACCOUNT_TOPICS_ENABLED=true` and restart. The first official-account message automatically provisions one private forum, with a separate topic per account. Future messages use those topics and replies route back to the matching account; General never routes to WeChat. The feature defaults off, retains old groups/bindings, and restores old routing when disabled. See [official-account topics (Chinese)](docs/official-account-topics.md).

### Inline WeChat custom emoji

`WECHAT_CUSTOM_EMOJI_ENABLED=true` renders native `[微笑]` / `[Facepalm]` tokens inline using [WeChatPack](https://t.me/addemoji/WeChatPack), preserving rich text and ordinary Unicode emoji. Sending eligibility includes a Premium bot owner or an eligible Fragment username. Enabled by default in auto mode, with button-icon eligibility checks before delivery and compatible output when eligibility is unknown or unavailable. The WebUI shows detection results and supports rechecking or explicit disable. Unknown tokens remain unchanged. See [mapping, coverage and limits (Chinese)](docs/wechat-custom-emoji.md). Available starting with `v6.0.13-dev.3`.

### WebUI and message center

The WebUI starts with the application; the current React interface is primarily Chinese. Docker Compose exposes **TCP 17863 on all host interfaces by default**: open `http://<server-address>:17863/`. Local development listens on loopback by default: `http://127.0.0.1:17863/`. WebUI and MCP share the same port; the MCP path is `/mcp`.

#### Telegram Mini App and live messages

The same WebUI can open from the owner’s private-chat **控制台** menu. Configure `WEBUI_MINI_APP_URL=https://your-domain/` and restart the Bot: the backend verifies Telegram signatures and permits **only the existing bot owner**, without entering a WebUI token. Ordinary browser login remains available. The message page uses SSE change notifications instead of five-second polling. A reachable HTTPS root URL and an SSE-compatible reverse proxy are required; see [setup and security boundaries](docs/telegram-mini-app.md). Available since v6.0.35; use **v6.0.36 or later** for the private-chat menu fix.

#### Configuration console

- Configure Telegram / WeChat connections, forwarding preferences, message templates, proxies, AI / speech recognition, retries, retention, and logging.
- Existing-field validation, unsaved-change tracking, conflict detection, responsive layouts and restart feedback are available. Telegram bot language settings do not imply equivalent WebUI language switching.
- Telegram and WeChat proxies are presented separately. Message templates have live contact, group, and official-account previews, including missing-alias examples. Previews use sample data and never send messages.
- Sign in with `WEBUI_TOKEN` (at least 16 characters), or retrieve the generated SQLite-backed token with `node dist/settings-cli.js --webui-token`. Sign-in opens chat by default. Ordinary browsers save the access token locally for refresh/reopen; Mini App sessions remain separate and memory-only. Signing out or a rejected token clears saved credentials.
- Configuration secret fields remain blank: leave blank to retain the saved value, enter a new value to replace it, or explicitly clear an optional secret. MCP tokens have separate reveal/regeneration controls.

#### WebUI chat limitations

> [!IMPORTANT]
> **WebUI chat is currently intended mainly for viewing simple messages such as text, with limited send, quote, recall and synchronization operations. It does not fully support every WeChat message type and is not a replacement for the WeChat client.** A summary, link or attachment entry does not mean that a message type is fully decoded, interactive or comprehensively verified. Use WeChat for the complete experience.

- **Rendering is partial.** Images, audio/video, files, official-account articles and merged histories have some preview/download/decoding paths. Protocol responses, expired media, cache availability and nested formats can still produce summaries, placeholders, missing attachments or failures. Eligible red packets can be opened manually; see the [red packet guide](docs/red-packets.md). Transfers, mini-programs, Channels content, special cards and real-time voice/video calls are not fully supported in the WebUI.
- **History is not your complete WeChat history.** The page reads records this project has saved or synchronized; it does not retrieve all old messages from WeChat. Telegram forwarding support must not be confused with WebUI rendering support.
- **Operations are type-dependent.** Text, some attachment sends and eligible quote/recall operations are available; uploads are limited to 50 MiB and captions are sent separately. Quotes cannot include attachments or native mentions; use the member picker for group mentions. Recalls require native receipts and remain subject to WeChat limits. Native interactions on complex cards are not guaranteed.
- **Status is not a read receipt.** Submitted means a WeChat-side receipt was returned, not that the recipient received/read the message. Pending Telegram synchronization is not WeChat unread state. Uncertain outcomes are not automatically resent.
- **Contacts are a cached directory.** dev.4 adds WeChat-style categories, alphabetical sections, avatars, search and paging. Service accounts require an explicit protocol field; remaining official accounts are not asserted to be confirmed subscription accounts. Counts are neither page lengths nor authoritative real-time WeChat totals. Cached groups are not necessarily saved-to-contacts groups. New-friend management, My Enterprise, and contact add/delete/approval are not implemented in WebUI.
- **Official-account menus are only partially supported.** dev.4 displays synchronized menus/submenus and opens ordinary HTTP(S) links in a new window. Event clicks, mini-programs and WeChat authorization/QR actions remain disabled. Button text is never sent as a fake menu click. Missing cached menus do not prove an account has no menu, and links may still require WeChat to complete their workflow.
- **PWA installation is not offline WeChat or background delivery.** Trusted HTTPS is required. Only public shell assets are cached, never protected APIs, chat bodies or attachments. Drafts live in the current signed-in window's memory; closing or forcing a reload does not guarantee recovery. There is no offline send replay or reliable closed-window push. Native mobile installation, keyboard and Telegram WebView behavior still need device testing.
- **The UI migration is incomplete.** The current React UI is primarily Chinese. Independent UI-language switching, global configuration search and one-click MCP client-configuration export from the old UI are not fully migrated.

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
| `storage/db/wx2tg.db` | Application settings, bot preferences and bindings, Telegram display overrides, MCP, credentials and automations | App settings apply on restart; preferences, display overrides, MCP and automation update immediately |
| `storage/db/webui-messages.db` | Message center history and delivery tracking | Immediately |
| `storage/webui-media` / `storage/webui-avatars` | Attachments and avatar cache | Immediately |

Starting with `v6.0.42-dev.12`, manage settings in the WebUI. **Non-empty ENV > SQLite values > built-in defaults.** Stable `v6.0.41` still uses `storage/webui-config.json`, whose saved values override ENV. ENV overrides the running process without writing back to SQLite; affected fields are marked in the WebUI. Back up `./.env` and `./config` (mounted at `/app/storage`) before upgrading. Existing settings files are imported once and retained untouched. See [configuration migration](docs/settings-migration.md) for upgrade steps and optional import of legacy ENV-only application settings.

Normal startup leaves the WebUI available if Telegram credentials are missing. To edit application settings without connecting clients, use `npm run build` then `npm run webui`; stop the standalone process before starting the normal app. The standalone process uses the same SQLite settings database but does not start Telegram or WeChat.

## Installation & Deployment

See the [release notes](docs/releases.md) for updates. On ARM64, verify that your chosen `wx2tg-server` image supports your host architecture; the bot and server are separate images.

For a new deployment, copy `.env.example` to `.env` and configure the environment variables. SQLite remains the default. To opt in to PostgreSQL for the server archive, the bot's databases (including history, outbox and archives), or both on one instance, use the [PostgreSQL setup and migration guide](docs/postgresql.md). Bot PostgreSQL support requires a build that includes this change.

Copy `app.conf.example` to `app.conf` in the `conf` directory and set the Redis address to your deployed Redis address. For existing deployments, merge the new settings instead of overwriting your ports, Redis credentials, and callback URL.

Keep `MODE=polling` in `.env` and `syncmessage=false`, `msgpush=false` on the server. Server-side message archiving now defaults to SQLite at host path `./server-data/messages`, independent of the bot database under `./config`. Puppet `6.0.12` supports message-bearing callbacks and binary file sections. To switch to callback mode, also configure `msgpush=true` and a reachable callback URL on the server; see the linked notes.

Use Docker Engine with Docker Compose v2, or Node.js 18+ for local development. Native SQLite, image-processing, and media-conversion dependencies must match the runtime platform.

### Docker Compose

The Compose example below uses `finalpi/wechat2tg:latest` and `finalpi/wx2tg-server:v6-latest`. Save it as `docker-compose.yml`; no WebUI override is needed.

The commands below initialize a new stack. For an existing deployment, review your local Compose and preserve private configuration, then update the bot with `docker compose pull wechat2tg` and `docker compose up -d --no-deps wechat2tg`.

```bash
test -e .env || cp .env.example .env
mkdir -p conf
test -e conf/app.conf || cp app.conf.example conf/app.conf
docker compose pull
docker compose up -d
```

If `WEBUI_TOKEN` is not configured, retrieve the generated token locally. For stable `v6.0.41`, run `docker compose exec wechat2tg cat storage/webui-token`; for `v6.0.42-dev.12` and newer, run `docker compose exec wechat2tg node dist/settings-cli.js --webui-token`.

In `.env`, fill in `BOT_TOKEN`, `API_ID`, and `API_HASH`, or enter them through WebUI and restart the app after saving. The bundled example uses `BASE_API=http://wx2tg-server:8058/api` and `redislink=wx2tg-redis:6379`. Keep those Compose service names if using the bundled stack.

Open `http://<server-address>:17863/` and sign in with the token. Then follow the login order above using `/login` in the bot's Telegram private chat. Missing credentials leave the configuration page available. After saving environment settings in WebUI:

```bash
docker compose restart wechat2tg
```

Example Compose configuration:

```yaml
services:
  wechat2tg:
    image: finalpi/wechat2tg:latest
    container_name: wechat2tg-v6
    environment:
      WEBUI_ENABLED: "${WEBUI_ENABLED:-true}"
      WEBUI_HOST: "0.0.0.0"
      WEBUI_PORT: "${WEBUI_PORT:-17863}"
      BOT_POSTGRES_DSN: "${BOT_POSTGRES_DSN:-}"
      BOT_POSTGRES_AUTO_MIGRATE: "${BOT_POSTGRES_AUTO_MIGRATE:-false}"
      MESSAGE_STORE_POSTGRES_DSN: ""
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
    image: finalpi/wx2tg-server:v6-latest
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

- `/login`: In the bot's private chat, complete Telegram user sign-in if needed, then start WeChat login. On a fresh deployment, the first person to run this command becomes the bot owner.

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
|`BOT_POSTGRES_DSN`| No | Dedicated bot PostgreSQL database URI; leave empty to use SQLite |
|`BOT_POSTGRES_AUTO_MIGRATE`| No | Set to `true` after backing up to migrate existing bot SQLite data on startup; default `false` |
|`MESSAGE_STORE_POSTGRES_DSN`| No | Dedicated server archive PostgreSQL database URI; also set `messagestore = "postgres"` in the server config |
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
|`SEND_TO_TG_MAX_RETRIES`, `SEND_TO_TG_RETRY_DELAY`| No | Ordinary failure retry limit (`3`) and backoff base (`5000` ms); confirmed pre-connect failures and 429 keep retrying. Uncertain delivery requires review. See [durable forwarding](docs/diagnostics/telegram-forwarding.md). |
|`MESSAGE_BUFFER_EXPIRE_TIME`| No | Legacy cleanup setting for completed forwarding records (at least 7 days); pending, failed and uncertain payloads never expire automatically. |
|`AUTO_DELETE_OLD_MESSAGES`, `MESSAGE_RETENTION_DAYS`| No | Cleanup existing bot message history; defaults `false` / `7` days |
|`LOG_LEVEL`, `DEBUG_MODE`| No | Logging level and debug mode; defaults `info` / `false` |
|`WEBUI_ENABLED`| No | Enable WebUI; default `true`. MCP uses the same listener |
|`WEBUI_HOST`| No | Local listener defaults to `127.0.0.1`; Compose overrides to `0.0.0.0` |
|`WEBUI_PORT`| No | WebUI and MCP port; default `17863` |
|`WEBUI_BIND_ADDRESS`| No | Compose host bind address; default `0.0.0.0` |
|`WEBUI_TOKEN`| No | WebUI access credential, minimum 16 characters; generated if omitted |
|`WEBUI_CONFIG_PATH`| No | Legacy migration source; defaults to `storage/webui-config.json` and does not move the SQLite database |
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
- The database migration preserves existing message templates; it does not reset them. Existing `webui-config.json.message-templates-v1.json` backups are left untouched.

`#[identity]`: Identity information text

`#[body]`: Message body text

`#[br]`: Line break

- Forwarded solitaires (groups and one-to-one chats) include a **Join solitaire** button (bot owner only, group nickname preferred). It calls the server `POST /Msg/SendSolitaire` join mode and never auto-retries an uncertain result. See [solitaire messages (Chinese)](docs/solitaire-messages.md).
- **Custom entry** and `/join 2 seats` join with your own text (it replaces the nickname); `/solitaire title | first entry | footer` starts a solitaire in a bound group. Success stays silent: WeChat publishes the updated solitaire and the bot forwards it. See [solitaire messages (Chinese)](docs/solitaire-messages.md).

## How to @everyone

Send a message starting with `@all` to @everyone, only supports text messages @everyone

---

## Frequently Asked Questions

### Why am I prompted to enter a verification code?

- **Telegram prompts before the WeChat QR code:** `/login` is signing in to your personal Telegram account. This is expected if no usable Telegram user session exists.
- **WeChat prompts or refuses login:** Check the message in the WeChat client and whether the `wx2tg-server` network region matches your usual login region. This alone does not resolve an unsupported protocol. If the problem persists, use the [WeChat login compatibility report](https://github.com/finalpi/wechat2tg/issues/new?template=wechat-login.yml).

## Participating in Development

1. Fork the project and create a feature branch from `v6`; keep v7 work separate.

2. Submit a Pull Request to the matching maintenance branch and follow the [release rules (Chinese)](docs/releases.md).

## License

[MIT](LICENSE)
