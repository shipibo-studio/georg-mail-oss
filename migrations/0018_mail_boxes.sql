ALTER TABLE `messages` ADD `box` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `moved_at` integer;--> statement-breakpoint
CREATE INDEX `messages_box_moved_idx` ON `messages` (`box`,`moved_at`) WHERE "messages"."box" IS NOT NULL;