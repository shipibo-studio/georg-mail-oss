ALTER TABLE `api_keys` ADD `content_access` text DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE `api_keys` ADD `expires_at` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `safe_text` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `authentication` text;