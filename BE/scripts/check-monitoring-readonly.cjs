// Metadata, SELECT, EXPLAIN and PREPARE only. No execution of DML, fixtures or sweeper.
require('reflect-metadata');
const mysql=require('mysql2/promise');const fs=require('node:fs');const {parse}=require('dotenv');
const {MonitoringRepository}=require('../dist/modules/monitoring/monitoring.repository');
async function main(){const e={...parse(fs.readFileSync('.env')),...process.env};
  const pool=mysql.createPool({host:e.DB_HOST,port:Number(e.DB_PORT),user:e.DB_USER,password:e.DB_PASSWORD,database:e.DB_NAME,
    timezone:'Z',supportBigNumbers:true,bigNumberStrings:true,connectTimeout:5000});
  try{
    const [columns]=await pool.query('SHOW COLUMNS FROM device_telemetry');console.log('Telemetry fields:',columns.map(c=>c.Field).join(','));
    const repository=new MonitoringRepository(pool);
    await repository.transaction(async tx=>{await tx.presence('9223372036854775807');await tx.telemetry('9223372036854775807');});
    const [plan]=await pool.execute(`EXPLAIN SELECT wifi_rssi,free_heap_bytes,battery_percent FROM device_telemetry
      WHERE device_id=? AND event_type='heartbeat' ORDER BY recorded_at DESC,id DESC LIMIT 1`,['9223372036854775807']);
    console.log('Telemetry EXPLAIN:',JSON.stringify(plan));
    // PREPARE checks actual DML syntax without running the statements.
    const connection=await pool.getConnection();
    try{
      const statements=[
        `UPDATE devices SET connection_status='offline',updated_at=UTC_TIMESTAMP()
         WHERE connection_status<>'offline' AND (last_seen_at IS NULL OR last_seen_at<=DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? SECOND))`,
        `UPDATE devices SET last_seen_at=?,connection_status='online',updated_at=UTC_TIMESTAMP()
         WHERE id=? AND (last_seen_at IS NULL OR last_seen_at<?)`,
        `INSERT INTO device_telemetry(device_id,event_type,wifi_rssi,free_heap_bytes,battery_percent,payload,recorded_at)
         VALUES(?,'heartbeat',?,?,?,?,?)`
      ];
      for(const statement of statements){await connection.query('PREPARE monitoring_probe FROM ?', [statement]);await connection.query('DEALLOCATE PREPARE monitoring_probe');}
      console.log('DML PREPARE passed; statements NOT executed.');
    }finally{connection.release();}
    console.log('PASS: live monitoring read-only/syntax checks; no data/schema writes.');
  }finally{await pool.end();}}
main().catch(error=>{console.error('Monitoring check failed:',error.code||error.name);process.exitCode=1;});
