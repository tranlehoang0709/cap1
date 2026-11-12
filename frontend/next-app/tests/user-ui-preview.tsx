// Presentation-only evidence. No session, Backend records, or successful API mocks.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from 'next-themes';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { AppShell } from '../src/components/app-shell';
import { UserDashboardView, UserUsageView } from '../src/components/user/UserDashboard';

declare global { interface Window { userUI: {
  state: (value: 'loading' | 'error' | 'empty') => void;
  reloads: number; navigation: string[]; range?: { from: string; to: string };
} } }
function Preview() {
  const [mode, setMode] = useState<'loading' | 'error' | 'empty'>('empty');
  const [path, setPath] = useState('/user/dashboard');
  useEffect(() => { window.userUI = { state: setMode, reloads: 0, navigation: [] }; }, []);
  const navigate = (href: string) => { window.userUI.navigation.push(href); setPath(href); };
  const router = { back: () => {}, forward: () => {}, refresh: () => {}, push: navigate, replace: navigate, prefetch: () => {}, bfcacheId: 'isolated-user-ui' };
  const resource = { data: undefined, loading: mode === 'loading', error: mode === 'error' ? 'Không kết nối được Backend.' : undefined, reload: () => { window.userUI.reloads++; } };
  const robots = { ...resource, data: { items: [] } };
  return <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} themes={['dark', 'light']}>
    <AppRouterContext value={router}><PathnameContext value={path}>
      <div onClickCapture={event => {
        const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
        const href = link?.getAttribute('href');
        if (href?.startsWith('/user/')) { event.preventDefault(); navigate(href); }
      }}>
        <AppShell user={{ id: '', role: 'USER', display_name: 'Chưa có phiên User', email: '' }}>
          <UserDashboardView robots={robots} history={resource}>
            <UserUsageView state={{ ...resource, data: [] }} onApply={range => { window.userUI.range = range; }} />
          </UserDashboardView>
        </AppShell>
      </div>
    </PathnameContext></AppRouterContext>
    <div style={{ position: 'fixed', bottom: 4, left: 4, zIndex: 100, fontSize: 9, background: 'var(--card)', color: 'var(--muted)', padding: '4px 8px', pointerEvents: 'none' }}>COMPONENT PREVIEW · Không có phiên User · Không có dữ liệu nghiệp vụ</div>
  </ThemeProvider>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
