CREATE TABLE `mailbox_aliases` (
	`address` text PRIMARY KEY NOT NULL,
	`inbox_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`inbox_id`) REFERENCES `inboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mailbox_aliases_inbox_idx` ON `mailbox_aliases` (`inbox_id`);