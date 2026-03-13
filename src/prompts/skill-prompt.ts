import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// @ts-ignore - enquirer uses CommonJS exports
const AutoComplete = require('enquirer/lib/prompts/autocomplete.js');
import { listSkills } from '../catalog.js';

/**
 * Prompt user to select skills from catalog.
 * @returns Selected skill IDs
 */
export async function promptSkills(): Promise<string[]> {
  const skills = await listSkills();

  if (skills.length === 0) {
    console.log('No skill entries in catalog.\n');
    console.log('Tip: Use these commands to add skills first:');
    console.log('  acsync catalog skill import ~/.claude/skills/my-skill');
    console.log('  acsync skill install <github-url>\n');
    return [];
  }

  const choices = skills.map(skill => ({
    name: skill.id,
    message: skill.displayName || skill.id,
    value: skill.id,
    hint: skill.description.slice(0, 50)
  }));

  const prompt = new AutoComplete({
    name: 'skills',
    message: 'Select skills (type to search)',
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
