-- Plan limits (see docs/plan.md, "Plans"). Free: 1 hour inboxes, 256 KB emails, no attachments.
-- Paid: up to 30-day inboxes, 1 MB emails with attachments.
INSERT INTO `plans` (`id`, `name`, `default_ttl_seconds`, `max_ttl_seconds`, `max_active_inboxes`, `max_message_bytes`, `attachments_enabled`, `pdf_text_enabled`, `sends_per_day`)
VALUES
  ('free', 'Free', 3600, 3600, 5, 262144, 0, 0, 100),
  ('paid', 'Paid', 86400, 2592000, 100, 1048576, 1, 1, 200);
