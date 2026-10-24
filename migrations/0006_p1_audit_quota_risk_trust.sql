CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`api_key_id` text,
	`action` text NOT NULL,
	`target_id` text,
	`detail` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_events_account_created_idx` ON `audit_events` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_created_idx` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `trusted_senders` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`verified_at` integer,
	`verification_token_hash` text,
	`verification_expires_at` integer,
	`verification_sent_at` integer,
	`locale` text DEFAULT 'en' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trusted_senders_project_value_unique` ON `trusted_senders` (`project_id`,`kind`,`value`);--> statement-breakpoint
CREATE UNIQUE INDEX `trusted_senders_token_unique` ON `trusted_senders` (`verification_token_hash`);--> statement-breakpoint
CREATE INDEX `trusted_senders_account_created_idx` ON `trusted_senders` (`account_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `messages` ADD `risk` text;--> statement-breakpoint
ALTER TABLE `plans` ADD `max_storage_bytes` integer DEFAULT 52428800 NOT NULL;--> statement-breakpoint
-- Storage quotas: Free accounts keep up to 50 MB of email (the column default), Paid up to 1 GB.
UPDATE `plans` SET `max_storage_bytes` = 1073741824 WHERE `id` = 'paid';
