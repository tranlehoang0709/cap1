'use client';
import {useState,useEffect,Suspense,type FormEvent,type FocusEvent} from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {useRouter} from 'next/navigation';
import {ArrowLeft,ArrowUpRight,AudioLines,ShieldCheck} from 'lucide-react';
import {request,me,ApiError} from '@/lib/client';
import {AuthMotion,AuthAutoHeight,AuthPanel,AuthTabHighlight,AuthThemeToggle,AuthFeedback,AuthButtonLabel} from '@/components/auth/AuthMotion';
import {useAuthPanelMotion} from '@/components/motion/useAuthPanelMotion';
import AivaNova from '@/components/robot/AivaNova';
import {NovaInteractionProvider,useNovaInteractions} from '@/components/robot/NovaInteractionProvider';
import type {AuthField,AuthView} from '@/components/robot/NovaInteractionController';
import {AuthGlowButton} from '@/components/auth/AuthGlowButton';
import {PasswordField} from '@/components/auth/PasswordField';
import {LivingBackground} from '@/components/backgrounds/LivingBackground';
import {Spinner} from '@/components/motion/VisibleMotion';
import type {AuthDebugFlags} from '@/components/debug/AuthDebugHarness';
import './smart-auth.css';

const DevAuthDebug=process.env.NODE_ENV==='development'?dynamic(()=>import('@/components/debug/AuthDebugHarness'),{ssr:false}):null;
type AuthMode='login'|'register'|'verify'|'recovery';
type RecoveryStep='request'|'reset';

export default function Login(){
 return <Suspense><NovaInteractionProvider>{DevAuthDebug?<DevAuthDebug>{flags=><Auth debug={flags}/>}</DevAuthDebug>:<Auth/>}</NovaInteractionProvider></Suspense>;
}

function fieldFor(element:EventTarget|null):AuthField|null{
 if(!(element instanceof HTMLInputElement))return null;
 return ({email:'email',password:'password',new_password:'password',confirm_password:'confirm',display_name:'name',code:'verification'} as Record<string,AuthField>)[element.name]||null;
}

function sanitizeOtp(raw:string):string{
 return raw.replace(/\D/g,'').slice(0,6);
}

function Auth({debug}:{debug?:AuthDebugFlags}){
 const devDebug=process.env.NODE_ENV==='development'?debug:undefined;
 const {ref:panelRef,capture:capturePanel}=useAuthPanelMotion(devDebug?.form!==false);
 const router=useRouter(),nova=useNovaInteractions();
 const [mode,setMode]=useState<AuthMode>('login');
 const [recoveryStep,setRecoveryStep]=useState<RecoveryStep>('request');
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [pending,setPending]=useState(false);
 const [verificationCode,setVerificationCode]=useState('');
 const [resetCode,setResetCode]=useState('');
 const [email,setEmail]=useState('');
 const [resendCooldown,setResendCooldown]=useState(0);

 const novaView:AuthView=mode==='verify'?'verify':mode==='register'?'register':'login';
 useEffect(()=>{nova.send({type:'view',view:novaView});},[nova,novaView]);

 useEffect(()=>{
  if(resendCooldown<=0)return;
  const timer=window.setInterval(()=>setResendCooldown(s=>s>1?s-1:0),1000);
  return ()=>window.clearInterval(timer);
 },[resendCooldown]);

 useEffect(()=>{
  const consume=()=>{
   if(window.location.hash.startsWith('#verify-email=')){
    const fragment=window.location.hash.slice('#verify-email='.length);
    window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search);
    queueMicrotask(()=>{
     try{
      const otp=decodeURIComponent(fragment).trim();
      if(!/^\d{6}$/.test(otp))throw new Error();
      setVerificationCode(otp);
      setError('');
      setMode('verify');
      setNotice('Đã nhận mã OTP từ liên kết. Nhập email (nếu chưa có) và bấm Xác minh email.');
     }catch{
      setError('Liên kết xác minh không hợp lệ.');
     }
    });
   }else if(window.location.hash.startsWith('#reset-password=')){
    const fragment=window.location.hash.slice('#reset-password='.length);
    window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search);
    queueMicrotask(()=>{
     try{
      const otp=decodeURIComponent(fragment).trim();
      if(!/^\d{6}$/.test(otp))throw new Error();
      setResetCode(otp);
      setError('');
      setMode('recovery');
      setRecoveryStep('reset');
      setNotice('Đã nhận mã khôi phục. Nhập email và mật khẩu mới để hoàn tất.');
     }catch{
      setError('Liên kết đặt lại mật khẩu không hợp lệ.');
     }
    });
   }
  };
  consume();
  window.addEventListener('hashchange',consume);
  const warning=sessionStorage.getItem('aiva_logout_warning');
  if(warning){
   sessionStorage.removeItem('aiva_logout_warning');
   queueMicrotask(()=>setNotice(warning));
  }
  return ()=>window.removeEventListener('hashchange',consume);
 },[]);

 function goToMode(nextMode:AuthMode,fromKeyboard=false,nextRecoveryStep:RecoveryStep='request'){
  capturePanel(!fromKeyboard);
  setMode(nextMode);
  setRecoveryStep(nextRecoveryStep);
  setError('');
  setNotice('');
 }

 async function resendVerification(){
  if(pending||resendCooldown>0)return;
  const targetEmail=email.trim();
  if(!targetEmail){
   setError('Vui lòng nhập email tài khoản để gửi lại mã OTP.');
   nova.send({type:'validation'});
   return;
  }
  setError('');setNotice('');setPending(true);nova.send({type:'submit',view:'verify'});
  try{
   const r=await request<{message?:string}>('/api/auth/resend',{email:targetEmail});
   nova.send({type:'result',view:'verify',outcome:'success'});
   setResendCooldown(60);
   setNotice(r.message||'Mã OTP xác minh mới đã được gửi đến email của bạn.');
  }catch(e){
   setError(e instanceof Error?e.message:'Không thể gửi lại mã OTP.');
   nova.send({type:'result',view:'verify',outcome:e instanceof ApiError&&e.status>=500?'server':'validation'});
  }finally{
   setPending(false);
  }
 }

 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();
  if(pending)return;
  setError('');setNotice('');
  const form=e.currentTarget;
  const data=Object.fromEntries(new FormData(form));
  const confirmation=data.confirm_password;
  delete data.confirm_password;
  if(typeof data.code==='string')data.code=data.code.trim();

  const activeAction=mode==='recovery'?(recoveryStep==='request'?'forgot':'reset'):mode;
  if(activeAction==='verify'||activeAction==='reset'){
   if(!/^\d{6}$/.test(String(data.code||''))){
    setError('Mã OTP phải gồm đúng 6 chữ số.');
    nova.send({type:'validation'});
    return;
   }
  }
  if(activeAction==='reset'){
   if(data.password!==confirmation){setError('Hai mật khẩu mới không khớp.');nova.send({type:'mismatch',invalid:true});nova.send({type:'validation'});return;}
   if(data.password&&new TextEncoder().encode(String(data.password)).length>72){setError('Mật khẩu tối đa 72 byte UTF-8.');nova.send({type:'validation'});return;}
   data.new_password=data.password;delete data.password;
  }
  if(activeAction==='register'&&data.password!==confirmation){setError('Hai mật khẩu đăng ký không khớp.');nova.send({type:'mismatch',invalid:true});nova.send({type:'validation'});return;}
  if(activeAction==='register'&&data.password&&new TextEncoder().encode(String(data.password)).length>72){setError('Mật khẩu tối đa 72 byte UTF-8.');nova.send({type:'validation'});return;}

  const submittedEmail=typeof data.email==='string'?data.email.trim():'';
  setPending(true);nova.send({type:'submit',view:novaView});
  try{
   const r=await request<{message?:string;verification_sent?:boolean}>('/api/auth/'+activeAction,data);
   form.reset();
   if(submittedEmail)setEmail(submittedEmail);
   if(activeAction==='login'){
    const user=await me();
    nova.send({type:'result',view:'login',outcome:'success'});
    router.replace('/'+(user.role==='ADMIN'?'admin':'user')+'/dashboard');
    router.refresh();
   }else if(activeAction==='register'){
    capturePanel(true);
    nova.send({type:'mismatch',invalid:false});
    nova.send({type:'result',view:'register',outcome:'success'});
    setMode('verify');
    if(r.verification_sent)setResendCooldown(60);
    setNotice(r.message||'Đã đăng ký. Nhập mã OTP 6 chữ số từ email để kích hoạt tài khoản.');
   }else if(activeAction==='forgot'){
    capturePanel(true);
    nova.send({type:'result',view:'login',outcome:'success'});
    setRecoveryStep('reset');
    setNotice(r.message||'Nếu email tồn tại trong hệ thống, mã OTP khôi phục đã được gửi.');
   }else if(activeAction==='reset'){
    capturePanel(true);
    setResetCode('');
    nova.send({type:'mismatch',invalid:false});
    nova.send({type:'result',view:'login',outcome:'success'});
    setMode('login');
    setRecoveryStep('request');
    setNotice(r.message||'Đã đặt lại mật khẩu thành công. Bạn có thể đăng nhập.');
   }else{
    capturePanel(true);
    setVerificationCode('');
    nova.send({type:'mismatch',invalid:false});
    nova.send({type:'result',view:'verify',outcome:'success'});
    setMode('login');
    setNotice(r.message||'Email đã được xác minh. Bạn có thể đăng nhập.');
   }
  }catch(e){
   const rawMessage=e instanceof Error?e.message:'Không thể xác thực.';
   const status=e instanceof ApiError?e.status:500;
   const code=e instanceof ApiError?e.code:undefined;

   if(submittedEmail)setEmail(submittedEmail);

   if(activeAction==='login'&&code==='EMAIL_NOT_VERIFIED'){
    capturePanel(true);
    setMode('verify');
    setError(rawMessage||'Tài khoản chưa xác minh email. Vui lòng nhập mã OTP hoặc gửi lại mã.');
    nova.send({type:'result',view:'login',outcome:'validation'});
    return;
   }

   if(activeAction==='login'&&(code==='ACCOUNT_SUSPENDED'||code==='ACCOUNT_DISABLED'||code==='ACCOUNT_UNAVAILABLE')){
    setError(rawMessage);
    nova.send({type:'result',view:'login',outcome:'credentials'});
    return;
   }

   const isGenericReject=rawMessage==='Backend từ chối yêu cầu.'||rawMessage==='Yêu cầu không thành công.';
   const message=activeAction==='verify'&&isGenericReject
    ?'Mã OTP không đúng hoặc đã hết hạn. Vui lòng kiểm tra lại.'
    :activeAction==='reset'&&isGenericReject
     ?'Mã khôi phục không hợp lệ hoặc đã hết hạn.'
     :rawMessage;
   setError(message);
   nova.send({type:'result',view:novaView,outcome:status===401&&activeAction==='login'?'credentials':status===0?'network':status>=500?'server':'validation'});
  }finally{
   setPending(false);
  }
 }

 function onFocus(e:FocusEvent<HTMLFormElement>){const field=fieldFor(e.target);if(field)nova.send({type:'focus',field});}
 function onBlur(e:FocusEvent<HTMLFormElement>){const field=fieldFor(e.target);if(field)nova.send({type:'blur',field});}
 function onInput(e:FormEvent<HTMLFormElement>){
  const field=fieldFor(e.target);
  if(field)nova.send({type:'input',field});
  if(mode==='register'||(mode==='recovery'&&recoveryStep==='reset')){
   const form=e.currentTarget;
   const a=form.elements.namedItem('password') as HTMLInputElement|null;
   const b=form.elements.namedItem('confirm_password') as HTMLInputElement|null;
   nova.send({type:'mismatch',invalid:!!b?.value&&a?.value!==b.value});
  }
 }

 const heading=mode==='register'?'Bắt đầu kết nối.':mode==='verify'?'Xác minh email.':mode==='recovery'?(recoveryStep==='request'?'Khôi phục mật khẩu.':'Đặt lại mật khẩu mới.'):'Trở lại không gian của bạn.';
 const subtitle=mode==='register'?'Tạo tài khoản để bắt đầu cùng AIVA.':mode==='verify'?'Nhập mã OTP 6 chữ số đã gửi tới email của bạn (hiệu lực 5 phút).':mode==='recovery'?(recoveryStep==='request'?'Nhập email đã đăng ký hoặc sử dụng mã OTP khôi phục đã nhận.':'Nhập email, mã OTP 6 chữ số và mật khẩu mới.'):'Mọi kết nối tốt đẹp đều bắt đầu từ đây.';
 const panelKey=mode==='recovery'?`recovery-${recoveryStep}`:mode;

 return <AuthMotion enabled={devDebug?.form!==false}><main className="auth-page smart-auth auth-animate-ui" data-auth-debug-glass={devDebug?(devDebug.glass?'on':'off'):undefined} data-auth-debug-form={devDebug?(devDebug.form?'on':'off'):undefined}>{devDebug?.background!==false&&<LivingBackground/>}<a className="skip-link" href="#auth-form">Đến biểu mẫu xác thực</a>
 <header className="auth-header"><Link href="/" className="brand" aria-label="AIVA-IoT trang chủ"><span className="brand-symbol"><AudioLines/></span>AIVA<span className="brand-suffix">IoT</span></Link><AuthThemeToggle/></header>
 <div className="auth-body"><section className="auth-story" aria-label="Trợ lý AIVA NOVA"><div className="auth-intro"><div className="eyebrow">ROBOT & PERSONAL AI</div><h1>Một kết nối.<br/><span>Nhiều khả năng.</span></h1><p>Robot của bạn. Trợ lý của bạn.<br/>Một không gian để bắt đầu.</p>{devDebug?.nova===false?<section className="auth-debug-nova-off" aria-label="NOVA đã tắt trong debug">NOVA đã tháo · DEV</section>:<AivaNova/>}</div></section>
 <section className="auth-form-side" aria-label="Tài khoản AIVA"><div ref={panelRef} className="auth-form" id="auth-form" tabIndex={-1} data-auth-motion="idle">{devDebug?.glass!==false&&<div className="auth-card-backdrop" aria-hidden="true"/>}<div className="auth-card-surface" aria-hidden="true"><span className="auth-glass-layer palette-dark"/><span className="auth-glass-layer palette-light"/></div><AuthAutoHeight><div className="eyebrow">TÀI KHOẢN AIVA-IoT</div><h2>{heading}</h2><p className="muted">{subtitle}</p>
 {(mode==='login'||mode==='register')?<div className="tabs" role="tablist" aria-label="Xác thực"><AuthTabHighlight index={mode==='login'?0:1}/>{([['login','Đăng nhập'],['register','Đăng ký']] as const).map(([id,label])=><button type="button" key={id} role="tab" aria-selected={mode===id} disabled={pending} onClick={e=>goToMode(id,e.detail===0)}>{label}</button>)}</div>:<div className="auth-step-bar"><span className="auth-step-badge">{mode==='verify'?'Bước xác minh email':'Khôi phục mật khẩu'}</span><button type="button" className="auth-link-btn" disabled={pending} onClick={()=>goToMode('login')}><ArrowLeft size={14}/>Quay lại đăng nhập</button></div>}
 <AuthPanel key={panelKey}><form onSubmit={submit} onFocusCapture={onFocus} onBlurCapture={onBlur} onInput={onInput} onInvalidCapture={()=>nova.send({type:'validation'})} className="form-stack" aria-busy={pending}>
 {mode==='verify'?<>
  <label>Email tài khoản<input name="email" type="email" placeholder="ban@example.com" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="username" maxLength={255}/></label>
  <label>Mã OTP xác minh (6 chữ số)<input name="code" type="text" inputMode="numeric" pattern="\d{6}" spellCheck={false} placeholder="Nhập 6 chữ số…" value={verificationCode} onChange={e=>setVerificationCode(sanitizeOtp(e.target.value))} onPaste={e=>{const pasted=e.clipboardData.getData('text');if(pasted){e.preventDefault();setVerificationCode(sanitizeOtp(pasted));nova.send({type:'input',field:'verification'});}}} required autoComplete="one-time-code" maxLength={6}/></label>
  <div className="auth-step-actions"><button type="button" className="btn ghost" disabled={pending||resendCooldown>0} onClick={()=>void resendVerification()}>{resendCooldown>0?`Gửi lại mã (${resendCooldown}s)`:'Gửi lại mã OTP'}</button></div>
 </>:mode==='recovery'&&recoveryStep==='request'?<>
  <label>Email đăng ký<input name="email" type="email" placeholder="ban@example.com" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="username" maxLength={255}/></label>
  <div className="auth-step-actions"><button type="button" className="btn ghost" disabled={pending} onClick={()=>{capturePanel(true);setRecoveryStep('reset');setError('');setNotice('');}}>Đã có mã OTP? Nhập mã đặt lại</button></div>
 </>:mode==='recovery'&&recoveryStep==='reset'?<>
  <label>Email tài khoản<input name="email" type="email" placeholder="ban@example.com" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="username" maxLength={255}/></label>
  <label>Mã OTP khôi phục (6 chữ số)<input name="code" type="text" inputMode="numeric" pattern="\d{6}" spellCheck={false} placeholder="Nhập 6 chữ số…" value={resetCode} onChange={e=>setResetCode(sanitizeOtp(e.target.value))} onPaste={e=>{const pasted=e.clipboardData.getData('text');if(pasted){e.preventDefault();setResetCode(sanitizeOtp(pasted));nova.send({type:'input',field:'verification'});}}} required autoComplete="one-time-code" maxLength={6}/></label>
  <PasswordField register/>
  <PasswordField confirm register/>
  <div className="auth-step-actions"><button type="button" className="btn ghost" disabled={pending} onClick={()=>{capturePanel(true);setRecoveryStep('request');setError('');setNotice('');}}>Chưa có mã? Gửi yêu cầu</button></div>
 </>:<>
  {mode==='register'&&<label>Họ và tên<input name="display_name" required maxLength={150} autoComplete="name"/></label>}
  <label>Email<input name="email" type="email" placeholder="ban@example.com" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="username" maxLength={255}/></label>
  <PasswordField register={mode==='register'}/>
  {mode==='register'&&<PasswordField confirm register/>}
  {mode==='login'&&<div className="auth-forgot-row"><button type="button" className="auth-link-btn" disabled={pending} onClick={()=>goToMode('recovery',false,'request')}>Quên mật khẩu?</button></div>}
 </>}
 {error&&<AuthFeedback kind="error" text={error}/>}
 {notice&&<AuthFeedback kind="success" text={notice}/>}
 <AuthGlowButton disabled={pending} type="submit" aria-busy={pending}><AuthButtonLabel busy={pending}>{pending?<><Spinner/>Đang xử lý…</>:<>{mode==='login'?'Đăng nhập':mode==='register'?'Tạo tài khoản':mode==='verify'?'Xác minh email':recoveryStep==='request'?'Gửi mã khôi phục':'Đặt lại mật khẩu'}<ArrowUpRight size={18}/></>}</AuthButtonLabel></AuthGlowButton>
 </form></AuthPanel><p className="fine auth-help">{mode==='login'?'Cần hỗ trợ đăng nhập? Chọn Quên mật khẩu hoặc liên hệ quản trị viên.':mode==='register'?'Sau khi đăng ký, hệ thống sẽ chuyển sang bước xác minh email bằng mã OTP.':mode==='verify'?'Kiểm tra hộp thư (kể cả Spam) để lấy mã OTP 6 chữ số có hiệu lực 5 phút.':'Sử dụng mã OTP khôi phục đã nhận hoặc gửi yêu cầu nhận mã mới qua email.'}</p></AuthAutoHeight></div></section></div>
 <footer className="auth-page-footer"><span><ShieldCheck size={14}/>Thông tin của bạn được bảo vệ.</span><span>AIVA-IoT · Robot & Personal AI Platform</span></footer></main></AuthMotion>;
}
