import 'server-only';
import { cookies } from 'next/headers';
import { randomBytes, createHash } from 'node:crypto';
import { identity, tokenPair, type Identity } from '../contracts';
import { sameOrigin } from '../origin';
export class BackendError extends Error {
    constructor(public status: number, message: string, public code?: string) { super(message); }
}
type Session = {
    access: string;
    refresh: string;
    expires: number;
    refreshing?: Promise<void>;
};
// Single-process store: opaque cookie only. Use a shared session store before multi-instance deployment.
const globalStore = globalThis as typeof globalThis & {
    aivaSessions?: Map<string, Session>;
};
const sessions = globalStore.aivaSessions ??= new Map<string, Session>();
const cookie = 'aiva_session';
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
function base() { const u = new URL(process.env.AIVA_BACKEND_URL || 'http://127.0.0.1:3000'); if (u.username || u.password || u.search || u.hash || u.pathname !== '/' || !(u.protocol === 'https:' || u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)))
    throw new BackendError(503, 'Cấu hình Backend không hợp lệ.'); return u; }
export async function upstream(path: string, method = 'GET', body?: unknown, access?: string, headers: Record<string, string> = {}) {
    let response: Response;
    try {
        response = await fetch(new URL(path, base()), { method, redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(access ? { Authorization: `Bearer ${access}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(path === '/web-chat/messages' ? 105000 : 15000) });
    }
    catch {
        throw new BackendError(503, method === 'GET' ? 'Không kết nối được Backend.' : 'Chưa xác nhận kết quả từ Backend. Kiểm tra dữ liệu trước khi thử lại.');
    }
    const raw = await response.text();
    if (raw.length > 2000000)
        throw new BackendError(502, 'Phản hồi Backend quá lớn.');
    let data: unknown;
    try {
        data = raw ? JSON.parse(raw) : null;
    }
    catch {
        throw new BackendError(502, 'Backend trả phản hồi không hợp lệ.');
    }
    if (!response.ok) {
        const d = data && typeof data === 'object' ? data as Record<string, unknown> : {};
        const message = Array.isArray(d.message) ? d.message.join('; ') : typeof d.message === 'string' ? d.message : typeof d.reason === 'string' ? d.reason : 'Backend từ chối yêu cầu.';
        throw new BackendError(response.status, message, typeof d.code === 'string' ? d.code : undefined);
    }
    return data;
}
export async function createSession(data: unknown) { const t = tokenPair.parse(data); const now = Date.now(); for (const [key, s] of sessions)
    if (s.expires < now)
        sessions.delete(key); if (sessions.size >= 10000)
    throw new BackendError(503, 'Hệ thống đang bận.'); const id = randomBytes(32).toString('base64url'); sessions.set(hash(id), { access: t.access_token, refresh: t.refresh_token, expires: now + 7 * 86400000 }); const secure = process.env.NODE_ENV === 'production' && process.env.AIVA_COOKIE_SECURE !== 'false'; (await cookies()).set(cookie, id, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 7 * 86400 }); }
export async function getSession() { const id = (await cookies()).get(cookie)?.value; const s = id ? sessions.get(hash(id)) : undefined; if (!s || s.expires < Date.now())
    throw new BackendError(401, 'Phiên đăng nhập hết hạn.'); return s; }
export async function destroySession() { const jar = await cookies(); const id = jar.get(cookie)?.value; if (id)
    sessions.delete(hash(id)); jar.delete(cookie); }
export async function authenticate(): Promise<{
    session: Session;
    user: Identity;
}> {
    const session = await getSession();
    try {
        return { session, user: identity.parse(await upstream('/auth/me', 'GET', undefined, session.access)) };
    }
    catch (e) {
        if (!(e instanceof BackendError) || e.status !== 401)
            throw e;
    }
    if (!session.refreshing)
        session.refreshing = (async () => { try {
            const t = tokenPair.parse(await upstream('/auth/refresh', 'POST', { refresh_token: session.refresh }));
            session.access = t.access_token;
            session.refresh = t.refresh_token;
        }
        catch (e) {
            session.expires = 0;
            throw e;
        } })().finally(() => { session.refreshing = undefined; });
    await session.refreshing;
    return { session, user: identity.parse(await upstream('/auth/me', 'GET', undefined, session.access)) };
}
export function checkOrigin(req: Request) { if (!sameOrigin(req.url, req.headers.get('host'), req.headers.get('origin'), process.env.AIVA_PUBLIC_ORIGIN))
    throw new BackendError(403, 'Nguồn yêu cầu không hợp lệ.'); }
export async function readBody(req: Request) { const text = await req.text(); if (text.length > 24000)
    throw new BackendError(413, 'Nội dung quá lớn.'); try {
    return JSON.parse(text) as Record<string, unknown>;
}
catch {
    throw new BackendError(400, 'JSON không hợp lệ.');
} }
export function errorResponse(e: unknown) { if (e instanceof BackendError)
    return Response.json({ message: e.message, code: e.code }, { status: e.status, headers: { 'Cache-Control': 'no-store' } }); return Response.json({ message: 'Dữ liệu hoặc phản hồi Backend không hợp lệ.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } }); }
