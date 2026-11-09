# WebUI development

The WebUI lives in `webui/` (React, Vite, Tailwind 3, shadcn/Radix). The Node server serves the built assets; the old vanilla message-page source is not shipped.

## Local preview

```sh
npm ci
npm run dev:webui
```

The launcher rebuilds the backend and frontend, prints the address and access token, then starts an **isolated demo server by default**. It reads `.env`, uses a separate saved `webui-demo-token` unless `WEBUI_TOKEN` is set, and forwards shutdown signals to the child process.

```sh
# Preview from another device on your LAN (token required):
WEBUI_HOST=0.0.0.0 npm run dev:webui

# Opt out of mock data and inspect the original disconnected/configuration preview:
npm run dev:webui -- --no-mock
# Equivalent: WEBUI_MOCK=false npm run dev:webui
```

The default `/` and `/chat` routes open the chat-only workspace; use `/manage` or the chat menu for configuration. Demo mode includes 12 synthetic contacts covering all six categories, multiple group senders, older history, quote messages, generated avatars, a local image/audio/file sample and read-only official-account menus. Sending text, mentions, syncing and recalling are simulated in memory and emit the usual SSE changes. A visible **演示模式** banner and 🧪 connection indicator distinguish it from a real account.

Demo messages reset on server restart. Media and server settings use a disposable temporary directory cleaned up on shutdown, never the production message database. Service settings are read-only; AI, automation, MCP and attachment uploads are blocked. Browser-local chat appearance preferences still work. No WeChat/Telegram client is started, no real messages are sent, and demo assets need no external downloads. Do not expose the access token or enable a remote service merely to preview the page.

The normal `npm run webui` standalone entry remains unchanged: it supports configuration editing but has no live message adapter, so the message page shows **消息服务未连接**. Run the normal bot with WebUI enabled for real conversations. A real bot outage never silently switches to demo data.

## Message page

- Chat / directory views, expandable cached categories, stable alphabet sections, avatars, search and pagination. Category counts cover deduplicated cached search matches before category filtering/paging, not live WeChat totals.
- Official/service menu display reads normalized cached metadata only. Ordinary HTTP(S) links require user navigation; native events, mini-programs and authorization are disabled. Menu refresh shares SSE notifications and does not add another stream or polling.
- Saved history, message search, older pages, quote replies and original-message lookup.
- Separate send/Telegram-sync/recall statuses. Pending sync counts are not unread counts.
- Text, files, voice preference, pasted attachments, group-member and everyone mentions.
- Header-authenticated avatar/media requests, Blob previews/downloads, image zoom/rotation, audio/video players and nested chat records.
- Idempotency keys survive uncertain HTTP responses. Text plus attachment uses separate requests; an accepted part is not submitted again. Unknown WeChat delivery is never automatically resent.
- Drafts survive conversation switches while the message page remains open. Drafts are memory-only, not persisted across page reloads/logout. An in-flight send continues even if another conversation is selected.
- One authenticated SSE connection, event-driven refreshes, preserved older history, and no jump to latest while viewing located quote context. No periodic message/contact/status HTTP polling.
- Theme-aware bubbles and a single-column conversation view on small screens.

These are partial implementation paths, not complete WeChat message-type support. Complex cards/media may only have summaries or fail to render; see the limitations in both READMEs.

HTML is rendered through a small React allowlist, not `dangerouslySetInnerHTML`. Only HTTP(S) links and local, allowlisted custom-emoji image paths are rendered. Tokens are never placed in media URLs.

## Installable chat workspace (v6.0.40-dev.3 preview)

The chat shell is independent of configuration loading and remains mounted when visiting management pages. Focus mode hides the conversation list; its width is keyboard/pointer adjustable. Browser back/forward and the Mini App BackButton return to the list without discarding in-memory drafts.

The build generates a root service worker from an explicit public-file allowlist. PWA installation requires HTTPS (loopback is a development exception). Only the shell and static assets are cached, never authenticated API/SSE/media responses. Activation is opt-in and only the approving tab reloads, after checking unsaved changes again; other tabs keep their drafts. Mini Apps do not register a worker or use saved browser credentials. See [PWA/chat operation and boundaries](pwa-chat.md).

`test-pwa-chat-browser.cjs` uses real Chromium service workers and a temporary HTTP server to test cache isolation, offline shell behavior, focus/resize, draft/scroll preservation, guarded updates and multi-tab behavior. Native mobile installation and real soft keyboards still require device testing.

## Telegram Mini App

The same React application supports owner-only Telegram login through signed initData and an in-memory session, without using the browser’s saved token. See [Mini App setup and SSE proxy configuration](telegram-mini-app.md). Available starting with v6.0.35.

## Configuration conflict recovery

Configuration GET includes the form schema; PATCH returns only the updated snapshot. Preserve the schema when applying a PATCH, and advance the saved revision after each successful environment/runtime batch. If a later batch fails, retain only unsaved draft fields.

A 409 `conflict` means the editable configuration changed since it was loaded, not an AI provider error. Keep the draft, offer **重新加载配置**, then require the user to review and save again. Do not automatically overwrite concurrent changes. Login identity fields such as `chatId` / `botId` are excluded from the revision; editable preferences and secret values remain covered.

The configuration browser regression covers conflict/reload failure recovery, preserving AI inputs, repeated saves, mixed environment/runtime saves and partial failures against the real local HTTP handler. Its AI URL is a reserved test domain and no AI requests are sent.

## Checks

```sh
npm run build                 # backend + strict frontend type checks + bundle
npm test                      # backend/API regression suite
npm run test:webui:browser     # Chromium integration checks against local fixtures
```

Browser tests use `playwright-core` with an installed Chrome/Chromium. Set `BROWSER_EXECUTABLE_PATH` if it is not installed at a common system path. They start a temporary local WebUI server and fake message adapter; they do not send to WeChat/Telegram or use account credentials.

`test-webui-demo-browser.cjs` exercises the actual demo adapter and real HTTP routes, including visible demo labels, avatar/media rendering, simulated sends/recall/sync/mentions, blocked uploads without logout, read-only service settings and mobile layout. Unit/API tests cover launcher defaults/opt-out, authentication, disposable state and production isolation.

The Mini App suite mocks only Telegram launch/SDK behavior while exercising the real local HTTP auth and SSE endpoints. It checks owner enforcement, theme/viewport/back button, session revocation and saved-token bypass protection. The message suite asserts zero recurring requests during an idle interval, long-connection reconnect, backdated updates and older-message status changes.

`test-contact-directory-browser.cjs` additionally checks real HTTP category counts beyond 60 rows, alphabetical sections/search/paging, SSE-driven category removal and menu availability, safe links/disabled native actions, draft retention and 320–430px layouts. It performs no sends or external navigation.

The browser suite exercises login, layout, history/search, original-message lookup, confirmed sync/recall, media preview, drafts, member selection, text/file splitting, lost-response retries, theme/proxy controls, mobile layout and unavailable/offline states. Live account receipt handling still requires real integration testing.
