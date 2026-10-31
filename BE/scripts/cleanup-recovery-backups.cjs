// Default is dry-run. --execute performs the explicitly requested 7-day cleanup.
require('reflect-metadata');
process.env.HEARTBEAT_SWEEPER_ENABLED='false';
const {NestFactory}=require('@nestjs/core');
const {AppModule}=require('../dist/app.module');
const {RecoveryRepository}=require('../dist/modules/device-recovery/recovery.repository');
const {RecoveryService}=require('../dist/modules/device-recovery/recovery.service');
async function main(){const app=await NestFactory.createApplicationContext(AppModule,{logger:false});
  try{
    if(!process.argv.includes('--execute')){
      const ids=await app.get(RecoveryRepository).expiredIds();console.log(JSON.stringify({dryRun:true,expiredInNextBatch:ids.length,batchLimit:100}));
    }else{console.log(JSON.stringify(await app.get(RecoveryService).cleanupExpiredBackups()));}
  }finally{await app.close();}}
main().catch(error=>{console.error('Recovery cleanup failed:',error.code||error.name);process.exitCode=1;});
