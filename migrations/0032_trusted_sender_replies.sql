-- Replies to trusted senders: the one way an agent's email leaves Georg mail. Outbound records say
-- whether they stayed inside a project or went out, and only the Paid plan may reply.
ALTER TABLE `outbound_messages` ADD `kind` text DEFAULT 'internal' NOT NULL;--> statement-breakpoint
CREATE INDEX `outbound_messages_kind_created_idx` ON `outbound_messages` (`kind`,`created_at`);--> statement-breakpoint
ALTER TABLE `plans` ADD `replies_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `plans` SET `replies_enabled` = 1 WHERE `id` = 'paid';--> statement-breakpoint
-- Sends recorded before this migration from a personal mailbox went out too: label them as such.
UPDATE `outbound_messages` SET `kind` = 'personal' WHERE `inbox_id` IN (SELECT `id` FROM `inboxes` WHERE `kind` = 'personal');
