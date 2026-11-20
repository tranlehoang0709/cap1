'use strict';
// Creates new, uniquely named empty test databases. Never copies local user data
// and never drops databases. All names are reported for subsequent inspection.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const mysql=require('mysql2/promise');
require('dotenv').config({path:path.resolve(__dirname,'../.env'),quiet:true});
const {migratePa10Subtasks}=require('../src/database/migrations/20261115_pa10_subtasks.cjs');
const {migrateGroupI}=require('../src/database/migrations/20261115_group_i.cjs');
const {migratePaSoftDelete}=require('../src/database/migrations/20261120_pa_soft_delete.cjs');
const {migratePaCalendarCompat}=require('../src/database/migrations/20261120_pa_calendar_compat.cjs');

async function main(){
  const suffix=Date.now().toString(36)+'_'+randomBytes(3).toString('hex');
  const databases={crud:'aiva_pa_test_'+suffix,sweep:'aiva_pa_sweep_test_'+suffix,repro:'aiva_pa_repro_test_'+suffix};
  const c=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),
    user:process.env.DB_USER,password:process.env.DB_PASSWORD,timezone:'Z'});
  try{
    for(const name of Object.values(databases)){
      if(!/^aiva_pa_(?:sweep_|repro_)?test_[a-z0-9_]+$/.test(name))throw new Error('Unsafe test database name');
      await c.query('CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',[name]);
    }
    await c.changeUser({database:databases.sweep});
    // Only execute the branch's baseline inside the new empty test database.
    const baseline=fs.readFileSync(path.resolve(__dirname,'../src/database/AIVA_IoT_V1_5_CREATE_MYSQL.sql'),'utf8')
      .replace(/^\s*--[^\r\n]*$/gm,'').replace(/^\s*CREATE DATABASE[^\r\n]*$/gm,'').replace(/^\s*USE[^\r\n]*$/gm,'');
    for(const statement of baseline.split(';').map(s=>s.trim()).filter(Boolean)){
      if(!/^(CREATE TABLE|ALTER TABLE|INSERT INTO|SELECT)\b/i.test(statement))throw new Error('Unsafe baseline statement');
      await c.query(statement);
    }
    await migratePa10Subtasks(c,{apply:true});
    await migrateGroupI(c,{apply:true});
    await migratePaSoftDelete(c,{apply:true});
    const calendarPlan=await migratePaCalendarCompat(c);
    await migratePaCalendarCompat(c,{apply:true});
    assert.deepEqual(await migratePaSoftDelete(c),[]);
    assert.deepEqual(await migratePaCalendarCompat(c,{apply:true}),[]);
    await require('../src/database/migrations/20261120_pa08_web_context.cjs').migratePa08WebContext(c,{apply:true});
    console.log(JSON.stringify({databases,calendarMigrationStatements:calendarPlan.length,migrationRerun:'PASS'}));

    await c.changeUser({database:databases.repro});
    await c.query('CREATE TABLE personal_tasks(id BIGINT PRIMARY KEY,user_id BIGINT NOT NULL,due_at DATETIME NULL) ENGINE=InnoDB');
    await c.query('CREATE TABLE personal_plans(id BIGINT PRIMARY KEY) ENGINE=InnoDB');
    await c.query('INSERT INTO personal_tasks(id,user_id,due_at) VALUES(1,1,NULL)');
    const failingSql='SELECT DISTINCT user_id FROM personal_tasks WHERE deleted_at IS NULL AND due_at IS NOT NULL';
    await assert.rejects(c.execute(failingSql),error=>error.code==='ER_BAD_FIELD_ERROR'&&error.message==="Unknown column 'deleted_at' in 'where clause'");
    const repair=await migratePaSoftDelete(c);
    assert.equal(repair.length,2);
    await migratePaSoftDelete(c,{apply:true});
    assert.deepEqual(await migratePaSoftDelete(c,{apply:true}),[]);
    await c.execute(failingSql);
    const[retained]=await c.query('SELECT id,user_id,due_at,deleted_at FROM personal_tasks');
    assert.equal(retained.length,1);assert.equal(Number(retained[0].id),1);assert.equal(Number(retained[0].user_id),1);
    console.log(JSON.stringify({missingDeletedAtReproduced:true,additiveRepair:'PASS',existingRowPreserved:true}));
  }finally{await c.end();}
  const env={...process.env,NODE_ENV:'test',PA_CRUD_TEST_DATABASE:databases.crud,PA_SWEEP_TEST_DATABASE:databases.sweep,
    PA_TEST_HOST:process.env.DB_HOST,PA_TEST_PORT:process.env.DB_PORT,PA_TEST_USER:process.env.DB_USER,PA_TEST_PASSWORD:process.env.DB_PASSWORD};
  // Run every suite in the default Backend Jest configuration, not a filtered subset.
  const result=spawnSync(process.execPath,[require.resolve('jest/bin/jest'),'--runInBand','--json',
    '--outputFile='+path.resolve(__dirname,'../.pa-local/jest-all.json')],{cwd:path.resolve(__dirname,'..'),env,stdio:'inherit'});
  const dir=path.resolve(__dirname,'../.pa-local');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'test-databases.json'),JSON.stringify(databases,null,2));
  if(result.error)throw result.error;
  process.exitCode=result.status??1;
}
main().catch(error=>{console.error('Isolated PA run failed: '+(error.code||error.name));process.exitCode=1;});
