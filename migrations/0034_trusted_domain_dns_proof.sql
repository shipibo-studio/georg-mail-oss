ALTER TABLE `trusted_senders` ADD `dns_token` text;--> statement-breakpoint
ALTER TABLE `trusted_senders` ADD `dns_verified_at` integer;--> statement-breakpoint
ALTER TABLE `trusted_senders` ADD `dns_checked_at` integer;