// @ts-ignore - enquirer uses CommonJS exports
import AutoComplete from 'enquirer/lib/prompts/autocomplete.js';
import { listSkills } from '../catalog.js';

/** Special return value indicating user wants to go back */
export const SKILL_BACK = '__SKILL_BACK__';

/**
 * Prompt user to select skills from catalog.
 * @param allowBack - Whether to show "Back" option (default: false)
 * @returns Selected skill IDs, or [SKILL_BACK] if user chose to go back
 */
export async function promptSkills(allowBack = false): Promise<string[]> {
  const skills = await listSkills();

  if (skills.length === 0) {
    console.log('No skill entries in catalog.\n');
    console.log('Tip: Use these commands to add skills first:');
    console.log('  acm catalog skill import ~/.claude/skills/my-skill');
    console.log('  acm skill install <github-url>\n');
    return [];
  }

  const choices = skills.map(skill => ({
    name: skill.id,
    message: skill.displayName || skill.id,
    value: skill.id,
    hint: skill.description.slice(0, 50)
  }));

  // Add back option if allowed
  if (allowBack) {
    choices.unshift({
      name: SKILL_BACK,
      message: '← Back to MCP selection',
      value: SKILL_BACK,
      hint: 'Return to previous step'
    });
  }

  const prompt = new AutoComplete({
    name: 'skills',
    message: allowBack
      ? 'Select skills (type to search, or select ← Back to return)'
      : 'Select skills (type to search)',
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
        if (choice.name === SKILL_BACK) return true;
        const name = (choice.name || '').toLowerCase();
        const message = (choice.message || '').toLowerCase();
        return name.includes(lowerInput) || message.includes(lowerInput);
      }).slice(0, 10);
    }
  });

  try {
    const result = await prompt.run();
    // If back was selected, return special value
    if (result && result.includes(SKILL_BACK)) {
      return [SKILL_BACK];
    }
    return result || [];
  } catch {
    // User cancelled (Ctrl+C)
    return [];
  }
}
