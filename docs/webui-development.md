# WebUI development

The WebUI lives in `webui/` (React, Vite, Tailwind 3, shadcn/Radix). The Node server serves the built assets; the old vanilla message-page source is not shipped.

## Local preview

```sh
npm ci
npm run dev:webui
```

The launcher rebuilds the backend and frontend, prints the local address and access token, then starts the standalone server. It reads `.env`, reuses the saved token unless `WEBUI_TOKEN` is set, and forwards shutdown signals to the child process.

The standalone server supports configuration editing. It has no live message adapter: the message page shows **消息服务未连接**. Run the normal bot with WebUI enabled to use real conversations. Do not expose the access token or enable a remote service merely to preview the page.

## Message page

- Conversation search and recent/contact/group filters, with paged contact lists.
- Saved history, message search, older pages, quote replies and original-message lookup.
- Separate send/Telegram-sync/recall statuses. Pending sync counts are not unread counts.
- Text, files, voice preference, pasted attachments, group-member and everyone mentions.
- Header-authenticated avatar/media requests, Blob previews/downloads, image zoom/rotation, audio/video players and nested chat records.
- Idempotency keys survive uncertain HTTP responses. Text plus attachment uses separate requests; an accepted part is not submitted again. Unknown WeChat delivery is never automatically resent.
- Drafts survive conversation switches while the message page remains open. Drafts are memory-only, not persisted across page reloads/logout. An in-flight send continues even if another conversation is selected.
- Five-second visible-page polling, preserved older history, and no latest-history polling while viewing located quote context.
- Theme-aware bubbles and a single-column conversation view on small screens.

HTML is rendered through a small React allowlist, not `dangerouslySetInnerHTML`. Only HTTP(S) links and local, allowlisted custom-emoji image paths are rendered. Tokens are never placed in media URLs.

## Checks

```sh
npm run build                 # backend + strict frontend type checks + bundle
npm test                      # backend/API regression suite
npm run test:webui:browser     # Chromium integration checks against local fixtures
```

Browser tests use `playwright-core` with an installed Chrome/Chromium. Set `BROWSER_EXECUTABLE_PATH` if it is not installed at a common system path. They start a temporary local WebUI server and fake message adapter; they do not send to WeChat/Telegram or use account credentials.

The browser suite exercises login, layout, history/search, original-message lookup, confirmed sync/recall, media preview, drafts, member selection, text/file splitting, lost-response retries, theme/proxy controls, mobile layout and unavailable/offline states. Live account receipt handling still requires real integration testing.
