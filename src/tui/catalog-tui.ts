/**
 * Catalog TUI
 *
 * Interactive catalog browser with list view, details, and actions.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// @ts-ignore - enquirer uses CommonJS exports
const { Select } = require('enquirer');
import type { TuiState, ScreenAction } from './tui-base.js';
import { listMcps, listSkills } from '../catalog.js';
import type { McpCatalogEntry, SkillCatalogEntry } from '../types.js';

type CatalogTab = 'mcp' | 'skill' | 'registry';
type CatalogAction = 'view' | 'add-to-project' | 'delete' | 'import' | 'install' | 'back' | 'exit';

/**
 * Catalog TUI Screen
 */
export class CatalogTuiScreen {
  name = 'catalog' as const;

  async render(state: TuiState): Promise<TuiState | null> {
    console.clear();
    this.renderHeader();

    // Let user select tab first
    const tab = await this.selectTab();
    if (!tab) return null; // Exit

    // Main loop for this tab
    while (true) {
      const action = await this.renderTab(tab, state);
      if (action === 'exit') return null;
      if (action === 'back') break;
      // Handle other actions...
    }

    return state;
  }

  private renderHeader(): void {
    console.log('╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║  📚 Catalog Browser                                                 ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝');
    console.log();
  }

  private async selectTab(): Promise<CatalogTab | null> {
    const prompt = new Select({
      name: 'tab',
      message: 'Select catalog section:',
      choices: [
        { name: 'mcp', message: '📦 MCP Servers' },
        { name: 'skill', message: '📚 Skills' },
        { name: 'registry', message: '🔍 Skill Registry' },
        { name: 'exit', message: '🚪 Exit' },
      ],
      actions: {
        ctrl: { n: 'down', p: 'up' }
      }
    });

    try {
      const result = await prompt.run();
      if (result === 'exit') return null;
      return result as CatalogTab;
    } catch {
      return null;
    }
  }

  private async renderTab(tab: CatalogTab, state: TuiState): Promise<CatalogAction> {
    console.log(`\n─── ${tab.toUpperCase()} CATALOG ───\n`);

    switch (tab) {
      case 'mcp':
        return await this.renderMcpCatalog(state);
      case 'skill':
        return await this.renderSkillCatalog(state);
      case 'registry':
        return await this.renderRegistry(state);
    }
  }

  private async renderMcpCatalog(state: TuiState): Promise<CatalogAction> {
    const mcps = await listMcps();

    if (mcps.length === 0) {
      console.log('No MCP entries in catalog.');
      console.log('\nTip: Use "acsync catalog mcp add <package>" to add entries.');
      await this.pressEnter();
      return 'back';
    }

    // Create choices with actions
    const choices = mcps.map(mcp => ({
      name: mcp.id,
      message: `📦 ${mcp.displayName || mcp.id}`,
      value: mcp.id,
      hint: mcp.description?.slice(0, 40)
    }));

    choices.push(
      { name: 'add', message: '➕ Add new MCP to catalog', value: '__add__', hint: '' },
      { name: 'back', message: '← Back to tabs', value: '__back__', hint: '' },
      { name: 'exit', message: '🚪 Exit', value: '__exit__', hint: '' }
    );

    const prompt = new Select({
      name: 'mcp',
      message: 'Select MCP (or action):',
      choices,
      actions: {
        ctrl: { n: 'down', p: 'up' }
      },
      footer: 'Use ↑↓ to navigate, Enter to select'
    });

    try {
      const selected = await prompt.run();

      if (selected === '__exit__') return 'exit';
      if (selected === '__back__') return 'back';
      if (selected === '__add__') {
        await this.addMcpToCatalog();
        return 'back'; // Return to refresh
      }

      // Show MCP details and actions
      return await this.showMcpDetails(selected, mcps.find(m => m.id === selected)!, state);
    } catch {
      return 'exit';
    }
  }

  private async renderSkillCatalog(state: TuiState): Promise<CatalogAction> {
    const skills = await listSkills();

    if (skills.length === 0) {
      console.log('No skill entries in catalog.');
      console.log('\nTip: Use "acsync catalog skill import <path>" to add skills.');
      await this.pressEnter();
      return 'back';
    }

    const choices = skills.map(skill => ({
      name: skill.id,
      message: `📚 ${skill.displayName || skill.id}`,
      value: skill.id,
      hint: skill.description?.slice(0, 40)
    }));

    choices.push(
      { name: 'import', message: '📥 Import local skill', value: '__import__', hint: '' },
      { name: 'back', message: '← Back to tabs', value: '__back__', hint: '' },
      { name: 'exit', message: '🚪 Exit', value: '__exit__', hint: '' }
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

      if (selected === '__exit__') return 'exit';
      if (selected === '__back__') return 'back';
      if (selected === '__import__') {
        await this.importSkill();
        return 'back';
      }

      // Show skill details and actions
      return await this.showSkillDetails(selected, skills.find(s => s.id === selected)!, state);
    } catch {
      return 'exit';
    }
  }

  private async renderRegistry(state: TuiState): Promise<CatalogAction> {
    const { prompt } = await import('enquirer');

    console.log('Search skills.directory registry...\n');

    try {
      const response = await prompt({
        type: 'input',
        name: 'query',
        message: 'Enter search query (or press Enter to go back):'
      }) as { query: string };

      if (!response.query) return 'back';

      // Search registry (delegate to existing CLI)
      const { catalogSkillSearch } = await import('../cli-catalog.js');
      await catalogSkillSearch(response.query);

      await this.pressEnter();
      return 'back';
    } catch {
      return 'back';
    }
  }

  private async showMcpDetails(id: string, mcp: McpCatalogEntry, state: TuiState): Promise<CatalogAction> {
    console.clear();
    this.renderHeader();
    console.log(`\n📦 ${mcp.displayName || id}`);
    console.log('─'.repeat(60));
    console.log(`ID: ${mcp.id}`);
    console.log(`Description: ${mcp.description || 'No description'}`);

    if (mcp.recipe) {
      console.log('\nConfiguration:');
      if (mcp.recipe.url) {
        console.log(`  Transport: HTTP/SSE`);
        console.log(`  URL: ${mcp.recipe.url}`);
      } else if (mcp.recipe.command) {
        console.log(`  Transport: stdio`);
        console.log(`  Command: ${mcp.recipe.command}`);
        if (mcp.recipe.args) console.log(`  Args: ${JSON.stringify(mcp.recipe.args)}`);
      }
    }

    console.log('\n' + '─'.repeat(60));

    const prompt = new Select({
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: 'add', message: '➕ Add to project' },
        { name: 'delete', message: '🗑️  Delete from catalog' },
        { name: 'back', message: '← Back to list' },
        { name: 'exit', message: '🚪 Exit' },
      ],
      actions: {
        ctrl: { n: 'down', p: 'up' }
      }
    });

    try {
      const action = await prompt.run();

      if (action === 'exit') return 'exit';
      if (action === 'back') return 'back';
      if (action === 'add') {
        await this.addMcpToProject(mcp, state);
      }
      if (action === 'delete') {
        await this.deleteMcpFromCatalog(id);
      }
      return 'back'; // Return to list
    } catch {
      return 'exit';
    }
  }

  private async showSkillDetails(id: string, skill: SkillCatalogEntry, state: TuiState): Promise<CatalogAction> {
    console.clear();
    this.renderHeader();
    console.log(`\n📚 ${skill.displayName || id}`);
    console.log('─'.repeat(60));
    console.log(`ID: ${skill.id}`);
    console.log(`Description: ${skill.description || 'No description'}`);

    console.log('\n' + '─'.repeat(60));

    const prompt = new Select({
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: 'add', message: '➕ Add to project' },
        { name: 'delete', message: '🗑️  Delete from catalog' },
        { name: 'back', message: '← Back to list' },
        { name: 'exit', message: '🚪 Exit' },
      ],
      actions: {
        ctrl: { n: 'down', p: 'up' }
      }
    });

    try {
      const action = await prompt.run();

      if (action === 'exit') return 'exit';
      if (action === 'back') return 'back';
      if (action === 'add') {
        await this.addSkillToProject(skill, state);
      }
      if (action === 'delete') {
        await this.deleteSkillFromCatalog(id);
      }
      return 'back';
    } catch {
      return 'exit';
    }
  }

  private async addMcpToCatalog(): Promise<void> {
    const { prompt } = await import('enquirer');

    try {
      const response = await prompt({
        type: 'input',
        name: 'packageId',
        message: 'Enter npm package ID (e.g., @modelcontextprotocol/server-github):'
      }) as { packageId: string };

      if (!response.packageId) return;

      const { catalogMcpAdd } = await import('../cli-catalog.js');
      await catalogMcpAdd({ packageId: response.packageId });
      console.log('\n✅ Added to catalog!');
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}`);
    }

    await this.pressEnter();
  }

  private async importSkill(): Promise<void> {
    const { prompt } = await import('enquirer');

    try {
      const response = await prompt({
        type: 'input',
        name: 'path',
        message: 'Enter skill directory path:'
      }) as { path: string };

      if (!response.path) return;

      const { catalogSkillImport } = await import('../cli-catalog.js');
      await catalogSkillImport({ path: response.path });
      console.log('\n✅ Imported to catalog!');
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}`);
    }

    await this.pressEnter();
  }

  private async addMcpToProject(mcp: McpCatalogEntry, state: TuiState): Promise<void> {
    // Select targets
    const { promptTargets } = await import('../prompts/index.js');
    const targets = await promptTargets([state.target]);

    // Add MCP
    const { mcpAdd } = await import('../cli-mcp.js');
    try {
      await mcpAdd({
        packageId: mcp.id,
        targets,
        noRegister: true // Already in catalog
      });
      console.log('\n✅ Added to project!');
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}`);
    }

    await this.pressEnter();
  }

  private async addSkillToProject(skill: SkillCatalogEntry, state: TuiState): Promise<void> {
    // Select targets
    const { promptTargets } = await import('../prompts/index.js');
    const targets = await promptTargets([state.target]);

    // Add skill
    const { skillAdd } = await import('../cli-skill.js');
    try {
      await skillAdd({
        skillId: skill.id,
        targets,
        noRegister: true // Already in catalog
      });
      console.log('\n✅ Added to project!');
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}`);
    }

    await this.pressEnter();
  }

  private async deleteMcpFromCatalog(id: string): Promise<void> {
    const { prompt } = await import('enquirer');

    try {
      const confirm = await prompt({
        type: 'confirm',
        name: 'confirmed',
        message: `Delete "${id}" from catalog?`,
        initial: false
      }) as { confirmed: boolean };

      if (!confirm) return;

      const { catalogMcpRemove } = await import('../cli-catalog.js');
      await catalogMcpRemove(id);
      console.log('\n✅ Deleted from catalog!');
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}`);
    }

    await this.pressEnter();
  }

  private async deleteSkillFromCatalog(id: string): Promise<void> {
    const { prompt } = await import('enquirer');

    try {
      const confirm = await prompt({
        type: 'confirm',
        name: 'confirmed',
        message: `Delete "${id}" from catalog?`,
        initial: false
      }) as { confirmed: boolean };

      if (!confirm) return;

      const { catalogSkillRemove } = await import('../cli-catalog.js');
      await catalogSkillRemove(id);
      console.log('\n✅ Deleted from catalog!');
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}`);
    }

    await this.pressEnter();
  }

  private pressEnter(): Promise<void> {
    return new Promise(resolve => {
      process.stdin.once('data', () => resolve());
    });
  }

  handleAction(state: TuiState, action: ScreenAction): Promise<TuiState> {
    // Implement action handling
    return Promise.resolve(state);
  }
}
