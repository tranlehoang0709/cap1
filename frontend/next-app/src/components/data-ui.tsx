'use client';
import { useEffect, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, Inbox, AlertCircle, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/client';
import { type Row, rows, object } from '@/lib/contracts';
import { display, date } from '@/lib/utils';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { LoadingSkeleton } from './motion/VisibleMotion';

export const COLUMN_LABELS: Record<string, string> = {
  id: 'ID',
  display_name: 'Tên hiển thị',
  device_uid: 'Robot UID',
  device_id: 'Mã thiết bị',
  deviceId: 'Mã thiết bị',
  connection_status: 'Kết nối',
  lifecycle_status: 'Vòng đời',
  reset_status: 'Trạng thái reset',
  email: 'Email',
  email_verified_at: 'Xác minh email lúc',
  role: 'Vai trò',
  status: 'Trạng thái',
  created_at: 'Thời điểm tạo',
  createdAt: 'Thời điểm tạo',
  updated_at: 'Cập nhật lúc',
  updatedAt: 'Cập nhật lúc',
  last_seen_at: 'Heartbeat gần nhất',
  last_healthcheck_at: 'Kiểm tra gần nhất',
  released_at: 'Thời điểm phát hành',
  started_at: 'Bắt đầu lúc',
  expires_at: 'Hết hạn lúc',
  expiresAt: 'Hết hạn lúc',
  restored_at: 'Khôi phục lúc',
  restoredAt: 'Khôi phục lúc',
  acknowledged_at: 'Xác nhận ACK lúc',
  acknowledgedAt: 'Xác nhận ACK lúc',
  requested_at: 'Yêu cầu lúc',
  requestedAt: 'Yêu cầu lúc',
  provider_id: 'Mã Provider',
  providerId: 'Mã Provider',
  user_id: 'Mã người dùng',
  userId: 'Mã người dùng',
  actor_user_id: 'Người thực hiện',
  target_id: 'Đối tượng tác động',
  instance_code: 'Mã phiên AI',
  label: 'Nhãn khóa',
  secret_hint: 'Gợi ý khóa',
  is_active: 'Đang hoạt động',
  is_enabled: 'Đang bật',
  version: 'Phiên bản',
  hardware_model: 'Mẫu phần cứng',
  title: 'Tiêu đề',
  channel: 'Kênh',
  name: 'Tên',
  code: 'Mã định danh',
  health_status: 'Tình trạng sức khỏe',
  model_code: 'Mã model',
  capability: 'Khả năng',
  severity: 'Mức độ',
  component: 'Thành phần',
  message: 'Nội dung',
  action: 'Hành động',
  key: 'Khóa cấu hình',
  setting_key: 'Khóa cấu hình',
  value: 'Giá trị cấu hình',
  setting_value: 'Giá trị cấu hình',
  requests: 'Số yêu cầu',
  input_tokens: 'Token đầu vào',
  output_tokens: 'Token đầu ra',
  tokens: 'Tổng token',
  total_tokens: 'Tổng token',
  requests_per_minute: 'Request / phút',
  requests_per_day: 'Request / ngày',
  tokens_per_month: 'Token / tháng',
  backupId: 'Mã bản sao lưu',
  backup_id: 'Mã bản sao lưu',
  operationId: 'Mã tiến trình',
  operation_id: 'Mã tiến trình',
  reason: 'Lý do',
  note: 'Ghi chú',
  description: 'Mô tả chi tiết',
  priority: 'Mức độ ưu tiên',
  due_at: 'Thời hạn',
  dueAt: 'Thời hạn',
  completed_at: 'Hoàn thành lúc',
  completedAt: 'Hoàn thành lúc',
  cancelled_at: 'Hủy lúc',
  cancelledAt: 'Hủy lúc',
  plan_id: 'Mã kế hoạch',
  planId: 'Mã kế hoạch',
  plan_title: 'Kế hoạch cá nhân',
  planTitle: 'Kế hoạch cá nhân',
  session_number: 'Buổi thứ',
  sessionNumber: 'Buổi thứ',
  total_sessions: 'Tổng số buổi',
  totalSessions: 'Tổng số buổi',
  completed_sessions: 'Số buổi hoàn thành',
  completedSessions: 'Số buổi hoàn thành',
  remaining_sessions: 'Số buổi còn lại',
  remainingSessions: 'Số buổi còn lại',
  progress_percent: 'Tiến độ (%)',
  progressPercent: 'Tiến độ (%)',
  instance_id: 'Mã phiên AI',
  cpu_percent: 'CPU (%)',
  memory_percent: 'RAM (%)',
  gpu_percent: 'GPU (%)',
  gpu_memory_percent: 'VRAM (%)',
  active_sessions: 'Phiên hoạt động',
  recorded_at: 'Ghi nhận lúc',
  robot_count: 'Số robot',
  ended_at: 'Kết thúc lúc',
};

export function colLabel(key: string): string {
  if (COLUMN_LABELS[key]) return COLUMN_LABELS[key];
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

export const cols = (...keys: string[]) =>
  keys.map((key) => ({ key, label: colLabel(key) }));

export function defaultDateRange() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    from: firstDay.toISOString(),
    to: now.toISOString(),
  };
}

export function toDateInputValue(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function useResource(
  operation: string,
  query: Record<string, string> = {},
  params: Record<string, unknown> = {}
) {
  const q = JSON.stringify(query),
    p = JSON.stringify(params),
    requestKey = operation + q + p;
  const [state, setState] = useState<{
    requestKey?: string;
    data?: unknown;
    error?: string;
    loading: boolean;
  }>({ loading: true });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    api(operation, { query: JSON.parse(q), params: JSON.parse(p) })
      .then((data) => {
        if (alive) setState({ requestKey, data, loading: false });
      })
      .catch((e) => {
        if (alive) setState({ requestKey, error: e.message, loading: false });
      });
    return () => {
      alive = false;
    };
  }, [operation, q, p, requestKey, version]);
  const reload = useCallback(() => {
    setState({ requestKey, loading: true });
    setVersion((x) => x + 1);
  }, [requestKey]);
  const stale = state.requestKey !== requestKey;
  return {
    data: stale ? undefined : state.data,
    error: stale ? undefined : state.error,
    loading: stale || state.loading,
    reload,
  };
}

export function Status({ children }: { children: unknown }) {
  const s = display(children);
  const good = /^(online|active|approved|acknowledged|completed|released|success|healthy|ok|info|true|đang bật|có)$/i.test(s);
  const bad = /^(offline|failed|rejected|suspended|disabled|revoked|error|critical|expired|unhealthy)$/i.test(s);
  return (
    <span className={'status ' + (good ? 'good' : bad ? 'bad' : 'neutral')}>
      <i />
      {s}
    </span>
  );
}

export function Notice({ error, success }: { error?: string; success?: string }) {
  return (
    <>
      {error && (
        <div className="alert error" role="alert">
          <AlertCircle size={17} />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="alert success" role="status">
          <CheckCircle2 size={17} />
          <span>{success}</span>
        </div>
      )}
    </>
  );
}

export function Blocked({ children }: { children: React.ReactNode }) {
  return (
    <div className="blocked">
      <span className="status neutral">BLOCKED</span>
      <p>{children}</p>
    </div>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className = '',
}: {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={'panel ' + className}>
      {(title || actions) && (
        <div className="panel-heading">
          <div>
            <h2>{title}</h2>
            {description && <p className="muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function ResourceState({
  state,
  children,
}: {
  state: {
    loading: boolean;
    error?: string;
    reload: () => void;
  };
  children: React.ReactNode;
}) {
  if (state.loading) return <LoadingSkeleton />;
  if (state.error)
    return (
      <div className="resource-error">
        <Notice error={state.error} />
        <Button variant="outline" onClick={state.reload}>
          <RefreshCw size={15} />
          Tải lại dữ liệu
        </Button>
      </div>
    );
  return children;
}

export type Column = {
  key: string;
  label: string;
};

const NUMERIC_COLUMNS = new Set([
  'requests',
  'input_tokens',
  'output_tokens',
  'tokens',
  'total_tokens',
  'requests_per_minute',
  'requests_per_day',
  'tokens_per_month',
]);

export function formatCell(key: string, rawValue: unknown, row?: Row): React.ReactNode {
  let value = rawValue;
  if (value === undefined && row) {
    if (key === 'setting_key') value = row.key;
    else if (key === 'setting_value') value = row.value;
    else if (key === 'backupId') value = row.backup_id;
    else if (key === 'operationId') value = row.operation_id;
    else if (key === 'createdAt') value = row.created_at;
    else if (key === 'expiresAt') value = row.expires_at;
    else if (key === 'restoredAt') value = row.restored_at;
  }
  if (value === null || value === undefined || value === '') return '—';
  if (/status$/i.test(key) || key === 'severity') {
    return <Status>{value}</Status>;
  }
  if (key === 'is_enabled' || key === 'is_active') {
    if (typeof value === 'boolean') {
      return <Status>{value ? 'Đang bật' : 'Đang tắt'}</Status>;
    }
  }
  if (/(_at|At)$/.test(key)) {
    return date(value);
  }
  if (NUMERIC_COLUMNS.has(key)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return new Intl.NumberFormat('vi-VN').format(value);
    }
    if (typeof value === 'string' && /^\d+$/.test(value)) {
      try {
        return BigInt(value).toLocaleString('vi-VN');
      } catch {
        return value;
      }
    }
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return '—';
    return (
      <span className="structured-cell">
        {entries.map(([k, v]) => `${colLabel(k)}: ${display(v)}`).join(' · ')}
      </span>
    );
  }
  return display(value);
}

export function DataTable({
  data,
  columns,
  actions,
}: {
  data: unknown;
  columns: Column[];
  actions?: (row: Row) => React.ReactNode;
}) {
  let items: Row[];
  try {
    items = rows(data);
  } catch (e) {
    return <Notice error={(e as Error).message} />;
  }
  if (!items.length)
    return (
      <div className="empty-state">
        <Inbox size={28} />
        <h3>Chưa có dữ liệu</h3>
        <p>Thông tin sẽ xuất hiện khi Backend có bản ghi.</p>
      </div>
    );
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
            {actions && <th>Thao tác</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((r, i) => (
            <tr key={String(r.id ?? r.backupId ?? r.setting_key ?? r.key ?? i)}>
              {columns.map((c) => (
                <td key={c.key}>{formatCell(c.key, r[c.key], r)}</td>
              ))}
              {actions && (
                <td>
                  <div className="row-actions">{actions(r)}</div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StructuredDataView({
  data,
  preferredColumns,
  emptyTitle = 'Chưa có dữ liệu',
  emptyDescription = 'Thông tin sẽ xuất hiện khi Backend trả về bản ghi.',
  allowTechnicalJson = false,
}: {
  data: unknown;
  preferredColumns?: Column[];
  emptyTitle?: string;
  emptyDescription?: string;
  allowTechnicalJson?: boolean;
}) {
  if (data === null || data === undefined) {
    return (
      <div className="empty-state">
        <Inbox size={28} />
        <h3>{emptyTitle}</h3>
        <p>{emptyDescription}</p>
      </div>
    );
  }
  let listItems: Row[] | null = null;
  try {
    listItems = rows(data);
  } catch {
    listItems = null;
  }
  if (listItems !== null) {
    if (!listItems.length) {
      return (
        <div className="empty-state">
          <Inbox size={28} />
          <h3>{emptyTitle}</h3>
          <p>{emptyDescription}</p>
        </div>
      );
    }
    const derivedColumns =
      preferredColumns && preferredColumns.length
        ? preferredColumns
        : cols(...Object.keys(listItems[0]).slice(0, 7));
    return (
      <>
        <DataTable data={listItems} columns={derivedColumns} />
        {allowTechnicalJson && (
          <details className="technical-details">
            <summary>Chi tiết kỹ thuật (JSON)</summary>
            <pre className="data-preview">{JSON.stringify(data, null, 2)}</pre>
          </details>
        )}
      </>
    );
  }

  let record: Row = {};
  try {
    record = object(data);
  } catch {
    return <p className="muted">{display(data)}</p>;
  }
  const entries = Object.entries(record).filter(([, v]) => v !== undefined);
  if (!entries.length) {
    return (
      <div className="empty-state">
        <Inbox size={28} />
        <h3>{emptyTitle}</h3>
        <p>{emptyDescription}</p>
      </div>
    );
  }
  const scalarEntries = entries.filter(
    ([, v]) => v === null || typeof v !== 'object'
  );
  const arrayEntries = entries.filter(([, v]) => Array.isArray(v));

  return (
    <div className="structured-data-view">
      {scalarEntries.length > 0 && (
        <dl className="details">
          {scalarEntries.map(([k, v]) => (
            <div key={k}>
              <dt>{colLabel(k)}</dt>
              <dd>{formatCell(k, v, record)}</dd>
            </div>
          ))}
        </dl>
      )}
      {arrayEntries.map(([k, arr]) => {
        const list = (arr as unknown[]).filter(
          (item): item is Row => !!item && typeof item === 'object' && !Array.isArray(item)
        );
        if (!list.length) return null;
        return (
          <div key={k} className="structured-subtable">
            <h3 className="subtable-heading">{colLabel(k)}</h3>
            <DataTable
              data={list}
              columns={
                preferredColumns && preferredColumns.length
                  ? preferredColumns
                  : cols(...Object.keys(list[0]).slice(0, 7))
              }
            />
          </div>
        );
      })}
      {allowTechnicalJson && (
        <details className="technical-details">
          <summary>Chi tiết kỹ thuật (JSON)</summary>
          <pre className="data-preview">{JSON.stringify(data, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

export function Pagination({
  data,
  page,
  setPage,
}: {
  data: unknown;
  page: number;
  setPage: (v: number) => void;
}) {
  let total: number | undefined;
  try {
    const d = object(data);
    if (typeof d.total === 'number') total = d.total;
  } catch {}
  return (
    <div className="pagination">
      <span>
        {total === undefined ? 'Danh sách từ Backend' : `${total} bản ghi`} · Trang {page}
      </span>
      <div>
        <Button
          variant="outline"
          disabled={page <= 1}
          aria-label="Trang trước"
          onClick={() => setPage(page - 1)}
        >
          <ChevronLeft size={16} />
        </Button>
        <Button
          variant="outline"
          disabled={total === undefined || page * 20 >= total}
          aria-label="Trang sau"
          onClick={() => setPage(page + 1)}
        >
          <ChevronRight size={16} />
        </Button>
      </div>
    </div>
  );
}

export type Field = {
  name: string;
  label: string;
  type?: 'text' | 'password' | 'email' | 'number' | 'textarea' | 'select' | 'checkbox' | 'json' | 'url';
  required?: boolean;
  max?: number;
  min?: number;
  options?: {
    value: string;
    label: string;
  }[];
  value?: unknown;
  placeholder?: string;
};

export const rowId = (r: Row) => ({ id: String(r.id) });

export const textField = (
  name: string,
  label: string,
  value?: unknown,
  max = 120
): Field => ({
  name,
  label,
  value,
  max,
  required: true,
});

export const selectField = (
  name: string,
  label: string,
  values: string[],
  value?: unknown
): Field => ({
  name,
  label,
  type: 'select',
  required: true,
  value,
  options: values.map((x) => ({ value: x, label: x })),
});

export type Action = {
  title: string;
  operation: string;
  params?: Record<string, unknown>;
  fields?: Field[];
  body?: Row;
  danger?: boolean;
  requireConfirm?: boolean;
  description?: string;
  idempotencyKey?: string;
  onDone?: (data: unknown) => void;
};

const STRICT_CONFIRM_OPERATIONS = new Set([
  'revoke',
  'restore',
  'reject',
  'conversationDelete',
  'userAiDataDelete',
  'personalTaskDelete',
  'userRole',
  'userStatus',
  'systemKeyRevoke',
  'quotaDelete',
  'firmwareRelease',
  'password',
]);

export function requiresStrictConfirmation(action: Action | null): boolean {
  if (!action) return false;
  return Boolean(
    action.danger ||
      action.requireConfirm ||
      STRICT_CONFIRM_OPERATIONS.has(action.operation)
  );
}

export function ActionDialog({
  action,
  close,
  onDone,
}: {
  action: Action | null;
  close: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState(false);
  const strictConfirm = requiresStrictConfirmation(action);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!action || (strictConfirm && !accepted)) return;
    setBusy(true);
    setError('');
    const data = new FormData(e.currentTarget);
    const params = { ...action.params };
    const body: Row = { ...action.body };
    try {
      for (const f of action.fields || []) {
        const v = data.get(f.name);
        if (f.name === '__key') {
          params.key = String(v);
          continue;
        }
        if (f.type === 'checkbox') body[f.name] = v === 'on';
        else if (f.type === 'json') body[f.name] = JSON.parse(String(v));
        else if (f.type === 'number') {
          if (v !== '' && v !== null) body[f.name] = Number(v);
        } else if (v !== '' && v !== null) body[f.name] = String(v);
      }
      const result = await api(action.operation, {
        params,
        body,
        idempotencyKey: action.idempotencyKey,
      });
      if (result === null)
        throw new Error(
          'Backend chưa trả xác nhận thao tác. Hãy kiểm tra dữ liệu trước khi thử lại.'
        );
      action.onDone?.(result);
      onDone();
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={!!action}
      busy={busy}
      onOpenChange={(v) => {
        if (!v && !busy) close();
      }}
      title={action?.title || 'Thao tác'}
      description={action?.description}
    >
      <form className="form-stack" onSubmit={submit}>
        {action?.fields?.map((f) => (
          <FieldControl key={f.name} field={f} />
        ))}
        <Notice error={error} />
        {strictConfirm && (
          <label className="check-label">
            <input
              type="checkbox"
              required
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            Tôi xác nhận thông tin và thao tác quan trọng này.
          </label>
        )}
        <div className="form-actions">
          <Button type="button" variant="outline" disabled={busy} onClick={close}>
            Hủy
          </Button>
          <Button
            variant={action?.danger ? 'destructive' : 'default'}
            disabled={busy || (strictConfirm && !accepted)}
          >
            {busy ? 'Đang chờ Backend…' : 'Xác nhận'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function FieldControl({ field: f }: { field: Field }) {
  if (f.type === 'checkbox')
    return (
      <label className="check-label">
        <input name={f.name} type="checkbox" defaultChecked={f.value === true} />
        {f.label}
      </label>
    );
  return (
    <label>
      {f.label}
      {f.type === 'select' ? (
        <select name={f.name} required={f.required} defaultValue={String(f.value ?? '')}>
          <option value="">Chọn…</option>
          {f.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : f.type === 'textarea' || f.type === 'json' ? (
        <textarea
          name={f.name}
          required={f.required}
          maxLength={f.max}
          defaultValue={
            f.type === 'json' ? JSON.stringify(f.value ?? {}, null, 2) : String(f.value ?? '')
          }
          rows={5}
        />
      ) : (
        <input
          name={f.name}
          type={f.type || 'text'}
          required={f.required}
          maxLength={f.type === 'number' ? undefined : f.max}
          max={f.type === 'number' ? f.max : undefined}
          min={f.type === 'number' ? f.min : undefined}
          minLength={f.type !== 'number' ? f.min : undefined}
          step={f.type === 'number' ? 1 : undefined}
          defaultValue={String(f.value ?? '')}
          placeholder={f.placeholder}
          autoComplete={f.type === 'password' ? 'new-password' : 'off'}
        />
      )}
    </label>
  );
}

export function useActions(reload: () => void) {
  const [action, setAction] = useState<Action | null>(null);
  const [notice, setNotice] = useState('');
  return {
    open: setAction,
    notice,
    dialog: (
      <ActionDialog
        key={action ? JSON.stringify([action.title, action.params]) : 'closed'}
        action={action}
        close={() => setAction(null)}
        onDone={() => {
          setNotice('Backend đã xác nhận thao tác.');
          reload();
        }}
      />
    ),
  };
}
