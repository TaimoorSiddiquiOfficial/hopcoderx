CREATE TABLE `bookmark` (
	`id` text NOT NULL,
	`session_id` text NOT NULL,
	`message_id` text NOT NULL,
	`label` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	PRIMARY KEY(`id`),
	FOREIGN KEY(`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE,
	FOREIGN KEY(`message_id`) REFERENCES `message`(`id`) ON DELETE CASCADE
);
CREATE INDEX `bookmark_session_idx` ON `bookmark` (`session_id`);
CREATE INDEX `bookmark_message_idx` ON `bookmark` (`message_id`);
