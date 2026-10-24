ALTER TABLE `inboxes` ADD `kind` text DEFAULT 'disposable' NOT NULL;--> statement-breakpoint
ALTER TABLE `inboxes` ADD `forward_to` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `direction` text DEFAULT 'received' NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `recipients` text;