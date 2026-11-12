import { notFound, redirect } from 'next/navigation';
import { authenticate, BackendError } from '@/lib/server/backend';
import { AppShell } from '@/components/app-shell';
import '@/components/admin/admin-workspace.css';
export default async function Layout({ children, params }: {
    children: React.ReactNode;
    params: Promise<{
        portal: string;
    }>;
}) { const { portal } = await params; if (!['user', 'admin'].includes(portal))
    notFound(); let auth; try {
    auth = await authenticate();
}
catch (e) {
    if (e instanceof BackendError && e.status === 401)
        redirect('/login');
    throw e;
} const expected = auth.user.role === 'ADMIN' ? 'admin' : 'user'; if (portal !== expected)
    redirect(`/${expected}/dashboard`); return <AppShell user={auth.user}>{children}</AppShell>; }
