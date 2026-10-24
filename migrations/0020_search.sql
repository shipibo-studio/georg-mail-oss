ALTER TABLE `messages` ADD `search_rowid` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `messages_search_rowid_unique` ON `messages` (`search_rowid`) WHERE "messages"."search_rowid" IS NOT NULL;--> statement-breakpoint
-- Full-text search of personal mail (hand-written: Drizzle does not model virtual tables).
-- unicode61 with remove_diacritics 2 folds case and accents in any script. Only personal mail is
-- indexed; the body is the visible text, never hidden parts, capped at 20,000 characters.
CREATE VIRTUAL TABLE `message_search` USING fts5(`subject`, `people`, `body`, tokenize = 'unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER `message_search_insert` AFTER INSERT ON `messages`
WHEN (SELECT `kind` FROM `inboxes` WHERE `id` = NEW.`inbox_id`) = 'personal'
BEGIN
  INSERT INTO `message_search` (`subject`, `people`, `body`) VALUES (
    coalesce(NEW.`subject`, ''),
    coalesce(NEW.`from_name`, '') || ' ' || NEW.`from_address` || ' ' || coalesce(NEW.`recipients`, ''),
    substr(coalesce(NEW.`safe_text`, ''), 1, 20000)
  );
  UPDATE `messages` SET `search_rowid` = last_insert_rowid() WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `message_search_delete` AFTER DELETE ON `messages`
WHEN OLD.`search_rowid` IS NOT NULL
BEGIN
  DELETE FROM `message_search` WHERE `rowid` = OLD.`search_rowid`;
END;
--> statement-breakpoint
-- Personal mail received before this migration.
INSERT INTO `message_search` (`rowid`, `subject`, `people`, `body`)
SELECT
  `messages`.`rowid`,
  coalesce(`messages`.`subject`, ''),
  coalesce(`messages`.`from_name`, '') || ' ' || `messages`.`from_address` || ' ' || coalesce(`messages`.`recipients`, ''),
  substr(coalesce(`messages`.`safe_text`, ''), 1, 20000)
FROM `messages` INNER JOIN `inboxes` ON `inboxes`.`id` = `messages`.`inbox_id`
WHERE `inboxes`.`kind` = 'personal';
--> statement-breakpoint
UPDATE `messages` SET `search_rowid` = `rowid`
WHERE `inbox_id` IN (SELECT `id` FROM `inboxes` WHERE `kind` = 'personal');
