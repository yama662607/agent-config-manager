/**
 * MCP Project TUI
 *
 * Manage MCP servers for the current project with visual status display.
 */

import type { TuiState, ScreenAction } from './tui-base.js';
import { TuiBaseScreen } from './tui-base.js';
import { getMcpServers } from '../config-adapters.js';
import { discoverProject } from '../project-discovery.js';
import { listMcps } from '../catalog.js';
import type { TargetName } from '../types.js';
import { join } from 'node:path';
import { padRightWide, truncateWide } from '../table-utils.js';
import { formatEnvMap, normalizeEnvMap, parseEnvEntriesText } from '../mcp-env.js';

type McpAction = 'toggle' | 'add' | 'remove' | 'edit' | 'switch-target' | 'refresh' | 'back' | 'exit';

/**
 * MCP TUI Screen
 */
export class McpTuiScreen extends TuiBaseScreen {
  name = 'mcp' as const;

  async render(state: TuiState): Promise<TuiState | null> {
    // Main loop
    while (true) {
      const action = await this.renderMain(state);
      if (action === 'exit') return null;
      if (action === 'back') return state;
    }
  }

  private renderMcpHeader(): void {
    this.renderHeader('Project MCPs', '🔧');
  }

  private getDefaultConfigPath(target: TargetName, projectRoot: string): string {
    switch (target) {
      case 'claude':
        return join(projectRoot, '.mcp.json');
      case 'codex':
        return join(projectRoot, '.codex', 'config.toml');
      case 'antigravity':
        return join(projectRoot, '.agents', 'mcp_config.json');
    }
  }

  private async renderMain(state: TuiState): Promise<McpAction> {
    this.clear();
    this.renderMcpHeader();

    const discovery = await discoverProject(undefined, { allowHome: state.allowHome });
    const currentTarget = state.target;

    // Get current status for all targets
    const allStatus: Record<TargetName, Record<string, { enabled: boolean; recipe?: any }>> = {} as any;

    for (const target of ['claude', 'codex', 'antigravity'] as TargetName[]) {
      try {
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
    for (const target of ['claude', 'codex', 'antigravity'] as TargetName[]) {
      Object.keys(allStatus[target] || {}).forEach(name => serverNames.add(name));
    }

    const choices = [
      { name: '__add__', message: '➕ Add MCP to project', hint: '' },
      { name: '__switch__', message: `🔄 Switch target (current: ${currentTarget})`, hint: '' },
      { name: '__exit__', message: '🚪 Exit', hint: '' },
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

    const selected = await this.select<string>('Select MCP or action:', choices);

    if (!selected || selected === '__exit__') return 'exit';
    if (selected === '__add__') return await this.handleAdd(state);
    if (selected === '__switch__') return await this.handleSwitchTarget(state);

    // Server selected
    const serverName = selected.startsWith('server:') ? selected.slice(7) : selected;
    return await this.handleServerAction(serverName, allStatus, currentTarget, state);
  }

  private renderStatusTable(
    allStatus: Record<TargetName, Record<string, { enabled: boolean; recipe?: any }>>,
    currentTarget: TargetName
  ): void {
    const targets: TargetName[] = ['claude', 'codex', 'antigravity'];
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

    const borderH = '  ┌' + '─'.repeat(NAME_WIDTH + 2) + '┬' + '─'.repeat(STATUS_WIDTH + 2) + '┬────┬────┬────┐';
    const borderM = '  ├' + '─'.repeat(NAME_WIDTH + 2) + '┼' + '─'.repeat(STATUS_WIDTH + 2) + '┼────┼────┼────┤';
    const borderF = '  └' + '─'.repeat(NAME_WIDTH + 2) + '┴' + '─'.repeat(STATUS_WIDTH + 2) + '┴────┴────┴────┘';

    console.log('\n' + borderH);
    console.log('  │ ' + padRightWide('Server', NAME_WIDTH) + ' │ ' + padRightWide('Status', STATUS_WIDTH) + ' │  C │  C │  A │');
    console.log(borderM);

    // Rows
    for (const name of Array.from(serverNames).sort()) {
      const status = allStatus[currentTarget]?.[name];
      const enabled = status?.enabled ?? false;
      const statusText = enabled ? '✅ On ' : '❌ Off';
      const truncated = truncateWide(name, NAME_WIDTH);

      console.log('  │ ' + padRightWide(truncated, NAME_WIDTH) + ' │ ' + padRightWide(statusText, STATUS_WIDTH) + ' │ ' +
                  (allStatus.claude?.[name]?.enabled ? '✅ ' : '❌ ') + '│ ' +
                  (allStatus.codex?.[name]?.enabled ? '✅ ' : '❌ ') + '│ ' +
                  (allStatus.antigravity?.[name]?.enabled ? '✅ ' : '❌ ') + '│');
    }

    console.log(borderF);
    console.log('  Legend: C=Claude, C=Codex, A=Antigravity | ✅=Enabled, ❌=Disabled');
  }

  private async handleSwitchTarget(state: TuiState): Promise<McpAction> {
    const targets: TargetName[] = ['claude', 'codex', 'antigravity'];

    const choices = targets.map(t => ({
      name: t,
      message: t === state.target ? `${t} (current)` : t
    }));

    const selected = await this.select<TargetName>('Select target:', choices);
    if (selected) {
      state.target = selected;
      return 'refresh';
    }
    return 'back';
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

      const choices = [
        { name: 'npm', message: 'Add from npm package' },
        { name: 'custom', message: 'Add custom configuration' },
        { name: 'back', message: '← Back' }
      ];

      const choice = await this.select('Choose option:', choices);
      if (!choice || choice === 'back') return 'back';
      if (choice === 'npm') return await this.addFromNpm(state);
      if (choice === 'custom') return await this.addCustom(state);
      return 'back';
    }

    // Show catalog entries
    const choices = mcps.map(mcp => ({
      name: mcp?.id || 'Unknown',
      message: `📦 ${mcp?.displayName || mcp?.id || 'Unknown'}`,
      hint: mcp?.description?.slice(0, 50)
    }));

    choices.push(
      { name: 'npm', message: 'Add from npm package (not in catalog)', hint: '' },
      { name: 'custom', message: 'Add custom configuration', hint: '' },
      { name: 'back', message: '← Back', hint: '' }
    );

    const selected = await this.select<string>('Select MCP (or action):', choices);
    if (!selected || selected === 'back') return 'back';
    if (selected === 'npm') return await this.addFromNpm(state);
    if (selected === 'custom') return await this.addCustom(state);

    // Add from catalog
    return await this.addToProject(selected, state);
  }

  private async addToProject(mcpId: string, state: TuiState): Promise<McpAction> {
    const { mcpAdd } = await import('../cli-mcp.js');

    try {
      await mcpAdd({
        packageId: mcpId,
        targets: [state.target],
        noRegister: true,
        allowHome: state.allowHome,
      });
      console.log('\n✅ Added to project!');
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}`);
    }

    await this.pressEnter();
    return 'refresh';
  }

  private async addFromNpm(state: TuiState): Promise<McpAction> {
    const { prompt } = (await import('enquirer')).default as any;

    try {
      const response = await prompt({
        type: 'input',
        name: 'packageId',
        message: 'Enter npm package ID (e.g., @modelcontextprotocol/server-github):'
      }) as { packageId: string };

      if (!response.packageId) return 'back';

      const env = await this.promptForEnv();

      const { mcpAdd } = await import('../cli-mcp.js');
      await mcpAdd({
        packageId: response.packageId,
        targets: [state.target],
        noRegister: false,
        recipe: env ? { env } : undefined,
        allowHome: state.allowHome,
      });
      console.log('\n✅ Added to catalog and project!');
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}`);
    }

    await this.pressEnter();
    return 'refresh';
  }

  private async addCustom(state: TuiState): Promise<McpAction> {
    try {
      const response = await this.promptForServerBasics();

      if (!response.name) return 'back';
      const recipe = await this.promptForRecipe(response.transport);

      // Add to catalog first
      const { catalogMcpAdd } = await import('../cli-catalog.js');
      await catalogMcpAdd({
        packageId: response.name,
        url: recipe.url,
        command: recipe.command,
        args: recipe.args,
        cwd: recipe.cwd,
        env: recipe.env,
      });

      // Then add to project
      const { mcpAdd } = await import('../cli-mcp.js');
      await mcpAdd({
        packageId: response.name,
        targets: [state.target],
        noRegister: true,
        recipe,
        allowHome: state.allowHome,
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
    currentTarget: TargetName,
    state: TuiState
  ): Promise<McpAction> {
    const isEnabled = allStatus[currentTarget]?.[serverName]?.enabled ?? false;
    const recipe = allStatus[currentTarget]?.[serverName]?.recipe;

    console.log(`\n🔧 ${serverName}`);
    console.log('─'.repeat(60));
    this.renderRecipeSummary(recipe);

    const choices = [
      { name: 'toggle', message: isEnabled ? '❌ Disable' : '✅ Enable' },
      { name: 'edit', message: '✏️  Edit configuration' },
      { name: 'remove', message: '🗑️  Remove from project' },
      { name: 'back', message: '← Back' }
    ];

    const action = await this.select<string>(
      `Server is ${isEnabled ? 'enabled' : 'disabled'}. What would you like to do?`,
      choices
    );

    if (!action || action === 'back') return 'refresh';
    if (action === 'toggle') return await this.toggleServer(serverName, currentTarget, isEnabled, state);
    if (action === 'edit') return await this.editServer(serverName, currentTarget, recipe, state);
    if (action === 'remove') return await this.removeServer(serverName, currentTarget, state);

    return 'refresh';
  }

  private async toggleServer(
    serverName: string,
    target: TargetName,
    currentEnabled: boolean,
    state: TuiState
  ): Promise<McpAction> {
    const { mcpEnable, mcpDisable } = await import('../cli-mcp.js');

    try {
      if (currentEnabled) {
        await mcpDisable({ serverName, targets: [target], allowHome: state.allowHome });
        console.log(`\n✅ Disabled ${serverName}`);
      } else {
        await mcpEnable({ serverName, targets: [target], allowHome: state.allowHome });
        console.log(`\n✅ Enabled ${serverName}`);
      }
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}`);
    }

    await this.pressEnter();
    return 'refresh';
  }

  private async removeServer(serverName: string, target: TargetName, state: TuiState): Promise<McpAction> {
    const { prompt } = (await import('enquirer')).default as any;

    try {
      const confirmed = await prompt({
        type: 'confirm',
        name: 'confirm',
        message: `Remove "${serverName}" from ${target}?`,
        initial: false
      }) as { confirm: boolean };

      if (!confirmed || !confirmed.confirm) return 'refresh';

      const { mcpRemove } = await import('../cli-mcp.js');
      await mcpRemove({ serverName, targets: [target], allowHome: state.allowHome });
      console.log(`\n✅ Removed ${serverName}`);
    } catch (error: any) {
      if (error instanceof Error && error.message.includes('User force closed')) {
        throw error;
      }
      console.error(`\n❌ Error: ${error.message}`);
    }

    await this.pressEnter();
    return 'refresh';
  }

  private async editServer(serverName: string, target: TargetName, recipe: any | undefined, state: TuiState): Promise<McpAction> {
    try {
      const nextRecipe = await this.promptForRecipe(this.detectTransport(recipe), recipe);
      const { mcpEdit } = await import('../cli-mcp.js');
      await mcpEdit({
        serverName,
        targets: [target],
        recipe: nextRecipe,
        allowHome: state.allowHome,
      });
      console.log(`\n✅ Updated ${serverName}`);
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}`);
    }

    await this.pressEnter();
    return 'refresh';
  }

  private renderRecipeSummary(recipe?: any): void {
    if (!recipe) {
      console.log('  No recipe details available.\n');
      return;
    }

    const transport = this.detectTransport(recipe);
    console.log(`  Transport: ${transport}`);
    if (recipe.command) console.log(`  Command: ${recipe.command}`);
    if (recipe.args?.length) console.log(`  Args: ${JSON.stringify(recipe.args)}`);
    if (recipe.url) console.log(`  URL: ${recipe.url}`);
    if (recipe.cwd) console.log(`  CWD: ${recipe.cwd}`);
    console.log(`  Env: ${formatEnvMap(recipe.env)}\n`);
  }

  private detectTransport(recipe?: any): 'stdio' | 'http' {
    return recipe?.url ? 'http' : 'stdio';
  }

  private async promptForServerBasics(): Promise<{ name: string; transport: 'stdio' | 'http' }> {
    const { prompt } = (await import('enquirer')).default as any;
    return await prompt([
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
  }

  private async promptForRecipe(
    transport: 'stdio' | 'http',
    initial: { command?: string; args?: string[]; url?: string; cwd?: string; env?: Record<string, string> } = {}
  ): Promise<{ command?: string; args?: string[]; url?: string; cwd?: string; env?: Record<string, string> }> {
    const { prompt } = (await import('enquirer')).default as any;
    const recipe: { command?: string; args?: string[]; url?: string; cwd?: string; env?: Record<string, string> } = {};

    if (transport === 'http') {
      const response = await prompt({
        type: 'input',
        name: 'url',
        message: 'HTTP URL:',
        initial: initial.url ?? '',
      }) as { url: string };
      recipe.url = response.url;
    } else {
      const response = await prompt([
        {
          type: 'input',
          name: 'command',
          message: 'Command (e.g., npx):',
          initial: initial.command ?? '',
        },
        {
          type: 'input',
          name: 'args',
          message: 'Args (JSON array, optional):',
          initial: initial.args?.length ? JSON.stringify(initial.args) : '',
        },
        {
          type: 'input',
          name: 'cwd',
          message: 'Working directory (optional):',
          initial: initial.cwd ?? '',
        }
      ]) as { command: string; args: string; cwd: string };

      recipe.command = response.command;
      if (response.args.trim()) {
        recipe.args = JSON.parse(response.args);
      }
      if (response.cwd.trim()) {
        recipe.cwd = response.cwd.trim();
      }
    }

    const env = await this.promptForEnv(initial.env);
    if (env) {
      recipe.env = env;
    }

    return recipe;
  }

  private async promptForEnv(initial?: Record<string, string>): Promise<Record<string, string> | undefined> {
    const { prompt } = (await import('enquirer')).default as any;
    const response = await prompt({
      type: 'input',
      name: 'env',
      message: 'Environment variables (KEY=value, comma-separated, or JSON; blank for none):',
      initial: this.envPromptInitialValue(initial),
    }) as { env: string };

    if (!response.env.trim()) {
      return undefined;
    }

    return normalizeEnvMap(parseEnvEntriesText(response.env));
  }

  private envPromptInitialValue(env?: Record<string, string>): string {
    if (!env || Object.keys(env).length === 0) {
      return '';
    }

    return Object.entries(env)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join(', ');
  }
}
