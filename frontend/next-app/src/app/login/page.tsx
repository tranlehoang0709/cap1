'use client';
import {useState,useEffect,Suspense,type FormEvent,type FocusEvent} from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {useRouter} from 'next/navigation';
import {ArrowUpRight,AudioLines,ShieldCheck} from 'lucide-react';
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
export default function Login(){return <Suspense><NovaInteractionProvider>{DevAuthDebug?<DevAuthDebug>{flags=><Auth debug={flags}/>}</DevAuthDebug>:<Auth/>}</NovaInteractionProvider></Suspense>;}
function fieldFor(element:EventTarget|null):AuthField|null{if(!(element instanceof HTMLInputElement))return null;return ({email:'email',password:'password',confirm_password:'confirm',display_name:'name',token:'verification'} as Record<string,AuthField>)[element.name]||null;}
function Auth({debug}:{debug?:AuthDebugFlags}){
 const devDebug=process.env.NODE_ENV==='development'?debug:undefined;
 const {ref:panelRef,capture:capturePanel}=useAuthPanelMotion(devDebug?.form!==false);
 const router=useRouter(),nova=useNovaInteractions();const [tab,setTab]=useState<AuthView>('login');const [error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState(false),[verificationToken,setVerificationToken]=useState(''),[email,setEmail]=useState('');
 useEffect(()=>{nova.send({type:'view',view:tab});},[nova,tab]);
 useEffect(()=>{
  const consume=()=>{if(!window.location.hash.startsWith('#verify-email='))return;const fragment=window.location.hash.slice('#verify-email='.length);window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search);queueMicrotask(()=>{try{const token=decodeURIComponent(fragment);if(token.length<20||token.length>2048||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))throw new Error();setVerificationToken(token);setTab('verify');setNotice('Đã nhận mã từ liên kết. Bấm Xác minh email để tiếp tục.');}catch{setError('Liên kết xác minh không hợp lệ.');}});};
  consume();window.addEventListener('hashchange',consume);const warning=sessionStorage.getItem('aiva_logout_warning');if(warning){sessionStorage.removeItem('aiva_logout_warning');queueMicrotask(()=>setNotice(warning));}return ()=>window.removeEventListener('hashchange',consume);
 },[]);
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();if(pending)return;setError('');setNotice('');const form=e.currentTarget;const data=Object.fromEntries(new FormData(form));const confirmation=data.confirm_password;delete data.confirm_password;
  if(typeof data.token==='string')data.token=data.token.trim();
  if(tab==='register'&&data.password!==confirmation){setError('Hai mật khẩu đăng ký không khớp.');nova.send({type:'mismatch',invalid:true});nova.send({type:'validation'});return;}
  if(data.password&&new TextEncoder().encode(String(data.password)).length>72&&tab==='register'){setError('Mật khẩu tối đa 72 byte UTF-8.');nova.send({type:'validation'});return;}
  const submittedEmail=typeof data.email==='string'?data.email.trim():'';
  setPending(true);nova.send({type:'submit',view:tab});
  try{
   const r=await request<{message?:string}>('/api/auth/'+tab,data);
   form.reset();
   if(submittedEmail)setEmail(submittedEmail);
   if(tab==='login'){
    const user=await me();nova.send({type:'result',view:tab,outcome:'success'});router.replace('/'+(user.role==='ADMIN'?'admin':'user')+'/dashboard');router.refresh();
   }else if(tab==='register'){
    nova.send({type:'mismatch',invalid:false});nova.send({type:'result',view:tab,outcome:'success'});
    setTab('verify');
    setNotice(r.message||'Đã đăng ký. Cần xác minh email trước khi đăng nhập.');
   }else{
    setVerificationToken('');
    nova.send({type:'mismatch',invalid:false});nova.send({type:'result',view:tab,outcome:'success'});
    setTab('login');
    setNotice(r.message||'Email đã được xác minh. Bạn có thể đăng nhập.');
   }
  }
  catch(e){
   const rawMessage=e instanceof Error?e.message:'Không thể xác thực.';
   const status=e instanceof ApiError?e.status:500;
   const message=tab==='verify'&&(rawMessage==='Backend từ chối yêu cầu.'||rawMessage==='Yêu cầu không thành công.')?'Mã xác minh không hợp lệ hoặc đã hết hạn. Vui lòng kiểm tra lại.':rawMessage;
   setError(message);
   nova.send({type:'result',view:tab,outcome:status===401&&tab==='login'?'credentials':status===0?'network':status>=500?'server':'validation'});
  }
  finally{setPending(false);}
 }
 function onFocus(e:FocusEvent<HTMLFormElement>){const field=fieldFor(e.target);if(field)nova.send({type:'focus',field});}
 function onBlur(e:FocusEvent<HTMLFormElement>){const field=fieldFor(e.target);if(field)nova.send({type:'blur',field});}
 function onInput(e:FormEvent<HTMLFormElement>){const field=fieldFor(e.target);if(field)nova.send({type:'input',field});if(tab==='register'){const form=e.currentTarget;const a=form.elements.namedItem('password') as HTMLInputElement|null;const b=form.elements.namedItem('confirm_password') as HTMLInputElement|null;nova.send({type:'mismatch',invalid:!!b?.value&&a?.value!==b.value});}}
 return <AuthMotion enabled={devDebug?.form!==false}><main className="auth-page smart-auth auth-animate-ui" data-auth-debug-glass={devDebug?(devDebug.glass?'on':'off'):undefined} data-auth-debug-form={devDebug?(devDebug.form?'on':'off'):undefined}>{devDebug?.background!==false&&<LivingBackground/>}<a className="skip-link" href="#auth-form">Đến biểu mẫu xác thực</a>
 <header className="auth-header"><Link href="/" className="brand" aria-label="AIVA-IoT trang chủ"><span className="brand-symbol"><AudioLines/></span>AIVA<span className="brand-suffix">IoT</span></Link><AuthThemeToggle/></header>
 <div className="auth-body"><section className="auth-story" aria-label="Trợ lý AIVA NOVA"><div className="auth-intro"><div className="eyebrow">ROBOT & PERSONAL AI</div><h1>Một kết nối.<br/><span>Nhiều khả năng.</span></h1><p>Robot của bạn. Trợ lý của bạn.<br/>Một không gian để bắt đầu.</p>{devDebug?.nova===false?<section className="auth-debug-nova-off" aria-label="NOVA đã tắt trong debug">NOVA đã tháo · DEV</section>:<AivaNova/>}</div></section>
 <section className="auth-form-side" aria-label="Tài khoản AIVA"><div ref={panelRef} className="auth-form" id="auth-form" tabIndex={-1} data-auth-motion="idle">{devDebug?.glass!==false&&<div className="auth-card-backdrop" aria-hidden="true"/>}<div className="auth-card-surface" aria-hidden="true"><span className="auth-glass-layer palette-dark"/><span className="auth-glass-layer palette-light"/></div><AuthAutoHeight><div className="eyebrow">TÀI KHOẢN AIVA-IoT</div><h2>{tab==='login'?'Trở lại không gian của bạn.':tab==='register'?'Bắt đầu kết nối.':'Xác minh email.'}</h2><p className="muted">{tab==='register'?'Tạo tài khoản để bắt đầu cùng AIVA.':tab==='verify'?'Hoàn tất xác minh để kích hoạt tài khoản.':'Mọi kết nối tốt đẹp đều bắt đầu từ đây.'}</p>
 <div className="tabs" role="tablist" aria-label="Xác thực"><AuthTabHighlight index={tab==='login'?0:tab==='register'?1:2}/>{([['login','Đăng nhập'],['register','Đăng ký'],['verify','Xác minh']] as const).map(([id,label])=><button type="button" key={id} role="tab" aria-selected={tab===id} disabled={pending} onClick={e=>{capturePanel(e.detail>0);setTab(id);setError('');setNotice('');}}>{label}</button>)}</div>
 <AuthPanel key={tab}><form onSubmit={submit} onFocusCapture={onFocus} onBlurCapture={onBlur} onInput={onInput} onInvalidCapture={()=>nova.send({type:'validation'})} className="form-stack" aria-busy={pending}>
 {tab==='verify'?<>{email&&<p className="fine">Tài khoản chờ xác minh: <strong>{email}</strong></p>}<label>Mã xác minh<input name="token" type="text" inputMode="text" spellCheck={false} placeholder="Nhập hoặc dán mã xác minh từ email…" value={verificationToken} onChange={e=>setVerificationToken(e.target.value)} onPaste={e=>{const pasted=e.clipboardData.getData('text');if(pasted){e.preventDefault();setVerificationToken(pasted.trim());nova.send({type:'input',field:'verification'});}}} required autoComplete="one-time-code" maxLength={4096}/></label></>:<>{tab==='register'&&<label>Họ và tên<input name="display_name" required maxLength={150} autoComplete="name"/></label>}<label>Email<input name="email" type="email" placeholder="ban@example.com" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="username" maxLength={255}/></label><PasswordField register={tab==='register'}/>{tab==='register'&&<PasswordField confirm register/>}</>}
 {error&&<AuthFeedback kind="error" text={error}/>} {notice&&<AuthFeedback kind="success" text={notice}/>}
 <AuthGlowButton disabled={pending} type="submit" aria-busy={pending}><AuthButtonLabel busy={pending}>{pending?<><Spinner/>Đang xử lý…</>:<>{tab==='login'?'Đăng nhập':tab==='register'?'Tạo tài khoản':'Xác minh email'}<ArrowUpRight size={18}/></>}</AuthButtonLabel></AuthGlowButton>
 </form></AuthPanel><p className="fine auth-help">{tab==='login'?'Cần hỗ trợ đăng nhập? Hãy liên hệ quản trị viên.':tab==='register'?'Xác minh email sau khi đăng ký để kích hoạt tài khoản.':'Mở liên kết trong email hoặc nhập mã xác minh của bạn.'}</p></AuthAutoHeight></div></section></div>
 <footer className="auth-page-footer"><span><ShieldCheck size={14}/>Thông tin của bạn được bảo vệ.</span><span>AIVA-IoT · Robot & Personal AI Platform</span></footer></main></AuthMotion>;
}
