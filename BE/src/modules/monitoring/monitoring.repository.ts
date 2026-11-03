import {Inject,Injectable} from '@nestjs/common';
import {Pool,RowDataPacket} from 'mysql2/promise';
import {MYSQL_POOL} from '../../database/database.constants';
@Injectable()
export class MonitoringRepository {
  constructor(@Inject(MYSQL_POOL)private pool:Pool){}
  async dashboard(){const q=async(sql:string)=>{const[r]=await this.pool.execute<RowDataPacket[]>(sql);return Number(r[0]?.total??0)};
    return {users:await q('SELECT COUNT(*) total FROM users'),devices:await q('SELECT COUNT(*) total FROM devices'),
      assigned_devices:await q("SELECT COUNT(*) total FROM devices WHERE lifecycle_status='assigned'"),online_devices:await q("SELECT COUNT(*) total FROM devices WHERE connection_status='online'"),
      conversations:await q('SELECT COUNT(*) total FROM conversations WHERE deleted_at IS NULL'),usage_today:await q('SELECT COUNT(*) total FROM usage_records WHERE occurred_at>=CURRENT_DATE'),generated_at:new Date().toISOString()};}
  async instances(){const [r]=await this.pool.execute<RowDataPacket[]>('SELECT id,instance_code,status,last_healthcheck_at,started_at FROM ai_server_instances ORDER BY instance_code');return r;}
  async transaction<T>(work:(tx:MonitoringTransaction)=>Promise<T>):Promise<T>{
    const c=await this.pool.getConnection();try{await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await c.beginTransaction();
      try{const result=await work(new MonitoringTransaction(this.pool,c));await c.commit();return result;}
      catch(e){try{await c.rollback();}catch(rollback){throw new AggregateError([e,rollback]);}throw e;}
    }finally{c.release();}
  }
  async markExpiredDevicesOffline(seconds:number){await this.pool.execute(`UPDATE devices SET connection_status='offline'
    WHERE connection_status='online' AND (last_seen_at IS NULL OR last_seen_at<=DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? SECOND))`,[seconds]);}
}
import { PoolConnection } from 'mysql2/promise';
import { OwnershipTransaction } from '../devices/ownership.repository';
import { HeartbeatEvent } from './dto/heartbeat.dto';

export class MonitoringTransaction {
  readonly ownership: OwnershipTransaction;
  constructor(pool:Pool,private readonly c:PoolConnection){this.ownership=new OwnershipTransaction(pool,c);}
  async presence(deviceId:string):Promise<{lastSeenAt:Date|null;now:Date}>{
    const [rows]=await this.c.execute<RowDataPacket[]>('SELECT last_seen_at AS lastSeenAt,UTC_TIMESTAMP() AS now FROM devices WHERE id=? FOR UPDATE',[deviceId]);
    if(!rows[0])throw new Error('Device not found');return rows[0] as {lastSeenAt:Date|null;now:Date};
  }
  async updateDevicePresence(id:string,time:Date){await this.c.execute("UPDATE devices SET last_seen_at=?,connection_status='online',updated_at=UTC_TIMESTAMP() WHERE id=? AND (last_seen_at IS NULL OR last_seen_at<?)",[time,id,time]);}
  async markDeviceOffline(id:string,now:Date,seconds:number){await this.c.execute("UPDATE devices SET connection_status='offline' WHERE id=? AND (last_seen_at IS NULL OR last_seen_at<=? OR last_seen_at>?)",[id,new Date(now.getTime()-seconds*1000),now]);}
  async saveDeviceTelemetry(id:string,event:HeartbeatEvent){
    const t=event.telemetry;if(!t)return;
    await this.c.execute("INSERT INTO device_telemetry(device_id,event_type,wifi_rssi,free_heap_bytes,battery_percent,payload,recorded_at) VALUES(?,'heartbeat',?,?,?,?,?)",
      [id,t.wifiRssi,t.freeHeapBytes,t.batteryPercent,t.payload===null?null:JSON.stringify(t.payload),event.observedAt]);
  }
  async telemetry(id:string){const [rows]=await this.c.execute<RowDataPacket[]>(`SELECT wifi_rssi AS wifiRssi,CAST(free_heap_bytes AS CHAR) AS freeHeapBytes,battery_percent AS batteryPercent
    FROM device_telemetry WHERE device_id=? ORDER BY recorded_at DESC,id DESC LIMIT 1`,[id]);return rows[0]??{wifiRssi:null,freeHeapBytes:null,batteryPercent:null};}
}
