-- Caps Paid emails at 512 KB so inbound parsing stays within the 10 ms CPU limit of Workers Free:
-- `pnpm bench:parse` measured 12-15 ms for ~1 MB emails. Raise it again on Workers Paid.
UPDATE `plans` SET `max_message_bytes` = 524288 WHERE `id` = 'paid';
