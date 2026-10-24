CREATE TABLE `mail_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`inbox_id` text NOT NULL,
	`object_key` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`inbox_id`) REFERENCES `inboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mail_uploads_inbox_idx` ON `mail_uploads` (`inbox_id`);--> statement-breakpoint
CREATE INDEX `mail_uploads_created_idx` ON `mail_uploads` (`created_at`);--> statement-breakpoint
ALTER TABLE `attachments` ADD `object_key` text;