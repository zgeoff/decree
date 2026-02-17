import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';

interface AgentDefinition {
  description: string;
  tools: string[];
  disallowedTools: string[];
  model: string;
  prompt: string;
}

interface LoadAgentDefinitionResult {
  definition: AgentDefinition;
  maxTurns: number | undefined;
}

interface LoadAgentDefinitionConfig {
  repoRoot: string;
  role: string;
  contextPaths: string[];
}

export async function loadAgentDefinition(
  config: LoadAgentDefinitionConfig,
): Promise<LoadAgentDefinitionResult> {
  const agentFilePath = join(config.repoRoot, '.claude', 'agents', `${config.role}.md`);

  const fileContent = await readFile(agentFilePath, 'utf-8');

  const parsed = matter(fileContent);

  const description = parsed.data.description ?? '';
  const tools = parseToolsList(parsed.data.tools);
  const disallowedTools = parseToolsList(parsed.data.disallowedTools);
  const model = parsed.data.model ?? 'inherit';
  const maxTurns = parsed.data.maxTurns;

  let prompt = parsed.content.trimStart();

  if (config.contextPaths.length > 0) {
    const contextContents = await Promise.all(
      config.contextPaths.map(async (relativePath) => {
        const contextFilePath = join(config.repoRoot, relativePath);
        return await readFile(contextFilePath, 'utf-8');
      }),
    );

    const contextBlock = contextContents.join('\n\n');
    prompt = `${prompt}\n\n${contextBlock}`;
  }

  const definition: AgentDefinition = {
    description,
    tools,
    disallowedTools,
    model,
    prompt,
  };

  return {
    definition,
    maxTurns,
  };
}

function parseToolsList(value: string | string[] | undefined): string[] {
  if (value === undefined) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  return value.split(',').map((tool) => tool.trim());
}
