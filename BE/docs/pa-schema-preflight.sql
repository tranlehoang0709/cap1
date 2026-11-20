-- Read-only. Run on the SAME endpoint/database used by the failing Backend.
SELECT DATABASE() AS selected_database, VERSION() AS mysql_version,
       @@hostname AS mysql_server, @@port AS mysql_port;

SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN
 ('personal_tasks','personal_plans','personal_events','personal_reminders','reminder_deliveries','personal_memories');

SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA
FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN
 ('personal_tasks','personal_plans','personal_events','personal_reminders','reminder_deliveries','personal_memories')
ORDER BY TABLE_NAME,ORDINAL_POSITION;

SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART
FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN
 ('personal_tasks','personal_plans','personal_events','personal_reminders','reminder_deliveries','personal_memories')
ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX;

SELECT k.TABLE_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,
       r.UPDATE_RULE,r.DELETE_RULE
FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
 ON k.CONSTRAINT_SCHEMA=r.CONSTRAINT_SCHEMA AND k.CONSTRAINT_NAME=r.CONSTRAINT_NAME AND k.TABLE_NAME=r.TABLE_NAME
WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME IN
 ('personal_tasks','personal_plans','personal_events','personal_reminders','reminder_deliveries','personal_memories');

-- Exact first SQL in PersonalAssistantRepository.sweepTaskAlerts().
SELECT DISTINCT user_id FROM personal_tasks WHERE deleted_at IS NULL AND due_at IS NOT NULL;
