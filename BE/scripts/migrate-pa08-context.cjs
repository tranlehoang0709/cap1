'use strict';
const {backendPool}=require('./audit-pa-schema.cjs');
const {migratePa08WebContext}=require('../src/database/migrations/20261120_pa08_web_context.cjs');
(async()=>{
 const i=process.argv.indexOf('--database'),name=i<0?null:process.argv[i+1];
 const {pool}=await backendPool();let c;
 try {
  c=await pool.getConnection();
  const [r]=await c.query('SELECT DATABASE() AS db');
  if(!name||name!==r[0].db)throw Error('Explicit --database must match actual Backend database');
  const apply=process.argv.includes('--apply');
  const statements=await migratePa08WebContext(c,{apply});
  console.log(JSON.stringify({database:name,apply,statements}));
 }finally{if(c)c.release();await pool.end();}
})().catch(e=>{console.error(e.code||e.message);process.exitCode=1});
