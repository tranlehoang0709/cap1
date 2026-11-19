'use client';
import { useState } from 'react';
import { Cpu, Plus, RefreshCw } from 'lucide-react';
import { rows, type Row } from '@/lib/contracts';
import { filterSystemSettings } from '@/lib/validation';
import { Button } from '../ui/button';
import {
  Blocked,
  cols,
  DataTable,
  type Field,
  Notice,
  Pagination,
  Panel,
  ResourceState,
  rowId,
  selectField,
  StructuredDataView,
  textField,
  useActions,
  useResource,
} from '../data-ui';

export { rowId, selectField, textField, type Field };

export function Recovery({
  deviceId,
  close,
}: {
  deviceId: string;
  close: () => void;
}) {
  const state = useResource('recovery', {}, { id: deviceId });
  const status = useResource('resetStatus', {}, { id: deviceId });
  const acts = useActions(() => {
    state.reload();
    status.reload();
  });
  let backups: unknown = [];
  try {
    if (state.data && typeof state.data === 'object' && !Array.isArray(state.data)) {
      backups = (state.data as Row).backups || [];
    }
  } catch {}

  return (
    <Panel
      title={'Recovery · Robot #' + deviceId}
      description="Trạng thái được Backend xác nhận. Không suy diễn reset từ việc gửi yêu cầu."
      actions={
        <Button variant="ghost" onClick={close}>
          Đóng
        </Button>
      }
    >
      <Notice success={acts.notice} />
      <ResourceState state={status}>
        <StructuredDataView
          data={status.data}
          emptyTitle="Chưa có tiến trình reset"
          emptyDescription="Thiết bị hiện chưa có bản ghi trạng thái reset từ Backend."
          allowTechnicalJson
        />
      </ResourceState>
      <div className="toolbar">
        <Button
          variant="outline"
          onClick={() => {
            state.reload();
            status.reload();
          }}
        >
          Kiểm tra trạng thái / ACK
        </Button>
        <Button
          variant="destructive"
          onClick={() =>
            acts.open({
              title: 'Thu hồi và yêu cầu reset',
              operation: 'revoke',
              params: { id: deviceId },
              idempotencyKey: crypto.randomUUID(),
              fields: [{ name: 'reason', label: 'Lý do', type: 'textarea', max: 500 }],
              danger: true,
              description:
                'Backend sẽ tạo backup và reset job. Thiết bị có thể ở reset_pending cho đến khi nhận ACK thật.',
            })
          }
        >
          Thu hồi & yêu cầu reset
        </Button>
      </div>
      <ResourceState state={state}>
        <DataTable
          data={backups}
          columns={cols('backupId', 'operationId', 'createdAt', 'expiresAt', 'restoredAt')}
          actions={(r) => (
            <Button
              variant="outline"
              onClick={() =>
                acts.open({
                  title: 'Khôi phục assignment',
                  operation: 'restore',
                  params: { id: String(r.backupId ?? r.backup_id) },
                  danger: true,
                  description:
                    'Backend chỉ cho phép khi reset đã xác nhận, backup còn hạn và điều kiện ownership hợp lệ.',
                })
              }
            >
              Khôi phục
            </Button>
          )}
        />
      </ResourceState>
      {acts.dialog}
    </Panel>
  );
}

export function Users() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const state = useResource('users', {
    page: String(page),
    limit: '20',
    ...(search ? { search } : {}),
  });
  const acts = useActions(state.reload);

  return (
    <>
      <Notice success={acts.notice} />
      <Panel
        title="Người dùng nền tảng"
        actions={
          <Button
            onClick={() =>
              acts.open({
                title: 'Tạo tài khoản User',
                operation: 'userCreate',
                fields: [
                  textField('display_name', 'Tên hiển thị', undefined, 150),
                  { name: 'email', label: 'Email', type: 'email', required: true, max: 255 },
                  {
                    name: 'password',
                    label: 'Mật khẩu',
                    type: 'password',
                    required: true,
                    min: 8,
                    max: 72,
                  },
                ],
                description:
                  'Backend cấp role USER. Tài khoản cần được xác minh theo quy trình hiện có.',
              })
            }
          >
            <Plus size={16} />
            Tạo User
          </Button>
        }
      >
        <form
          className="filter-bar"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(String(new FormData(e.currentTarget).get('search') || '').trim());
          }}
        >
          <label>
            Tìm người dùng
            <input name="search" placeholder="Tên hoặc email…" maxLength={128} />
          </label>
          <Button variant="outline">Tìm kiếm</Button>
        </form>
        <ResourceState state={state}>
          <DataTable
            data={state.data}
            columns={cols('id', 'display_name', 'email', 'role', 'robot_count', 'status')}
            actions={(r) => (
              <>
                <Button
                  variant="ghost"
                  onClick={() =>
                    acts.open({
                      title: 'Đổi vai trò',
                      operation: 'userRole',
                      params: rowId(r),
                      fields: [selectField('role', 'Vai trò', ['USER', 'ADMIN'], r.role)],
                      danger: true,
                    })
                  }
                >
                  Vai trò
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    acts.open({
                      title: 'Đổi trạng thái tài khoản',
                      operation: 'userStatus',
                      params: rowId(r),
                      fields: [
                        selectField(
                          'status',
                          'Trạng thái',
                          ['active', 'suspended', 'disabled'],
                          r.status
                        ),
                      ],
                      danger: true,
                    })
                  }
                >
                  Trạng thái
                </Button>
              </>
            )}
          />
          <Pagination data={state.data} page={page} setPage={setPage} />
        </ResourceState>
      </Panel>
      {acts.dialog}
    </>
  );
}

export function AI() {
  const state = useResource('providers');
  const models = useResource('models');
  const acts = useActions(() => {
    state.reload();
    models.reload();
  });
  let providers: Row[] = [];
  try {
    providers = rows(state.data);
  } catch {}
  const options = providers.map((p) => ({
    value: String(p.id),
    label: String(p.name || p.code),
  }));

  return (
    <>
      <Notice success={acts.notice} />
      <Panel
        title="AI Provider"
        description="Điều khiển dịch vụ nền tảng. Người dùng không có quyền chọn provider."
      >
        <ResourceState state={state}>
          <DataTable
            data={state.data}
            columns={cols('id', 'name', 'code', 'is_enabled', 'health_status')}
            actions={(r) => (
              <Button
                variant="outline"
                onClick={() =>
                  acts.open({
                    title: 'Cấu hình provider',
                    operation: 'providerSave',
                    params: rowId(r),
                    fields: [
                      {
                        name: 'is_enabled',
                        label: 'Bật provider',
                        type: 'checkbox',
                        value: r.is_enabled,
                      },
                      {
                        name: 'health_status',
                        label: 'Tình trạng sức khỏe (metadata)',
                        max: 24,
                        value: r.health_status,
                      },
                    ],
                    description:
                      'Health status là metadata cấu hình, không phải kết quả probe trực tiếp.',
                  })
                }
              >
                Cấu hình
              </Button>
            )}
          />
        </ResourceState>
      </Panel>
      <Panel
        title="Danh mục model"
        actions={
          <Button
            disabled={!options.length}
            onClick={() =>
              acts.open({
                title: 'Thêm model',
                operation: 'modelCreate',
                fields: [
                  {
                    name: 'provider_id',
                    label: 'Nhà cung cấp (Provider)',
                    type: 'select',
                    options,
                    required: true,
                  },
                  textField('model_code', 'Mã model'),
                  selectField('capability', 'Khả năng', ['llm', 'stt', 'tts']),
                  {
                    name: 'is_enabled',
                    label: 'Bật model',
                    type: 'checkbox',
                    value: true,
                  },
                ],
              })
            }
          >
            <Plus size={16} />
            Thêm model
          </Button>
        }
      >
        <ResourceState state={models}>
          <DataTable
            data={models.data}
            columns={cols('id', 'provider_id', 'model_code', 'capability', 'is_enabled')}
            actions={(r) => (
              <Button
                variant="outline"
                onClick={() =>
                  acts.open({
                    title: 'Cập nhật model',
                    operation: 'modelSave',
                    params: rowId(r),
                    fields: [
                      textField('model_code', 'Mã model', r.model_code),
                      {
                        name: 'is_enabled',
                        label: 'Bật model',
                        type: 'checkbox',
                        value: r.is_enabled,
                      },
                    ],
                  })
                }
              >
                Chỉnh sửa
              </Button>
            )}
          />
        </ResourceState>
      </Panel>
      <Blocked>
        Chính sách chọn provider cho User chưa có API quản trị riêng. Provider Chat của
        frontend này được quản trị viên cấu hình bằng AIVA_CHAT_PROVIDER_ID phía server.
      </Blocked>
      {acts.dialog}
    </>
  );
}

export function SystemKeys() {
  const state = useResource('systemKeys');
  const providers = useResource('providers');
  const acts = useActions(state.reload);
  let options: { value: string; label: string }[] = [];
  try {
    options = rows(providers.data)
      .filter((p) => p.is_enabled === true)
      .map((p) => ({ value: String(p.id), label: String(p.name || p.code) }));
  } catch {}

  return (
    <>
      <Notice success={acts.notice} />
      <Panel
        title="System API Key"
        description="Chỉ lưu khóa hệ thống. Giá trị đã lưu không được đọc lại từ giao diện."
        actions={
          <Button
            disabled={!options.length}
            onClick={() =>
              acts.open({
                title: 'Thêm system key',
                operation: 'systemKeyCreate',
                fields: [
                  {
                    name: 'provider_id',
                    label: 'Nhà cung cấp (Provider)',
                    type: 'select',
                    required: true,
                    options,
                  },
                  textField('label', 'Nhãn khóa', undefined, 100),
                  {
                    name: 'secret',
                    label: 'API key',
                    type: 'password',
                    required: true,
                    min: 8,
                    max: 4096,
                  },
                ],
              })
            }
          >
            <Plus size={16} />
            Thêm khóa
          </Button>
        }
      >
        <ResourceState state={providers}>
          <ResourceState state={state}>
            <DataTable
              data={state.data}
              columns={cols(
                'id',
                'provider_id',
                'label',
                'secret_hint',
                'is_active',
                'created_at'
              )}
              actions={(r) =>
                r.is_active !== false && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      acts.open({
                        title: 'Thu hồi system key',
                        operation: 'systemKeyRevoke',
                        params: rowId(r),
                        danger: true,
                      })
                    }
                  >
                    Thu hồi
                  </Button>
                )
              }
            />
          </ResourceState>
        </ResourceState>
      </Panel>
      <p className="fine">
        Backend chưa có endpoint kiểm tra system key trực tiếp. Thêm khóa thành công không
        xác nhận provider đang sẵn sàng.
      </p>
      {acts.dialog}
    </>
  );
}

export function Quotas() {
  const state = useResource('allQuotas');
  const acts = useActions(state.reload);
  return (
    <>
      <Notice success={acts.notice} />
      <Panel
        title="Chính sách quota"
        description="Phạm vi User/Provider để trống tương ứng với chính sách chung."
        actions={
          <Button
            onClick={() =>
              acts.open({
                title: 'Tạo / cập nhật quota',
                operation: 'quotaSave',
                fields: [
                  { name: 'user_id', label: 'Mã người dùng (tùy chọn)' },
                  { name: 'provider_id', label: 'Mã Provider (tùy chọn)' },
                  {
                    name: 'requests_per_minute',
                    label: 'Request / phút',
                    type: 'number',
                    min: 1,
                    max: 2147483647,
                  },
                  {
                    name: 'requests_per_day',
                    label: 'Request / ngày',
                    type: 'number',
                    min: 1,
                    max: 2147483647,
                  },
                  {
                    name: 'tokens_per_month',
                    label: 'Token / tháng (chuỗi số nguyên)',
                  },
                ],
                description:
                  'Các giới hạn bỏ trống là không đặt giới hạn. Kiểm tra kỹ phạm vi trước khi xác nhận.',
              })
            }
          >
            <Plus size={16} />
            Đặt quota
          </Button>
        }
      >
        <ResourceState state={state}>
          <DataTable
            data={state.data}
            columns={cols(
              'id',
              'user_id',
              'provider_id',
              'requests_per_minute',
              'requests_per_day',
              'tokens_per_month',
              'is_active'
            )}
            actions={(r) =>
              r.is_active !== false && (
                <Button
                  variant="outline"
                  onClick={() =>
                    acts.open({
                      title: 'Ngừng chính sách quota',
                      operation: 'quotaDelete',
                      params: rowId(r),
                      danger: true,
                    })
                  }
                >
                  Ngừng áp dụng
                </Button>
              )
            }
          />
        </ResourceState>
      </Panel>
      <AdminUsage />
      {acts.dialog}
    </>
  );
}

export function AdminUsage() {
  const [filter, setFilter] = useState<Record<string, string>>({});
  const state = useResource('adminUsage', filter);
  return (
    <Panel
      title="Thống kê mức sử dụng nền tảng"
      description="Tổng hợp từ quota ledger; Backend có thể chặn nếu schema hoặc contract chưa sẵn sàng."
    >
      <form
        className="filter-bar"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setFilter(
            Object.fromEntries(
              [...f.entries()].filter(([, v]) => String(v).trim() !== '')
            ) as Record<string, string>
          );
        }}
      >
        <label>
          Mã người dùng
          <input name="userId" placeholder="Tất cả người dùng…" />
        </label>
        <label>
          Mã Provider
          <input name="providerId" placeholder="Tất cả provider…" />
        </label>
        <Button variant="outline">Lọc</Button>
      </form>
      <ResourceState state={state}>
        <StructuredDataView
          data={state.data}
          preferredColumns={cols(
            'user_id',
            'provider_id',
            'requests',
            'input_tokens',
            'output_tokens',
            'tokens'
          )}
          emptyTitle="Chưa có dữ liệu thống kê usage"
          emptyDescription="Số liệu sẽ hiển thị khi Backend ghi nhận lượt sử dụng AI."
          allowTechnicalJson
        />
      </ResourceState>
    </Panel>
  );
}

export function Firmware() {
  const state = useResource('firmware');
  const acts = useActions(state.reload);
  return (
    <>
      <Notice success={acts.notice} />
      <Panel
        title="Firmware OTA"
        description="Đăng ký metadata và phát hành. Không build hoặc flash firmware từ website."
        actions={
          <Button
            onClick={() =>
              acts.open({
                title: 'Đăng ký firmware',
                operation: 'firmwareCreate',
                fields: [
                  textField('hardware_model', 'Mẫu phần cứng'),
                  textField('version', 'Phiên bản'),
                  { name: 'file_uri', label: 'URL firmware', type: 'url', required: true },
                  { ...textField('checksum_sha256', 'SHA-256'), max: 64 },
                ],
                description:
                  'File phải được lưu tại URL có thật. Backend kiểm tra checksum metadata.',
              })
            }
          >
            <Plus size={16} />
            Thêm firmware
          </Button>
        }
      >
        <ResourceState state={state}>
          <DataTable
            data={state.data}
            columns={cols('id', 'hardware_model', 'version', 'released_at', 'created_at')}
            actions={(r) => (
              <Button
                variant="outline"
                onClick={() =>
                  acts.open({
                    title: 'Phát hành firmware',
                    operation: 'firmwareRelease',
                    params: rowId(r),
                    danger: true,
                    description:
                      'Phát hành metadata OTA qua Backend. Không đồng nghĩa robot đã cài đặt.',
                  })
                }
              >
                Phát hành
              </Button>
            )}
          />
        </ResourceState>
      </Panel>
      {acts.dialog}
    </>
  );
}

export function Monitoring() {
  const [tab, setTab] = useState('instances');
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<Record<string, string>>({});
  const [selectedInstanceId, setSelectedInstanceId] = useState('');
  const [selectedInstanceCode, setSelectedInstanceCode] = useState('');
  const state = useResource(
    tab,
    tab === 'instances'
      ? {}
      : { page: String(page), limit: '20', ...(tab === 'logs' ? filter : {}) }
  );

  return (
    <>
      <Panel
        title="Vận hành nền tảng"
        actions={
          <Button variant="outline" onClick={state.reload}>
            <RefreshCw size={15} />
            Tải lại
          </Button>
        }
      >
        <div className="tabs" role="tablist" aria-label="Monitoring">
          {(
            [
              ['instances', 'Phiên AI (Instances)'],
              ['logs', 'Nhật ký hệ thống (System logs)'],
              ['audits', 'Nhật ký kiểm toán (Audit logs)'],
            ] as const
          ).map(([v, label]) => (
            <button
              type="button"
              key={v}
              role="tab"
              aria-selected={tab === v}
              onClick={() => {
                setTab(v);
                setPage(1);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'logs' && (
          <form
            className="filter-bar"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setFilter(
                Object.fromEntries(
                  [...new FormData(e.currentTarget).entries()].filter(
                    ([, v]) => String(v).trim() !== ''
                  )
                ) as Record<string, string>
              );
            }}
          >
            <label>
              Mức độ (Severity)
              <input name="severity" placeholder="error, warn, info…" />
            </label>
            <label>
              Thành phần (Component)
              <input name="component" placeholder="auth, ai, device…" />
            </label>
            <Button variant="outline">Lọc</Button>
          </form>
        )}
        <ResourceState state={state}>
          <DataTable
            data={state.data}
            columns={
              tab === 'instances'
                ? cols('id', 'instance_code', 'status', 'last_healthcheck_at', 'started_at')
                : tab === 'logs'
                  ? cols('id', 'severity', 'component', 'message', 'created_at')
                  : cols('id', 'actor_user_id', 'action', 'target_id', 'created_at')
            }
            actions={
              tab === 'instances'
                ? (r) => (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSelectedInstanceId(String(r.id));
                        setSelectedInstanceCode(String(r.instance_code || `#${r.id}`));
                      }}
                    >
                      Tài nguyên (CPU/RAM/GPU/VRAM)
                    </Button>
                  )
                : undefined
            }
          />
          {tab !== 'instances' && <Pagination data={state.data} page={page} setPage={setPage} />}
        </ResourceState>
      </Panel>
      {tab === 'instances' && selectedInstanceId && (
        <InstanceResourceMetrics
          key={selectedInstanceId}
          instanceId={selectedInstanceId}
          instanceCode={selectedInstanceCode}
          onClose={() => {
            setSelectedInstanceId('');
            setSelectedInstanceCode('');
          }}
        />
      )}
    </>
  );
}

function InstanceResourceMetrics({
  instanceId,
  instanceCode,
  onClose,
}: {
  instanceId: string;
  instanceCode: string;
  onClose: () => void;
}) {
  const metricsState = useResource('instanceMetrics', { limit: '20' }, { id: instanceId });
  let items: Row[] = [];
  try {
    items = rows(metricsState.data);
  } catch {}
  return (
    <Panel
      title={`Thông số tài nguyên AI Server · ${instanceCode} (ID #${instanceId})`}
      description="Dữ liệu CPU, RAM, GPU, VRAM và số phiên hoạt động từ bảng resource_metrics trên MySQL."
      actions={
        <div className="row-actions">
          <Button variant="outline" onClick={metricsState.reload}>
            <RefreshCw size={15} />
            Làm mới
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Đóng
          </Button>
        </div>
      }
    >
      <ResourceState state={metricsState}>
        {items.length === 0 ? (
          <div className="empty-state">
            <Cpu size={28} />
            <h3>Chưa có dữ liệu telemetry phần cứng</h3>
            <p>
              AI Server instance này chưa gửi bản ghi thông số CPU, RAM, GPU, VRAM nào vào
              bảng <code>resource_metrics</code>. Hệ thống không tạo số liệu giả.
            </p>
          </div>
        ) : (
          <DataTable
            data={items}
            columns={cols(
              'id',
              'cpu_percent',
              'memory_percent',
              'gpu_percent',
              'gpu_memory_percent',
              'active_sessions',
              'recorded_at'
            )}
          />
        )}
      </ResourceState>
    </Panel>
  );
}

function parseSetting(value: unknown) {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

export function Settings() {
  const state = useResource('settings');
  const acts = useActions(state.reload);
  return (
    <>
      <Notice success={acts.notice} />
      <Panel
        title="Cấu hình hệ thống (System Settings)"
        description="Giá trị JSON. Không lưu secret, token hoặc API key tại đây."
        actions={
          <Button
            onClick={() =>
              acts.open({
                title: 'Tạo cấu hình',
                operation: 'settingSave',
                fields: [
                  textField('__key', 'Khóa cấu hình (chữ, số, dấu . _ -)', undefined, 120),
                  { name: 'value', label: 'Giá trị JSON', type: 'json', required: true },
                ],
                description:
                  'Khóa cấu hình không được chứa secret, token, password hoặc API key.',
              })
            }
          >
            <Plus size={16} />
            Thêm cấu hình
          </Button>
        }
      >
        <ResourceState state={state}>
          <DataTable
            data={filterSystemSettings(state.data)}
            columns={cols('setting_key', 'setting_value', 'updated_at')}
            actions={(r) => (
              <Button
                variant="outline"
                onClick={() =>
                  acts.open({
                    title: 'Cập nhật ' + String(r.key ?? r.setting_key),
                    operation: 'settingSave',
                    params: { key: String(r.key ?? r.setting_key) },
                    fields: [
                      {
                        name: 'value',
                        label: 'Giá trị JSON',
                        type: 'json',
                        value: parseSetting(r.value ?? r.setting_value),
                        required: true,
                      },
                    ],
                    danger: true,
                  })
                }
              >
                Chỉnh sửa
              </Button>
            )}
          />
        </ResourceState>
      </Panel>
      {acts.dialog}
    </>
  );
}
