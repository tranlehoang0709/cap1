import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {LivingBackground} from '../src/components/backgrounds/LivingBackground';
import {WorkspaceBackground} from '../src/components/backgrounds/WorkspaceBackground';
import {NovaInteractionProvider} from '../src/components/robot/NovaInteractionProvider';
import {workspaceEvidence} from './workspace-evidence';

test('decorative backgrounds SSR without canvas, iframe, random state or announcements',()=>{
 const living=renderToStaticMarkup(<NovaInteractionProvider><LivingBackground/></NovaInteractionProvider>);
 const workspace=renderToStaticMarkup(<WorkspaceBackground/>);
 for(const html of [living,workspace]){assert.ok(html.includes('aria-hidden="true"'));assert.ok(!/<canvas|<iframe|aria-live/.test(html));}
 assert.ok(living.includes('data-running="false"'));assert.ok(living.includes('data-background="living"'));assert.ok(!workspace.includes('living-waves'));
});
test('all existing workspace routes share ambient surfaces with role-specific navigation (SSR only)',()=>{
 for(const admin of [false,true])for(const section of admin?['dashboard','users','robots','ai','keys','quotas','firmware','monitoring','settings','account']:['dashboard','robots','assistant','chat','conversations','privacy','account']){
  const html=workspaceEvidence(admin,section);assert.ok(html.includes('data-background="workspace"'));assert.ok(!html.includes('data-background="living"'));assert.ok(!html.includes('data-nova-status'));
  if(!admin){assert.ok(!html.includes('href="/admin/'));assert.ok(!html.includes('System API Key'));}
  assert.ok(!html.includes('access_token'));assert.ok(html.includes('id="main"'));
 }
});
