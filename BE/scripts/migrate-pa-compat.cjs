'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {backendPool,snapshot}=require('./audit-pa-schema.cjs');
const {migratePaSoftDelete}=require('../src/database/migrations/20261120_pa_soft_delete.cjs');
const {migratePaCalendarCompat}=require('../src/database/migrations/20261120_pa_calendar_compat.cjs');

async function main(){
  const apply=process.argv.includes('--apply');
  const migrations=process.argv.includes('--soft-delete-only')
    ? [migratePaSoftDelete] : [migratePaSoftDelete,migratePaCalendarCompat];
  const index=process.argv.indexOf('--database');
  const target=index<0?null:process.argv[index+1];
  const {pool}=await backendPool();
  const c=await pool.getConnection();let locked=false;
  try{
    const[identity]=await c.query('SELECT DATABASE() AS db,@@hostname AS server');
    if(!target || target!==identity[0].db)throw new Error('Explicit --database must match the actual Backend database');
    const[lock]=await c.execute('SELECT GET_LOCK(?,10) AS acquired',['pa_compat_'+target]);
    if(Number(lock[0].acquired)!==1)throw new Error('Migration lock unavailable');locked=true;
    const planned=[];
    for(const migration of migrations)planned.push(...await migration(c));
    if(apply && planned.length){
      const dir=path.resolve(__dirname,'../.pa-local');fs.mkdirSync(dir,{recursive:true});
      const before=await snapshot(c);
      const backup={};
      for(const name of Object.keys(before).filter(t=>/^(personal_|reminder_deliveries$)/.test(t))){
        const[ddl]=await c.query('SHOW CREATE TABLE ??',[name]);const[rows]=await c.query('SELECT * FROM ??',[name]);
        backup[name]={ddl:Object.values(ddl[0])[1],rows};
      }
      const file=path.join(dir,'pre-migration-'+Date.now()+'.json');
      fs.writeFileSync(file,JSON.stringify({identity:identity[0],snapshot:before,backup}));
      for(const migration of migrations)await migration(c,{apply:true});
      const after=await snapshot(c,before);
      const changed=Object.keys(before).filter(t=>before[t].sha256!==after[t]?.sha256);
      if(changed.length)throw new Error('Original table data changed; inspect local backup before proceeding');
      console.log(JSON.stringify({applied:planned.length,originalDataUnchanged:true,comparedTables:Object.keys(before).length}));
    }else console.log(JSON.stringify({apply,planned}));
    const remaining=[];
    for(const migration of migrations)remaining.push(...await migration(c));
    if(apply&&remaining.length)throw new Error('Migration postcondition failed');
  }finally{
    if(locked)await c.execute('SELECT RELEASE_LOCK(?)',['pa_compat_'+target]);
    c.release();await pool.end();
  }
}
main().catch(error=>{console.error('PA migration stopped: '+(error.code||error.message));process.exitCode=1;});
