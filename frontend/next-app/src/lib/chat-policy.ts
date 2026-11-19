import { rows, object } from './contracts';
export function providerForChat(catalogue: unknown, providerId: string | undefined) {
    const list = rows(catalogue);
    if (providerId !== undefined && providerId !== '') {
        if (!/^[1-9]\d*$/.test(providerId))
            throw new Error('BLOCKED: Quản trị viên chưa cấu hình provider cho Chat.');
        const provider = list.find(p => String(p.id) === providerId && p.is_enabled === true);
        if (!provider)
            throw new Error('BLOCKED: Provider do quản trị viên cấu hình chưa khả dụng.');
        return provider;
    }
    const enabled = list.filter(p => p.is_enabled === true && ['LOCAL', 'GEMINI', 'OPENAI'].includes(String(p.code)));
    if (enabled.length === 1) return enabled[0];
    throw new Error('BLOCKED: Quản trị viên chưa cấu hình provider cho Chat.');
}
export function requireSystemScope(provider: Record<string, unknown>, profile: unknown) { if (provider.code !== 'LOCAL' && object(profile).credentialScope !== 'SYSTEM')
    throw new Error('BLOCKED: Backend chưa cấp SYSTEM credential scope cho tài khoản. Chat không sử dụng Personal API Key.'); }
