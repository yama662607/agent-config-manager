// @ts-ignore - enquirer uses CommonJS exports
const AutoComplete = require('enquirer/lib/prompts/autocomplete.js');
import { listMcps } from '../catalog.js';

/**
 * Prompt user to select MCP servers from catalog.
 * @returns Selected MCP server IDs
 */
export async function promptMcps(): Promise<string[]> {
  const mcps = await listMcps();

  if (mcps.length === 0) {
    console.log('No MCP entries in catalog.\n');
    console.log('Tip: Use these commands to add MCPs first:');
    console.log('  acsync catalog mcp add @modelcontextprotocol/server-github');
    console.log('  acsync catalog mcp add @modelcontextprotocol/server-filesystem\n');
    return [];
  }

  const choices = mcps.map(mcp => ({
    name: mcp.id,
    message: mcp.displayName || mcp.id,
    value: mcp.id,
    hint: mcp.description.slice(0, 50)
  }));

  const prompt = new AutoComplete({
    name: 'mcps',
    message: 'Select MCP servers (type to search)',
    multiple: true,
    choices: choices,
    limit: 10,
    suggest: (input: string, choices: any[]) => {
      // Simple fuzzy search - matches if input is substring of name or message
      const lowerInput = input.toLowerCase();
      return choices.filter(choice => {
        const name = (choice.name || '').toLowerCase();
        const message = (choice.message || '').toLowerCase();
        return name.includes(lowerInput) || message.includes(lowerInput);
      }).slice(0, 10);
    }
  });

  try {
    const result = await prompt.run();
    return result || [];
  } catch {
    // User cancelled (Ctrl+C)
    return [];
  }
}
