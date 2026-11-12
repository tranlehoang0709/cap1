import type { Identity } from './contracts';
export class ApiError extends Error {
    constructor(message: string, public status: number) { super(message); }
}
// A full document navigation intentionally discards all user-scoped client state after session expiry.
/* eslint-disable @next/next/no-location-assign-relative-destination */
export async function request<T = unknown>(path: string, body?: unknown): Promise<T> { let r: Response; try {
    r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
}
catch {
    throw new ApiError('Mất kết nối. Kiểm tra kết quả trước khi gửi lại thao tác.', 0);
} const data = await r.json(); if (!r.ok) {
    if (r.status === 401 && typeof window !== 'undefined' && !path.includes('/auth/login'))
        window.location.assign('/login');
    throw new ApiError(data.message || 'Yêu cầu không thành công.', r.status);
} return data; }
export const api = <T = unknown>(operation: string, options: {
    params?: Record<string, unknown>;
    body?: Record<string, unknown>;
    query?: Record<string, string>;
    idempotencyKey?: string;
} = {}) => request<T>('/api/backend', { operation, ...options });
export const me = () => request<Identity>('/api/auth/me');
