ALTER TABLE `inboxes` ADD `raw_bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `body_parsed` integer DEFAULT true NOT NULL;