CREATE TABLE `notify_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`hook_id` text NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`idempotency_key` text,
	`status` text NOT NULL,
	`subject` text,
	`detail` text,
	`risk` text NOT NULL,
	`channel_results` text NOT NULL,
	`next_attempt_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`hook_id`) REFERENCES `notify_hooks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notify_deliveries_idempotency_unique` ON `notify_deliveries` (`hook_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `notify_deliveries_hook_idx` ON `notify_deliveries` (`hook_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notify_deliveries_due_idx` ON `notify_deliveries` (`next_attempt_at`) WHERE "notify_deliveries"."next_attempt_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `notify_deliveries_created_idx` ON `notify_deliveries` (`created_at`);--> statement-breakpoint
CREATE TABLE `notify_hooks` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`channels` text NOT NULL,
	`email_to` text,
	`slack_url_encrypted` text,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`token_expires_at` integer NOT NULL,
	`max_deliveries` integer NOT NULL,
	`deliveries_count` integer DEFAULT 0 NOT NULL,
	`deadline_at` integer,
	`deadline_notified_at` integer,
	`locale` text DEFAULT 'en' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`disabled_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notify_hooks_token_unique` ON `notify_hooks` (`token_hash`);--> statement-breakpoint
CREATE INDEX `notify_hooks_account_idx` ON `notify_hooks` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notify_hooks_deadline_idx` ON `notify_hooks` (`deadline_at`) WHERE "notify_hooks"."deadline_notified_at" IS NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `hooks_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Outgoing notifications (webhooks and notify hooks) are a paid feature.
UPDATE `plans` SET `hooks_enabled` = 1 WHERE `id` = 'paid';
