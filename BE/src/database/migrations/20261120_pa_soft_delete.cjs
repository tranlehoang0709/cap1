'use strict';

/** Reconcile existing PA tables; CREATE TABLE IF NOT EXISTS cannot add columns.
 * Dry-run by default. Only adds the nullable soft-delete fields already defined
 * by the canonical 20261114 PA schema. Never changes existing definitions/data.
 */
async function migratePaSoftDelete(connection, { apply = false } = {}) {
  const tables = ['personal_tasks', 'personal_plans'];
  const [existing] = await connection.execute(
    `SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('personal_tasks','personal_plans')`
  );
  for (const name of tables) {
    if (!existing.some(t => t.name === name && t.engine === 'InnoDB')) {
      throw new Error(`Expected existing InnoDB table: ${name}`);
    }
  }
  const [columns] = await connection.execute(
    `SELECT TABLE_NAME AS tableName, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
            COLUMN_DEFAULT AS defaultValue, EXTRA AS extra
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN ('personal_tasks','personal_plans') AND COLUMN_NAME = 'deleted_at'`
  );
  // Validate both tables before running any auto-committing MySQL DDL.
  const statements = [];
  for (const name of tables) {
    const column = columns.find(c => c.tableName === name);
    if (column) {
      if (column.type !== 'datetime' || column.nullable !== 'YES' ||
          column.defaultValue !== null || column.extra !== '') {
        throw new Error(`Incompatible existing ${name}.deleted_at; manual review required`);
      }
    } else {
      statements.push(`ALTER TABLE \`${name}\` ADD COLUMN \`deleted_at\` DATETIME NULL DEFAULT NULL`);
    }
  }
  if (apply) for (const sql of statements) await connection.query(sql);
  return statements;
}

module.exports = { migratePaSoftDelete };
