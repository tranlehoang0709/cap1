import { Inject,Injectable } from '@nestjs/common';
import { Pool,PoolConnection,RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL } from '../../database/database.constants';
import { OwnershipTransaction } from '../devices/ownership.repository';
import { HeartbeatEvent } from './dto/heartbeat.dto';

@Injectable()
export class MonitoringRepository {
  constructor(@Inject(MYSQL_POOL)private readonly pool:Pool){}
  async transaction<T>(work:(tx:MonitoringTransaction)=>Promise<T>):Promise<T>{
    const c=await this.pool.getConnection();
    try{await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await c.beginTransaction();
      try{const result=await work(new MonitoringTransaction(this.pool,c));await c.commit();return result;}
      catch(error){try{await c.rollback();}catch(rollback){throw new AggregateError([error,rollback],'Monitoring rollback failed');}throw error;}
    }finally{c.release();}
  }
  async markExpiredDevicesOffline(timeoutSeconds:number):Promise<void>{
    // UPDATE rechecks the current row after waiting for a heartbeat's device lock.
    // Do not read IDs first and later overwrite a freshly reconnected device.
    await this.pool.execute(`UPDATE devices SET connection_status='offline',updated_at=UTC_TIMESTAMP()
      WHERE connection_status<>'offline' AND (last_seen_at IS NULL
      OR last_seen_at<=DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? SECOND))`,[timeoutSeconds]);
  }
}
export class MonitoringTransaction {
  readonly ownership:OwnershipTransaction;
  constructor(pool:Pool,private readonly c:PoolConnection){this.ownership=new OwnershipTransaction(pool,c);}
  async presence(deviceId:string):Promise<{lastSeenAt:Date|null;now:Date}|null>{
    const [rows]=await this.c.execute<RowDataPacket[]>(`SELECT last_seen_at AS lastSeenAt,UTC_TIMESTAMP() AS now
      FROM devices WHERE id=? FOR UPDATE`,[deviceId]);
    return (rows[0] as {lastSeenAt:Date|null;now:Date}|undefined)??null;
  }
  async updateDevicePresence(deviceId:string,timestamp:Date):Promise<void>{
    await this.c.execute(`UPDATE devices SET last_seen_at=?,connection_status='online',updated_at=UTC_TIMESTAMP()
      WHERE id=? AND (last_seen_at IS NULL OR last_seen_at<?)`,[timestamp,deviceId,timestamp]);
  }
  async saveDeviceTelemetry(deviceId:string,event:HeartbeatEvent):Promise<void>{
    if(!event.telemetry)return;
    const t=event.telemetry;
    await this.c.execute(`INSERT INTO device_telemetry(device_id,event_type,wifi_rssi,free_heap_bytes,battery_percent,payload,recorded_at)
      VALUES(?,'heartbeat',?,?,?,?,?)`,[deviceId,t.wifiRssi,t.freeHeapBytes,t.batteryPercent,t.payload?JSON.stringify(t.payload):null,event.observedAt]);
  }
  async markDeviceOffline(deviceId:string,now:Date,timeoutSeconds:number):Promise<void>{
    const cutoff=new Date(now.getTime()-timeoutSeconds*1000);
    await this.c.execute(`UPDATE devices SET connection_status='offline',updated_at=UTC_TIMESTAMP()
      WHERE id=? AND connection_status<>'offline' AND (last_seen_at IS NULL OR last_seen_at<=? OR last_seen_at>?)`,[deviceId,cutoff,now]);
  }
  async telemetry(deviceId:string):Promise<{wifiRssi:number|null;freeHeapBytes:string|null;batteryPercent:number|null}>{
    const [rows]=await this.c.execute<RowDataPacket[]>(`SELECT wifi_rssi AS wifiRssi,CAST(free_heap_bytes AS CHAR) AS freeHeapBytes,
      battery_percent AS batteryPercent FROM device_telemetry WHERE device_id=? AND event_type='heartbeat'
      ORDER BY recorded_at DESC,id DESC LIMIT 1`,[deviceId]);
    const r=rows[0];return r?{wifiRssi:r.wifiRssi,freeHeapBytes:r.freeHeapBytes,batteryPercent:r.batteryPercent}:{wifiRssi:null,freeHeapBytes:null,batteryPercent:null};
  }
}
