-- Additive schema change represented by Message.threadId / conversationWxId.
-- Normal startup uses TypeORM synchronize=true and applies this automatically,
-- including indexes. This file documents the one-time delta for deployments
-- that manage schema manually. Check PRAGMA table_info(message) first; do not
-- execute ADD COLUMN again on an already upgraded database.
ALTER TABLE "message" ADD COLUMN "threadId" integer;
ALTER TABLE "message" ADD COLUMN "conversationWxId" text;
CREATE INDEX IF NOT EXISTS "idx_message_topic_history"
    ON "message" ("chatId", "threadId", "id");
-- Existing rows remain NULL; old group bindings and history are not rewritten.
-- Back up SQLite before upgrading/downgrading. Disabling the feature does not
-- remove these columns or the official_account_* tables.
