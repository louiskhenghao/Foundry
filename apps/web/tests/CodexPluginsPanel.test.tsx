import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PluginRow } from '../src/pages/skills/CodexPluginsPanel.tsx';

const plugin = { id:'example@fixture', name:'Example',marketplace:'fixture',version:'1.0',installed:false,enabled:false,installPolicy:'AVAILABLE',authPolicy:'ON_INSTALL' };
describe('native plugin controls', () => {
  test('installed disabled plugins are distinct from available packages', () => {
    const html = renderToStaticMarkup(<PluginRow plugin={{...plugin,installed:true}} busy={false} onChange={()=>{}} />);
    expect(html).toContain('Installed · disabled by native configuration');
    expect(html).toContain('>Remove</button>');
    expect(html).not.toContain('Available to install');
  });
  test('marketplace-managed packages and running changes disable mutation controls', () => {
    const managed = renderToStaticMarkup(<PluginRow plugin={{...plugin,installPolicy:'REQUIRED'}} busy={false} onChange={()=>{}} />);
    expect(managed).toContain('Managed in Codex');
    expect(managed).toContain('disabled=""');
    expect(renderToStaticMarkup(<PluginRow plugin={plugin} busy onChange={()=>{}} />)).toContain('disabled=""');
  });
});
