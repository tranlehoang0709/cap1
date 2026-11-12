import { z } from 'zod';
import { authenticate, BackendError, checkOrigin, createSession, destroySession, errorResponse, readBody, upstream } from '@/lib/server/backend';
export const runtime = 'nodejs';
export async function GET(_req: Request, { params }: {
    params: Promise<{
        action: string;
    }>;
}) { try {
    if ((await params).action !== 'me')
        throw new BackendError(404, 'Không tìm thấy.');
    const { user } = await authenticate();
    return Response.json(user, { headers: { 'Cache-Control': 'no-store' } });
}
catch (e) {
    return errorResponse(e);
} }
export async function POST(req: Request, { params }: {
    params: Promise<{
        action: string;
    }>;
}) {
    try {
        checkOrigin(req);
        const { action } = await params;
        const body = await readBody(req);
        if (action === 'logout') {
            let warning = false;
            try {
                const { session } = await authenticate();
                await upstream('/auth/logout', 'POST', { refresh_token: session.refresh }, session.access);
            }
            catch {
                warning = true;
            }
            await destroySession();
            return Response.json({ success: true, warning });
        }
        if (action === 'login') {
            const v = z.object({ email: z.email().max(255), password: z.string().min(1).max(200) }).strict().parse(body);
            const tokens = await upstream('/auth/login', 'POST', v);
            await createSession(tokens);
            return Response.json({ success: true });
        }
        if (action === 'register') {
            const v = z.object({ email: z.email().max(255), display_name: z.string().trim().min(1).max(150), password: z.string().min(8).max(72).refine(x => Buffer.byteLength(x, 'utf8') <= 72) }).strict().parse(body);
            await upstream('/auth/register', 'POST', v);
            return Response.json({ success: true, message: 'Đã đăng ký. Cần xác minh email trước khi đăng nhập. Kênh gửi lại xác minh chưa được Backend hỗ trợ.' });
        }
        if (action === 'verify') {
            const v = z.object({ token: z.string().min(1).max(4096) }).strict().parse(body);
            await upstream('/auth/verify-email', 'POST', v);
            return Response.json({ success: true });
        }
        throw new BackendError(404, 'Không tìm thấy.');
    }
    catch (e) {
        if (e instanceof z.ZodError)
            return Response.json({ message: e.issues[0]?.message || 'Dữ liệu không hợp lệ.' }, { status: 400 });
        return errorResponse(e);
    }
}
