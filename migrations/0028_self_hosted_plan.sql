-- The plan of a self-hosted mail client, given to the account /setup creates. Only the mailbox
-- limits matter: 512 KB parsed per message (about 6 ms of CPU, inside Workers Free's 10 ms), and
-- 300 MB of text in D1, which leaves room for the search index under D1 Free's 500 MB per database.
-- The rest (inbox lifetimes, AI extraction, hooks) belongs to the hosted product and stays off.
INSERT INTO `plans` (`id`, `name`, `default_ttl_seconds`, `max_ttl_seconds`, `max_active_inboxes`, `max_message_bytes`, `max_messages_per_inbox`, `extendable`, `attachments_enabled`, `pdf_text_enabled`, `sends_per_day`, `max_storage_bytes`, `hooks_enabled`)
VALUES ('self-hosted', 'Self-hosted', 3600, 3600, 0, 524288, 0, 0, 1, 0, 200, 314572800, 0);
