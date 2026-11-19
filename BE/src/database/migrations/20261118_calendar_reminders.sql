-- PA-01, PA-02 and PA-14. Additive migration; no existing data is deleted.
CREATE TABLE IF NOT EXISTS `calendar_events` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `starts_at` DATETIME NOT NULL,
  `ends_at` DATETIME NOT NULL,
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'UTC',
  `recurrence_rule` VARCHAR(500) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_calendar_events_user_time` (`user_id`, `starts_at`, `ends_at`),
  CONSTRAINT `fk_calendar_events_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `reminders` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `calendar_event_id` BIGINT NULL,
  `device_id` BIGINT NULL,
  `message` VARCHAR(500) NOT NULL,
  `remind_at` DATETIME NOT NULL,
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'UTC',
  `status` VARCHAR(24) NOT NULL DEFAULT 'pending',
  `attempt_count` INT NOT NULL DEFAULT 0,
  `next_attempt_at` DATETIME NULL,
  `delivery_key` VARCHAR(255) NOT NULL,
  `acknowledged_at` DATETIME NULL,
  `last_error` VARCHAR(120) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reminders_delivery_key` (`delivery_key`),
  KEY `idx_reminders_due` (`status`, `remind_at`, `next_attempt_at`),
  KEY `idx_reminders_user` (`user_id`, `remind_at`),
  CONSTRAINT `fk_reminders_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT `fk_reminders_calendar_event_id` FOREIGN KEY (`calendar_event_id`) REFERENCES `calendar_events` (`id`) ON UPDATE RESTRICT ON DELETE SET NULL,
  CONSTRAINT `fk_reminders_device_id` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
