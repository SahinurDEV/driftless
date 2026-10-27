import { describe, expect, it } from 'vitest';
import { getMcpTools, listMcpToolNames } from '../src/mcp/server';

describe('MCP tools', () => {
  it('exposes the planned tool set', () => {
    const names = listMcpToolNames();
    expect(names).toEqual(
      expect.arrayContaining([
        'search_docs',
        'list_docs',
        'read_doc',
        'read_outline',
        'read_section',
        'recent_changes',
        'drift_status',
        'edit_section',
        'query_code_graph',
      ]),
    );
  });

  it('edit_section requires base_version', () => {
    const edit = getMcpTools().find((t) => t.name === 'edit_section');
    expect(edit?.inputSchema.required).toContain('base_version');
    expect(edit?.inputSchema.required).toContain('heading');
  });
});
