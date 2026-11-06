# Telegram media delivery

## Queue behavior

Each Telegram chat has two serial lanes: media (`BaseMessage.type === 1`) and non-media. Uploading a file does not hold later text in that chat. Text/text and media/media keep their enqueue order. All lanes still obey the same global/per-chat rate limits and FloodWait deadline.

Slow media can arrive after later text. There is no temporary “处理中…” message, empty preview, reply-to-placeholder or placeholder deletion.

WeChat GIF download and voice preparation currently happen before Telegram enqueueing. There is no independently available GIF preview in the existing SDK path. The bot sends the actual media once ready; it does not claim to preserve an earlier Telegram position by editing a fabricated placeholder.

## Send, then enrich

Voice transcription sends the real audio first, stores its Telegram message ID, and performs ASR outside the delivery lane. The transcript edits that same message's caption through the rate-limited request wrapper. Transcription/edit failure leaves the delivered audio intact and never retries the entire audio send.

This is not a generic progressive-preview implementation for every media type. Such a feature needs usable original/preview bytes and a supported in-place media edit operation.

## Retry safety

FloodWait and delivery uncertainty belong to a single async-local queued attempt. Only rate-limit timestamps/deadlines are shared between concurrent lanes.

Unknown or partially completed delivery terminates automatic whole-message retries and is recorded as `unknown` for WebUI review. A buffer item marked terminal is not proof that Telegram acknowledged every part. Explicit Telegram synchronization of uncertain messages requires user confirmation because it can duplicate an earlier delivery.

Tests: `test/telegram-send-lanes.test.cjs` covers same-chat media/text concurrency, per-lane ordering, shared rate limits, isolated attempt outcomes, terminal uncertainty, and send-then-caption-edit behavior. Tests use mocked services, not live Telegram delivery.
