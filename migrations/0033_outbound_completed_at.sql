-- When a send finished, so a retry with the same Idempotency-Key can tell a finished request (replay)
-- from one still running (409 idempotency_key_in_flight). Every send recorded before this finished.
ALTER TABLE `outbound_messages` ADD `completed_at` integer;--> statement-breakpoint
UPDATE `outbound_messages` SET `completed_at` = `created_at`;
