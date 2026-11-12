export function sameOrigin(requestUrl: string, host: string | null, origin: string | null, configured?: string) { if (!origin || !host)
    return false; try {
    const source = new URL(origin);
    const expected = configured ? new URL(configured) : new URL(new URL(requestUrl).protocol + '//' + host);
    return source.origin === expected.origin && source.origin === origin;
}
catch {
    return false;
} }
