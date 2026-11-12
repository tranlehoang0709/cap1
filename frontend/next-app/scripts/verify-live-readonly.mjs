// Live read-only checks. No route interception, fixture service, login, or data mutation.
import {chromium} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const result={kind:'LIVE_READ_ONLY_NO_MOCK',timestamp:new Date().toISOString(),checks:[],browserErrors:[]};
const frontend='http://127.0.0.1:3100',backend='http://127.0.0.1:3000';
for(const endpoint of ['/health','/auth/me','/users','/devices/admin/all','/devices/admin/pairing-requests','/ai/providers','/admin/ai/models','/admin/api-keys/system','/admin/quotas','/admin/ai/usage','/conversations','/admin/monitoring/instances','/admin/logs','/admin/audit-logs','/admin/system-settings']){
 const r=await fetch(backend+endpoint,{signal:AbortSignal.timeout(5000)});let data;try{data=await r.json();}catch{}
 const ok=endpoint==='/health'?r.status===200&&data?.status==='ok':[401,403].includes(r.status);
 result.checks.push({endpoint,status:r.status,responseKeys:data&&typeof data==='object'?Object.keys(data):[],expected: endpoint==='/health'?'health ok':'deny unauthenticated request',result:ok?'PASS':'FAIL'});
}
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();page.on('pageerror',e=>result.browserErrors.push(e.message));
 for(const pathname of ['/user/dashboard','/admin/dashboard']){await page.goto(frontend+pathname);await page.waitForURL('**/login');result.checks.push({endpoint:pathname,finalPath:new URL(page.url()).pathname,result:'PASS',verified:'real browser redirect without credentials'});}
 const noSession=await page.request.post(frontend+'/api/backend',{headers:{Origin:frontend},data:{operation:'dashboard'}});
 result.checks.push({endpoint:'/api/backend',scenario:'no session',status:noSession.status(),result:noSession.status()===401?'PASS':'FAIL'});
 const foreignOrigin=await page.request.post(frontend+'/api/backend',{headers:{Origin:'https://untrusted.invalid'},data:{operation:'dashboard'}});
 result.checks.push({endpoint:'/api/backend',scenario:'cross-origin denied',status:foreignOrigin.status(),result:foreignOrigin.status()===403?'PASS':'FAIL'});
 await page.screenshot({path:path.resolve('../../artifacts/real-integration/live-login.png'),fullPage:true});
}finally{await browser.close();}
fs.writeFileSync(path.resolve('../../artifacts/real-integration/live-browser.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(result.checks.some(x=>x.result==='FAIL')||result.browserErrors.length)process.exitCode=1;
