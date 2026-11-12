import { z } from 'zod';
export const identity = z.object({ id: z.string().regex(/^[1-9]\d*$/), email: z.string(), display_name: z.string(), role: z.enum(['ADMIN', 'USER']) });
export type Identity = z.infer<typeof identity>;
export type Row = Record<string, unknown>;
export const tokenPair = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1), token_type: z.literal('Bearer'), expires_in: z.number().positive() });
export const chatReply = z.object({ content: z.string(), conversation_id: z.string().regex(/^[1-9]\d*$/), usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }) });
export function rows(value: unknown): Row[] { const a = Array.isArray(value) ? value : value && typeof value === 'object' ? (value as Row).items : undefined; if (!Array.isArray(a) || a.some(x => !x || typeof x !== 'object' || Array.isArray(x)))
    throw new Error('Backend trả danh sách không hợp lệ.'); return a; }
export function object(value: unknown): Row { if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Backend trả dữ liệu không hợp lệ.'); return value as Row; }
