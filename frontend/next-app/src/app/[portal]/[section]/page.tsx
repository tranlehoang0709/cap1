import { notFound } from 'next/navigation';
import { adminNav, userNav } from '@/lib/navigation';
import { Workspace } from '@/components/workspace';
export default async function Page({ params }: {
    params: Promise<{
        portal: string;
        section: string;
    }>;
}) { const { portal, section } = await params; const nav = portal === 'admin' ? adminNav : userNav; if (!nav.some(x => x[0] === section))
    notFound(); return <Workspace section={section} admin={portal === 'admin'}/>; }
