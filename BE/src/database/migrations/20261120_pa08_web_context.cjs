'use strict';
// Additive only; no backfill or changes to existing conversations/messages.
const ddl = `CREATE TABLE IF NOT EXISTS pa08_web_turns (
  user_id BIGINT NOT NULL,
  request_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  conversation_id BIGINT NOT NULL,
  content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(24) NOT NULL,
  response_json JSON NULL,
  created_at DATETIME NOT NULL,
  completed_at DATETIME NULL,
  PRIMARY KEY(user_id,request_id),
  KEY idx_pa08_turn_conversation(conversation_id),
  CONSTRAINT fk_pa08_turn_user FOREIGN KEY(user_id) REFERENCES users(id),
  CONSTRAINT fk_pa08_turn_conversation FOREIGN KEY(conversation_id) REFERENCES conversations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
async function migratePa08WebContext(connection,{apply=false}={}) {
  const [existing]=await connection.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pa08_web_turns'");
  if(existing.length) {
    const [columns]=await connection.query(`SELECT COLUMN_NAME AS name,COLUMN_TYPE AS type,IS_NULLABLE AS nullable,
      COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pa08_web_turns'`);
    const expected={user_id:['bigint','NO'],request_id:['varchar(128)','NO'],conversation_id:['bigint','NO'],
      content_hash:['char(64)','NO'],status:['varchar(24)','NO'],response_json:['json','YES'],
      created_at:['datetime','NO'],completed_at:['datetime','YES']};
    for(const [name,[type,nullable]] of Object.entries(expected)) {
      const c=columns.find(c=>c.name===name);
      if(!c||c.type!==type||c.nullable!==nullable||(['request_id','content_hash'].includes(name)&&c.collation!=='ascii_bin'))
        throw new Error('Incompatible pa08_web_turns column: '+name);
    }
    const [indexes]=await connection.query(`SELECT INDEX_NAME AS name,COLUMN_NAME AS col,SEQ_IN_INDEX AS pos
      FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pa08_web_turns' ORDER BY SEQ_IN_INDEX`);
    if(JSON.stringify(indexes.filter(i=>i.name==='PRIMARY').map(i=>i.col))!==JSON.stringify(['user_id','request_id'])||
       !indexes.some(i=>i.name==='idx_pa08_turn_conversation'&&i.col==='conversation_id'))throw new Error('Incompatible pa08_web_turns indexes');
    const [fk]=await connection.query(`SELECT COLUMN_NAME AS col,REFERENCED_TABLE_NAME AS parent,REFERENCED_COLUMN_NAME AS target
      FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pa08_web_turns' AND REFERENCED_TABLE_NAME IS NOT NULL`);
    if(!fk.some(f=>f.col==='user_id'&&f.parent==='users'&&f.target==='id')||
       !fk.some(f=>f.col==='conversation_id'&&f.parent==='conversations'&&f.target==='id'))throw new Error('Incompatible pa08_web_turns foreign keys');
    return [];
  }
  if(apply) await connection.query(ddl);
  return [ddl];
}
module.exports={migratePa08WebContext};
