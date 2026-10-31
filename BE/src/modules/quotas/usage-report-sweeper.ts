import { Injectable,Logger,OnApplicationBootstrap,OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QuotasService } from './quotas.service';
@Injectable()
export class UsageReportSweeper implements OnApplicationBootstrap,OnApplicationShutdown {
  private timer?:ReturnType<typeof setInterval>;private running:Promise<unknown>|null=null;private readonly logger=new Logger(UsageReportSweeper.name);
  constructor(private readonly quotas:QuotasService,private readonly config:ConfigService){}
  onApplicationBootstrap(){if(this.config.get<string>('AI_USAGE_REPORT_SWEEPER_ENABLED')!=='true')return;
    const interval=this.quotas.reportTimeoutSeconds()*1000;
    this.timer=setInterval(()=>{if(!this.running)this.running=this.quotas.markMissingReports().catch(()=>this.logger.error('Usage report sweep failed; retained reservations will be retried'))
      .finally(()=>{this.running=null;});},interval);this.timer.unref();}
  async onApplicationShutdown(){if(this.timer)clearInterval(this.timer);if(this.running)await this.running;}
}
