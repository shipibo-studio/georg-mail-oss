CREATE TABLE `outbound_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`inbox_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`recipient_count` integer NOT NULL,
	`recipients` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inbox_id`) REFERENCES `inboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbound_messages_inbox_key_unique` ON `outbound_messages` (`inbox_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `outbound_messages_account_created_idx` ON `outbound_messages` (`account_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `messages` ADD `in_reply_to` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `internal_sender_inbox_id` text;