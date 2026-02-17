import { vol } from 'memfs';
import { beforeEach, expect, test } from 'vitest';
import { loadAgentDefinition } from './load-agent-definition.ts';

beforeEach(() => {
  vol.reset();
});

test('it loads agent definition with all frontmatter fields', async () => {
  vol.fromJSON({
    '/repo/.claude/agents/planner.md': `---
description: Decomposes specs into tasks
tools: Read, Grep, Glob
disallowedTools: Write, Edit
model: opus
maxTurns: 50
---

You are the Planner agent.`,
  });

  const result = await loadAgentDefinition({
    repoRoot: '/repo',
    role: 'planner',
    contextPaths: [],
  });

  expect(result.definition).toStrictEqual({
    description: 'Decomposes specs into tasks',
    tools: ['Read', 'Grep', 'Glob'],
    disallowedTools: ['Write', 'Edit'],
    model: 'opus',
    prompt: 'You are the Planner agent.',
  });
  expect(result.maxTurns).toBe(50);
});

test('it parses tools from comma-separated string with whitespace', async () => {
  vol.fromJSON({
    '/repo/.claude/agents/test.md': `---
description: Test agent
tools: Read, Write,  Edit , Grep
---

Body content.`,
  });

  const result = await loadAgentDefinition({
    repoRoot: '/repo',
    role: 'test',
    contextPaths: [],
  });

  expect(result.definition.tools).toStrictEqual(['Read', 'Write', 'Edit', 'Grep']);
});

test('it parses tools from YAML array syntax', async () => {
  vol.fromJSON({
    '/repo/.claude/agents/test.md': `---
description: Test agent
tools:
  - Read
  - Write
  - Edit
---

Body content.`,
  });

  const result = await loadAgentDefinition({
    repoRoot: '/repo',
    role: 'test',
    contextPaths: [],
  });

  expect(result.definition.tools).toStrictEqual(['Read', 'Write', 'Edit']);
});

test('it parses disallowedTools from comma-separated string', async () => {
  vol.fromJSON({
    '/repo/.claude/agents/test.md': `---
description: Test agent
disallowedTools: WebFetch, WebSearch, Task
---

Body content.`,
  });

  const result = await loadAgentDefinition({
    repoRoot: '/repo',
    role: 'test',
    contextPaths: [],
  });

  expect(result.definition.disallowedTools).toStrictEqual(['WebFetch', 'WebSearch', 'Task']);
});

test('it parses disallowedTools from YAML array syntax', async () => {
  vol.fromJSON({
    '/repo/.claude/agents/test.md': `---
description: Test agent
disallowedTools:
  - WebFetch
  - WebSearch
---

Body content.`,
  });

  const result = await loadAgentDefinition({
    repoRoot: '/repo',
    role: 'test',
    contextPaths: [],
  });

  expect(result.definition.disallowedTools).toStrictEqual(['WebFetch', 'WebSearch']);
});

test('it defaults model to inherit when absent', async () => {
  vol.fromJSON({
    '/repo/.claude/agents/test.md': `---
description: Test agent
---

Body content.`,
  });

  const result = await loadAgentDefinition({
    repoRoot: '/repo',
    role: 'test',
    contextPaths: [],
  });

  expect(result.definition.model).toBe('inherit');
});

test('it uses provided model when present', async () => {
  vol.fromJSON({
    '/repo/.claude/agents/test.md': `---
description: Test agent
model: opus
---

Body content.`,
  });

  const result = await loadAgentDefinition({
    repoRoot: '/repo',
    role: 'test',
    contextPaths: [],
  });

  expect(result.definition.model).toBe('opus');
});

test('it returns undefined maxTurns when absent', async () => {
  vol.fromJSON({
    '/repo/.claude/agents/test.md': `---
description: Test agent
---

Body content.`,
  });

  const result = await loadAgentDefinition({
    repoRoot: '/repo',
    role: 'test',
    contextPaths: [],
  });

  expect(result.maxTurns).toBe(undefined);
});

test('it parses maxTurns as integer when present', async () => {
  vol.fromJSON({
    '/repo/.claude/agents/test.md': `---
description: Test agent
maxTurns: 100
---

Body content.`,
  });

  const result = await loadAgentDefinition({
    repoRoot: '/repo',
    role: 'test',
    contextPaths: [],
  });

  expect(result.maxTurns).toBe(100);
});

test('it uses markdown body as prompt', async () => {
  vol.fromJSON({
    '/repo/.claude/agents/test.md': `---
description: Test agent
---

You are a test agent.

This is your system prompt.`,
  });

  const result = await loadAgentDefinition({
    repoRoot: '/repo',
    role: 'test',
    contextPaths: [],
  });

  expect(result.definition.prompt).toBe('You are a test agent.\n\nThis is your system prompt.');
});

test('it appends context files to prompt when contextPaths provided', async () => {
  vol.fromJSON({
    '/repo/.claude/agents/test.md': `---
description: Test agent
---

Agent prompt.`,
    '/repo/.claude/CLAUDE.md': 'Project context file.',
    '/repo/docs/CONVENTIONS.md': 'Code conventions.',
  });

  const result = await loadAgentDefinition({
    repoRoot: '/repo',
    role: 'test',
    contextPaths: ['.claude/CLAUDE.md', 'docs/CONVENTIONS.md'],
  });

  expect(result.definition.prompt).toBe(
    'Agent prompt.\n\nProject context file.\n\nCode conventions.',
  );
});

test('it uses prompt as-is when contextPaths is empty', async () => {
  vol.fromJSON({
    '/repo/.claude/agents/test.md': `---
description: Test agent
---

Agent prompt.`,
  });

  const result = await loadAgentDefinition({
    repoRoot: '/repo',
    role: 'test',
    contextPaths: [],
  });

  expect(result.definition.prompt).toBe('Agent prompt.');
});

test('it throws when agent definition file is missing', async () => {
  vol.fromJSON({});

  await expect(
    loadAgentDefinition({
      repoRoot: '/repo',
      role: 'nonexistent',
      contextPaths: [],
    }),
  ).rejects.toThrow();
});

test('it throws when agent definition file contains malformed YAML', async () => {
  vol.fromJSON({
    '/repo/.claude/agents/test.md': `---
description: Test agent
malformed: [unclosed
---

Body.`,
  });

  await expect(
    loadAgentDefinition({
      repoRoot: '/repo',
      role: 'test',
      contextPaths: [],
    }),
  ).rejects.toThrow();
});

test('it throws when context file cannot be read', async () => {
  vol.fromJSON({
    '/repo/.claude/agents/test.md': `---
description: Test agent
---

Prompt.`,
  });

  await expect(
    loadAgentDefinition({
      repoRoot: '/repo',
      role: 'test',
      contextPaths: ['missing-file.md'],
    }),
  ).rejects.toThrow();
});

test('it excludes hooks from returned definition', async () => {
  vol.fromJSON({
    '/repo/.claude/agents/test.md': `---
description: Test agent
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: scripts/workflow/validate-bash.sh
---

Body.`,
  });

  const result = await loadAgentDefinition({
    repoRoot: '/repo',
    role: 'test',
    contextPaths: [],
  });

  expect(result.definition).not.toHaveProperty('hooks');
});

test('it excludes permissionMode from returned definition', async () => {
  vol.fromJSON({
    '/repo/.claude/agents/test.md': `---
description: Test agent
permissionMode: bypassPermissions
---

Body.`,
  });

  const result = await loadAgentDefinition({
    repoRoot: '/repo',
    role: 'test',
    contextPaths: [],
  });

  expect(result.definition).not.toHaveProperty('permissionMode');
});

test('it defaults tools to empty array when absent', async () => {
  vol.fromJSON({
    '/repo/.claude/agents/test.md': `---
description: Test agent
---

Body.`,
  });

  const result = await loadAgentDefinition({
    repoRoot: '/repo',
    role: 'test',
    contextPaths: [],
  });

  expect(result.definition.tools).toStrictEqual([]);
});

test('it defaults disallowedTools to empty array when absent', async () => {
  vol.fromJSON({
    '/repo/.claude/agents/test.md': `---
description: Test agent
---

Body.`,
  });

  const result = await loadAgentDefinition({
    repoRoot: '/repo',
    role: 'test',
    contextPaths: [],
  });

  expect(result.definition.disallowedTools).toStrictEqual([]);
});

test('it defaults description to empty string when absent', async () => {
  vol.fromJSON({
    '/repo/.claude/agents/test.md': `---
tools: Read
---

Body.`,
  });

  const result = await loadAgentDefinition({
    repoRoot: '/repo',
    role: 'test',
    contextPaths: [],
  });

  expect(result.definition.description).toBe('');
});
