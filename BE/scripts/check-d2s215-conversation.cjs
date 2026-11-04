// Read-only persistence check. No transcript, email or credential output.
require('dotenv').config({quiet:true});
const mysql=require('mysql2/promise');
(async()=>{
 const id=process.argv[2];if(!/^[1-9][0-9]{0,18}$/.test(id||''))throw new Error('Supply conversation ID');
 let c;
 try {
  c=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,
   password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectTimeout:4000});
  const [rows]=await c.execute(`SELECT c.status,c.channel,p.save_history AS saveHistory,
   (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id AND m.role='user') AS userMessages,
   (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id AND m.role='assistant') AS assistantMessages,
   (SELECT COUNT(*) FROM ai_sessions s WHERE s.conversation_id=c.id AND s.status='completed') AS completedSessions,
   (SELECT COUNT(*) FROM usage_records r WHERE r.conversation_id=c.id AND r.request_id IS NOT NULL AND r.finalized_at IS NOT NULL AND r.status='success' AND r.input_tokens IS NOT NULL AND r.output_tokens IS NOT NULL) AS settledUsage
   FROM conversations c JOIN privacy_preferences p ON p.user_id=c.user_id WHERE c.id=?`,[id]);
  const r=rows[0];console.log(r||'No matching conversation');
  if(!r||r.status!=='completed'||Number(r.completedSessions)!==1||Number(r.settledUsage)!==1||
    Number(r.userMessages)!==(r.saveHistory?1:0)||Number(r.assistantMessages)!==(r.saveHistory?1:0))process.exitCode=2;
  else console.log('PASS: completed conversation/session, expected messages and settled actual usage.');
 } catch(e){console.log('Verification blocked:',e.code||e.name);process.exitCode=2;}
 finally {if(c)await c.end();}
})().catch(()=>{console.log('Supply a valid conversation ID');process.exitCode=2;});
