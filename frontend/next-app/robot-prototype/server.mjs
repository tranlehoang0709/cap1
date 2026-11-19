import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('./',import.meta.url));
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
export function createPreviewServer(port=Number(process.env.PORT||3200)){
 const server=createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root)||pathname.includes('..')||pathname.includes('\\')||!['/index.html','/style.css','/src/','/node_modules/three/'].some(p=>pathname==='/'||pathname.startsWith(p))){res.writeHead(404).end();return;}const content=await readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(content);}catch{res.writeHead(404).end('Not found');}});
 return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>resolve(server));});
}
if(process.argv[1]===fileURLToPath(import.meta.url)){await createPreviewServer();console.log('AIVA Robot Lab → http://127.0.0.1:'+(process.env.PORT||3200));}
