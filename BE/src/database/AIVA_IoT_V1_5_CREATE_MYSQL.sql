-- AIVA-IoT V1.5: fresh install schema converted from the existing V1.5 DBML.
-- IMPORTANT: Run on an EMPTY database; this is NOT a V1.4 -> V1.5 migration.
-- This file preserves V1.5 column names; V1.4 compatibility requires a separate migration.
CREATE DATABASE IF NOT EXISTS `aiva_iot` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `aiva_iot`;

CREATE TABLE `users` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `display_name` VARCHAR(150) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'active',
  `email_verified_at` DATETIME NULL,
  `last_login_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `roles` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(32) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_roles_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `user_roles` (
  `user_id` BIGINT NOT NULL,
  `role_id` INT NOT NULL,
  PRIMARY KEY (`user_id`, `role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `auth_sessions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `refresh_token_hash` VARCHAR(255) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `revoked_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_auth_sessions_refresh_token_hash` (`refresh_token_hash`),
  KEY `idx_auth_sessions_user_id_expires_at` (`user_id`, `expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `privacy_preferences` (
  `user_id` BIGINT NOT NULL,
  `save_history` TINYINT(1) NOT NULL DEFAULT 1,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `devices` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `device_uid` VARCHAR(128) NOT NULL,
  `display_name` VARCHAR(120) NULL,
  `hardware_model` VARCHAR(100) NULL,
  `lifecycle_status` VARCHAR(32) NOT NULL DEFAULT 'available',
  `connection_status` VARCHAR(20) NOT NULL DEFAULT 'offline',
  `current_firmware_id` BIGINT NULL,
  `last_seen_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_devices_device_uid` (`device_uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `device_credentials` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `device_id` BIGINT NOT NULL,
  `credential_hash` VARCHAR(255) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'active',
  `expires_at` DATETIME NULL,
  `revoked_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_device_credentials_credential_hash` (`credential_hash`),
  KEY `idx_device_credentials_device_id_status` (`device_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `device_pairing_codes` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `device_id` BIGINT NOT NULL,
  `code_hash` VARCHAR(255) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME NULL,
  `revoked_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_device_pairing_codes_code_hash` (`code_hash`),
  KEY `idx_device_pairing_codes_device_id_expires_at` (`device_id`, `expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `device_pairing_requests` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `device_id` BIGINT NOT NULL,
  `user_id` BIGINT NOT NULL,
  `pairing_code_id` BIGINT NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'pending',
  `reviewed_by` BIGINT NULL,
  `reviewed_at` DATETIME NULL,
  `review_note` VARCHAR(500) NULL,
  `created_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_device_pairing_requests_device_id_status` (`device_id`, `status`),
  KEY `idx_device_pairing_requests_user_id_status` (`user_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `device_assignments` (
  `device_id` BIGINT NOT NULL,
  `user_id` BIGINT NOT NULL,
  `pairing_request_id` BIGINT NOT NULL,
  `assigned_by` BIGINT NOT NULL,
  `assigned_at` DATETIME NOT NULL,
  PRIMARY KEY (`device_id`),
  UNIQUE KEY `uq_device_assignments_pairing_request_id` (`pairing_request_id`),
  KEY `idx_device_assignments_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `device_assignment_history` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `device_id` BIGINT NOT NULL,
  `user_id` BIGINT NOT NULL,
  `pairing_request_id` BIGINT NULL,
  `assigned_at` DATETIME NOT NULL,
  `unlinked_at` DATETIME NULL,
  `unlinked_by` BIGINT NULL,
  `unlink_reason` VARCHAR(500) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_device_assignment_history_device_id_assigned_at` (`device_id`, `assigned_at`),
  KEY `idx_device_assignment_history_user_id_assigned_at` (`user_id`, `assigned_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `device_unlink_operations` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `device_id` BIGINT NOT NULL,
  `former_user_id` BIGINT NOT NULL,
  `assignment_history_id` BIGINT NOT NULL,
  `requested_by` BIGINT NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'requested',
  `requested_at` DATETIME NOT NULL,
  `revoked_at` DATETIME NULL,
  `completed_at` DATETIME NULL,
  `failure_reason` TEXT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_device_unlink_operations_device_id_status` (`device_id`, `status`),
  KEY `idx_device_unlink_operations_former_user_id_requested_at` (`former_user_id`, `requested_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `device_recovery_backups` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `unlink_operation_id` BIGINT NOT NULL,
  `encrypted_blob_uri` VARCHAR(1024) NOT NULL,
  `checksum_sha256` CHAR(64) NOT NULL,
  `encryption_key_ref` VARCHAR(255) NOT NULL,
  `created_at` DATETIME NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `deleted_at` DATETIME NULL,
  `restored_at` DATETIME NULL,
  `restored_by` BIGINT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_device_recovery_backups_unlink_operation_id` (`unlink_operation_id`),
  KEY `idx_device_recovery_backups_expires_at_deleted_at` (`expires_at`, `deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `device_reset_jobs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `unlink_operation_id` BIGINT NOT NULL,
  `device_id` BIGINT NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'pending',
  `attempt_count` INT NOT NULL DEFAULT 0,
  `requested_at` DATETIME NOT NULL,
  `sent_at` DATETIME NULL,
  `acknowledged_at` DATETIME NULL,
  `last_error` VARCHAR(500) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_device_reset_jobs_device_id_status` (`device_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `device_telemetry` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `device_id` BIGINT NOT NULL,
  `event_type` VARCHAR(60) NOT NULL,
  `wifi_rssi` INT NULL,
  `free_heap_bytes` BIGINT NULL,
  `battery_percent` TINYINT NULL,
  `payload` JSON NULL,
  `recorded_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_device_telemetry_device_id_recorded_at` (`device_id`, `recorded_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `ai_providers` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(32) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `is_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `health_status` VARCHAR(24) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ai_providers_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `ai_models` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `provider_id` INT NOT NULL,
  `model_code` VARCHAR(120) NOT NULL,
  `capability` VARCHAR(20) NOT NULL,
  `is_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ai_models_provider_id_model_code_capability` (`provider_id`, `model_code`, `capability`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `ai_profiles` (
  `user_id` BIGINT NOT NULL,
  `assistant_name` VARCHAR(100) NULL,
  `system_prompt` TEXT NULL,
  `language_code` VARCHAR(20) NULL,
  `voice_code` VARCHAR(100) NULL,
  `preferred_provider_id` INT NULL,
  `preferred_llm_model_id` BIGINT NULL,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `api_credentials` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `provider_id` INT NOT NULL,
  `owner_scope` VARCHAR(20) NOT NULL,
  `owner_user_id` BIGINT NULL,
  `label` VARCHAR(100) NOT NULL,
  `secret_ciphertext` TEXT NOT NULL,
  `secret_hint` VARCHAR(16) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL,
  `revoked_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_api_credentials_owner_scope_owner_user_id_provider_id` (`owner_scope`, `owner_user_id`, `provider_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `quota_policies` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NULL,
  `provider_id` INT NULL,
  `requests_per_minute` INT NULL,
  `requests_per_day` INT NULL,
  `tokens_per_month` BIGINT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_quota_policies_user_id_provider_id` (`user_id`, `provider_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `conversations` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `device_id` BIGINT NULL,
  `channel` VARCHAR(20) NOT NULL,
  `title` VARCHAR(255) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'active',
  `started_at` DATETIME NOT NULL,
  `ended_at` DATETIME NULL,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_conversations_user_id_started_at` (`user_id`, `started_at`),
  KEY `idx_conversations_device_id_started_at` (`device_id`, `started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `ai_sessions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `conversation_id` BIGINT NOT NULL,
  `device_id` BIGINT NULL,
  `ai_server_instance_id` BIGINT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'active',
  `started_at` DATETIME NOT NULL,
  `ended_at` DATETIME NULL,
  `error_code` VARCHAR(80) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ai_sessions_conversation_id_started_at` (`conversation_id`, `started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `messages` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `conversation_id` BIGINT NOT NULL,
  `role` VARCHAR(20) NOT NULL,
  `content` TEXT NULL,
  `provider_id` INT NULL,
  `created_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_messages_conversation_id_created_at` (`conversation_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `usage_records` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `conversation_id` BIGINT NULL,
  `ai_session_id` BIGINT NULL,
  `provider_id` INT NOT NULL,
  `model_id` BIGINT NULL,
  `credential_id` BIGINT NULL,
  `request_kind` VARCHAR(20) NOT NULL,
  `input_tokens` INT NULL,
  `output_tokens` INT NULL,
  `duration_ms` INT NULL,
  `status` VARCHAR(24) NOT NULL,
  `occurred_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_usage_records_user_id_occurred_at` (`user_id`, `occurred_at`),
  KEY `idx_usage_records_provider_id_occurred_at` (`provider_id`, `occurred_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `firmware_versions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `hardware_model` VARCHAR(100) NOT NULL,
  `version` VARCHAR(80) NOT NULL,
  `file_uri` VARCHAR(1024) NOT NULL,
  `checksum_sha256` CHAR(64) NOT NULL,
  `uploaded_by` BIGINT NOT NULL,
  `released_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_firmware_versions_hardware_model_version` (`hardware_model`, `version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `ota_updates` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `device_id` BIGINT NOT NULL,
  `firmware_version_id` BIGINT NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'pending',
  `requested_at` DATETIME NOT NULL,
  `completed_at` DATETIME NULL,
  `error_message` TEXT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ota_updates_device_id_requested_at` (`device_id`, `requested_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `ai_server_instances` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `instance_code` VARCHAR(100) NOT NULL,
  `status` VARCHAR(24) NOT NULL,
  `last_healthcheck_at` DATETIME NULL,
  `started_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ai_server_instances_instance_code` (`instance_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `resource_metrics` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `instance_id` BIGINT NOT NULL,
  `cpu_percent` DECIMAL(5,2) NULL,
  `memory_percent` DECIMAL(5,2) NULL,
  `gpu_percent` DECIMAL(5,2) NULL,
  `gpu_memory_percent` DECIMAL(5,2) NULL,
  `active_sessions` INT NULL,
  `recorded_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_resource_metrics_instance_id_recorded_at` (`instance_id`, `recorded_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `system_logs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `instance_id` BIGINT NULL,
  `device_id` BIGINT NULL,
  `severity` VARCHAR(20) NOT NULL,
  `component` VARCHAR(100) NOT NULL,
  `event_code` VARCHAR(100) NULL,
  `message` TEXT NULL,
  `occurred_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_system_logs_severity_occurred_at` (`severity`, `occurred_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `audit_logs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `actor_user_id` BIGINT NULL,
  `action` VARCHAR(100) NOT NULL,
  `entity_type` VARCHAR(80) NOT NULL,
  `entity_id` VARCHAR(100) NULL,
  `metadata` JSON NULL,
  `occurred_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_audit_logs_actor_user_id_occurred_at` (`actor_user_id`, `occurred_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `system_settings` (
  `setting_key` VARCHAR(120) NOT NULL,
  `setting_value` JSON NOT NULL,
  `updated_by` BIGINT NULL,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `user_roles` ADD CONSTRAINT `fk_user_roles_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `user_roles` ADD CONSTRAINT `fk_user_roles_role_id` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `auth_sessions` ADD CONSTRAINT `fk_auth_sessions_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `privacy_preferences` ADD CONSTRAINT `fk_privacy_preferences_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `devices` ADD CONSTRAINT `fk_devices_current_firmware_id` FOREIGN KEY (`current_firmware_id`) REFERENCES `firmware_versions` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `device_credentials` ADD CONSTRAINT `fk_device_credentials_device_id` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `device_pairing_codes` ADD CONSTRAINT `fk_device_pairing_codes_device_id` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `device_pairing_requests` ADD CONSTRAINT `fk_device_pairing_requests_device_id` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `device_pairing_requests` ADD CONSTRAINT `fk_device_pairing_requests_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `device_pairing_requests` ADD CONSTRAINT `fk_device_pairing_requests_pairing_code_id` FOREIGN KEY (`pairing_code_id`) REFERENCES `device_pairing_codes` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `device_pairing_requests` ADD CONSTRAINT `fk_device_pairing_requests_reviewed_by` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `device_assignments` ADD CONSTRAINT `fk_device_assignments_device_id` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `device_assignments` ADD CONSTRAINT `fk_device_assignments_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `device_assignments` ADD CONSTRAINT `fk_device_assignments_pairing_request_id` FOREIGN KEY (`pairing_request_id`) REFERENCES `device_pairing_requests` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `device_assignments` ADD CONSTRAINT `fk_device_assignments_assigned_by` FOREIGN KEY (`assigned_by`) REFERENCES `users` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `device_assignment_history` ADD CONSTRAINT `fk_device_assignment_history_device_id` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `device_assignment_history` ADD CONSTRAINT `fk_device_assignment_history_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `device_assignment_history` ADD CONSTRAINT `fk_device_assignment_history_pairing_request_id` FOREIGN KEY (`pairing_request_id`) REFERENCES `device_pairing_requests` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `device_assignment_history` ADD CONSTRAINT `fk_device_assignment_history_unlinked_by` FOREIGN KEY (`unlinked_by`) REFERENCES `users` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `device_unlink_operations` ADD CONSTRAINT `fk_device_unlink_operations_device_id` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `device_unlink_operations` ADD CONSTRAINT `fk_device_unlink_operations_former_user_id` FOREIGN KEY (`former_user_id`) REFERENCES `users` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `device_unlink_operations` ADD CONSTRAINT `fk_device_unlink_operations_assignment_history_id` FOREIGN KEY (`assignment_history_id`) REFERENCES `device_assignment_history` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `device_unlink_operations` ADD CONSTRAINT `fk_device_unlink_operations_requested_by` FOREIGN KEY (`requested_by`) REFERENCES `users` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `device_recovery_backups` ADD CONSTRAINT `fk_device_recovery_backups_unlink_operation_id` FOREIGN KEY (`unlink_operation_id`) REFERENCES `device_unlink_operations` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `device_recovery_backups` ADD CONSTRAINT `fk_device_recovery_backups_restored_by` FOREIGN KEY (`restored_by`) REFERENCES `users` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `device_reset_jobs` ADD CONSTRAINT `fk_device_reset_jobs_unlink_operation_id` FOREIGN KEY (`unlink_operation_id`) REFERENCES `device_unlink_operations` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `device_reset_jobs` ADD CONSTRAINT `fk_device_reset_jobs_device_id` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `device_telemetry` ADD CONSTRAINT `fk_device_telemetry_device_id` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `ai_models` ADD CONSTRAINT `fk_ai_models_provider_id` FOREIGN KEY (`provider_id`) REFERENCES `ai_providers` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `ai_profiles` ADD CONSTRAINT `fk_ai_profiles_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `ai_profiles` ADD CONSTRAINT `fk_ai_profiles_preferred_provider_id` FOREIGN KEY (`preferred_provider_id`) REFERENCES `ai_providers` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `ai_profiles` ADD CONSTRAINT `fk_ai_profiles_preferred_llm_model_id` FOREIGN KEY (`preferred_llm_model_id`) REFERENCES `ai_models` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `api_credentials` ADD CONSTRAINT `fk_api_credentials_provider_id` FOREIGN KEY (`provider_id`) REFERENCES `ai_providers` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `api_credentials` ADD CONSTRAINT `fk_api_credentials_owner_user_id` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `quota_policies` ADD CONSTRAINT `fk_quota_policies_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `quota_policies` ADD CONSTRAINT `fk_quota_policies_provider_id` FOREIGN KEY (`provider_id`) REFERENCES `ai_providers` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `conversations` ADD CONSTRAINT `fk_conversations_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `conversations` ADD CONSTRAINT `fk_conversations_device_id` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `ai_sessions` ADD CONSTRAINT `fk_ai_sessions_conversation_id` FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `ai_sessions` ADD CONSTRAINT `fk_ai_sessions_device_id` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `ai_sessions` ADD CONSTRAINT `fk_ai_sessions_ai_server_instance_id` FOREIGN KEY (`ai_server_instance_id`) REFERENCES `ai_server_instances` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `messages` ADD CONSTRAINT `fk_messages_conversation_id` FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `messages` ADD CONSTRAINT `fk_messages_provider_id` FOREIGN KEY (`provider_id`) REFERENCES `ai_providers` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `usage_records` ADD CONSTRAINT `fk_usage_records_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `usage_records` ADD CONSTRAINT `fk_usage_records_conversation_id` FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `usage_records` ADD CONSTRAINT `fk_usage_records_ai_session_id` FOREIGN KEY (`ai_session_id`) REFERENCES `ai_sessions` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `usage_records` ADD CONSTRAINT `fk_usage_records_provider_id` FOREIGN KEY (`provider_id`) REFERENCES `ai_providers` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `usage_records` ADD CONSTRAINT `fk_usage_records_model_id` FOREIGN KEY (`model_id`) REFERENCES `ai_models` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `usage_records` ADD CONSTRAINT `fk_usage_records_credential_id` FOREIGN KEY (`credential_id`) REFERENCES `api_credentials` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `firmware_versions` ADD CONSTRAINT `fk_firmware_versions_uploaded_by` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `ota_updates` ADD CONSTRAINT `fk_ota_updates_device_id` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `ota_updates` ADD CONSTRAINT `fk_ota_updates_firmware_version_id` FOREIGN KEY (`firmware_version_id`) REFERENCES `firmware_versions` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `resource_metrics` ADD CONSTRAINT `fk_resource_metrics_instance_id` FOREIGN KEY (`instance_id`) REFERENCES `ai_server_instances` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `system_logs` ADD CONSTRAINT `fk_system_logs_instance_id` FOREIGN KEY (`instance_id`) REFERENCES `ai_server_instances` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `system_logs` ADD CONSTRAINT `fk_system_logs_device_id` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `audit_logs` ADD CONSTRAINT `fk_audit_logs_actor_user_id` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `system_settings` ADD CONSTRAINT `fk_system_settings_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
-- Seed roles and providers (idempotent)
INSERT INTO `roles` (`code`, `name`) VALUES ('ADMIN', 'Administrator'), ('USER', 'User') ON DUPLICATE KEY UPDATE `name`=VALUES(`name`);
INSERT INTO `ai_providers` (`code`, `name`, `is_enabled`) VALUES ('LOCAL', 'Local AI', 1), ('OPENAI', 'OpenAI', 1), ('GEMINI', 'Google Gemini', 1) ON DUPLICATE KEY UPDATE `name`=VALUES(`name`);

SELECT COUNT(*) AS table_count FROM information_schema.tables WHERE table_schema = DATABASE();
