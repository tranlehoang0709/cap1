import { z } from 'zod';
import { authenticate, BackendError, checkOrigin, destroySession, errorResponse, readBody, upstream } from '@/lib/server/backend';
import { resolveOperation } from '@/lib/operations';
import { chatReply, object } from '@/lib/contracts';
import { validateBody, sanitizeResponse, assertAcknowledged, filterSystemSettings } from '@/lib/validation';
export const runtime = 'nodejs';
export async function POST(req: Request) {
    try {
        checkOrigin(req);
        const input = z.object({ operation: z.string(), params: z.record(z.string(), z.unknown()).optional(), body: z.record(z.string(), z.unknown()).optional(), query: z.record(z.string(), z.string()).optional(), idempotencyKey: z.string().optional() }).strict().parse(await readBody(req));
        const { session, user } = await authenticate();
        let op;
        try {
            op = resolveOperation(input.operation, user.role, input.params);
        }
        catch (e) {
            throw new BackendError(e instanceof Error && (e.message === 'FORBIDDEN' || e.message === 'FORBIDDEN_SETTING_KEY') ? 403 : 400, 'Thao tác không được phép.');
        }
        let body: Record<string, unknown> | undefined = op.method === 'GET' ? undefined : input.body || {};
        if (body && Object.keys(body).some(k => !(op.fields || []).includes(k)))
            throw new BackendError(400, 'Trường dữ liệu không được phép.');
        if (body)
            body = validateBody(input.operation, body);
        if (input.operation === 'assistantSave') {
            const old = object(await upstream('/ai/profile', 'GET', undefined, session.access));
            body = { ...body, preferred_provider_id: old.preferred_provider_id ?? null, preferred_llm_model_id: old.preferred_llm_model_id ?? null };
        }
        if (input.operation === 'chat' || input.operation === 'chatReadiness') {
            try {
                if (input.operation === 'chatReadiness')
                    return Response.json({ configured: true, provider: { code: 'LOCAL', name: 'AIVA Local' } }, { headers: { 'Cache-Control': 'no-store' } });
                const rawConvId = body?.conversation_id;
                const conversationId = rawConvId !== undefined && rawConvId !== null && String(rawConvId).trim() !== ''
                    ? z.string().regex(/^[1-9]\d{0,18}$/).parse(String(rawConvId).trim())
                    : undefined;
                body = {
                    content: z.string().trim().min(1).max(16000).parse(body?.content),
                    ...(conversationId ? { conversation_id: conversationId } : {}),
                    ...(body?.request_id === undefined ? {} : { request_id: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/).parse(body.request_id) }),
                };
            }
            catch (e) {
                if (e instanceof Error && e.message.startsWith('BLOCKED:'))
                    throw new BackendError(409, e.message);
                throw e;
            }
        }
        const query = new URLSearchParams();
        for (const [key, v] of Object.entries(input.query || {})) {
            if (!op.query?.includes(key))
                throw new BackendError(400, 'Bộ lọc không được hỗ trợ.');
            query.set(key, v);
        }
        const headers: Record<string, string> = {};
        if (input.operation === 'revoke') {
            if (!input.idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(input.idempotencyKey))
                throw new BackendError(400, 'Thiếu mã thao tác an toàn.');
            headers['Idempotency-Key'] = input.idempotencyKey;
        }
        const result = await upstream(op.path + (query.size ? '?' + query.toString() : ''), op.method, body, session.access, headers);
        if(op.method!=='GET'){try{assertAcknowledged(result);}catch{throw new BackendError(502,'Backend chưa xác nhận thao tác. Kiểm tra kết quả trước khi thử lại.');}}
        if (['conversation', 'conversationRename', 'conversationClose', 'conversationResume'].includes(input.operation) && object(result).user_id !== undefined && String(object(result).user_id) !== user.id)
            throw new BackendError(403, 'Hội thoại không thuộc tài khoản hiện tại.');
        if (
            ['personalTaskDetail', 'personalPlanDetail', 'personalEventDetail', 'personalReminderDetail', 'personalMemoryDetail'].includes(input.operation) &&
            object(result).user_id !== undefined &&
            String(object(result).user_id) !== user.id
        )
            throw new BackendError(403, 'Dữ liệu cá nhân không thuộc tài khoản hiện tại.');
        if (input.operation === 'password')
            await destroySession();
        const data = input.operation === 'chat' ? chatReply.parse(result) : input.operation === 'settings' ? filterSystemSettings(result) : result;
        // Strip verification tokens and unexpected secret fields recursively from responses.
        return Response.json(sanitizeResponse(data), { headers: { 'Cache-Control': 'no-store' } });
    }
    catch (e) {
        if (e instanceof z.ZodError)
            return Response.json({ message: 'Dữ liệu không hợp lệ.' }, { status: 400 });
        return errorResponse(e);
    }
}
