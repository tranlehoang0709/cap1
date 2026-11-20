'use strict';

// Shared six-table PA schema. Calendar's original standalone-table migration
// does not add the fields required by CalendarRepository's shared-table SQL.
const FIELDS = {
  personal_events: {
    timezone: ['varchar(64)', 'NO', 'UTC', "VARCHAR(64) NOT NULL DEFAULT 'UTC'"],
    deleted_at: ['datetime', 'YES', null, 'DATETIME NULL DEFAULT NULL'],
    recurrence_rule: ['json', 'YES', null, 'JSON NULL'],
  },
  personal_reminders: {
    timezone: ['varchar(64)', 'NO', 'UTC', "VARCHAR(64) NOT NULL DEFAULT 'UTC'"],
  },
  reminder_deliveries: {
    attempt_count: ['int', 'NO', '0', 'INT NOT NULL DEFAULT 0'],
    next_retry_at: ['datetime', 'YES', null, 'DATETIME NULL DEFAULT NULL'],
    idempotency_key: ['char(64)', 'YES', null, 'CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL DEFAULT NULL'],
  },
};

async function migratePaCalendarCompat(connection, { apply = false } = {}) {
  const [tables] = await connection.execute(`SELECT TABLE_NAME AS name, ENGINE AS engine
    FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME IN ('personal_events','personal_reminders','reminder_deliveries')`);
  for (const name of Object.keys(FIELDS)) {
    if (!tables.some(t => t.name === name && t.engine === 'InnoDB')) {
      throw new Error(`Expected existing InnoDB table: ${name}`);
    }
  }
  const [columns] = await connection.execute(`SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name,
    COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra,
    COLLATION_NAME AS collationName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME IN ('personal_events','personal_reminders','reminder_deliveries')`);
  // Refuse the incompatible legacy title/delivery_channel schema instead of
  // silently inventing a data conversion or partially applying DDL to it.
  for (const [table, name, type] of [
    ['personal_events', 'start_at', 'datetime'],
    ['personal_reminders', 'message', 'varchar(500)'],
    ['personal_reminders', 'channel', 'varchar(24)'],
    ['reminder_deliveries', 'channel', 'varchar(24)'],
    ['reminder_deliveries', 'error_message', 'varchar(500)'],
  ]) {
    if (!columns.some(c => c.tableName === table && c.name === name && c.type === type)) {
      throw new Error(`Canonical PA prerequisite mismatch: ${table}.${name}`);
    }
  }
  const statements = [];
  for (const [table, fields] of Object.entries(FIELDS)) {
    for (const [name, [type, nullable, defaultValue, ddl]] of Object.entries(fields)) {
      const found = columns.find(c => c.tableName === table && c.name === name);
      if (!found) {
        statements.push(`ALTER TABLE \`${table}\` ADD COLUMN \`${name}\` ${ddl}`);
      } else if (found.type !== type || found.nullable !== nullable ||
                 (found.defaultValue === null ? null : String(found.defaultValue)) !== defaultValue ||
                 found.extra !== '' || (name === 'idempotency_key' && found.collationName !== 'ascii_bin')) {
        throw new Error(`Incompatible existing ${table}.${name}; manual review required`);
      }
    }
  }
  const [indexes] = await connection.execute(`SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique,
    COLUMN_NAME AS columnName, SEQ_IN_INDEX AS position, SUB_PART AS prefixLength
    FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='reminder_deliveries'`);
  for (const [name, unique, fields] of [
    ['uq_pa_delivery_idempotency', true, ['idempotency_key']],
    ['idx_pa_delivery_due', false, ['status', 'next_retry_at']],
  ]) {
    const found = indexes.filter(i => i.name === name).sort((a,b) => Number(a.position)-Number(b.position));
    if (!found.length) {
      if (unique && columns.some(c => c.tableName === 'reminder_deliveries' && c.name === 'idempotency_key')) {
        const [duplicates] = await connection.execute(`SELECT 1 FROM reminder_deliveries
          WHERE idempotency_key IS NOT NULL GROUP BY idempotency_key HAVING COUNT(*)>1 LIMIT 1`);
        if (duplicates.length) throw new Error('Duplicate existing idempotency keys; no automatic data changes allowed');
      }
      statements.push(`ALTER TABLE \`reminder_deliveries\` ADD ${unique ? 'UNIQUE ' : ''}INDEX \`${name}\` (${fields.map(f=>'`'+f+'`').join(',')})`);
    } else if (Number(found[0].nonUnique) !== (unique ? 0 : 1) ||
               JSON.stringify(found.map(i => i.columnName)) !== JSON.stringify(fields) ||
               found.some(i => i.prefixLength !== null)) {
      throw new Error(`Incompatible existing reminder_deliveries index: ${name}`);
    }
  }
  // All validation precedes auto-committing DDL. No UPDATE/DELETE/backfill.
  if (apply) for (const statement of statements) await connection.query(statement);
  return statements;
}

module.exports = { migratePaCalendarCompat };
