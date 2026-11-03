-- Additive SQLite schema for optional official-account forum routing.
-- Register both entities with AppDataSource; existing synchronize=true also creates these tables.
-- Never migrate/delete/rebind rows in bind_group. OFF restores legacy routing for those groups.
CREATE TABLE IF NOT EXISTS "official_account_forum" (
    "id" integer PRIMARY KEY NOT NULL,
    "chatId" integer,
    "creationStatus" text NOT NULL,
    CONSTRAINT "CHK_official_account_forum_singleton" CHECK ("id" = 1)
);
CREATE TABLE IF NOT EXISTS "official_account_topic" (
    "wxId" text PRIMARY KEY NOT NULL,
    "chatId" integer NOT NULL,
    "threadId" integer,
    "name" text NOT NULL,
    "status" text NOT NULL,
    "randomId" text NOT NULL,
    "isReceive" boolean NOT NULL DEFAULT (1),
    "isForwardOthers" boolean NOT NULL DEFAULT (0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_official_account_topic_destination"
    ON "official_account_topic" ("chatId", "threadId");

-- OFFICIAL_ACCOUNT_TOPICS_ENABLED defaults to false (enable with true).
-- Forum creationStatus: creating (intent recorded), provisioning (chatId recorded), ready.
-- Topic status: creating (randomId recorded), ready (topic service-message ID recorded).
-- If CreateChannel's result is unknown, automatic creation STOPS, even after restart.
-- Inspect the logged-in user's private groups, then set OFFICIAL_ACCOUNT_FORUM_CHAT_ID
-- to the EXISTING private forum's Bot API ID (-100...) and retry. Do not clear the row
-- or create another group blindly. A different established chatId is always rejected.
-- A known group resumes member/admin setup; a pending topic reuses its stored randomId.
-- This is provisioning recovery, not a durable message-delivery queue or delivery ACK.
