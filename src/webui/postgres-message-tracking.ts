// PostgreSQL uses a connection-local journal, just like the SQLite path.
// Triggers skip notifications for offline migration and ordinary SQL maintenance.
export const installPostgresMessageTracking = `
    CREATE TABLE IF NOT EXISTS inbox_cursor (singleton INTEGER PRIMARY KEY CHECK (singleton=1), high BIGINT NOT NULL);
    INSERT INTO inbox_cursor SELECT 1, CASE WHEN is_called THEN last_value ELSE 0 END FROM inbox_id_seq ON CONFLICT DO NOTHING;
    CREATE OR REPLACE FUNCTION public.wx2tg_track_inbox() RETURNS trigger LANGUAGE plpgsql SET search_path TO public AS $$
    BEGIN
        IF TG_OP='INSERT' THEN UPDATE public.inbox_cursor SET high=GREATEST(high,NEW.id) WHERE singleton=1; END IF;
        IF to_regclass('pg_temp.message_changes') IS NULL THEN RETURN NULL; END IF;
        IF TG_OP='UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN RETURN NULL; END IF;
        IF TG_OP<>'INSERT' AND OLD.hidden=0 AND (SELECT count(*) FROM pg_temp.message_changes)<257 THEN
            INSERT INTO pg_temp.message_changes VALUES (OLD.wxid,OLD.id) ON CONFLICT DO NOTHING;
        END IF;
        IF TG_OP<>'DELETE' AND NEW.hidden=0 AND (SELECT count(*) FROM pg_temp.message_changes)<257 THEN
            INSERT INTO pg_temp.message_changes VALUES (NEW.wxid,NEW.id) ON CONFLICT DO NOTHING;
        END IF;
        RETURN NULL;
    END $$;
    CREATE OR REPLACE FUNCTION public.wx2tg_track_recalls() RETURNS trigger LANGUAGE plpgsql SET search_path TO public AS $$
    DECLARE recall_key TEXT; matched BOOLEAN;
    BEGIN
        IF to_regclass('pg_temp.message_changes') IS NULL THEN RETURN NULL; END IF;
        IF TG_OP='UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN RETURN NULL; END IF;
        IF TG_OP='DELETE' THEN recall_key := OLD.key; ELSE recall_key := NEW.key; END IF;
        SELECT EXISTS(SELECT 1 FROM inbox i WHERE i.hidden=0 AND i.remoteid IS NOT NULL AND
            right(recall_key,length(':'||i.wxid||':'||i.remoteid))=':'||i.wxid||':'||i.remoteid) INTO matched;
        IF matched THEN
            INSERT INTO pg_temp.message_changes
            SELECT i.wxid,i.id FROM inbox i WHERE i.hidden=0 AND i.remoteid IS NOT NULL AND
                right(recall_key,length(':'||i.wxid||':'||i.remoteid))=':'||i.wxid||':'||i.remoteid
                AND NOT EXISTS(SELECT 1 FROM pg_temp.message_changes c WHERE c.wxid=i.wxid AND c.id=i.id)
                LIMIT GREATEST(0,257-(SELECT count(*) FROM pg_temp.message_changes)) ON CONFLICT DO NOTHING;
        ELSE
            INSERT INTO pg_temp.message_changes SELECT '',0 WHERE (SELECT count(*) FROM pg_temp.message_changes)<257 ON CONFLICT DO NOTHING;
        END IF;
        RETURN NULL;
    END $$;
    DROP TRIGGER IF EXISTS inbox_changed ON inbox;
    CREATE TRIGGER inbox_changed AFTER INSERT OR UPDATE OR DELETE ON inbox FOR EACH ROW EXECUTE FUNCTION public.wx2tg_track_inbox();
    DROP TRIGGER IF EXISTS recall_changed ON telegram_recalls;
    CREATE TRIGGER recall_changed AFTER INSERT OR UPDATE OR DELETE ON telegram_recalls FOR EACH ROW EXECUTE FUNCTION public.wx2tg_track_recalls();`