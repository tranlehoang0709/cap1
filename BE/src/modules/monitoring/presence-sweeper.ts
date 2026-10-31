import { Injectable,Logger,OnApplicationBootstrap,OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MonitoringService } from './monitoring.service';

@Injectable()
export class PresenceSweeper implements OnApplicationBootstrap,OnApplicationShutdown {
  private timer?:ReturnType<typeof setInterval>;
  private running:Promise<void>|null=null;
  private readonly logger=new Logger(PresenceSweeper.name);
  constructor(private readonly monitoring:MonitoringService,private readonly config:ConfigService){}
  onApplicationBootstrap(){
    if(this.config.get<string>('HEARTBEAT_SWEEPER_ENABLED')==='false')return;
    const interval=this.monitoring.timeoutSeconds()*1000;
    this.timer=setInterval(()=>{if(!this.running)this.running=this.monitoring.markExpiredDevicesOffline()
      .catch(()=>{this.logger.error('Presence sweep failed; will retry next interval');}).finally(()=>{this.running=null;});},interval);
    this.timer.unref();
  }
  async onApplicationShutdown(){if(this.timer)clearInterval(this.timer);if(this.running)await this.running;}
}
