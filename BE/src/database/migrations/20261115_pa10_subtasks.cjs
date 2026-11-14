'use strict';

/**
 * Additive, idempotent migration for PA-10 (Personal Task Subtasks):
 * Adds nullable `parent_task_id` with index and self-referencing FK on `personal_tasks`.
 * Preserves the strict 6-table Personal Assistant architecture (never creates a 7th table).
 */
async function migratePa10Subtasks(connection, { apply = false } = {}) {
  const statements = [];

  const [tableRows] = await connection.execute(
    `SELECT TABLE_NAME AS name
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'personal_tasks'`
  );
  if (!tableRows.length) {
    throw new Error('Missing required table: personal_tasks');
  }

  const [colRows] = await connection.execute(
    `SELECT COLUMN_NAME AS name
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'personal_tasks' AND COLUMN_NAME = 'parent_task_id'`
  );
  if (!colRows.length) {
    const sql =
      'ALTER TABLE `personal_tasks` ADD COLUMN `parent_task_id` BIGINT NULL AFTER `event_id`';
    statements.push(sql);
    if (apply) await connection.query(sql);
  }

  const [idxRows] = await connection.execute(
    `SELECT INDEX_NAME AS name
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'personal_tasks' AND INDEX_NAME = 'idx_personal_tasks_parent_task_id'`
  );
  if (!idxRows.length) {
    const sql =
      'ALTER TABLE `personal_tasks` ADD INDEX `idx_personal_tasks_parent_task_id` (`parent_task_id`)';
    statements.push(sql);
    if (apply) await connection.query(sql);
  }

  const [fkRows] = await connection.execute(
    `SELECT CONSTRAINT_NAME AS name
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'personal_tasks' AND CONSTRAINT_NAME = 'fk_personal_tasks_parent_task_id' AND CONSTRAINT_TYPE = 'FOREIGN KEY'`
  );
  if (!fkRows.length) {
    const sql =
      'ALTER TABLE `personal_tasks` ADD CONSTRAINT `fk_personal_tasks_parent_task_id` FOREIGN KEY (`parent_task_id`) REFERENCES `personal_tasks` (`id`) ON UPDATE RESTRICT ON DELETE SET NULL';
    statements.push(sql);
    if (apply) await connection.query(sql);
  }

  return statements;
}

module.exports = { migratePa10Subtasks };
