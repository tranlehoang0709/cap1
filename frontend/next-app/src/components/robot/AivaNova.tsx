'use client';
import dynamic from 'next/dynamic';
import {Component,useState,type ReactNode} from 'react';
import styles from './nova.module.css';
import {Eye,EyeOff} from 'lucide-react';
const NovaCanvas=dynamic(()=>import('./NovaCanvas'),{ssr:false,loading:()=> <p className={styles.loading} role="status">Đang tải NOVA 3D…</p>});
class RobotBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<p role="alert">NOVA chưa hiển thị được. Bạn vẫn có thể sử dụng form đăng nhập.</p>:this.props.children;}
}
export default function AivaNova(){const [enabled,setEnabled]=useState(true);return <section className={styles.nova} aria-label="AIVA NOVA 3D">{enabled?<RobotBoundary><NovaCanvas/></RobotBoundary>:<div className={styles.disabled}><p>NOVA luôn sẵn sàng bên bạn.</p></div>}<button type="button" className={styles.lifecycle} aria-label={enabled?'Ẩn NOVA 3D':'Hiện NOVA 3D'} title={enabled?'Ẩn NOVA để giảm chuyển động':'Hiện NOVA 3D'} onClick={()=>setEnabled(value=>!value)}>{enabled?<EyeOff size={16}/>:<Eye size={16}/>} </button></section>;}
