ALTER TABLE `accounts` ADD `stored_bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `inboxes` ADD `message_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `stored_bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `messages_inbox_unread_idx` ON `messages` (`inbox_id`,`received_at`) WHERE "messages"."read_at" IS NULL;--> statement-breakpoint
-- Backfill the counters from existing rows.
UPDATE `messages` SET `stored_bytes` = coalesce(length(`text_body`), 0) + coalesce(length(`html_body`), 0) + coalesce(length(`safe_text`), 0);--> statement-breakpoint
UPDATE `accounts` SET `stored_bytes` = (SELECT coalesce(sum(`stored_bytes`), 0) FROM `messages` WHERE `messages`.`account_id` = `accounts`.`id`);--> statement-breakpoint
UPDATE `inboxes` SET `message_count` = (SELECT count(*) FROM `messages` WHERE `messages`.`inbox_id` = `inboxes`.`id`);--> statement-breakpoint
-- Quotas sized for D1, where every account's email shares one database of at most 500 MB on the
-- free plan: Free accounts keep 20 MB of stored email, Paid accounts 200 MB.
UPDATE `plans` SET `max_storage_bytes` = 20971520 WHERE `id` = 'free';--> statement-breakpoint
UPDATE `plans` SET `max_storage_bytes` = 209715200 WHERE `id` = 'paid';
