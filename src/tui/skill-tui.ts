/**
 * Skill Project TUI
 *
 * Manage skills for the current project.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// @ts-ignore - enquirer uses CommonJS exports
const { Select } = require('enquirer');
import type { TuiState, ScreenAction } from './tui-base.js';
import { listSkills } from '../catalog.js';
import type { TargetName } from '../types.js';
import { join } from 'node:path';
import { padRightWide, truncateWide } from '../table-utils.js';

type SkillAction = 'add' | 'remove' | 'install' | 'switch-target' | 'refresh' | 'back' | 'exit';

interface SkillStatus {
  name: string;
  targets: TargetName[];
}

/**
 * Skill TUI Screen
 */
export class SkillTuiScreen {
  name = 'skill' as const;

  async render(state: TuiState): Promise<TuiState | null> {
    // Main loop - header cleared/redrawn in renderMain
    while (true) {
      const action = await this.renderMain(state);
      if (action === 'exit') return null;
      if (action === 'back') return state;
    }
  }

  private renderHeader(): void {
    console.log('╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║  🎯 Project Skills                                                  ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝');
  }

  private getDefaultConfigPath(target: TargetName, projectRoot: string): string {
    switch (target) {
      case 'claude':
        return join(projectRoot, '.mcp.json');
      case 'codex':
        return join(projectRoot, '.codex', 'config.toml');
      case 'gemini':
        return join(projectRoot, '.gemini', 'settings.json');
    }
  }

  private async renderMain(state: TuiState): Promise<SkillAction> {
    console.clear();
    this.renderHeader();

    const currentTarget = state.target;

    // Get installed skills for current target
    const installedSkills = await this.getInstalledSkills(currentTarget, state.allowHome);

    // Display status table
    await this.renderStatusTable(installedSkills, currentTarget, state.allowHome);

    console.log();

    const choices = [
      { name: 'add', message: '➕ Add skill to project', value: '__add__' },
      { name: 'install', message: '🔍 Install skill from GitHub', value: '__install__' },
      { name: 'switch-target', message: `🔄 Switch target (current: ${currentTarget})`, value: '__switch__' },
      { name: 'exit', message: '🚪 Exit', value: '__exit__' },
    ];

    // Add skill actions
    if (installedSkills.length > 0) {
      const skillChoices = installedSkills.map(skill => ({
        name: `skill:${skill.name}`,
        message: `📚 ${skill.name}`,
        value: skill.name
      }));
      choices.splice(1, 0, ...skillChoices);
    }

    const prompt = new Select({
      name: 'action',
      message: 'Select skill or action:',
      choices,
      actions: {
        ctrl: { n: 'down', p: 'up' }
      }
    });

    try {
      const selected = await prompt.run();

      if (selected === '__exit__') return 'exit';
      if (selected === '__add__') return await this.handleAdd(state);
      if (selected === '__install__') return await this.handleInstall(state);
      if (selected === '__switch__') return await this.handleSwitchTarget(state);

      // Skill selected
      return await this.handleSkillAction(selected as string, state);
    } catch {
      return 'exit';
    }
  }

  private async renderStatusTable(installedSkills: SkillStatus[], currentTarget: TargetName, allowHome?: boolean): Promise<void> {
    const targets: TargetName[] = ['claude', 'codex', 'gemini'];

    if (installedSkills.length === 0) {
      console.log('\n  No skills configured for this project.');
      console.log('  Select "➕ Add skill to project" to get started.\n');
      return;
    }

    // Get all skills across targets
    const allSkills: Record<TargetName, SkillStatus[]> = {} as any;
    for (const target of targets) {
      allSkills[target] = await this.getInstalledSkills(target, allowHome);
    }

    const allSkillNames = new Set<string>();
    for (const target of targets) {
      allSkills[target]?.forEach(s => allSkillNames.add(s.name));
    }

    const NAME_WIDTH = 35;

    const borderH = '  ┌' + '─'.repeat(NAME_WIDTH + 2) + '┬───┬───┬───┐';
    const borderM = '  ├' + '─'.repeat(NAME_WIDTH + 2) + '┼───┼───┼───┤';
    const borderF = '  └' + '─'.repeat(NAME_WIDTH + 2) + '┴───┴───┴───┘';

    console.log('\n' + borderH);
    console.log('  │ ' + padRightWide('Skill', NAME_WIDTH) + ' │ C │ C │ G │');
    console.log(borderM);

    // Get skill descriptions
    const catalogSkills = await listSkills();
    const skillMap = new Map(catalogSkills.map(s => [s.id, s]));

    // Rows
    for (const name of Array.from(allSkillNames).sort()) {
      const skillInfo = skillMap.get(name);
      const displayName = skillInfo?.displayName || name;
      const truncated = truncateWide(displayName, NAME_WIDTH);

      console.log('  │ ' + padRightWide(truncated, NAME_WIDTH) + ' │ ' +
                  (allSkills.claude?.find(s => s.name === name) ? '✅ ' : '   ') + '│ ' +
                  (allSkills.codex?.find(s => s.name === name) ? '✅ ' : '   ') + '│ ' +
                  (allSkills.gemini?.find(s => s.name === name) ? '✅ ' : '   ') + '│');
    }

    console.log(borderF);
    console.log('  Legend: C=Claude, C=Codex, G=Gemini | ✅=Installed');
  }

  private async getInstalledSkills(target: TargetName, allowHome?: boolean): Promise<SkillStatus[]> {
    try {
      const { discoverProject } = await import('../project-discovery.js');
      const discovery = await discoverProject(undefined, { allowHome });

      const { getSkills } = await import('../skill-adapters.js');
      const configPath = this.getDefaultConfigPath(target, discovery.root);
      const skills = await getSkills(target, configPath as any);

      return Object.entries(skills).map(([name, _]) => ({ name, targets: [target] }));
    } catch {
      return [];
    }
  }

  private async handleSwitchTarget(state: TuiState): Promise<SkillAction> {
    const targets: TargetName[] = ['claude', 'codex', 'gemini'];

    const prompt = new Select({
      name: 'target',
      message: 'Select target:',
      choices: targets.map(t => ({
        name: t,
        message: t === state.target ? `${t} (current)` : t
      })),
      actions: {
        ctrl: { n: 'down', p: 'up' }
      }
    });

    try {
      const selected = await prompt.run() as TargetName;
      state.target = selected;
      return 'refresh';
    } catch {
      return 'back';
    }
  }

  private async handleAdd(state: TuiState): Promise<SkillAction> {
    console.log('\n📚 Add Skill to Project\n');

    // Get catalog entries
    const skills = await listSkills();

    if (skills.length === 0) {
      console.log('No skills in catalog.');
      console.log('\nOptions:');
      console.log('  1. Install from GitHub');
      console.log('  2. Import local skill');

      const prompt = new Select({
        name: 'option',
        message: 'Choose option:',
        choices: [
          { name: 'github', message: 'Install from GitHub' },
          { name: 'import', message: 'Import local skill' },
          { name: 'back', message: '← Back' }
        ],
        actions: {
          ctrl: { n: 'down', p: 'up' }
        }
      });

      try {
        const choice = await prompt.run();
        if (choice === 'back') return 'back';
        if (choice === 'github') return await this.installFromGithub(state);
        if (choice === 'import') return await this.importLocal(state);
      } catch {
        return 'back';
      }
    }

    // Show catalog entries
    const choices = skills.map(skill => ({
      name: skill.id,
      message: `📚 ${skill.displayName || skill.id}`,
      hint: skill.description?.slice(0, 50)
    }));

    choices.push(
      { name: 'github', message: 'Install from GitHub (not in catalog)', hint: '' },
      { name: 'import', message: 'Import local skill', hint: '' },
      { name: 'back', message: '← Back', hint: '' }
    );

    const prompt = new Select({
      name: 'skill',
      message: 'Select skill (or action):',
      choices,
      actions: {
        ctrl: { n: 'down', p: 'up' }
      }
    });

    try {
      const selected = await prompt.run();
      if (selected === 'back') return 'back';
      if (selected === 'github') return await this.installFromGithub(state);
      if (selected === 'import') return await this.importLocal(state);

      // Add from catalog
      return await this.addToProject(selected, state);
    } catch {
      return 'back';
    }
  }

  private async handleInstall(state: TuiState): Promise<SkillAction> {
    return await this.installFromGithub(state);
  }

  private async addToProject(skillId: string, state: TuiState): Promise<SkillAction> {
    const { skillAdd } = await import('../cli-skill.js');

    try {
      await skillAdd({
        skillId,
        targets: [state.target],
        noRegister: true
      });
      console.log('\n✅ Added to project!');
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}`);
    }

    await this.pressEnter();
    return 'refresh';
  }

  private async installFromGithub(state: TuiState): Promise<SkillAction> {
    const { prompt } = await import('enquirer');

    try {
      const response = await prompt({
        type: 'input',
        name: 'url',
        message: 'Enter GitHub URL (e.g., https://github.com/anthropics/skills/tree/main/skill-creator):'
      }) as { url: string };

      if (!response.url) return 'back';

      const { skillInstallFromGitHub } = await import('../cli-skill.js');
      await skillInstallFromGitHub({
        githubUrl: response.url,
        targets: [state.target],
        addToCatalog: true
      });
      console.log('\n✅ Installed from GitHub and added to project!');
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}`);
    }

    await this.pressEnter();
    return 'refresh';
  }

  private async importLocal(state: TuiState): Promise<SkillAction> {
    const { prompt } = await import('enquirer');

    try {
      const response = await prompt({
        type: 'input',
        name: 'path',
        message: 'Enter skill directory path:'
      }) as { path: string };

      if (!response.path) return 'back';

      // Import to catalog first
      const { catalogSkillImport } = await import('../cli-catalog.js');
      await catalogSkillImport({ path: response.path });

      // Get skill ID from path
      const skillId = response.path.split('/').pop() || response.path.split('\\').pop() || 'imported-skill';

      // Add to project
      const { skillAdd } = await import('../cli-skill.js');
      await skillAdd({
        skillId,
        targets: [state.target],
        noRegister: true
      });

      console.log('\n✅ Imported to catalog and added to project!');
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}`);
    }

    await this.pressEnter();
    return 'refresh';
  }

  private async handleSkillAction(skillName: string, state: TuiState): Promise<SkillAction> {
    console.log(`\n📚 ${skillName}`);
    console.log('─'.repeat(60));

    const prompt = new Select({
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: 'remove', message: '🗑️  Remove from project' },
        { name: 'details', message: '📄 View details' },
        { name: 'back', message: '← Back' }
      ],
      actions: {
        ctrl: { n: 'down', p: 'up' }
      }
    });

    try {
      const action = await prompt.run();

      if (action === 'back') return 'refresh';
      if (action === 'remove') return await this.removeSkill(skillName, state);
      if (action === 'details') return await this.showSkillDetails(skillName);
    } catch {
      return 'refresh';
    }

    return 'refresh';
  }

  private async removeSkill(skillName: string, state: TuiState): Promise<SkillAction> {
    const { prompt } = await import('enquirer');

    try {
      const confirmed = await prompt({
        type: 'confirm',
        name: 'confirm',
        message: `Remove "${skillName}" from ${state.target}?`,
        initial: false
      }) as { confirm: boolean };

      if (!confirmed) return 'refresh';

      const { skillRemove } = await import('../cli-skill.js');
      await skillRemove({ skillName, targets: [state.target] });
      console.log(`\n✅ Removed ${skillName}`);
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}`);
    }

    await this.pressEnter();
    return 'refresh';
  }

  private async showSkillDetails(skillName: string): Promise<SkillAction> {
    const skills = await listSkills();
    const skill = skills.find(s => s.id === skillName);

    if (skill) {
      console.log(`\n📚 ${skill.displayName || skill.id}`);
      console.log('─'.repeat(60));
      console.log(`ID: ${skill.id}`);
      console.log(`Description: ${skill.description || 'No description'}`);
    } else {
      console.log(`\nSkill "${skillName}" is not in catalog.`);
    }

    await this.pressEnter();
    return 'refresh';
  }

  private pressEnter(): Promise<void> {
    return new Promise(resolve => {
      process.stdin.once('data', () => resolve());
    });
  }

  handleAction(state: TuiState, action: ScreenAction): Promise<TuiState> {
    return Promise.resolve(state);
  }
}
