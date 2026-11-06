/** Additive, resumable migration. Never infer ownership for legacy conversations. */
async function migrateRobotHandover(connection, { apply = false } = {}) {
  const [tables] = await connection.execute(`SELECT TABLE_NAME AS name, ENGINE AS engine
    FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME IN ('conversations','device_assignment_history')`);
  if (tables.length !== 2 || tables.some(t => t.engine !== 'InnoDB')) throw new Error('Expected existing InnoDB handover tables');
  const [columns] = await connection.execute(`SELECT TABLE_NAME AS tableName,COLUMN_NAME AS name,
    COLUMN_TYPE AS type,IS_NULLABLE AS nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
    AND ((TABLE_NAME='device_assignment_history' AND COLUMN_NAME='id')
      OR (TABLE_NAME='conversations' AND COLUMN_NAME='assignment_history_id'))`);
  const history = columns.find(c => c.tableName === 'device_assignment_history');
  const assignment = columns.find(c => c.tableName === 'conversations');
  if (!history || !/^bigint(?:\(\d+\))?$/.test(history.type)) throw new Error('Expected signed BIGINT assignment history id');
  if (assignment && (!/^bigint(?:\(\d+\))?$/.test(assignment.type) || assignment.nullable !== 'YES')) {
    throw new Error('Existing assignment_history_id has an incompatible definition');
  }
  const [constraints] = await connection.execute(`SELECT CONSTRAINT_NAME AS name,REFERENCED_TABLE_NAME AS target,
    REFERENCED_COLUMN_NAME AS targetColumn FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='conversations' AND COLUMN_NAME='assignment_history_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL`);
  if (constraints.some(c => c.target !== 'device_assignment_history' || c.targetColumn !== 'id')) throw new Error('Unexpected assignment history foreign key');
  const statements = [];
  if (!assignment) statements.push('ALTER TABLE conversations ADD COLUMN assignment_history_id BIGINT NULL');
  if (!constraints.length) statements.push(`ALTER TABLE conversations ADD CONSTRAINT fk_conversations_assignment_history_id
    FOREIGN KEY (assignment_history_id) REFERENCES device_assignment_history(id) ON UPDATE RESTRICT ON DELETE RESTRICT`);
  if (apply) for (const sql of statements) await connection.query(sql);
  return statements;
}
module.exports = { migrateRobotHandover };
