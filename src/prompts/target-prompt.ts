// @ts-ignore - enquirer uses CommonJS exports
import enquirer from 'enquirer';
import { CustomMultiSelect } from './custom-multiselect.js';
import type { TargetName } from '../types.js';

/**
 * Prompt user to select target agents.
 * @param preselected - Pre-selected targets (from CLI options)
 * @returns Selected target names
 */
export async function promptTargets(preselected: TargetName[] = []): Promise<TargetName[]> {
  const EnquirerClass = enquirer as any;

  const instance = new EnquirerClass({
    symbols: {
      checked: '◉',
      unchecked: '○'
    }
  });

  instance.register('multi', CustomMultiSelect);

  // All targets selected if none specified
  const allSelected = preselected.length === 0;

  const result = await instance.prompt({
    type: 'multi',
    name: 'targets',
    message: 'Select target agents',
    choices: [
      {
        name: 'claude',
        message: 'Claude Code',
        hint: '.mcp.json',
        enabled: preselected.includes('claude') || allSelected
      },
      {
        name: 'codex',
        message: 'Codex',
        hint: '.codex/config.toml',
        enabled: preselected.includes('codex') || allSelected
      },
      {
        name: 'gemini',
        message: 'Gemini CLI',
        hint: '.gemini/settings.json',
        enabled: preselected.includes('gemini') || allSelected
      }
    ],
    validate: (value: TargetName[]) => value.length > 0 || 'Please select at least one target'
  });

  return result.targets as TargetName[];
}
