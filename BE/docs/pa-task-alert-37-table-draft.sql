-- Draft for review. Use a dedicated MySQL connection and fail-fast batch mode
-- (never mysql --force). Set @pa_approved_schema explicitly after approval.
-- Set it to the disposable clone name when rehearsing the migration.
-- Do not use the baseline migration runner for this existing 37-table schema.

SELECT COUNT(*) INTO @pa_table_count
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE';

SELECT COUNT(*) INTO @pa_innodb_count
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND ENGINE = 'InnoDB'
  AND TABLE_NAME IN ('personal_tasks', 'personal_plans', 'personal_reminders', 'reminder_deliveries');

SELECT COUNT(*) INTO @pa_required_count
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND IS_NULLABLE = 'NO'
  AND ((TABLE_NAME = 'personal_reminders' AND
        ((COLUMN_NAME = 'title' AND COLUMN_TYPE = 'varchar(200)') OR
         (COLUMN_NAME = 'timezone' AND COLUMN_TYPE = 'varchar(64)')))
    OR (TABLE_NAME = 'reminder_deliveries' AND
        ((COLUMN_NAME = 'delivery_channel' AND COLUMN_TYPE = 'varchar(20)') OR
         (COLUMN_NAME = 'idempotency_key' AND COLUMN_TYPE = 'varchar(100)'))));

SELECT COUNT(*), SUM(COLUMN_NAME = 'idempotency_key' AND NON_UNIQUE = 0 AND SUB_PART IS NULL)
INTO @pa_key_columns, @pa_valid_key
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reminder_deliveries'
  AND INDEX_NAME = 'uq_pa_delivery_idempotency';

SELECT COALESCE(SUM(
  IS_NULLABLE <> 'YES' OR COLUMN_DEFAULT IS NOT NULL OR EXTRA <> ''
  OR COLUMN_TYPE <> CASE COLUMN_NAME
    WHEN 'deleted_at' THEN 'datetime'
    WHEN 'session_number' THEN 'int'
    WHEN 'message' THEN 'varchar(500)'
  END
  OR (COLUMN_NAME = 'message' AND COLLATION_NAME <> 'utf8mb4_unicode_ci')
), 0)
INTO @pa_conflicting_columns
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND ((TABLE_NAME = 'personal_tasks' AND COLUMN_NAME IN ('deleted_at', 'session_number'))
    OR (TABLE_NAME = 'personal_plans' AND COLUMN_NAME = 'deleted_at')
    OR (TABLE_NAME = 'personal_reminders' AND COLUMN_NAME = 'message'));

SET @pa_sql = IF(
  DATABASE() = @pa_approved_schema AND @pa_table_count = 37 AND @pa_innodb_count = 4
  AND @pa_required_count = 4 AND @pa_key_columns = 1 AND @pa_valid_key = 1
  AND @pa_conflicting_columns = 0,
  'SELECT ''PA schema preflight passed'' AS result',
  'PA_PREFLIGHT_FAILED__STOP_AND_REVIEW_SCHEMA'
);
PREPARE pa_statement FROM @pa_sql;
EXECUTE pa_statement;
DEALLOCATE PREPARE pa_statement;

SELECT
  MAX(TABLE_NAME = 'personal_tasks' AND COLUMN_NAME = 'deleted_at'),
  MAX(TABLE_NAME = 'personal_tasks' AND COLUMN_NAME = 'session_number'),
  MAX(TABLE_NAME = 'personal_plans' AND COLUMN_NAME = 'deleted_at'),
  MAX(TABLE_NAME = 'personal_reminders' AND COLUMN_NAME = 'message')
INTO @pa_task_deleted, @pa_task_session, @pa_plan_deleted, @pa_reminder_message
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE();

SET @pa_sql = CASE
  WHEN @pa_task_deleted = 0 AND @pa_task_session = 0 THEN
    'ALTER TABLE personal_tasks ADD COLUMN deleted_at DATETIME NULL DEFAULT NULL, ADD COLUMN session_number INT NULL DEFAULT NULL'
  WHEN @pa_task_deleted = 0 THEN
    'ALTER TABLE personal_tasks ADD COLUMN deleted_at DATETIME NULL DEFAULT NULL'
  WHEN @pa_task_session = 0 THEN
    'ALTER TABLE personal_tasks ADD COLUMN session_number INT NULL DEFAULT NULL'
  ELSE 'SELECT ''personal_tasks already compatible'' AS result'
END;
PREPARE pa_statement FROM @pa_sql;
EXECUTE pa_statement;
DEALLOCATE PREPARE pa_statement;

SET @pa_sql = IF(@pa_plan_deleted = 0,
  'ALTER TABLE personal_plans ADD COLUMN deleted_at DATETIME NULL DEFAULT NULL',
  'SELECT ''personal_plans already compatible'' AS result');
PREPARE pa_statement FROM @pa_sql;
EXECUTE pa_statement;
DEALLOCATE PREPARE pa_statement;

SET @pa_sql = IF(@pa_reminder_message = 0,
  'ALTER TABLE personal_reminders ADD COLUMN message VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL',
  'SELECT ''personal_reminders already compatible'' AS result');
PREPARE pa_statement FROM @pa_sql;
EXECUTE pa_statement;
DEALLOCATE PREPARE pa_statement;

SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND ((TABLE_NAME = 'personal_tasks' AND COLUMN_NAME IN ('deleted_at', 'session_number'))
    OR (TABLE_NAME = 'personal_plans' AND COLUMN_NAME = 'deleted_at')
    OR (TABLE_NAME = 'personal_reminders' AND COLUMN_NAME = 'message'))
ORDER BY TABLE_NAME, COLUMN_NAME;

SELECT COUNT(*) AS base_table_count
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE';
