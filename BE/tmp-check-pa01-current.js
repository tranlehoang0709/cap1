require('dotenv').config();
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,dateStrings:true});
  const [db] = await c.query('SELECT DATABASE() db, UTC_TIMESTAMP() utc_now');
  const [events] = await c.execute(`SELECT id,user_id,title,start_at,end_at,timezone,deleted_at,created_at,updated_at FROM personal_events WHERE user_id=? ORDER BY id DESC LIMIT 15`, [2]);
  console.log(JSON.stringify({connection:db[0],events}, null, 2));
  await c.end();
})().catch(e => { console.error(e.code || e.message); process.exit(1); });
