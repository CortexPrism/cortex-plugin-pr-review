import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { tools } from '../../mod.ts';
import type { PluginContext, ToolContext } from '../../types.ts';

// Mock PluginContext
const mockContext: PluginContext & ToolContext = {
  pluginId: 'cortex-plugin-pr-review',
  pluginDir: '/tmp/plugins/cortex-plugin-pr-review',
  state: {
    get: async () => null,
    set: async () => {},
    delete: async () => {},
    list: async () => ({}),
  },
  config: {
    get: async () => null,
    set: async () => {},
    getAll: async () => ({}),
  },
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
  host: {
    registerTool: () => {},
    unregisterTool: () => {},
  },
  sessionId: 'test-session',
  workingDir: '/tmp',
  agentId: 'test-agent',
  workspaceDir: '/tmp',
};

function findTool(name: string) {
  const tool = tools.find((t) => t.definition.name === name);
  if (!tool) throw new Error(`Tool "${name}" not found`);
  return tool;
}

Deno.test('tools array — exports all tools', () => {
  assertEquals(tools.length, 6);
  assertEquals(tools[0].definition.name, 'review_pr');
  assertEquals(tools[1].definition.name, 'analyze_diff');
  assertEquals(tools[2].definition.name, 'check_security');
  assertEquals(tools[3].definition.name, 'check_style');
  assertEquals(tools[4].definition.name, 'suggest_fixes');
  assertEquals(tools[5].definition.name, 'review_checks');
});

Deno.test('review_pr — rejects empty repo', async () => {
  const tool = findTool('review_pr');
  const result = await tool.execute({ 'repo': '' }, mockContext);
  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'non-empty string');
});

Deno.test('analyze_diff — rejects empty diff', async () => {
  const tool = findTool('analyze_diff');
  const result = await tool.execute({ 'diff': '' }, mockContext);
  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'non-empty string');
});

Deno.test('check_security — rejects empty content', async () => {
  const tool = findTool('check_security');
  const result = await tool.execute({ 'content': '' }, mockContext);
  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'non-empty string');
});

Deno.test('check_style — rejects empty content', async () => {
  const tool = findTool('check_style');
  const result = await tool.execute({ 'content': '' }, mockContext);
  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'non-empty string');
});

Deno.test('suggest_fixes — rejects empty code_snippet', async () => {
  const tool = findTool('suggest_fixes');
  const result = await tool.execute({ 'code_snippet': '' }, mockContext);
  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'non-empty string');
});

Deno.test('review_checks — tool is defined with name and description', () => {
  const tool = findTool('review_checks');
  assertEquals(typeof tool.definition.description, 'string');
  assertEquals(tool.definition.description.length > 0, true);
});

Deno.test('all tools return durationMs', async () => {
  for (const tool of tools) {
    const args: Record<string, unknown> = {};
    const result = await tool.execute(args, mockContext);
    assertEquals(typeof result.durationMs, 'number');
    assertEquals(result.durationMs >= 0, true);
  }
});
