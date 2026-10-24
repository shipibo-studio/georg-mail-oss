-- How each account's Paid plan completes the codes and links the rules miss (docs/plan.md, "AI
-- provider per account"). No row means no model sees the account's mail: every existing Paid
-- account, which used Workers AI until now, starts with AI off until its owner turns it on.
CREATE TABLE `account_ai_settings` (
	`account_id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`provider` text,
	`model` text,
	`api_key_encrypted` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_failure_code` text,
	`last_failure_at` integer,
	`last_success_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
