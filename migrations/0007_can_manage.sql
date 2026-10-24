ALTER TABLE `api_keys` ADD `can_manage` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Keys created with direct database access (account-wide, never expiring) are the owners' admin keys.
UPDATE `api_keys` SET `can_manage` = 1 WHERE `expires_at` IS NULL AND `project_id` IS NULL AND `inbox_id` IS NULL;
