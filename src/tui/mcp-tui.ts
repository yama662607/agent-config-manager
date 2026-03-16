/**
 * MCP Project TUI
 *
 * Manage MCP servers for the current project with visual status display.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// @ts-ignore - enquirer uses CommonJS exports
const { Select, prompt: enquirerPrompt } = require('enquirer');
import type { TuiState, ScreenAction } from './tui-base.js';
import { getMcpServers } from '../config-adapters.js';
import { discoverProject } from '../project-discovery.js';
import { listMcps } from '../catalog.js';
import type { TargetName } from '../types.js';
import { join } from 'node:path';
import { padRightWide } from '../table-utils.js';

type McpAction = 'toggle' | 'add' | 'remove' | 'edit' | 'switch-target' | 'refresh' | 'back' | 'exit';

/**
 * MCP TUI Screen
 */
export class McpTuiScreen {
  name = 'mcp' as const;

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
    console.log('║  🔧 Project MCPs                                                    ║');
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

  private async renderMain(state: TuiState): Promise<McpAction> {
    console.clear();
    this.renderHeader();

    const discovery = await discoverProject(undefined, { allowHome: state.allowHome });
    const currentTarget = state.target;

    // Get current status for all targets
    const allStatus: Record<TargetName, Record<string, { enabled: boolean; recipe?: any }>> = {} as any;

    for (const target of ['claude', 'codex', 'gemini'] as TargetName[]) {
      try {
        // Get config path for target
        const configPath = this.getDefaultConfigPath(target, discovery.root);
        const servers = await getMcpServers(target, configPath);
        allStatus[target] = servers;
      } catch {
        allStatus[target] = {};
      }
    }

    // Display status table
    this.renderStatusTable(allStatus, currentTarget);

    console.log();

    // Get unique server names
    const serverNames = new Set<string>();
    for (const target of ['claude', 'codex', 'gemini'] as TargetName[]) {
      Object.keys(allStatus[target]).forEach(name => serverNames.add(name));
    }

    const choices = [
      { name: 'add', message: '➕ Add MCP to project', value: '__add__', hint: '' },
      { name: 'switch-target', message: `🔄 Switch target (current: ${currentTarget})`, value: '__switch__', hint: '' },
      { name: 'exit', message: '🚪 Exit', value: '__exit__', hint: '' },
    ];

    // Add server actions
    if (serverNames.size > 0) {
      const serverChoices = Array.from(serverNames).map(name => {
        const enabledForTarget = allStatus[currentTarget]?.[name]?.enabled ?? false;
        const statusIcon = enabledForTarget ? '✅' : '❌';
        return {
          name: `server:${name}`,
          message: `${statusIcon} ${name}`,
          value: name,
          hint: ''
        };
      });
      choices.splice(1, 0, ...serverChoices);
    }

    const prompt = new Select({
      name: 'action',
      message: 'Select MCP or action:',
      choices,
      actions: {
        ctrl: { n: 'down', p: 'up' }
      }
    });

    try {
      const selected = await prompt.run();

      if (selected === '__exit__') return 'exit';
      if (selected === '__add__') return await this.handleAdd(state);
      if (selected === '__switch__') return await this.handleSwitchTarget(state);

      // Server selected
      return await this.handleServerAction(selected as string, allStatus, currentTarget);
    } catch {
      return 'exit';
    }
  }

  private renderStatusTable(
    allStatus: Record<TargetName, Record<string, { enabled: boolean; recipe?: any }>>,
    currentTarget: TargetName
  ): void {
    const targets: TargetName[] = ['claude', 'codex', 'gemini'];
    const serverNames = new Set<string>();

    for (const target of targets) {
      Object.keys(allStatus[target] || {}).forEach(name => serverNames.add(name));
    }

    if (serverNames.size === 0) {
      console.log('\n  No MCP servers configured for this project.');
      console.log('  Select "➕ Add MCP to project" to get started.\n');
      return;
    }

    const NAME_WIDTH = 30;
    const STATUS_WIDTH = 10;

    const borderH = '  ┌' + '─'.repeat(NAME_WIDTH + 2) + '┬' + '─'.repeat(STATUS_WIDTH + 2) + '┬───┬───┬───┐';
    const borderM = '  ├' + '─'.repeat(NAME_WIDTH + 2) + '┼' + '─'.repeat(STATUS_WIDTH + 2) + '┼───┼───┼───┤';
    const borderF = '  └' + '─'.repeat(NAME_WIDTH + 2) + '┴' + '─'.repeat(STATUS_WIDTH + 2) + '┴───┴───┴───┘';

    console.log('\n' + borderH);
    console.log('  │ ' + padRightWide('Server', NAME_WIDTH) + ' │ ' + padRightWide('Status', STATUS_WIDTH) + ' │ C │ C │ G │');
    console.log(borderM);

    // Rows
    for (const name of Array.from(serverNames).sort()) {
      const status = allStatus[currentTarget]?.[name];
      const enabled = status?.enabled ?? false;
      const statusText = enabled ? '✅ On ' : '❌ Off';

      console.log('  │ ' + padRightWide(name, NAME_WIDTH) + ' │ ' + padRightWide(statusText, STATUS_WIDTH) + ' │ ' +
                  (allStatus.claude?.[name]?.enabled ? '✅ ' : '❌ ') + '│ ' +
                  (allStatus.codex?.[name]?.enabled ? '✅ ' : '❌ ') + '│ ' +
                  (allStatus.gemini?.[name]?.enabled ? '✅ ' : '❌ ') + '│');
    }

    console.log(borderF);
    console.log('  Legend: C=Claude, C=Codex, G=Gemini | ✅=Enabled, ❌=Disabled');
  }

  private async handleSwitchTarget(state: TuiState): Promise<McpAction> {
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

  private async handleAdd(state: TuiState): Promise<McpAction> {
    console.log('\n📦 Add MCP to Project\n');

    // Get catalog entries
    const mcps = await listMcps();

    if (mcps.length === 0) {
      console.log('No MCP entries in catalog.');
      console.log('\nOptions:');
      console.log('  1. Add from npm package');
      console.log('  2. Add custom configuration');

      const prompt = new Select({
        name: 'option',
        message: 'Choose option:',
        choices: [
          { name: 'npm', message: 'Add from npm package' },
          { name: 'custom', message: 'Add custom configuration' },
          { name: 'back', message: '← Back' }
        ],
        actions: {
          ctrl: { n: 'down', p: 'up' }
        }
      });

      try {
        const choice = await prompt.run();
        if (choice === 'back') return 'back';
        if (choice === 'npm') return await this.addFromNpm(state);
        if (choice === 'custom') return await this.addCustom(state);
      } catch {
        return 'back';
      }
    }

    // Show catalog entries
    const choices = mcps.map(mcp => ({
      name: mcp.id,
      message: `📦 ${mcp.displayName || mcp.id}`,
      hint: mcp.description?.slice(0, 50)
    }));

    choices.push(
      { name: 'npm', message: 'Add from npm package (not in catalog)', hint: '' },
      { name: 'custom', message: 'Add custom configuration', hint: '' },
      { name: 'back', message: '← Back', hint: '' }
    );

    const prompt = new Select({
      name: 'mcp',
      message: 'Select MCP (or action):',
      choices,
      actions: {
        ctrl: { n: 'down', p: 'up' }
      }
    });

    try {
      const selected = await prompt.run();
      if (selected === 'back') return 'back';
      if (selected === 'npm') return await this.addFromNpm(state);
      if (selected === 'custom') return await this.addCustom(state);

      // Add from catalog
      return await this.addToProject(selected, state);
    } catch {
      return 'back';
    }
  }

  private async addToProject(mcpId: string, state: TuiState): Promise<McpAction> {
    const { mcpAdd } = await import('../cli-mcp.js');

    try {
      await mcpAdd({
        packageId: mcpId,
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

  private async addFromNpm(state: TuiState): Promise<McpAction> {
    const { prompt } = await import('enquirer');

    try {
      const response = await prompt({
        type: 'input',
        name: 'packageId',
        message: 'Enter npm package ID (e.g., @modelcontextprotocol/server-github):'
      }) as { packageId: string };

      if (!response.packageId) return 'back';

      const { mcpAdd } = await import('../cli-mcp.js');
      await mcpAdd({
        packageId: response.packageId,
        targets: [state.target],
        noRegister: false
      });
      console.log('\n✅ Added to catalog and project!');
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}`);
    }

    await this.pressEnter();
    return 'refresh';
  }

  private async addCustom(state: TuiState): Promise<McpAction> {
    const { prompt } = await import('enquirer');

    try {
      const response = await prompt([
        {
          type: 'input',
          name: 'name',
          message: 'Server name:'
        },
        {
          type: 'select',
          name: 'transport',
          message: 'Transport type:',
          choices: ['stdio', 'http']
        }
      ]) as { name: string; transport: 'stdio' | 'http' };

      if (!response.name) return 'back';

      let url: string | undefined;
      let command: string | undefined;
      let args: string[] | undefined;

      if (response.transport === 'http') {
        const urlResponse = await prompt({
          type: 'input',
          name: 'url',
          message: 'HTTP URL:'
        }) as { url: string };
        url = urlResponse.url;
      } else {
        const cmdResponse = await prompt({
          type: 'input',
          name: 'command',
          message: 'Command (e.g., npx):'
        }) as { command: string };
        command = cmdResponse.command;
      }

      // Add to catalog first
      const { catalogMcpAdd } = await import('../cli-catalog.js');
      await catalogMcpAdd({
        packageId: response.name,
        url,
        command,
        args
      });

      // Then add to project
      const { mcpAdd } = await import('../cli-mcp.js');
      await mcpAdd({
        packageId: response.name,
        targets: [state.target],
        noRegister: true
      });

      console.log('\n✅ Added to catalog and project!');
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}`);
    }

    await this.pressEnter();
    return 'refresh';
  }

  private async handleServerAction(
    serverName: string,
    allStatus: Record<TargetName, Record<string, { enabled: boolean; recipe?: any }>>,
    currentTarget: TargetName
  ): Promise<McpAction> {
    const isEnabled = allStatus[currentTarget]?.[serverName]?.enabled ?? false;

    console.log(`\n🔧 ${serverName}`);
    console.log('─'.repeat(60));

    const prompt = new Select({
      name: 'action',
      message: `Server is ${isEnabled ? 'enabled' : 'disabled'}. What would you like to do?`,
      choices: [
        { name: 'toggle', message: isEnabled ? '❌ Disable' : '✅ Enable' },
        { name: 'remove', message: '🗑️  Remove from project' },
        { name: 'back', message: '← Back' }
      ],
      actions: {
        ctrl: { n: 'down', p: 'up' }
      }
    });

    try {
      const action = await prompt.run();

      if (action === 'back') return 'refresh';
      if (action === 'toggle') return await this.toggleServer(serverName, currentTarget, isEnabled);
      if (action === 'remove') return await this.removeServer(serverName, currentTarget);
    } catch {
      return 'refresh';
    }

    return 'refresh';
  }

  private async toggleServer(
    serverName: string,
    target: TargetName,
    currentEnabled: boolean
  ): Promise<McpAction> {
    const { mcpEnable, mcpDisable } = await import('../cli-mcp.js');

    try {
      if (currentEnabled) {
        await mcpDisable({ serverName, targets: [target] });
        console.log(`\n✅ Disabled ${serverName}`);
      } else {
        await mcpEnable({ serverName, targets: [target] });
        console.log(`\n✅ Enabled ${serverName}`);
      }
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}`);
    }

    await this.pressEnter();
    return 'refresh';
  }

  private async removeServer(serverName: string, target: TargetName): Promise<McpAction> {
    const { prompt } = await import('enquirer');

    try {
      const confirmed = await prompt({
        type: 'confirm',
        name: 'confirm',
        message: `Remove "${serverName}" from ${target}?`,
        initial: false
      }) as { confirm: boolean };

      if (!confirmed) return 'refresh';

      const { mcpRemove } = await import('../cli-mcp.js');
      await mcpRemove({ serverName, targets: [target] });
      console.log(`\n✅ Removed ${serverName}`);
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}`);
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
