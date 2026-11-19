/**
 * Additive, idempotent migration for the 6 approved Personal Assistant tables:
 * 1. personal_plans
 * 2. personal_events
 * 3. personal_tasks
 * 4. personal_reminders
 * 5. reminder_deliveries
 * 6. personal_memories
 *
 * Strictly enforces the 6-table PA architecture (never creates personal_plan_sessions or a 7th table).
 */
const APPROVED_PA_TABLES = [
  'personal_plans',
  'personal_events',
  'personal_tasks',
  'personal_reminders',
  'reminder_deliveries',
  'personal_memories',
];

const DDL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS \`personal_plans\` (
    \`id\` BIGINT NOT NULL AUTO_INCREMENT,
    \`user_id\` BIGINT NOT NULL,
    \`title\` VARCHAR(255) NOT NULL,
    \`description\` TEXT NULL,
    \`goal\` VARCHAR(500) NULL,
    \`total_sessions\` INT NOT NULL DEFAULT 1,
    \`status\` VARCHAR(24) NOT NULL DEFAULT 'active',
    \`start_date\` DATE NULL,
    \`end_date\` DATE NULL,
    \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`deleted_at\` DATETIME NULL,
    PRIMARY KEY (\`id\`),
    KEY \`idx_personal_plans_user_id_status\` (\`user_id\`, \`status\`),
    CONSTRAINT \`fk_personal_plans_user_id\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON UPDATE RESTRICT ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS \`personal_events\` (
    \`id\` BIGINT NOT NULL AUTO_INCREMENT,
    \`user_id\` BIGINT NOT NULL,
    \`plan_id\` BIGINT NULL,
    \`title\` VARCHAR(255) NOT NULL,
    \`description\` TEXT NULL,
    \`location\` VARCHAR(255) NULL,
    \`start_at\` DATETIME NOT NULL,
    \`end_at\` DATETIME NULL,
    \`status\` VARCHAR(24) NOT NULL DEFAULT 'scheduled',
    \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    KEY \`idx_personal_events_user_id_start_at\` (\`user_id\`, \`start_at\`),
    KEY \`idx_personal_events_plan_id\` (\`plan_id\`),
    CONSTRAINT \`fk_personal_events_user_id\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT \`fk_personal_events_plan_id\` FOREIGN KEY (\`plan_id\`) REFERENCES \`personal_plans\` (\`id\`) ON UPDATE RESTRICT ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS \`personal_tasks\` (
    \`id\` BIGINT NOT NULL AUTO_INCREMENT,
    \`user_id\` BIGINT NOT NULL,
    \`plan_id\` BIGINT NULL,
    \`event_id\` BIGINT NULL,
    \`session_number\` INT NULL,
    \`title\` VARCHAR(500) NOT NULL,
    \`description\` TEXT NULL,
    \`status\` VARCHAR(24) NOT NULL DEFAULT 'pending',
    \`priority\` VARCHAR(24) NOT NULL DEFAULT 'MEDIUM',
    \`progress_percent\` INT NOT NULL DEFAULT 0,
    \`due_at\` DATETIME NULL,
    \`completed_at\` DATETIME NULL,
    \`cancelled_at\` DATETIME NULL,
    \`cancel_reason\` VARCHAR(500) NULL,
    \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`deleted_at\` DATETIME NULL,
    PRIMARY KEY (\`id\`),
    KEY \`idx_personal_tasks_user_id_status\` (\`user_id\`, \`status\`),
    KEY \`idx_personal_tasks_plan_id_session_number\` (\`plan_id\`, \`session_number\`),
    KEY \`idx_personal_tasks_user_id_due_at\` (\`user_id\`, \`due_at\`),
    KEY \`idx_personal_tasks_event_id\` (\`event_id\`),
    CONSTRAINT \`fk_personal_tasks_user_id\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT \`fk_personal_tasks_plan_id\` FOREIGN KEY (\`plan_id\`) REFERENCES \`personal_plans\` (\`id\`) ON UPDATE RESTRICT ON DELETE SET NULL,
    CONSTRAINT \`fk_personal_tasks_event_id\` FOREIGN KEY (\`event_id\`) REFERENCES \`personal_events\` (\`id\`) ON UPDATE RESTRICT ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS \`personal_reminders\` (
    \`id\` BIGINT NOT NULL AUTO_INCREMENT,
    \`user_id\` BIGINT NOT NULL,
    \`task_id\` BIGINT NULL,
    \`event_id\` BIGINT NULL,
    \`remind_at\` DATETIME NOT NULL,
    \`message\` VARCHAR(500) NOT NULL,
    \`channel\` VARCHAR(24) NOT NULL DEFAULT 'VOICE',
    \`status\` VARCHAR(24) NOT NULL DEFAULT 'pending',
    \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    KEY \`idx_personal_reminders_user_id_remind_at\` (\`user_id\`, \`remind_at\`),
    KEY \`idx_personal_reminders_task_id\` (\`task_id\`),
    KEY \`idx_personal_reminders_event_id\` (\`event_id\`),
    CONSTRAINT \`fk_personal_reminders_user_id\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT \`fk_personal_reminders_task_id\` FOREIGN KEY (\`task_id\`) REFERENCES \`personal_tasks\` (\`id\`) ON UPDATE RESTRICT ON DELETE SET NULL,
    CONSTRAINT \`fk_personal_reminders_event_id\` FOREIGN KEY (\`event_id\`) REFERENCES \`personal_events\` (\`id\`) ON UPDATE RESTRICT ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS \`reminder_deliveries\` (
    \`id\` BIGINT NOT NULL AUTO_INCREMENT,
    \`reminder_id\` BIGINT NOT NULL,
    \`device_id\` BIGINT NULL,
    \`channel\` VARCHAR(24) NOT NULL,
    \`status\` VARCHAR(24) NOT NULL DEFAULT 'pending',
    \`delivered_at\` DATETIME NULL,
    \`acknowledged_at\` DATETIME NULL,
    \`error_message\` VARCHAR(500) NULL,
    \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    KEY \`idx_reminder_deliveries_reminder_id\` (\`reminder_id\`),
    KEY \`idx_reminder_deliveries_device_id\` (\`device_id\`),
    CONSTRAINT \`fk_reminder_deliveries_reminder_id\` FOREIGN KEY (\`reminder_id\`) REFERENCES \`personal_reminders\` (\`id\`) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT \`fk_reminder_deliveries_device_id\` FOREIGN KEY (\`device_id\`) REFERENCES \`devices\` (\`id\`) ON UPDATE RESTRICT ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS \`personal_memories\` (
    \`id\` BIGINT NOT NULL AUTO_INCREMENT,
    \`user_id\` BIGINT NOT NULL,
    \`memory_key\` VARCHAR(120) NOT NULL,
    \`memory_value\` TEXT NOT NULL,
    \`category\` VARCHAR(60) NULL,
    \`confidence\` DECIMAL(4,3) NULL,
    \`source_conversation_id\` BIGINT NULL,
    \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`uq_personal_memories_user_id_memory_key\` (\`user_id\`, \`memory_key\`),
    KEY \`idx_personal_memories_source_conversation_id\` (\`source_conversation_id\`),
    CONSTRAINT \`fk_personal_memories_user_id\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT \`fk_personal_memories_source_conversation_id\` FOREIGN KEY (\`source_conversation_id\`) REFERENCES \`conversations\` (\`id\`) ON UPDATE RESTRICT ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

async function migratePersonalAssistant(connection, { apply = false } = {}) {
  const [usersTable] = await connection.execute(
    `SELECT TABLE_NAME AS name, ENGINE AS engine
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`
  );
  if (!usersTable.length || usersTable[0].engine !== 'InnoDB') {
    throw new Error('Expected existing InnoDB users table before migrating Personal Assistant schema');
  }

  const [existingTables] = await connection.execute(
    `SELECT TABLE_NAME AS name
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN ('personal_plans','personal_events','personal_tasks','personal_reminders','reminder_deliveries','personal_memories','personal_plan_sessions')`
  );
  const existingNames = new Set(existingTables.map((r) => r.name));
  if (existingNames.has('personal_plan_sessions')) {
    throw new Error('Forbidden seventh table personal_plan_sessions detected; only the 6 approved PA tables are permitted');
  }

  const statementsToRun = [];
  for (let i = 0; i < APPROVED_PA_TABLES.length; i++) {
    const tableName = APPROVED_PA_TABLES[i];
    if (!existingNames.has(tableName)) {
      statementsToRun.push(DDL_STATEMENTS[i]);
    }
  }

  if (apply) {
    for (const sql of statementsToRun) {
      await connection.query(sql);
    }
  }

  return statementsToRun;
}

module.exports = {
  APPROVED_PA_TABLES,
  DDL_STATEMENTS,
  migratePersonalAssistant,
};
