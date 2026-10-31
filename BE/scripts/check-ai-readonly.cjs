require('reflect-metadata');
const mysql=require('mysql2/promise');const fs=require('node:fs');const {parse}=require('dotenv');
const {AiProvidersRepository}=require('../dist/modules/ai-providers/ai-providers.repository');
async function main(){const e={...parse(fs.readFileSync('.env')),...process.env};
  const pool=mysql.createPool({host:e.DB_HOST,port:Number(e.DB_PORT),user:e.DB_USER,password:e.DB_PASSWORD,database:e.DB_NAME,
    timezone:'Z',supportBigNumbers:true,bigNumberStrings:true,connectTimeout:5000});
  try{const repository=new AiProvidersRepository(pool);await repository.transaction(async tx=>{
    const providers=await tx.providers();console.log('Enabled provider codes:',providers.map(p=>p.code).join(','));
    for(const p of providers){await tx.provider(p.id);const models=await tx.models(p.id);console.log(p.code,'enabled model count',models.length);}
    const userId='9223372036854775807';await tx.profile(userId);await tx.scope(userId);await tx.model(userId);
    for(const owner of [{scope:'USER',userId},{scope:'SYSTEM',userId:null}]){
      await tx.credentials(owner);await tx.credential(owner,userId);await tx.activeCredential(owner,'2');
    }
    await tx.setting('ai.provider.1.defaults');
  });console.log('PASS: live AI SELECT/locking SQL only; no DML/fixtures or secret output.');}
  finally{await pool.end();}}
main().catch(error=>{console.error('AI check failed:',error.code||error.name);process.exitCode=1;});
