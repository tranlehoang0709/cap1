import PortalLayout from '../../[portal]/layout';

// Reuse the existing server-side session and role checks without duplicating them.
export default function UserDashboardLayout({ children }: { children: React.ReactNode }) {
  return <PortalLayout params={Promise.resolve({ portal: 'user' })}>{children}</PortalLayout>;
}
