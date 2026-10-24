CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`key` text NOT NULL,
	`display_name` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_key_unique` ON `projects` (`key`);--> statement-breakpoint
CREATE INDEX `projects_account_created_idx` ON `projects` (`account_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `api_keys` ADD `project_id` text REFERENCES projects(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `inboxes` ADD `project_id` text REFERENCES projects(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `inboxes` ADD `label` text;--> statement-breakpoint
CREATE INDEX `inboxes_project_idx` ON `inboxes` (`project_id`);