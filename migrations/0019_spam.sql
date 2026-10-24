CREATE TABLE `sender_rules` (
	`inbox_id` text NOT NULL,
	`address` text NOT NULL,
	`verdict` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`inbox_id`, `address`),
	FOREIGN KEY (`inbox_id`) REFERENCES `inboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `messages` ADD `spam_reason` text;