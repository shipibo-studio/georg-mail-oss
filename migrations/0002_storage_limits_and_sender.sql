ALTER TABLE `messages` ADD `envelope_from` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `body_truncated` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `attachment_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `max_messages_per_inbox` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `extendable` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Per-plan storage caps: Free inboxes hold up to 100 messages and cannot be extended past their
-- 1-hour lifetime; Paid inboxes hold up to 1,000 messages and can be extended.
UPDATE `plans` SET `max_messages_per_inbox` = 1000, `extendable` = 1 WHERE `id` = 'paid';
