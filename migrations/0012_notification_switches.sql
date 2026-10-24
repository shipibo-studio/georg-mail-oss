ALTER TABLE `inboxes` ADD `forward_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `inboxes` ADD `slack_enabled` integer DEFAULT true NOT NULL;