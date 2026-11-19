'use strict';

const { APPROVED_PA_TABLES, DDL_STATEMENTS } = require('./20261114_personal_assistant.cjs');
const { migratePa10Subtasks } = require('./20261115_pa10_subtasks.cjs');

const TABLES = ['personal_plans', 'personal_events', 'personal_tasks', 'personal_memories'];

async function migratePa04Pa06Pa08(connection, { apply = false } = {}) {
  const [parents] = await connection.query(
    "SELECT t.TABLE_NAME, t.ENGINE, c.COLUMN_TYPE, c.COLUMN_KEY FROM information_schema.TABLES t JOIN information_schema.COLUMNS c ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME WHERE t.TABLE_SCHEMA = DATABASE() AND t.TABLE_NAME IN ('users', 'conversations') AND c.COLUMN_NAME = 'id'"
  );
  for (const name of ['users', 'conversations']) {
    const parent = parents.find(row => row.TABLE_NAME === name);
    if (!parent || parent.ENGINE !== 'InnoDB' || parent.COLUMN_TYPE !== 'bigint' || parent.COLUMN_KEY !== 'PRI') {
      throw new Error('Expected an existing InnoDB signed BIGINT primary key on ' + name);
    }
  }
  const [existing] = await connection.query(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('personal_plans', 'personal_events', 'personal_tasks', 'personal_memories')"
  );
  const names = new Set(existing.map(row => row.TABLE_NAME));
  const statements = [];
  for (const name of TABLES) {
    if (names.has(name)) continue;
    const sql = DDL_STATEMENTS[APPROVED_PA_TABLES.indexOf(name)];
    if (!sql) throw new Error('Missing canonical DDL for ' + name);
    statements.push(sql);
    if (apply) await connection.query(sql);
  }
  // Current plan/task readers select parent_task_id even for top-level plan steps.
  // Reuse its canonical migration, which only changes personal_tasks.
  if (apply || names.has('personal_tasks')) {
    statements.push(...await migratePa10Subtasks(connection, { apply }));
  }
  return statements;
}

module.exports = { TABLES, migratePa04Pa06Pa08 };
