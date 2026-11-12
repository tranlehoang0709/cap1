import { z } from 'zod';
const identifier = z.string().regex(/^[1-9]\d{0,18}$/).refine(v => BigInt(v) <= 9223372036854775807n);
const SENSITIVE_RESPONSE_KEY =
    /^(secret|secret_token|access_token|refresh_token|verification_token|reset_token|service_token|token|credential|credentials|password|password_hash|secret_ciphertext|hash|code_hash|pairing_code_hash|token_hash|challenge|challenge_hash|api_key|private_key|client_secret|encrypted_blob_uri|encryption_key_ref)$/i;

export function isProtectedSettingKey(key: unknown): boolean {
    if (typeof key !== 'string') return false;
    return (
        /^recovery\./i.test(key) ||
        /(^|[._-])(secret|secrets|token|password|api[_-]?key|private[_-]?key|challenge|credential|credentials|hash)([._-]|$)/i.test(key.replace(/([a-z0-9])([A-Z])/g, '$1_$2'))
    );
}

export function filterSystemSettings(data: unknown): unknown {
    const isAllowedRow = (item: unknown) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return true;
        const row = item as Record<string, unknown>;
        const key = row.setting_key ?? row.key;
        return !isProtectedSettingKey(key);
    };
    if (Array.isArray(data)) {
        return data.filter(isAllowedRow);
    }
    if (data && typeof data === 'object') {
        const obj = data as Record<string, unknown>;
        if (Array.isArray(obj.items)) {
            const filtered = obj.items.filter(isAllowedRow);
            return { ...obj, items: filtered };
        }
    }
    return data;
}

export function validateBody(operation: string, body: Record<string, unknown>) {
    if (operation === 'quotaSave') {
        for (const key of ['user_id', 'provider_id', 'tokens_per_month'])
            if (body[key] !== undefined)
                identifier.parse(body[key]);
        for (const key of ['requests_per_minute', 'requests_per_day'])
            if (body[key] !== undefined)
                z.number().int().min(1).max(2147483647).parse(body[key]);
    }
    if (operation === 'firmwareCreate') {
        z.object({ hardware_model: z.string().trim().min(1).max(100), version: z.string().trim().min(1).max(100), file_uri: z.url().refine(v => ['http:', 'https:'].includes(new URL(v).protocol)), checksum_sha256: z.string().regex(/^[a-f\d]{64}$/i) }).strict().parse(body);
    }
    if (operation === 'password') {
        z.string().min(8).max(72).refine(v => new TextEncoder().encode(v).length <= 72).parse(body.new_password);
    }
    return body;
}
export function assertAcknowledged(value:unknown){if(value===null||value===undefined||typeof value==='object'&&!Array.isArray(value)&&((value as Record<string,unknown>).success===false||(value as Record<string,unknown>).allowed===false))throw new Error('Backend chưa xác nhận thao tác. Kiểm tra kết quả trước khi thử lại.');}
export function sanitizeResponse(v: unknown): unknown { return Array.isArray(v) ? v.map(sanitizeResponse) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !SENSITIVE_RESPONSE_KEY.test(k.replace(/([a-z0-9])([A-Z])/g, '$1_$2'))).map(([k, x]) => [k, sanitizeResponse(x)])) : v; }
