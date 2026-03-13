import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// @ts-ignore - enquirer uses CommonJS exports
const Confirm = require('enquirer/lib/prompts/confirm.js');
import type { TargetName } from '../types.js';

/**
 * Prompt user to confirm the selection summary.
 * @param targets - Selected target agents
 * @param mcps - Selected MCP server IDs
 * @param skills - Selected skill IDs
 * @returns True if user confirmed, false otherwise
 */
export async function promptConfirm(
  targets: TargetName[],
  mcps: string[],
  skills: string[]
): Promise<boolean> {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Summary');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log(`Targets: ${targets.join(', ')}`);

  if (mcps.length > 0) {
    console.log('\nMCP Servers to add:');
    for (const mcpId of mcps) {
      console.log(`  • ${mcpId}`);
    }
  }

  if (skills.length > 0) {
    console.log('\nSkills to add:');
    for (const skillId of skills) {
      console.log(`  • ${skillId}`);
    }
  }

  if (mcps.length === 0 && skills.length === 0) {
    console.log('\nNo items selected. Nothing to add.\n');
    return false;
  }

  const prompt = new Confirm({
    name: 'confirm',
    message: 'Add these items to your project?',
    initial: true,
    // Override key actions: Ctrl+n → down, Ctrl+p → up (emacs-style)
    // Note: Confirm only has Yes/No, but this adds consistency
    actions: {
      ctrl: {
        n: 'down',
        p: 'up'
      }
    }
  });

  try {
    return await prompt.run();
  } catch {
    // User cancelled (Ctrl+C)
    return false;
  }
}
