'use client';
import { ViewTransition } from 'react';
import { AdminDashboard } from './admin/AdminDashboard';
import {
  AI,
  Firmware,
  Monitoring,
  Quotas,
  Settings,
  SystemKeys,
  Users,
} from './admin/AdminSections';
import { UserDashboard } from './user/UserDashboard';
import {
  Account,
  Assistant,
  Chat,
  Conversations,
  Privacy,
  Robots,
} from './user/UserSections';

export function Workspace({
  section,
  admin,
}: {
  section: string;
  admin: boolean;
}) {
  return (
    <ViewTransition
      key={section}
      name="workspace-content"
      default="none"
      share="workspace-state"
      enter="workspace-state"
      exit="workspace-state"
    >
      <div className="workspace-view">
        {section === 'dashboard' ? (
          admin ? (
            <AdminDashboard />
          ) : (
            <UserDashboard />
          )
        ) : section === 'robots' ? (
          <Robots admin={admin} />
        ) : section === 'chat' ? (
          <Chat />
        ) : section === 'assistant' ? (
          <Assistant />
        ) : section === 'conversations' ? (
          <Conversations />
        ) : section === 'account' ? (
          <Account />
        ) : section === 'privacy' ? (
          <Privacy />
        ) : admin && section === 'users' ? (
          <Users />
        ) : admin && section === 'ai' ? (
          <AI />
        ) : admin && section === 'keys' ? (
          <SystemKeys />
        ) : admin && section === 'quotas' ? (
          <Quotas />
        ) : admin && section === 'firmware' ? (
          <Firmware />
        ) : admin && section === 'monitoring' ? (
          <Monitoring />
        ) : admin && section === 'settings' ? (
          <Settings />
        ) : null}
      </div>
    </ViewTransition>
  );
}
