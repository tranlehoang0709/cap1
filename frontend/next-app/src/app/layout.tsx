import type { Metadata } from 'next';
import { Providers } from '@/components/providers';
import {themeBootstrap} from '@/lib/theme-policy';
import './globals.css';
import './aiva-backgrounds.css';
import './aiva-workspace.css';
import './aiva-motion.css';
export const metadata: Metadata = { title: { default: 'AIVA-IoT · Không gian kết nối', template: '%s · AIVA-IoT' }, description: 'Quản lý robot, trợ lý AI và vận hành AIVA-IoT.' };
export default function Layout({ children }: {
    children: React.ReactNode;
}) { return <html lang="vi" suppressHydrationWarning><head><script id="aiva-theme-bootstrap" dangerouslySetInnerHTML={{__html:themeBootstrap}}/></head><body><Providers>{children}</Providers></body></html>; }
