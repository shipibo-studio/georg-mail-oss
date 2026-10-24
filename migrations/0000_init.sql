CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`plan_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`can_send` integer DEFAULT false NOT NULL,
	`inbox_id` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `api_keys_account_idx` ON `api_keys` (`account_id`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`filename` text,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`is_inline` integer NOT NULL,
	`content_id` text,
	`omitted` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attachments_message_idx` ON `attachments` (`message_id`);--> statement-breakpoint
CREATE TABLE `inboxes` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`address` text NOT NULL,
	`display_name` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inboxes_address_unique` ON `inboxes` (`address`);--> statement-breakpoint
CREATE INDEX `inboxes_account_created_idx` ON `inboxes` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `inboxes_expires_idx` ON `inboxes` (`expires_at`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`inbox_id` text NOT NULL,
	`account_id` text NOT NULL,
	`message_id_header` text,
	`from_address` text NOT NULL,
	`from_name` text,
	`to_address` text NOT NULL,
	`subject` text,
	`text_body` text,
	`html_body` text,
	`codes` text NOT NULL,
	`links` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`raw_object_key` text,
	`parse_error` text,
	`received_at` integer NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`inbox_id`) REFERENCES `inboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_inbox_received_idx` ON `messages` (`inbox_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `messages_account_idx` ON `messages` (`account_id`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`default_ttl_seconds` integer NOT NULL,
	`max_ttl_seconds` integer NOT NULL,
	`max_active_inboxes` integer NOT NULL,
	`max_message_bytes` integer NOT NULL,
	`attachments_enabled` integer NOT NULL,
	`pdf_text_enabled` integer NOT NULL,
	`sends_per_day` integer NOT NULL
);
