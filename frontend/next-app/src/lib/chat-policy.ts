import { rows, object } from './contracts';
export function providerForChat(catalogue: unknown, providerId: string | undefined) { if (!providerId || !/^[1-9]\d*$/.test(providerId))
    throw new Error('BLOCKED: Quản trị viên chưa cấu hình provider cho Chat.'); const provider = rows(catalogue).find(p => p.id === providerId && p.is_enabled === true); if (!provider)
    throw new Error('BLOCKED: Provider do quản trị viên cấu hình chưa khả dụng.'); return provider; }
export function requireSystemScope(provider: Record<string, unknown>, profile: unknown) { if (provider.code !== 'LOCAL' && object(profile).credentialScope !== 'SYSTEM')
    throw new Error('BLOCKED: Backend chưa cấp SYSTEM credential scope cho tài khoản. Chat không sử dụng Personal API Key.'); }
