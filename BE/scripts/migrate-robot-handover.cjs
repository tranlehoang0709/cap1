// Read-only plan by default. Only --apply performs the additive DDL.
require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');
const { migrateRobotHandover } = require('../src/database/migrations/20261105_robot_handover.cjs');
async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--apply','--dry-run'].includes(arg)) || args.includes('--apply') && args.includes('--dry-run')) {
    throw new Error('Usage: node scripts/migrate-robot-handover.cjs [--dry-run | --apply]');
  }
  for (const key of ['DB_HOST','DB_PORT','DB_USER','DB_PASSWORD','DB_NAME']) if (!process.env[key]) throw new Error(`Missing ${key}`);
  const connection = await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),
    user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,multipleStatements:false});
  try {
    const statements = await migrateRobotHandover(connection, {apply:args.includes('--apply')});
    process.stdout.write(`${args.includes('--apply') ? 'Applied' : 'Planned'} ${statements.length} additive DDL statements.\n`);
    for (const sql of statements) process.stdout.write(`${sql};\n`);
  } finally { await connection.end(); }
}
main().catch(() => { process.stderr.write('Handover migration failed; verify schema, permissions and connection settings. No baseline was run.\n'); process.exitCode=1; });
