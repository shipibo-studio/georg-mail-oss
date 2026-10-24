CREATE TABLE `mail_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`inbox_id` text NOT NULL,
	`to` text NOT NULL,
	`cc` text NOT NULL,
	`subject` text NOT NULL,
	`text` text NOT NULL,
	`in_reply_to` text,
	`attachments` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`inbox_id`) REFERENCES `inboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mail_drafts_inbox_updated_idx` ON `mail_drafts` (`inbox_id`,`updated_at`);