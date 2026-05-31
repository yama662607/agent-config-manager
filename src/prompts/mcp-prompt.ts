import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// @ts-ignore - enquirer uses CommonJS exports
const AutoComplete = require('enquirer/lib/prompts/autocomplete.js');
import { listMcps } from '../catalog.js';

/** Special return value indicating user wants to go back */
export const MCP_BACK = '__MCP_BACK__';

/**
 * Prompt user to select MCP servers from catalog.
 * @param allowBack - Whether to show "Back" option (default: false)
 * @returns Selected MCP server IDs, or [MCP_BACK] if user chose to go back
 */
export async function promptMcps(allowBack = false): Promise<string[]> {
  const mcps = await listMcps();

  if (mcps.length === 0) {
    console.log('No MCP entries in catalog.\n');
    console.log('Tip: Use these commands to add MCPs first:');
    console.log('  acm catalog mcp add @modelcontextprotocol/server-github');
    console.log('  acm catalog mcp add @modelcontextprotocol/server-filesystem\n');
    return [];
  }

  const choices = mcps.map(mcp => ({
    name: mcp.id,
    message: mcp.displayName || mcp.id,
    value: mcp.id,
    hint: mcp.description.slice(0, 50)
  }));

  // Add back option if allowed
  if (allowBack) {
    choices.unshift({
      name: MCP_BACK,
      message: '← Back to target selection',
      value: MCP_BACK,
      hint: 'Return to previous step'
    });
  }

  const prompt = new AutoComplete({
    name: 'mcps',
    message: allowBack
      ? 'Select MCP servers (type to search, or select ← Back to return)'
      : 'Select MCP servers (type to search)',
    multiple: true,
    choices: choices,
    limit: 10,
    // Override key actions: Ctrl+n → down, Ctrl+p → up (emacs-style)
    actions: {
      ctrl: {
        n: 'down',
        p: 'up'
      }
    },
    suggest: (input: string, choices: any[]) => {
      // Simple fuzzy search - matches if input is substring of name or message
      const lowerInput = input.toLowerCase();
      return choices.filter(choice => {
        // Always show back option when filtering
        if (choice.name === MCP_BACK) return true;
        const name = (choice.name || '').toLowerCase();
        const message = (choice.message || '').toLowerCase();
        return name.includes(lowerInput) || message.includes(lowerInput);
      }).slice(0, 10);
    }
  });

  try {
    const result = await prompt.run();
    // If back was selected, return special value
    if (result && result.includes(MCP_BACK)) {
      return [MCP_BACK];
    }
    return result || [];
  } catch {
    // User cancelled (Ctrl+C)
    return [];
  }
}
