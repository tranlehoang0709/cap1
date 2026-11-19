'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Plus, Send, ShieldCheck, Sparkles } from 'lucide-react';
import { api } from '@/lib/client';
import { chatReply, object, rows, type Row } from '@/lib/contracts';
import { memoryAwareChatContent } from '@/lib/personal-assistant';
import { date, display } from '@/lib/utils';
import { Spinner } from '../motion/VisibleMotion';
import { RobotViewer } from '../robot-viewer';
import { Button } from '../ui/button';
import {
  Blocked,
  cols,
  DataTable,
  formatCell,
  Notice,
  Pagination,
  Panel,
  ResourceState,
  rowId,
  textField,
  useActions,
  useResource,
} from '../data-ui';
import { Recovery } from '../admin/AdminSections';

export function Robots({ admin }: { admin: boolean }) {
  const [page, setPage] = useState(1);
  const [requestPage, setRequestPage] = useState(1);
  const state = useResource(admin ? 'allRobots' : 'robots', {
    page: String(page),
    limit: '20',
  });
  const pairing = useResource(admin ? 'allPairings' : 'pairings', {
    page: String(requestPage),
    limit: '20',
  });
  const [code, setCode] = useState<{ value: string; expiresAt?: string } | null>(
    null
  );
  const [recoveryId, setRecoveryId] = useState('');
  const acts = useActions(() => {
    state.reload();
    pairing.reload();
  });

  function capturePairingCode(d: unknown) {
    try {
      const obj = object(d);
      if (typeof obj.pairing_code === 'string' && obj.pairing_code) {
        const formattedExpiry = obj.expires_at ? date(obj.expires_at) : undefined;
        setCode({
          value: obj.pairing_code,
          expiresAt:
            formattedExpiry && formattedExpiry !== '—' ? formattedExpiry : undefined,
        });
      }
    } catch {}
  }

  return (
    <>
      <Notice success={acts.notice} />
      {code && (
        <div className="alert success" role="status">
          <div>
            <strong>Mã ghép nối được Backend cấp</strong>
            <p className="pairing-secret">{code.value}</p>
            {code.expiresAt && <p className="fine">Hiệu lực đến: {code.expiresAt}</p>}
            <p>Chỉ chia sẻ qua kênh riêng với chủ robot.</p>
            <Button variant="outline" onClick={() => setCode(null)}>
              Ẩn mã
            </Button>
          </div>
        </div>
      )}
      <Panel
        title={admin ? 'Danh sách robot' : 'Các robot đã ghép nối'}
        description={
          admin
            ? 'Đăng ký thiết bị trước, cấp mã dùng một lần rồi duyệt yêu cầu của người dùng.'
            : 'Kết nối và vòng đời được lấy trực tiếp từ Backend.'
        }
        actions={
          <Button
            onClick={() =>
              acts.open(
                admin
                  ? {
                      title: 'Đăng ký robot',
                      operation: 'robotCreate',
                      fields: [
                        textField('device_uid', 'Robot UID (Device UID)', undefined, 128),
                        { ...textField('display_name', 'Tên robot'), required: false },
                        {
                          ...textField('hardware_model', 'Mẫu phần cứng', undefined, 100),
                          required: false,
                        },
                      ],
                      onDone: capturePairingCode,
                    }
                  : {
                      title: 'Ghép nối robot',
                      operation: 'pair',
                      fields: [
                        {
                          name: 'pairing_code',
                          label: 'Mã ghép nối',
                          type: 'password',
                          required: true,
                          min: 32,
                          max: 64,
                        },
                      ],
                      description:
                        'Nhập mã do quản trị viên cấp. Robot chỉ thuộc về bạn sau khi được duyệt.',
                    }
              )
            }
          >
            <Plus size={16} />
            {admin ? 'Đăng ký robot' : 'Nhập mã ghép nối'}
          </Button>
        }
      >
        <ResourceState state={state}>
          <DataTable
            data={state.data}
            columns={cols(
              'id',
              'display_name',
              'device_uid',
              'connection_status',
              'lifecycle_status',
              'last_seen_at'
            )}
            actions={(r) => (
              <>
                {!admin && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      acts.open({
                        title: 'Đổi tên robot',
                        operation: 'robotRename',
                        params: rowId(r),
                        fields: [textField('display_name', 'Tên robot', r.display_name)],
                      })
                    }
                  >
                    Đổi tên
                  </Button>
                )}
                {admin && (
                  <>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        acts.open({
                          title: 'Cấp mã ghép nối',
                          operation: 'pairingCode',
                          params: rowId(r),
                          fields: [
                            {
                              name: 'ttl_minutes',
                              label: 'Hiệu lực (phút)',
                              type: 'number',
                              min: 1,
                              max: 60,
                              value: 10,
                              required: true,
                            },
                          ],
                          onDone: capturePairingCode,
                        })
                      }
                    >
                      Cấp mã
                    </Button>
                    <Button variant="ghost" onClick={() => setRecoveryId(String(r.id))}>
                      Recovery
                    </Button>
                  </>
                )}
              </>
            )}
          />
          <Pagination data={state.data} page={page} setPage={setPage} />
        </ResourceState>
      </Panel>
      <Panel
        title="Yêu cầu ghép nối"
        description={
          admin
            ? 'Phê duyệt hoặc từ chối các yêu cầu ghép nối đang chờ (PENDING).'
            : 'Theo dõi trạng thái phê duyệt từ quản trị viên.'
        }
      >
        <ResourceState state={pairing}>
          <DataTable
            data={pairing.data}
            columns={cols('id', 'device_id', 'user_id', 'status', 'created_at')}
            actions={
              admin
                ? (r) =>
                    String(r.status).toUpperCase() === 'PENDING' ? (
                      <>
                        {(['approve', 'reject'] as const).map((op) => (
                          <Button
                            key={op}
                            variant={op === 'reject' ? 'outline' : 'default'}
                            onClick={() =>
                              acts.open({
                                title:
                                  op === 'approve'
                                    ? 'Duyệt ghép nối'
                                    : 'Từ chối ghép nối',
                                operation: op,
                                params: rowId(r),
                                fields: [
                                  {
                                    name: 'note',
                                    label: 'Ghi chú',
                                    type: 'textarea',
                                    max: 500,
                                  },
                                ],
                                danger: op === 'reject',
                              })
                            }
                          >
                            {op === 'approve' ? 'Duyệt' : 'Từ chối'}
                          </Button>
                        ))}
                      </>
                    ) : null
                : undefined
            }
          />
          <Pagination
            data={pairing.data}
            page={requestPage}
            setPage={setRequestPage}
          />
        </ResourceState>
      </Panel>
      {recoveryId && admin && (
        <Recovery
          key={recoveryId}
          deviceId={recoveryId}
          close={() => setRecoveryId('')}
        />
      )}
      <div className="dashboard-grid">
        <Panel title="NOVA 3D">
          <RobotViewer />
        </Panel>
        <Panel title="Kết nối an toàn">
          <div className="guidance">
            <ShieldCheck size={30} />
            <h3>
              {admin
                ? 'Reset cần được xác nhận bởi thiết bị.'
                : 'Robot luôn có chủ sở hữu rõ ràng.'}
            </h3>
            <p>
              {admin
                ? 'HTTP 202 chỉ ghi nhận yêu cầu. Chỉ ACK thành công từ luồng thiết bị mới xác nhận reset.'
                : 'Bạn không thể tự bỏ ghép robot. Hãy liên hệ quản trị viên để thực hiện recovery/reset đúng quy trình.'}
            </p>
            <p>
              Wi-Fi được cấu hình qua cổng provisioning của firmware. Website chưa hỗ
              trợ đổi Wi-Fi từ xa.
            </p>
          </div>
        </Panel>
      </div>
      {acts.dialog}
    </>
  );
}

export function Assistant() {
  const state = useResource('assistant');
  const acts = useActions(state.reload);
  let data: Row = {};
  try {
    data = object(state.data);
  } catch {}
  return (
    <>
      <Notice success={acts.notice} />
      <div className="dashboard-grid">
        <Panel
          title="Một trợ lý, theo cách của bạn"
          description="Cá nhân hóa tên, hướng dẫn, ngôn ngữ và giọng nói."
        >
          <ResourceState state={state}>
            <dl className="details">
              {(
                [
                  ['assistant_name', 'Tên trợ lý'],
                  ['language_code', 'Ngôn ngữ'],
                  ['voice_code', 'Giọng nói'],
                  ['system_prompt', 'Hướng dẫn cá nhân'],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{display(data[key])}</dd>
                </div>
              ))}
            </dl>
            <Button
              onClick={() =>
                acts.open({
                  title: 'Cấu hình trợ lý',
                  operation: 'assistantSave',
                  fields: [
                    {
                      ...textField(
                        'assistant_name',
                        'Tên trợ lý',
                        data.assistant_name,
                        100
                      ),
                      required: false,
                    },
                    {
                      name: 'system_prompt',
                      label: 'Hướng dẫn cá nhân',
                      type: 'textarea',
                      max: 8000,
                      value: data.system_prompt,
                    },
                    {
                      ...textField(
                        'language_code',
                        'Mã ngôn ngữ',
                        data.language_code,
                        20
                      ),
                      required: false,
                    },
                    {
                      ...textField('voice_code', 'Mã giọng nói', data.voice_code, 100),
                      required: false,
                    },
                  ],
                  description:
                    'Provider và model được giữ nguyên phía server; người dùng không chọn nhà cung cấp.',
                })
              }
            >
              Chỉnh sửa trợ lý
            </Button>
          </ResourceState>
        </Panel>
        <Panel title="NOVA · Personal Intelligence">
          <RobotViewer />
          <p className="muted">Dịch vụ AI và khóa hệ thống do quản trị viên quản lý.</p>
        </Panel>
      </div>
      {acts.dialog}
    </>
  );
}

export function Chat() {
  const ready = useResource('chatReadiness');
  const historyState = useResource('conversations', { page: '1', limit: '20' });
  const [messages, setMessages] = useState<
    {
      role: 'user' | 'assistant';
      content: string;
      failed?: boolean;
    }[]
  >([]);
  const [textValue, setText] = useState('');
  const [includeMemories, setIncludeMemories] = useState(false);
  const [memorySearch, setMemorySearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conversation, setConversation] = useState('');
  const [conversationStatus, setConversationStatus] = useState<'active' | 'ended' | ''>('');

  let savedConversations: Row[] = [];
  try {
    savedConversations = rows(historyState.data);
  } catch {}

  async function selectConversation(id: string) {
    if (!id || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const detail = object(await api('conversation', { params: { id } }));
      const loaded = rows(detail.messages).map((m) => ({
        role: (String(m.role) === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: String(m.content ?? ''),
      }));
      setConversation(String(detail.id ?? id));
      setConversationStatus(String(detail.status) === 'ended' ? 'ended' : 'active');
      setMessages(loaded);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function closeActiveConversation() {
    if (!conversation || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('conversationClose', { params: { id: conversation } });
      setConversationStatus('ended');
      setNotice(`Đã đóng phiên hội thoại #${conversation}.`);
      historyState.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resumeSelectedConversation() {
    if (!conversation || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('conversationResume', { params: { id: conversation } });
      setConversationStatus('active');
      setNotice(`Đã mở lại phiên hội thoại #${conversation} để tiếp tục trò chuyện.`);
      historyState.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || ready.loading || ready.error || !textValue.trim() || conversationStatus === 'ended') return;
    const content = textValue.trim();
    setBusy(true);
    setError('');
    setNotice('');
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === 'user' && last.failed && last.content === content) {
        return [...prev.slice(0, -1), { role: 'user', content }];
      }
      return [...prev, { role: 'user', content }];
    });
    setText('');
    try {
      const messageContent = await memoryAwareChatContent(
        content, includeMemories, memorySearch,
        (query) => api('personalMemories', { query }),
      );
      const payload: Record<string, string> = { content: messageContent };
      if (conversation) payload.conversation_id = conversation;
      const r = chatReply.parse(await api('chat', { body: payload }));
      setMessages((prev) => [...prev, { role: 'assistant', content: r.content }]);
      if (r.conversation_id) {
        setConversation(r.conversation_id);
        setConversationStatus('active');
        historyState.reload();
      }
    } catch (err) {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'user' && last.content === content) {
          return [...prev.slice(0, -1), { ...last, failed: true }];
        }
        return prev;
      });
      setText((prev) => prev || content);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="chat-panel">
      <div className="chat-header">
        <div className="assistant-avatar" aria-hidden="true">
          <Sparkles size={22} />
        </div>
        <div>
          <h2>AIVA Assistant</h2>
          <p className="muted">
            {conversation
              ? `Phiên hội thoại #${conversation} (${conversationStatus === 'ended' ? 'Đã đóng' : 'Đang hoạt động'})`
              : 'Dịch vụ do quản trị viên cấu hình · Phiên mới'}
          </p>
        </div>
        <div className="row-actions">
          {savedConversations.length > 0 && (
            <select
              aria-label="Chọn phiên hội thoại"
              value={conversation}
              disabled={busy}
              onChange={(e) => {
                const nextId = e.target.value;
                if (!nextId) {
                  setMessages([]);
                  setConversation('');
                  setConversationStatus('');
                  setError('');
                  setNotice('');
                } else {
                  void selectConversation(nextId);
                }
              }}
            >
              <option value="">+ Phiên trò chuyện mới</option>
              {savedConversations.map((c) => (
                <option key={String(c.id)} value={String(c.id)}>
                  #{String(c.id)} · {String(c.title || 'Hội thoại Web')} ({String(c.status)})
                </option>
              ))}
            </select>
          )}
          {conversation && conversationStatus !== 'ended' && (
            <Button variant="outline" disabled={busy} onClick={() => void closeActiveConversation()}>
              Đóng phiên
            </Button>
          )}
          {conversation && conversationStatus === 'ended' && (
            <Button variant="outline" disabled={busy} onClick={() => void resumeSelectedConversation()}>
              Tiếp tục phiên
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setMessages([]);
              setConversation('');
              setConversationStatus('');
              setError('');
              setNotice('');
            }}
          >
            Cuộc trò chuyện mới
          </Button>
        </div>
      </div>
      <div className="chat-messages" aria-live="polite">
        {!messages.length ? (
          <div className="chat-empty">
            <span className="chat-star">
              <Sparkles size={35} />
            </span>
            <div className="eyebrow">YOUR PERSONAL INTELLIGENCE</div>
            <h2>Hôm nay, bạn muốn khám phá điều gì?</h2>
            <p>Gửi một câu hỏi để bắt đầu hoặc chọn phiên đã lưu để tiếp tục cùng AIVA.</p>
            <div className="prompt-grid">
              {[
                'Giúp tôi lên kế hoạch cho hôm nay',
                'Giải thích một ý tưởng theo cách đơn giản',
                'Gợi ý cách học một kỹ năng mới',
              ].map((p) => (
                <button type="button" key={p} onClick={() => setText(p)}>
                  {p}
                  <ArrowUpRight size={16} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={'chat-bubble ' + m.role}>
              <span>{m.role === 'user' ? 'Bạn' : 'AIVA'}</span>
              <p>{m.content}</p>
            </div>
          ))
        )}
        {busy && (
          <div className="chat-wait" role="status">
            <Spinner />
            AIVA đang xử lý…
          </div>
        )}
      </div>
      <div className="chat-composer">
        <ResourceState state={ready}>
          <p className="fine">
            Provider hệ thống đã được cấu hình. Backend tiếp tục kiểm tra quyền, model,
            quota và khả năng thực thi khi gửi.
          </p>
        </ResourceState>
        <Notice error={error} success={notice} />
        {error && (
          <p className="fine">
            Tin nhắn của bạn vẫn được giữ trên màn hình. Không tự động gửi lại; nếu mất
            kết nối, hãy kiểm tra lịch sử trước khi thử lại.
          </p>
        )}
        {conversation && (
          <p className="fine">
            Backend xác nhận hội thoại #{conversation} ({conversationStatus === 'ended' ? 'Đã đóng — bấm Tiếp tục phiên để gửi thêm tin nhắn' : 'Đang duy trì ngữ cảnh nhiều lượt'}).{' '}
            <Link href="/user/conversations">Xem lịch sử đã lưu</Link>
          </p>
        )}
        <label><input type="checkbox" checked={includeMemories} disabled={busy} onChange={(e) => setIncludeMemories(e.target.checked)} />Đính kèm ghi nhớ cá nhân đã lưu vào tin nhắn gửi AI</label>
        {includeMemories && <label>Từ khóa ghi nhớ (để trống để dùng tất cả)
          <input maxLength={200} value={memorySearch} disabled={busy} onChange={(e) => setMemorySearch(e.target.value)} />
        </label>}
        <form onSubmit={send}>
          <label className="sr-only" htmlFor="chat-content">
            Nội dung tin nhắn
          </label>
          <textarea
            id="chat-content"
            placeholder={
              conversationStatus === 'ended'
                ? 'Phiên hội thoại này đã đóng. Bấm "Tiếp tục phiên" ở trên để gửi thêm tin nhắn.'
                : 'Hỏi AIVA điều gì đó… (Nhấn Enter để gửi, Shift+Enter để xuống dòng)'
            }
            value={textValue}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                e.keyCode !== 229
              ) {
                e.preventDefault();
                if (!busy && !ready.loading && !ready.error && conversationStatus !== 'ended' && textValue.trim()) {
                  void send();
                }
              }
            }}
            maxLength={16000}
            required
            rows={2}
            disabled={busy || ready.loading || !!ready.error || conversationStatus === 'ended'}
          />
          <Button
            disabled={busy || ready.loading || !!ready.error || conversationStatus === 'ended' || !textValue.trim()}
            type="submit"
            aria-label="Gửi tin nhắn"
          >
            <Send size={18} />
          </Button>
        </form>
        <p className="fine">
          Ngữ cảnh hội thoại nhiều lượt được đồng bộ trực tiếp với MySQL theo mã phiên
          (#conversation_id) của tài khoản hiện tại.
        </p>
      </div>
    </Panel>
  );
}

export function Conversations() {
  const [page, setPage] = useState(1);
  const state = useResource('conversations', {
    page: String(page),
    limit: '20',
  });
  const [selected, setSelected] = useState('');
  const acts = useActions(() => {
    state.reload();
  });
  return (
    <>
      <Notice success={acts.notice} />
      <Panel
        title="Hội thoại đã lưu"
        description="Chỉ hiển thị dữ liệu thuộc tài khoản đang đăng nhập. Hỗ trợ xem chi tiết, đổi tiêu đề, đóng/mở lại phiên hoặc xóa."
      >
        <ResourceState state={state}>
          <DataTable
            data={state.data}
            columns={cols('id', 'title', 'channel', 'status', 'started_at')}
            actions={(r) => (
              <div className="row-actions">
                <Button variant="ghost" onClick={() => setSelected(String(r.id))}>
                  Xem lịch sử
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    acts.open({
                      title: 'Đổi tiêu đề hội thoại',
                      operation: 'conversationRename',
                      params: rowId(r),
                      fields: [textField('title', 'Tiêu đề mới', r.title, 200)],
                    })
                  }
                >
                  Đổi tên
                </Button>
                {String(r.status) === 'ended' ? (
                  <Button
                    variant="outline"
                    onClick={() =>
                      acts.open({
                        title: 'Tiếp tục phiên hội thoại',
                        operation: 'conversationResume',
                        params: rowId(r),
                        description: 'Mở lại phiên hội thoại này để tiếp tục trò chuyện nhiều lượt.',
                      })
                    }
                  >
                    Tiếp tục phiên
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() =>
                      acts.open({
                        title: 'Đóng phiên hội thoại',
                        operation: 'conversationClose',
                        params: rowId(r),
                        description: 'Đánh dấu kết thúc phiên hội thoại hiện tại. Bạn vẫn có thể xem lại hoặc mở lại sau.',
                      })
                    }
                  >
                    Đóng phiên
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() =>
                    acts.open({
                      title: 'Xóa hội thoại',
                      operation: 'conversationDelete',
                      params: rowId(r),
                      danger: true,
                      onDone: () => {
                        if (selected === String(r.id)) setSelected('');
                      },
                      description:
                        'Xóa hội thoại đã chọn khỏi lịch sử. Không thể hoàn tác từ giao diện.',
                    })
                  }
                >
                  Xóa
                </Button>
              </div>
            )}
          />
          <Pagination data={state.data} page={page} setPage={setPage} />
        </ResourceState>
      </Panel>
      {selected && <ConversationDetail key={selected} conversationId={selected} />}
      {acts.dialog}
    </>
  );
}

export function ConversationDetail({
  conversationId,
}: {
  conversationId: string;
}) {
  const state = useResource('conversation', {}, { id: conversationId });
  let messages: Row[] = [];
  try {
    messages = rows(object(state.data).messages);
  } catch {}
  return (
    <Panel title={'Hội thoại #' + conversationId}>
      <ResourceState state={state}>
        {messages.length ? (
          messages.map((m, i) => (
            <div className={'chat-bubble ' + String(m.role)} key={i}>
              <span>{String(m.role) === 'user' ? 'Bạn' : display(m.role)}</span>
              <p>{display(m.content)}</p>
            </div>
          ))
        ) : (
          <p className="muted">Hội thoại chưa có nội dung hiển thị.</p>
        )}
      </ResourceState>
    </Panel>
  );
}

export function Account() {
  const router = useRouter();
  const state = useResource('profile');
  const acts = useActions(state.reload);
  let data: Row = {};
  try {
    data = object(state.data);
  } catch {}
  return (
    <>
      <Notice success={acts.notice} />
      <Panel title="Thông tin tài khoản">
        <ResourceState state={state}>
          <dl className="details">
            {(['display_name', 'email', 'status', 'email_verified_at'] as const).map(
              (k) => (
                <div key={k}>
                  <dt>{cols(k)[0].label}</dt>
                  <dd>{formatCell(k, data[k], data)}</dd>
                </div>
              )
            )}
          </dl>
          <div className="toolbar">
            <Button
              onClick={() =>
                acts.open({
                  title: 'Cập nhật tài khoản',
                  operation: 'profileSave',
                  fields: [
                    textField('display_name', 'Tên hiển thị', data.display_name, 150),
                  ],
                })
              }
            >
              Chỉnh sửa tên
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                acts.open({
                  title: 'Đổi mật khẩu',
                  operation: 'password',
                  requireConfirm: true,
                  fields: [
                    {
                      name: 'current_password',
                      label: 'Mật khẩu hiện tại',
                      type: 'password',
                      required: true,
                    },
                    {
                      name: 'new_password',
                      label: 'Mật khẩu mới',
                      type: 'password',
                      required: true,
                      min: 8,
                      max: 72,
                    },
                  ],
                  onDone: () => {
                    router.replace('/login');
                    router.refresh();
                  },
                  description: 'Sau khi Backend xác nhận, bạn cần đăng nhập lại.',
                })
              }
            >
              Đổi mật khẩu
            </Button>
          </div>
        </ResourceState>
      </Panel>
      {acts.dialog}
    </>
  );
}

export function Privacy() {
  const state = useResource('privacy');
  const acts = useActions(state.reload);
  let data: Row = {};
  try {
    data = object(state.data);
  } catch {}
  return (
    <>
      <Notice success={acts.notice} />
      <Panel
        title="Bạn quyết định cách lưu dữ liệu"
        description="Thiết lập áp dụng theo xử lý của Backend và AI pipeline."
      >
        <ResourceState state={state}>
          <div className="privacy-setting">
            <ShieldCheck size={32} />
            <div>
              <h3>Lưu lịch sử hội thoại</h3>
              <p>
                {typeof data.save_history === 'boolean'
                  ? data.save_history
                    ? 'Đang bật'
                    : 'Đang tắt'
                  : 'Backend chưa trả thiết lập hợp lệ.'}
              </p>
            </div>
            <Button
              variant="outline"
              disabled={typeof data.save_history !== 'boolean'}
              onClick={() =>
                acts.open({
                  title: 'Cập nhật quyền riêng tư',
                  operation: 'privacySave',
                  requireConfirm: Boolean(data.save_history),
                  body: { save_history: !data.save_history },
                  description: data.save_history
                    ? 'Tắt lưu lịch sử cho các lượt tiếp theo theo chính sách Backend. Không xóa lịch sử đã tồn tại.'
                    : 'Bật lưu lịch sử theo chính sách Backend.',
                })
              }
            >
              {data.save_history ? 'Tắt lưu' : 'Bật lưu'}
            </Button>
          </div>
        </ResourceState>
      </Panel>
      <Panel
        title="Xóa toàn bộ dữ liệu hội thoại AI"
        description="Xóa toàn bộ lịch sử hội thoại AI thuộc quyền sở hữu của tài khoản hiện tại. Dữ liệu Kế hoạch và Công việc cá nhân (Personal Assistant) được giữ nguyên."
      >
        <div className="privacy-setting">
          <ShieldCheck size={32} />
          <div>
            <h3>Làm sạch lịch sử hội thoại AI</h3>
            <p>
              Thao tác này xóa vĩnh viễn toàn bộ hội thoại AI đã lưu khỏi danh sách hiển thị của bạn và không thể hoàn tác.
            </p>
          </div>
          <Button
            variant="destructive"
            onClick={() =>
              acts.open({
                title: 'Xóa toàn bộ dữ liệu hội thoại AI',
                operation: 'userAiDataDelete',
                danger: true,
                requireConfirm: true,
                description:
                  'Xác nhận xóa toàn bộ lịch sử hội thoại AI của tài khoản. Các kế hoạch nhiều buổi và công việc cá nhân (Personal Assistant) không bị xóa bởi thao tác này.',
              })
            }
          >
            Xóa dữ liệu AI của tôi
          </Button>
        </div>
      </Panel>
      {acts.dialog}
    </>
  );
}
