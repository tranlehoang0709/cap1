'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  AudioLines,
  LayoutDashboard,
  MessageSquare,
  Bot,
  Sparkles,
  History,
  Shield,
  User,
  Users,
  KeyRound,
  Gauge,
  Package,
  Activity,
  Settings,
  Menu,
  LogOut,
  X,
} from 'lucide-react';
import type { Identity } from '@/lib/contracts';
import { adminNav, userNav } from '@/lib/navigation';
import { ThemeToggle } from './theme-toggle';
import { request } from '@/lib/client';
import { WorkspaceBackground } from './backgrounds/WorkspaceBackground';

const icons: Record<string, typeof Bot> = {
  dashboard: LayoutDashboard,
  chat: MessageSquare,
  robots: Bot,
  assistant: Sparkles,
  conversations: History,
  privacy: Shield,
  account: User,
  users: Users,
  ai: Sparkles,
  keys: KeyRound,
  quotas: Gauge,
  firmware: Package,
  monitoring: Activity,
  settings: Settings,
};

export function AppShell({
  user,
  children,
}: {
  user: Identity;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () =>
      Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),select'
        ) || []
      ).filter((el) => el.getClientRects().length);
    focusable()[0]?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (event.key === 'Tab') {
        const items = focusable(),
          first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handle);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', handle);
      previous?.focus();
    };
  }, [open]);

  const [leaving, setLeaving] = useState(false);
  const prefix = user.role === 'ADMIN' ? 'admin' : 'user';
  const nav = user.role === 'ADMIN' ? adminNav : userNav;
  const title = nav.find((x) => path === `/${prefix}/${x[0]}`)?.[1] || 'Không gian AIVA';
  const isDashboard = path === `/${prefix}/dashboard`;

  return (
    <div className="app-shell" data-portal={prefix}>
      <WorkspaceBackground />
      <a className="skip-link" href="#main">
        Đến nội dung chính
      </a>
      {open && (
        <button
          aria-label="Đóng điều hướng"
          className="sidebar-backdrop"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        id="aiva-sidebar"
        ref={sidebarRef}
        className={'sidebar ' + (open ? 'is-open' : '')}
      >
        <Link href={`/${prefix}/dashboard`} className="brand">
          <span className="brand-symbol">
            <AudioLines />
          </span>
          AIVA<span className="brand-suffix">IoT</span>
        </Link>
        <button
          className="mobile-close icon-button"
          onClick={() => setOpen(false)}
          aria-label="Đóng menu"
        >
          <X />
        </button>
        <div className="workspace-label">
          <span className="workspace-avatar">A</span>
          <div>
            <strong>{user.role === 'ADMIN' ? 'Admin Console' : 'Personal Workspace'}</strong>
            <small>AIVA-IoT Platform</small>
          </div>
        </div>
        <nav aria-label="Điều hướng chính">
          {nav.map(([id, label, group], i) => {
            const Icon = icons[id];
            return (
              <div key={id}>
                {(i === 0 || group !== nav[i - 1][2]) && (
                  <p className="nav-group">
                    {
                      {
                        overview: 'KHÔNG GIAN',
                        workspace: 'TRỢ LÝ & ROBOT',
                        account: 'CÁ NHÂN',
                        management: 'QUẢN LÝ',
                        operations: 'VẬN HÀNH',
                      }[group]
                    }
                  </p>
                )}
                <Link
                  onClick={() => setOpen(false)}
                  href={`/${prefix}/${id}`}
                  className={path === `/${prefix}/${id}` ? 'nav-item active' : 'nav-item'}
                  aria-current={path === `/${prefix}/${id}` ? 'page' : undefined}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                  {path === `/${prefix}/${id}` && <span className="nav-dot" />}
                </Link>
              </div>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="account-avatar">
            {user.display_name.slice(0, 1).toUpperCase()}
          </div>
          <div className="account-info">
            <strong>{user.display_name}</strong>
            <small>{user.email}</small>
          </div>
          <button
            disabled={leaving}
            className="icon-button"
            aria-label="Đăng xuất"
            onClick={async () => {
              setLeaving(true);
              try {
                const r = await request<{ warning: boolean }>('/api/auth/logout', {});
                if (r.warning)
                  sessionStorage.setItem(
                    'aiva_logout_warning',
                    'Phiên giao diện đã đóng; Backend chưa xác nhận thu hồi.'
                  );
                router.replace('/login');
                router.refresh();
              } finally {
                setLeaving(false);
              }
            }}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="app-content" inert={open ? true : undefined}>
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Mở menu"
              aria-expanded={open}
              aria-controls="aiva-sidebar"
              onClick={() => setOpen(true)}
            >
              <Menu size={20} />
            </button>
            <span>{user.role === 'ADMIN' ? 'Admin Console' : 'Workspace'}</span>
            <span>/</span>
            <strong>{title}</strong>
          </div>
          <div className="topbar-actions">
            <ThemeToggle />
            <span className="role-pill">{user.role === 'ADMIN' ? 'Admin' : 'User'}</span>
          </div>
        </header>
        <main id="main" className="main-content" tabIndex={-1}>
          <div className={'page-heading' + (isDashboard ? ' is-dashboard' : '')}>
            <div>
              <div className="eyebrow">
                AIVA-IoT / {user.role === 'ADMIN' ? 'CONTROL CENTER' : 'YOUR WORKSPACE'}
              </div>
              <h1>{title}</h1>
            </div>
          </div>
          {children}
          <footer className="workspace-footer">
            <span>AIVA-IoT</span>
            <span>Connected robots. Personal intelligence.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
