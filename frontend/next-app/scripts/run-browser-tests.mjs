// Test-only production host. Owns its HTTP server; never stops another service.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const run=(module,args)=>new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[require.resolve(module),...args],{stdio:'inherit',env:process.env});
 child.once('error',reject);child.once('exit',code=>resolve(code??1));
});
const built=await run('next/dist/bin/next',['build']);
if(built!==0)process.exit(built);
process.env.NODE_ENV='production';
const {default:next}=await import('next');
let server,app,handle;
let code=1;
try{
 // An ephemeral loopback port keeps tests independent of the user's dev server.
 server=createServer((req,res)=>handle?handle(req,res):res.writeHead(503).end());
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const address=server.address();
 if(!address||typeof address==='string')throw new Error('Test host did not receive a TCP port.');
 const port=address.port;
 process.env.AIVA_TEST_BASE_URL=`http://127.0.0.1:${port}`;
 app=next({dev:false,hostname:'127.0.0.1',port});
 await app.prepare();handle=app.getRequestHandler();
 console.log(`Test-only AIVA production host: ${process.env.AIVA_TEST_BASE_URL}`);
 code=await run('@playwright/test/cli',['test',...process.argv.slice(2)]);
}catch(error){console.error(error instanceof Error?error.message:'Browser test host failed.');}
finally{
 if(server?.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 await app?.close();
}
process.exit(code);
