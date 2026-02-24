/**
 * MCP Prompt definitions and handler for MemoClaw.
 *
 * Prompts are reusable templates that MCP clients can discover and invoke.
 * They appear as slash commands in compatible clients (Claude Desktop, etc.).
 */

import type { ApiClient } from './api.js';
import type { Config } from './config.js';
import { formatMemory } from './format.js';

/** Prompt definitions returned by prompts/list */
export const PROMPTS = [
  {
    name: 'review-memories',
    description:
      'Review and consolidate memories in a namespace. Shows duplicates, stale items, and suggestions for cleanup.',
    arguments: [
      {
        name: 'namespace',
        description: 'Namespace to review (omit for default namespace)',
        required: false,
      },
    ],
  },
  {
    name: 'load-context',
    description:
      'Load relevant memories for a task. Performs semantic recall and returns a context-ready summary.',
    arguments: [
      {
        name: 'task',
        description: 'Description of the task you need context for',
        required: true,
      },
      {
        name: 'namespace',
        description: 'Namespace to search (omit for default namespace)',
        required: false,
      },
    ],
  },
  {
    name: 'memory-report',
    description:
      'Generate a summary report of memory stats, namespace breakdown, stale items, and optimization suggestions.',
    arguments: [
      {
        name: 'namespace',
        description: 'Namespace to report on (omit for all namespaces)',
        required: false,
      },
    ],
  },
  {
    name: 'migrate-files',
    description:
      'Guided migration from .md files to MemoClaw. Provides step-by-step instructions and the right CLI commands.',
    arguments: [
      {
        name: 'file_path',
        description: 'Path to the .md file or directory to migrate',
        required: true,
      },
      {
        name: 'namespace',
        description: 'Target namespace for imported memories',
        required: false,
      },
    ],
  },
];

type PromptMessage = { role: 'user' | 'assistant'; content: { type: 'text'; text: string } };

export function createPromptHandler(api: ApiClient, _config: Config) {
  const { makeRequest } = api;

  return async function handleGetPrompt(
    name: string,
    args: Record<string, string> | undefined
  ): Promise<{ description?: string; messages: PromptMessage[] }> {
    switch (name) {
      case 'review-memories': {
        const namespace = args?.namespace;
        const params = new URLSearchParams();
        params.set('limit', '100');
        if (namespace) params.set('namespace', namespace);

        const result = await makeRequest('GET', `/v1/memories?${params}`);
        const memories = result.memories || result.data || [];

        const nsLabel = namespace ? `namespace "${namespace}"` : 'default namespace';
        const memoryList = memories.length > 0
          ? memories.map((m: any) => formatMemory(m)).join('\n\n')
          : '(no memories found)';

        return {
          description: `Review memories in ${nsLabel}`,
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Review the following ${memories.length} memories in ${nsLabel}. Identify:\n` +
                  `1. **Duplicates** — memories with very similar content that could be consolidated\n` +
                  `2. **Stale items** — memories that seem outdated or no longer relevant\n` +
                  `3. **Low-value** — memories with low importance that add little value\n` +
                  `4. **Suggestions** — specific actions to clean up and optimize this memory store\n\n` +
                  `For each suggestion, mention the memory ID so the user can act on it.\n\n` +
                  `---\n\n${memoryList}`,
              },
            },
          ],
        };
      }

      case 'load-context': {
        const task = args?.task;
        if (!task) throw new Error('task argument is required');
        const namespace = args?.namespace;

        const body: any = { query: task, limit: 20 };
        if (namespace) body.namespace = namespace;

        const result = await makeRequest('POST', '/v1/recall', body);
        const memories = result.memories || result.data || [];

        const memoryList = memories.length > 0
          ? memories.map((m: any) => formatMemory(m)).join('\n\n')
          : '(no relevant memories found)';

        return {
          description: `Load context for: ${task}`,
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `I need to work on the following task:\n\n**${task}**\n\n` +
                  `Here are the ${memories.length} most relevant memories from my store` +
                  (namespace ? ` (namespace: ${namespace})` : '') + `:\n\n` +
                  `---\n\n${memoryList}\n\n---\n\n` +
                  `Based on these memories, provide a brief context summary highlighting ` +
                  `the most important information relevant to this task. Note any potential ` +
                  `conflicts or outdated information.`,
              },
            },
          ],
        };
      }

      case 'memory-report': {
        const namespace = args?.namespace;

        // Fetch stats
        const stats = await makeRequest('GET', '/v1/stats');

        // Fetch namespaces
        let namespaces: any[] = [];
        try {
          const nsResult = await makeRequest('GET', '/v1/namespaces');
          namespaces = nsResult.namespaces || [];
        } catch {
          // Ignore if not available
        }

        // Fetch recent memories to check for staleness
        const params = new URLSearchParams();
        params.set('limit', '50');
        params.set('sort', 'created_at');
        params.set('order', 'asc');
        if (namespace) params.set('namespace', namespace);

        const oldResult = await makeRequest('GET', `/v1/memories?${params}`);
        const oldestMemories = oldResult.memories || oldResult.data || [];

        const statsText = JSON.stringify(stats, null, 2);
        const nsText = namespaces.length > 0
          ? namespaces.map((ns: any) => `- ${ns.namespace}: ${ns.count} memories`).join('\n')
          : '(no namespace data available)';

        const oldMemoriesText = oldestMemories.length > 0
          ? oldestMemories.slice(0, 10).map((m: any) => formatMemory(m)).join('\n\n')
          : '(none)';

        return {
          description: 'Memory store report' + (namespace ? ` for "${namespace}"` : ''),
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Generate a health report for my MemoClaw memory store` +
                  (namespace ? ` (namespace: "${namespace}")` : '') + `.\n\n` +
                  `## Stats\n\`\`\`json\n${statsText}\n\`\`\`\n\n` +
                  `## Namespaces\n${nsText}\n\n` +
                  `## Oldest Memories (potential stale)\n${oldMemoriesText}\n\n` +
                  `Based on this data, provide:\n` +
                  `1. **Overview** — total memories, storage health\n` +
                  `2. **Namespace analysis** — which namespaces are most/least active\n` +
                  `3. **Stale memory candidates** — oldest items that might need review\n` +
                  `4. **Optimization tips** — actionable suggestions to improve memory quality`,
              },
            },
          ],
        };
      }

      case 'migrate-files': {
        const filePath = args?.file_path;
        if (!filePath) throw new Error('file_path argument is required');
        const namespace = args?.namespace;

        const nsFlag = namespace ? ` --namespace ${namespace}` : '';

        return {
          description: `Migration guide for ${filePath}`,
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `I want to migrate my memory/knowledge from markdown files to MemoClaw.\n\n` +
                  `**Source:** \`${filePath}\`\n` +
                  (namespace ? `**Target namespace:** \`${namespace}\`\n` : '') + `\n` +
                  `Guide me through the migration process. Here's what I need:\n\n` +
                  `1. **Preview** — What the CLI command will do:\n` +
                  `   \`\`\`bash\n   memoclaw migrate ${filePath}${nsFlag} --dry-run\n   \`\`\`\n\n` +
                  `2. **Execute** — Run the actual migration:\n` +
                  `   \`\`\`bash\n   memoclaw migrate ${filePath}${nsFlag}\n   \`\`\`\n\n` +
                  `3. **Verify** — Check the imported memories:\n` +
                  `   \`\`\`bash\n   memoclaw list${nsFlag} --limit 20\n   \`\`\`\n\n` +
                  `**Important notes:**\n` +
                  `- Each section/heading in the .md file becomes a separate memory\n` +
                  `- Maximum 8192 characters per memory\n` +
                  `- Migration uses GPT to extract structured memories (costs $0.01/call)\n` +
                  `- Use \`--dry-run\` first to preview what will be imported\n\n` +
                  `Would you like to proceed with the preview first?`,
              },
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown prompt: ${name}`);
    }
  };
}
