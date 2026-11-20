// Explicit BFF allowlist. No browser-supplied upstream path or Authorization.
import { isProtectedSettingKey } from './validation';
import { personalAssistantOperations } from './personal-assistant';
export type Operation = {
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    role: 'USER' | 'ADMIN' | 'ANY';
    path: string;
    fields?: string[];
    query?: string[];
};
export const operations: Record<string, Operation> = {
    chatReadiness: { method: 'GET', role: 'USER', path: '/ai/profile' },
    adminUsage: { method: 'GET', role: 'ADMIN', path: '/admin/ai/usage', query: ['userId', 'providerId', 'from', 'to'] },
    profile: { method: 'GET', role: 'ANY', path: '/users/me' }, profileSave: { method: 'PATCH', role: 'ANY', path: '/users/me', fields: ['display_name'] }, password: { method: 'PATCH', role: 'ANY', path: '/auth/password', fields: ['current_password', 'new_password'] },
    privacy: { method: 'GET', role: 'USER', path: '/users/me/privacy' }, privacySave: { method: 'PATCH', role: 'USER', path: '/users/me/privacy', fields: ['save_history'] }, userAiDataDelete: { method: 'DELETE', role: 'USER', path: '/users/me/ai-data' },
    robots: { method: 'GET', role: 'USER', path: '/devices', query: ['page', 'limit'] }, robotRename: { method: 'PATCH', role: 'USER', path: '/devices/:id', fields: ['display_name'] }, pair: { method: 'POST', role: 'USER', path: '/devices/pairing-requests', fields: ['pairing_code'] }, pairings: { method: 'GET', role: 'USER', path: '/devices/pairing-requests/mine', query: ['page', 'limit'] },
    assistant: { method: 'GET', role: 'USER', path: '/ai/profile' }, assistantSave: { method: 'PATCH', role: 'USER', path: '/ai/profile', fields: ['assistant_name', 'system_prompt', 'language_code', 'voice_code'] },
    conversations: { method: 'GET', role: 'USER', path: '/conversations', query: ['page', 'limit'] }, conversation: { method: 'GET', role: 'USER', path: '/conversations/:id' }, conversationRename: { method: 'PATCH', role: 'USER', path: '/conversations/:id', fields: ['title'] }, conversationClose: { method: 'POST', role: 'USER', path: '/conversations/:id/close', fields: [] }, conversationResume: { method: 'POST', role: 'USER', path: '/conversations/:id/resume', fields: [] }, conversationDelete: { method: 'DELETE', role: 'USER', path: '/conversations/:id' }, chat: { method: 'POST', role: 'USER', path: '/web-chat/messages', fields: ['content', 'conversation_id', 'request_id'] },
    quotas: { method: 'GET', role: 'USER', path: '/quotas' }, usage: { method: 'GET', role: 'USER', path: '/usage', query: ['from', 'to'] },
    dashboard: { method: 'GET', role: 'ADMIN', path: '/admin/dashboard' }, users: { method: 'GET', role: 'ADMIN', path: '/users', query: ['page', 'limit', 'search'] }, userCreate: { method: 'POST', role: 'ADMIN', path: '/users', fields: ['email', 'display_name', 'password'] }, userRole: { method: 'PATCH', role: 'ADMIN', path: '/users/:id/role', fields: ['role'] }, userStatus: { method: 'PATCH', role: 'ADMIN', path: '/users/:id/status', fields: ['status'] },
    allRobots: { method: 'GET', role: 'ADMIN', path: '/devices/admin/all', query: ['page', 'limit'] }, robotCreate: { method: 'POST', role: 'ADMIN', path: '/devices/admin', fields: ['device_uid', 'display_name', 'hardware_model'] }, pairingCode: { method: 'POST', role: 'ADMIN', path: '/devices/admin/:id/pairing-codes', fields: ['ttl_minutes'] }, allPairings: { method: 'GET', role: 'ADMIN', path: '/devices/admin/pairing-requests', query: ['page', 'limit'] }, approve: { method: 'POST', role: 'ADMIN', path: '/devices/admin/pairing-requests/:id/approve', fields: ['note'] }, reject: { method: 'POST', role: 'ADMIN', path: '/devices/admin/pairing-requests/:id/reject', fields: ['note'] },
    recovery: { method: 'GET', role: 'ADMIN', path: '/admin/devices/:id/recovery' }, resetStatus: { method: 'GET', role: 'ADMIN', path: '/admin/devices/:id/reset-status' }, revoke: { method: 'POST', role: 'ADMIN', path: '/admin/devices/:id/revoke', fields: ['reason'] }, restore: { method: 'POST', role: 'ADMIN', path: '/admin/device-recovery/:id/restore', fields: [] },
    providers: { method: 'GET', role: 'ADMIN', path: '/ai/providers' }, providerSave: { method: 'PATCH', role: 'ADMIN', path: '/admin/ai/providers/:id', fields: ['is_enabled', 'health_status'] }, models: { method: 'GET', role: 'ADMIN', path: '/admin/ai/models' }, modelCreate: { method: 'POST', role: 'ADMIN', path: '/admin/ai/models', fields: ['provider_id', 'model_code', 'capability', 'is_enabled'] }, modelSave: { method: 'PATCH', role: 'ADMIN', path: '/admin/ai/models/:id', fields: ['model_code', 'is_enabled'] },
    systemKeys: { method: 'GET', role: 'ADMIN', path: '/admin/api-keys/system' }, systemKeyCreate: { method: 'POST', role: 'ADMIN', path: '/admin/api-keys/system', fields: ['provider_id', 'label', 'secret'] }, systemKeyRevoke: { method: 'DELETE', role: 'ADMIN', path: '/admin/api-keys/system/:id' },
    allQuotas: { method: 'GET', role: 'ADMIN', path: '/admin/quotas' }, quotaSave: { method: 'POST', role: 'ADMIN', path: '/admin/quotas', fields: ['user_id', 'provider_id', 'requests_per_minute', 'requests_per_day', 'tokens_per_month'] }, quotaDelete: { method: 'DELETE', role: 'ADMIN', path: '/admin/quotas/:id' },
    firmware: { method: 'GET', role: 'ADMIN', path: '/admin/firmware' }, firmwareCreate: { method: 'POST', role: 'ADMIN', path: '/admin/firmware', fields: ['hardware_model', 'version', 'file_uri', 'checksum_sha256'] }, firmwareRelease: { method: 'POST', role: 'ADMIN', path: '/admin/firmware/:id/release', fields: [] },
    instances: { method: 'GET', role: 'ADMIN', path: '/admin/monitoring/instances' }, instanceMetrics: { method: 'GET', role: 'ADMIN', path: '/admin/monitoring/instances/:id/metrics', query: ['limit'] }, logs: { method: 'GET', role: 'ADMIN', path: '/admin/logs', query: ['page', 'limit', 'severity', 'component'] }, audits: { method: 'GET', role: 'ADMIN', path: '/admin/audit-logs', query: ['page', 'limit'] }, settings: { method: 'GET', role: 'ADMIN', path: '/admin/system-settings' }, settingSave: { method: 'PUT', role: 'ADMIN', path: '/admin/system-settings/:key', fields: ['value'] }
};
export function resolveOperation(name: string, role: string, params: Record<string, unknown> = {}) { const op = operations[name] ?? personalAssistantOperations[name]; if (!op)
    throw new Error('UNKNOWN_OPERATION'); if (op.role !== 'ANY' && op.role !== role)
    throw new Error('FORBIDDEN'); let path = op.path; for (const part of [':id', ':sessionId', ':key'])
    if (path.includes(part)) {
        const v = params[part.slice(1)];
        const isNumericId = part === ':id' || part === ':sessionId';
        if (typeof v !== 'string' || !(isNumericId ? /^[1-9]\d{0,18}$/ : /^[A-Za-z0-9_.-]{1,120}$/).test(v))
            throw new Error('INVALID_PARAMETER');
        if (part === ':key' && isProtectedSettingKey(v))
            throw new Error('FORBIDDEN_SETTING_KEY');
        path = path.replace(part, encodeURIComponent(v));
    } return { ...op, path }; }
