'use strict';
// SELECT, metadata and PREPARE only. Never executes repository DML.
require('reflect-metadata');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

function repositorySql(source) {
  const ast = ts.createSourceFile('repository.ts', source, ts.ScriptTarget.Latest, true);
  const metrics = source.match(/const TASK_SUBTASK_METRICS_SELECT = `([\s\S]*?)`;/)?.[1] || '';
  const substitutions = { TASK_SUBTASK_METRICS_SELECT: metrics, lockClause: '', whereSql: '1=0',
    where: '1=0', orderBySql: 't.id', excludeSql: '', "clauses.join(' AND ')": 'user_id = ?',
    "excludeId ? ' AND id <> ?' : ''": ' AND id <> ?', "status ? ' AND d.status = ?' : ''": ' AND d.status = ?' };
  const queries = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        ['execute', 'query'].includes(node.expression.name.text) && node.arguments.length) {
      const arg = node.arguments[0];
      let sql;
      if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) sql = arg.text;
      else if (ts.isTemplateExpression(arg)) {
        sql = arg.head.text;
        for (const span of arg.templateSpans) {
          const key = span.expression.getText(ast);
          if (!(key in substitutions)) throw new Error('Unsupported SQL template; audit must be updated');
          sql += substitutions[key] + span.literal.text;
        }
      }
      if (sql && /^\s*(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql)) {
        queries.push({ sql, line: ast.getLineAndCharacterOfPosition(arg.getStart(ast)).line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return queries;
}

async function backendPool() {
  const { ConfigService } = require('@nestjs/config');
  const configuration = require('../dist/config/configuration').default();
  const { DatabaseModule } = require('../dist/database/database.module');
  const { MYSQL_POOL } = require('../dist/database/database.constants');
  const factory = Reflect.getMetadata('providers', DatabaseModule).find(p => p.provide === MYSQL_POOL);
  const pool = factory.useFactory(new ConfigService(configuration));
  return { pool, configuration };
}

async function snapshot(connection, reference) {
  const [columns] = await connection.query(`SELECT TABLE_NAME AS t,COLUMN_NAME AS n FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION`);
  const result = {};
  for (const table of [...new Set(columns.map(c => c.t))]) {
    const names = reference?.[table]?.columns || columns.filter(c => c.t === table).map(c => c.n);
    const [rows] = await connection.query(`SELECT ${names.map(n=>'`'+n+'`').join(',')} FROM \`${table}\``);
    const serialized = rows.map(row => JSON.stringify(row)).sort();
    result[table] = { columns: names, count: rows.length,
      sha256: createHash('sha256').update(JSON.stringify(serialized)).digest('hex') };
  }
  return result;
}

async function main() {
  const { pool, configuration } = await backendPool();
  const c = await pool.getConnection();
  try {
    const [identity] = await c.query('SELECT DATABASE() AS db,VERSION() AS version,@@hostname AS server,@@port AS port');
    if (identity[0].db !== configuration.database.name) throw new Error('Backend connection identity mismatch');
    const result = { identity: identity[0], configuredHost: configuration.database.host, configuredPort: configuration.database.port };
    const [columns] = await c.query(`SELECT TABLE_NAME AS t,COLUMN_NAME AS n,COLUMN_TYPE AS type,
      IS_NULLABLE AS nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()`);
    result.paColumns = columns.filter(c => /^(personal_|reminder_deliveries$)/.test(c.t));
    result.migrationPlans = {};
    for (const [file, fn] of [
      ['20261114_personal_assistant.cjs','migratePersonalAssistant'], ['20261115_pa10_subtasks.cjs','migratePa10Subtasks'],
      ['20261115_group_i.cjs','migrateGroupI'], ['20261117_pa04_pa06_pa08.cjs','migratePa04Pa06Pa08'],
      ['20261120_pa_soft_delete.cjs','migratePaSoftDelete'], ['20261120_pa_calendar_compat.cjs','migratePaCalendarCompat'],
    ]) result.migrationPlans[file] = await require('../src/database/migrations/'+file)[fn](c);
    result.prepare = [];
    for (const [name, source] of [
      ['origin/tichhopv1 PA', execFileSync('git',['show','origin/tichhopv1:BE/src/modules/personal-assistant/personal-assistant.repository.ts'],{encoding:'utf8'})],
      ['current PA',fs.readFileSync(path.resolve(__dirname,'../src/modules/personal-assistant/personal-assistant.repository.ts'),'utf8')],
      ['current Calendar',fs.readFileSync(path.resolve(__dirname,'../src/modules/calendar/calendar.repository.ts'),'utf8')],
    ]) {
      const queries = repositorySql(source), failed = [];
      for (const q of queries) {
        try { await c.prepare(q.sql); await c.unprepare(q.sql); }
        catch (error) { failed.push({line:q.line, code:error.code, sql:q.sql}); }
      }
      result.prepare.push({ name, total:queries.length, passed:queries.length-failed.length, failed });
      if (failed.length && !process.argv.includes('--before')) process.exitCode=1;
    }
    await c.query('START TRANSACTION READ ONLY');
    const [eligible] = await c.execute('SELECT DISTINCT user_id FROM personal_tasks WHERE deleted_at IS NULL AND due_at IS NOT NULL');
    result.sweepInitialSelect = { passed:true, eligibleUsers:eligible.length };
    const dir = path.resolve(__dirname,'../.pa-local');
    fs.mkdirSync(dir,{recursive:true});
    const beforePath = path.join(dir,'before.json');
    if (process.argv.includes('--before')) {
      if (fs.existsSync(beforePath)) throw new Error('Refusing to overwrite existing before snapshot');
      const data = await snapshot(c);
      fs.writeFileSync(beforePath,JSON.stringify({identity:identity[0],tables:data},null,2));
      // Backup only PA data, never print it or commit it.
      const backup = {};
      for (const table of Object.keys(data).filter(t=>/^(personal_|reminder_deliveries$)/.test(t))) {
        const [ddl] = await c.query('SHOW CREATE TABLE ??',[table]);
        const [rows] = await c.query('SELECT * FROM ??',[table]);
        backup[table] = { ddl:Object.values(ddl[0])[1], rows };
      }
      fs.writeFileSync(path.join(dir,'pa-backup.json'),JSON.stringify(backup));
      result.snapshot = { saved:true, tables:Object.keys(data).length };
    }
    if (process.argv.includes('--compare')) {
      const before = JSON.parse(fs.readFileSync(beforePath));
      if (before.identity.db !== identity[0].db || before.identity.server !== identity[0].server) throw new Error('Snapshot server mismatch');
      const after = await snapshot(c,before.tables);
      const changed = Object.keys(before.tables).filter(t=>!after[t] || before.tables[t].sha256 !== after[t].sha256);
      result.originalData = { comparedTables:Object.keys(before.tables).length, changedTables:changed };
      if (changed.length) process.exitCode=1;
    }
    await c.rollback();
    const output = path.join(dir,process.argv.includes('--before')?'audit-before.json':'audit-after.json');
    fs.writeFileSync(output,JSON.stringify(result,null,2));
    console.log(JSON.stringify({identity:result.identity,migrationPlans:result.migrationPlans,
      prepare:result.prepare.map(p=>({name:p.name,total:p.total,passed:p.passed,failed:p.failed.map(f=>({line:f.line,code:f.code}))})),
      sweepInitialSelect:result.sweepInitialSelect,originalData:result.originalData,snapshot:result.snapshot},null,2));
  } finally { c.release(); await pool.end(); }
}
module.exports = { repositorySql, backendPool, snapshot };
if(require.main === module) main().catch(error=>{console.error('PA audit failed: '+(error.code || error.name));process.exitCode=1;});
