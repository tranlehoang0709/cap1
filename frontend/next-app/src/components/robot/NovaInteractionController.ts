export type AuthView='login'|'register'|'verify';
export type AuthField='email'|'password'|'confirm'|'name'|'verification';
export type AuthOutcome='success'|'credentials'|'network'|'server'|'validation';
export type NovaEvent=
 |{type:'view';view:AuthView}|{type:'focus'|'blur'|'input';field:AuthField}
 |{type:'visibility'}|{type:'submit';view:AuthView}|{type:'result';view:AuthView;outcome:AuthOutcome}
 |{type:'mismatch';invalid:boolean}|{type:'validation'}|{type:'robot-click'}|{type:'interact'}
 |{type:'preview';mode:'idle'|'greeting'|'thinking'|'success'};
export type SmartMode='idle'|'greeting'|'email'|'privacy'|'thinking'|'success'|'dance'|'sad'|'worried'|'confused'|'reaction';
export type SmartOutput={mode:SmartMode;action:'idle'|'wave'|'celebrate'|'dance'|'react';emotion:string;tracking:boolean;caption:string;beast:boolean;idleSeconds:number};
const captions:Record<SmartMode,string>={idle:'NOVA, luôn sẵn sàng bên bạn.',greeting:'Xin chào. Rất vui được gặp bạn!',email:'Mình đang lắng nghe.',privacy:'Mình quay đi khi bạn nhập mật khẩu.',thinking:'Đang chờ hệ thống xác nhận…',success:'Hệ thống đã xác nhận thành công.',dance:'Chào mừng bạn đến với AIVA!',sad:'Chưa thể hoàn tất. Mình vẫn ở đây.',worried:'Kết nối đang gián đoạn. Hãy kiểm tra lại.',confused:'Có thông tin cần bạn kiểm tra lại.',reaction:'Mình thấy bạn rồi!'};
const beastCaption='NOVA Beast Mode · Sẵn sàng bảo vệ không gian của bạn!';
const actions:Partial<Record<SmartMode,SmartOutput['action']>>={greeting:'wave',success:'celebrate',dance:'dance',reaction:'react'};
const emotions:Partial<Record<SmartMode,string>>={greeting:'happy',email:'curious',privacy:'sleepy',thinking:'focused',success:'happy',dance:'happy',sad:'sad',worried:'worried',confused:'worried',reaction:'surprised'};
export const BEAST_IDLE_THRESHOLD=5.0;
/** Only event kinds enter this class. Credentials, tokens and field content never do. */
export class NovaInteractionController{
 private listeners=new Set<()=>void>();private seen=new Set<AuthView>();private view:AuthView='login';private focus:AuthField|null=null;private pending=false;private mismatch=false;private transient:{mode:SmartMode;remaining:number;next?:SmartMode}|null=null;private disposed=false;
 private idleSeconds=0;private beast=false;
 private output:SmartOutput=this.make('idle');
 private make(mode:SmartMode):SmartOutput{
  const isBeast=mode==='idle'&&this.beast;
  return {mode,action:actions[mode]||'idle',emotion:emotions[mode]||'curious',tracking:mode==='idle'||mode==='email',caption:isBeast?beastCaption:captions[mode],beast:isBeast,idleSeconds:Number(this.idleSeconds.toFixed(2))};
 }
 getSnapshot=()=>this.output;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private resolve(){if(this.disposed)return;const mode:SmartMode=this.focus==='password'||this.focus==='confirm'?'privacy':this.pending?'thinking':this.transient?.mode||(this.mismatch?'confused':this.focus?'email':'idle');if(mode!=='idle')this.beast=false;const nextBeast=mode==='idle'&&this.beast;if(mode===this.output.mode&&nextBeast===this.output.beast)return;this.output=this.make(mode);this.listeners.forEach(fn=>fn());}
 private gesture(mode:SmartMode,remaining:number,next?:SmartMode){this.transient={mode,remaining,next};}
 send(event:NovaEvent){if(this.disposed)return;this.idleSeconds=0;this.beast=false;switch(event.type){
  case'view':if(event.view!==this.view){this.focus=null;this.transient=null;this.mismatch=false;}this.view=event.view;if(!this.seen.has(event.view)){this.seen.add(event.view);this.gesture('greeting',3.5);}break;
  case'focus':this.focus=event.field;if(!this.pending&&this.transient?.mode==='greeting')this.transient=null;break;
  case'blur':if(this.focus===event.field)this.focus=null;break;
  case'input':if(!this.pending&&this.transient&&['sad','worried','confused'].includes(this.transient.mode))this.transient=null;break;
  case'visibility':if(!this.focus&&!this.pending)this.gesture('reaction',.6);break;
  case'submit':this.pending=true;this.transient=null;break;
  case'result':this.pending=false;if(event.outcome==='success')this.gesture('success',1.2,event.view==='register'?'dance':undefined);else this.gesture(event.outcome==='credentials'?'sad':event.outcome==='network'||event.outcome==='server'?'worried':'confused',2.4);break;
  case'mismatch':this.mismatch=event.invalid;break;
  case'validation':if(!this.pending)this.gesture('confused',1.8);break;
  case'robot-click':if(!this.pending&&!this.focus)this.gesture('reaction',1.2);break;
  case'interact':break;
  case'preview':this.focus=null;this.pending=false;this.mismatch=false;this.transient=null;if(event.mode!=='idle')this.gesture(event.mode,event.mode==='thinking'?3:1.7);break;
 }this.resolve();}
 tick(delta:number){
  if(this.disposed||this.pending||this.output.mode==='privacy'){this.idleSeconds=0;return;}
  const dt=Math.max(0,Math.min(delta,.05));
  if(this.transient){
   this.idleSeconds=0;
   this.transient.remaining-=dt;
   if(this.transient.remaining<=0){const next=this.transient.next;this.transient=next?{mode:next,remaining:1.7}:null;this.resolve();}
   return;
  }
  if(this.output.mode==='idle'&&!this.focus&&!this.mismatch){
   this.idleSeconds+=dt;
   if(this.idleSeconds>=BEAST_IDLE_THRESHOLD&&!this.beast){
    this.beast=true;
    this.resolve();
   }
  }else{
   this.idleSeconds=0;
  }
 }
 dispose(){this.disposed=true;this.listeners.clear();this.focus=null;this.transient=null;this.pending=false;this.idleSeconds=0;this.beast=false;}
}
