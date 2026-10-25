CREATE TABLE `member_preferences` (
	`email` text PRIMARY KEY NOT NULL,
	`preferences` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`email`) REFERENCES `dashboard_members`(`email`) ON UPDATE no action ON DELETE cascade
);
