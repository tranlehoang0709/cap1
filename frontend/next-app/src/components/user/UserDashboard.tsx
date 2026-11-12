'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Bot, MessageSquare, RefreshCw, Sparkles, AudioLines, CalendarDays } from 'lucide-react';
import { object } from '@/lib/contracts';
import { Button } from '@/components/ui/button';
import {
  cols,
  DataTable,
  defaultDateRange,
  Notice,
  Panel,
  ResourceState,
  toDateInputValue,
  useResource,
} from '@/components/data-ui';
import { RobotViewer } from '@/components/robot-viewer';

type Resource = ReturnType<typeof useResource>;
const robotColumns = cols('display_name', 'connection_status', 'lifecycle_status');
const usageColumns = cols('provider_id', 'requests', 'input_tokens', 'output_tokens', 'tokens');

function total(data: unknown) {
  try {
    return object(data).total;
  } catch {
    return undefined;
  }
}
function number(value: unknown) {
  return typeof value === 'number' ? new Intl.NumberFormat('vi-VN').format(value) : '—';
}

export function UserDashboard() {
  // Preserve the original operations, query sizes, and independent reloads.
  const robots = useResource('robots', { page: '1', limit: '20' });
  const history = useResource('conversations', { page: '1', limit: '5' });
  return (
    <UserDashboardView robots={robots} history={history}>
      <Usage />
    </UserDashboardView>
  );
}

export function UserDashboardView({
  robots,
  history,
  children,
}: {
  robots: Resource;
  history: Resource;
  children: React.ReactNode;
}) {
  return (
    <div className="user-dashboard">
      <section className="ud-welcome welcome-band" aria-labelledby="ud-welcome-title">
        <div className="ud-welcome-copy">
          <span className="ud-eyebrow">
            <span /> KHÔNG GIAN CỦA BẠN
          </span>
          <h2 id="ud-welcome-title">
            Chào một ngày <span>nhiều kết nối.</span>
          </h2>
          <p>Robot và trợ lý cá nhân của bạn trong cùng một không gian điều khiển.</p>
        </div>
        <div className="ud-welcome-actions">
          <Button asChild>
            <Link href="/user/chat">
              Mở AI Chat <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
          </Button>
          <div className="ud-welcome-mark" aria-hidden="true">
            <AudioLines strokeWidth={1.25} />
            <span>AIVA · NOVA</span>
          </div>
        </div>
      </section>

      <div className="ud-metrics">
        <section className="ud-metric" aria-label="Robot đã ghép">
          <div className="ud-metric-label">
            <span>Robot đã ghép</span>
            <Bot size={19} aria-hidden="true" />
          </div>
          <ResourceState state={robots}>
            <strong>{number(total(robots.data))}</strong>
            <p>Thiết bị trong không gian của bạn</p>
          </ResourceState>
        </section>
        <section className="ud-metric" aria-label="Hội thoại đã lưu">
          <div className="ud-metric-label">
            <span>Hội thoại đã lưu</span>
            <MessageSquare size={19} aria-hidden="true" />
          </div>
          <ResourceState state={history}>
            <strong>{number(total(history.data))}</strong>
            <p>Những cuộc trò chuyện cùng AIVA</p>
          </ResourceState>
        </section>
        <section className="ud-personal">
          <div className="ud-metric-label">
            <span>Không gian cá nhân</span>
            <Sparkles size={19} aria-hidden="true" />
          </div>
          <h3>
            Trợ lý của bạn.
            <br />
            Theo cách của bạn.
          </h3>
          <Link href="/user/assistant">
            Tùy chỉnh trải nghiệm <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </section>
      </div>

      <div className="ud-main-grid">
        <Panel
          className="ud-robots"
          title="Robot gần đây"
          description="Kết nối và trạng thái thiết bị của bạn."
          actions={
            <Button variant="ghost" onClick={robots.reload} aria-label="Tải lại robot">
              <RefreshCw size={16} />
            </Button>
          }
        >
          <ResourceState state={robots}>
            <DataTable data={robots.data} columns={robotColumns} />
          </ResourceState>
        </Panel>
        <Panel
          className="ud-companion"
          title="NOVA, bên cạnh bạn"
          description="Nhận diện đồng nhất cùng trợ lý AI của bạn."
        >
          <RobotViewer />
        </Panel>
      </div>
      {children}
    </div>
  );
}

export function Usage() {
  const [range, setRange] = useState(defaultDateRange);
  const state = useResource('usage', range);
  return <UserUsageView state={state} range={range} onApply={setRange} />;
}

export function UserUsageView({
  state,
  range,
  onApply,
}: {
  state: Resource;
  range?: { from: string; to: string };
  onApply: (range: { from: string; to: string }) => void;
}) {
  const effectiveRange = range ?? defaultDateRange();
  const [fromValue, setFromValue] = useState(() => toDateInputValue(effectiveRange.from));
  const [toValue, setToValue] = useState(() => toDateInputValue(effectiveRange.to));
  const [filterError, setFilterError] = useState('');

  return (
    <Panel
      className="ud-usage"
      title="Mức sử dụng AI"
      description="Tổng hợp số yêu cầu và token trong khoảng thời gian đã chọn."
    >
      <form
        className="ud-filter"
        onSubmit={(event) => {
          event.preventDefault();
          if (!fromValue || !toValue) {
            setFilterError('Vui lòng chọn đầy đủ ngày bắt đầu và ngày kết thúc.');
            return;
          }
          if (fromValue > toValue) {
            setFilterError('Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc.');
            return;
          }
          setFilterError('');
          onApply({
            from: new Date(fromValue + 'T00:00:00').toISOString(),
            to: new Date(toValue + 'T23:59:59').toISOString(),
          });
        }}
      >
        <CalendarDays size={18} aria-hidden="true" />
        <label>
          Từ ngày
          <input
            name="from"
            type="date"
            required
            value={fromValue}
            max={toValue || undefined}
            onChange={(e) => {
              setFromValue(e.target.value);
              if (filterError) setFilterError('');
            }}
          />
        </label>
        <label>
          Đến ngày
          <input
            name="to"
            type="date"
            required
            value={toValue}
            min={fromValue || undefined}
            onChange={(e) => {
              setToValue(e.target.value);
              if (filterError) setFilterError('');
            }}
          />
        </label>
        <Button variant="outline">Áp dụng</Button>
      </form>
      <Notice error={filterError} />
      <ResourceState state={state}>
        <DataTable data={state.data} columns={usageColumns} />
      </ResourceState>
    </Panel>
  );
}
