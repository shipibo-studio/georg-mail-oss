CREATE TABLE `reply_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`inbox_id` text NOT NULL,
	`message_id` text NOT NULL,
	`api_key_id` text,
	`recipient` text NOT NULL,
	`subject` text NOT NULL,
	`text` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`outbound_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`decided_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inbox_id`) REFERENCES `inboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reply_drafts_inbox_status_idx` ON `reply_drafts` (`inbox_id`,`status`);--> statement-breakpoint
CREATE INDEX `reply_drafts_account_created_idx` ON `reply_drafts` (`account_id`,`created_at`);