CREATE TABLE `account_channels` (
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`secret_encrypted` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`account_id`, `kind`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
