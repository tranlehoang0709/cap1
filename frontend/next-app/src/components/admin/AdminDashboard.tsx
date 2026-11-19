'use client';

import Link from 'next/link';
import {
  Activity,
  ArrowUpRight,
  Bot,
  Gauge,
  MessageSquare,
  RefreshCw,
  Server,
  Sparkles,
  Users,
} from 'lucide-react';
import { object, rows, type Row } from '@/lib/contracts';
import { Button } from '@/components/ui/button';
import { cols, DataTable, Panel, ResourceState, useResource } from '@/components/data-ui';

type Resource = ReturnType<typeof useResource>;
const metrics = [
  { key: 'users', label: 'Người dùng', Icon: Users },
  { key: 'devices', label: 'Robot', Icon: Bot },
  { key: 'online_devices', label: 'Robot trực tuyến', Icon: Activity },
  { key: 'conversations', label: 'Hội thoại', Icon: MessageSquare },
] as const;
const columns = cols('id', 'instance_code', 'status', 'last_healthcheck_at');

export function AdminDashboard() {
  // Dashboard is an aggregate endpoint; the BFF accepts no pagination filters.
  const state = useResource('dashboard');
  const history = useResource('instances', {});
  let data: Row = {};
  try {
    if (state.data) data = object(state.data);
  } catch {}
  return <AdminDashboardView state={state} history={history} data={data} />;
}

function Pending({ cards = false }: { cards?: boolean }) {
  return (
    <div
      className={
        (cards ? 'admin-metrics-pending' : 'admin-table-pending') + ' skeleton-wrap'
      }
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Đang tải dữ liệu</span>
      {Array.from({ length: cards ? 4 : 3 }, (_, index) => (
        <div className="admin-placeholder skeleton" key={index}>
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

// Presentation is separate so empty/error/loading can be inspected without
// creating a session, bypassing RBAC or fabricating backend records.
export function AdminDashboardView({
  state,
  history,
  data,
}: {
  state: Resource;
  history: Resource;
  data: Row;
}) {
  let instanceItems: Row[] | null = null;
  try {
    if (history.data !== undefined) instanceItems = rows(history.data);
  } catch {
    instanceItems = null;
  }
  const onlineRatio =
    typeof data.online_devices === 'number' && typeof data.devices === 'number'
      ? `${new Intl.NumberFormat('vi-VN').format(data.online_devices)} / ${new Intl.NumberFormat('vi-VN').format(data.devices)}`
      : '—';
  const instanceSummary = history.loading
    ? 'Đang tải…'
    : instanceItems !== null
      ? `${instanceItems.length} phiên`
      : '—';

  return (
    <div className="admin-dashboard">
      <section
        className="admin-overview-intro welcome-band"
        aria-label="Tổng quan nền tảng"
      >
        <div>
          <span className="eyebrow">PLATFORM OVERVIEW</span>
          <h2>Mọi kết nối, trong một tầm nhìn.</h2>
          <p>Theo dõi vận hành và quản lý nền tảng trực tiếp từ dữ liệu Backend.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin/robots">
            Quản lý robot
            <ArrowUpRight size={16} />
          </Link>
        </Button>
      </section>
      <section className="admin-metrics" aria-label="Chỉ số nền tảng">
        {state.loading ? (
          <Pending cards />
        ) : (
          <ResourceState state={state}>
            <div className="metric-grid">
              {metrics.map(({ key, label, Icon }) => (
                <div className="metric-card" key={key}>
                  <div>
                    <span>{label}</span>
                    <span className="admin-metric-icon">
                      <Icon size={18} />
                    </span>
                  </div>
                  <strong>
                    {typeof data[key] === 'number'
                      ? new Intl.NumberFormat('vi-VN').format(data[key] as number)
                      : '—'}
                  </strong>
                  {typeof data[key] !== 'number' && <small>Chưa có dữ liệu</small>}
                </div>
              ))}
            </div>
          </ResourceState>
        )}
      </section>
      <div className="admin-dashboard-grid">
        <Panel
          title="Dịch vụ đang ghi nhận"
          description="Các phiên AI (instances) và lần kiểm tra sức khỏe gần nhất."
          className="admin-instances-panel"
          actions={
            <Button
              variant="ghost"
              onClick={history.reload}
              aria-label="Tải lại dịch vụ"
            >
              <RefreshCw size={16} />
              <span>Tải lại</span>
            </Button>
          }
        >
          <div className="admin-table-label">
            <Server size={15} />
            <span>INSTANCE / HEALTH CHECK</span>
          </div>
          <div className="admin-services-body">
            {history.loading ? (
              <Pending />
            ) : (
              <ResourceState state={history}>
                <DataTable data={history.data} columns={columns} />
              </ResourceState>
            )}
          </div>
        </Panel>
        <Panel
          title="Trạng thái vận hành & Điều hướng"
          description="Tổng hợp từ dữ liệu API hiện có, không tạo dữ liệu giả."
          className="admin-ops-panel"
        >
          <dl className="details admin-ops-summary">
            <div>
              <dt>Robot trực tuyến / Tổng số</dt>
              <dd>{onlineRatio}</dd>
            </div>
            <div>
              <dt>Phiên AI ghi nhận</dt>
              <dd>{instanceSummary}</dd>
            </div>
          </dl>
          <div className="admin-quick-links" role="navigation" aria-label="Lối tắt quản trị">
            <Link href="/admin/robots" className="admin-quick-link">
              <Bot size={16} />
              <span>Robot & Pairing</span>
              <ArrowUpRight size={14} />
            </Link>
            <Link href="/admin/ai" className="admin-quick-link">
              <Sparkles size={16} />
              <span>AI Provider & Model</span>
              <ArrowUpRight size={14} />
            </Link>
            <Link href="/admin/quotas" className="admin-quick-link">
              <Gauge size={16} />
              <span>Chính sách Quota & Usage</span>
              <ArrowUpRight size={14} />
            </Link>
            <Link href="/admin/monitoring" className="admin-quick-link">
              <Activity size={16} />
              <span>Monitoring & Audit Logs</span>
              <ArrowUpRight size={14} />
            </Link>
          </div>
        </Panel>
      </div>
    </div>
  );
}
