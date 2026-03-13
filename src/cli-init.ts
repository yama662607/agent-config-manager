import type { TargetName } from './types.js';
import { discoverProject } from './project-discovery.js';
import { listMcps } from './catalog.js';
import { listSkills } from './catalog.js';
import {
  mcpAdd,
  type McpAddOptions,
} from './cli-mcp.js';
import {
  skillAdd,
  type SkillAddOptions,
} from './cli-skill.js';

// ============================================================================
// Interactive Init
// ============================================================================

export interface InitOptions {
  targets?: TargetName[];
}

interface InitState {
  targets: TargetName[];
  selectedMcps: string[];
  selectedSkills: string[];
}

/**
 * Run the interactive init wizard.
 */
export async function runInteractiveInit(options: InitOptions): Promise<void> {
  const discovery = await discoverProject();
  const projectRoot = discovery.root;

  console.log(`📁 Project: ${projectRoot}\n`);

  // Initialize state
  const state: InitState = {
    targets: options.targets ?? [],
    selectedMcps: [],
    selectedSkills: [],
  };

  // Step 1: Select targets
  await stepSelectTargets(state);

  // Step 2: Select MCPs
  await stepSelectMcps(state);

  // Step 3: Select skills
  await stepSelectSkills(state);

  // Step 4: Confirm and apply
  await stepConfirmAndApply(state);

  console.log('\n✅ Setup complete!');
  console.log('\nRun these commands to see your configuration:');
  console.log(`  acsync mcp      # Show MCP status`);
  console.log(`  acsync skill    # Show skill status`);
}

// ============================================================================
// Step 1: Select Targets
// ============================================================================

async function stepSelectTargets(state: InitState): Promise<void> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Step 1: Select Target Agents');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (state.targets.length > 0) {
    console.log(`Pre-selected targets: ${state.targets.join(', ')}\n`);
    return;
  }

  const targets: { name: TargetName; label: string; description: string }[] = [
    { name: 'claude', label: 'Claude Code', description: '.mcp.json' },
    { name: 'codex', label: 'Codex', description: '.codex/config.toml' },
    { name: 'gemini', label: 'Gemini CLI', description: '.gemini/settings.json' },
  ];

  console.log('Select which agents to configure:\n');

  for (const target of targets) {
    console.log(`  [${target.name}] ${target.label} (${target.description})`);
  }
  console.log();

  // Simple prompt for target selection
  console.log('Enter target names (comma-separated, e.g., claude,codex):');
  console.log('Press Enter for default (all):');

  // For now, we'll use a simpler approach - read from stdin
  const readline = (await import('node:readline')).createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    readline.question('> ', (input) => {
      readline.close();
      resolve(input.trim());
    });
  });

  if (answer) {
    state.targets = answer.split(',').map(t => t.trim().toLowerCase() as TargetName);
  } else {
    state.targets = ['claude', 'codex', 'gemini'];
  }

  console.log(`Selected: ${state.targets.join(', ')}\n`);
}

// ============================================================================
// Step 2: Select MCPs
// ============================================================================

async function stepSelectMcps(state: InitState): Promise<void> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Step 2: Select MCP Servers');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const mcps = await listMcps();

  if (mcps.length === 0) {
    console.log('No MCP entries in catalog.\n');
    console.log('Tip: Use these commands to add MCPs to your catalog first:');
    console.log('  acsync catalog mcp add @modelcontextprotocol/server-github');
    console.log('  acsync catalog mcp add @modelcontextprotocol/server-filesystem\n');
    return;
  }

  console.log(`Available MCPs (${mcps.length}):\n`);

  for (let i = 0; i < mcps.length; i++) {
    const mcp = mcps[i];
    console.log(`  [${i + 1}] ${mcp.id}`);
    console.log(`      ${mcp.displayName || mcp.description}`);
  }
  console.log();

  const readline = (await import('node:readline')).createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    readline.question('Enter MCP numbers to add (comma-separated, or "none" to skip): ', (input) => {
      readline.close();
      resolve(input.trim());
    });
  });

  if (answer && answer.toLowerCase() !== 'none') {
    const indices = answer.split(',').map(s => parseInt(s.trim(), 10) - 1);
    for (const idx of indices) {
      if (idx >= 0 && idx < mcps.length) {
        state.selectedMcps.push(mcps[idx].id);
      }
    }
  }

  if (state.selectedMcps.length > 0) {
    console.log(`\nSelected MCPs: ${state.selectedMcps.join(', ')}`);
  }
  console.log();
}

// ============================================================================
// Step 3: Select Skills
// ============================================================================

async function stepSelectSkills(state: InitState): Promise<void> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Step 3: Select Skills');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const skills = await listSkills();

  if (skills.length === 0) {
    console.log('No skill entries in catalog.\n');
    console.log('Tip: Use these commands to add skills to your catalog first:');
    console.log('  acsync catalog skill import ~/.claude/skills/my-skill');
    console.log('  acsync skill install <github-url>\n');
    return;
  }

  console.log(`Available Skills (${skills.length}):\n`);

  for (let i = 0; i < skills.length; i++) {
    const skill = skills[i];
    console.log(`  [${i + 1}] ${skill.id}`);
    console.log(`      ${skill.displayName || skill.description}`);
  }
  console.log();

  const readline = (await import('node:readline')).createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    readline.question('Enter skill numbers to add (comma-separated, or "none" to skip): ', (input) => {
      readline.close();
      resolve(input.trim());
    });
  });

  if (answer && answer.toLowerCase() !== 'none') {
    const indices = answer.split(',').map(s => parseInt(s.trim(), 10) - 1);
    for (const idx of indices) {
      if (idx >= 0 && idx < skills.length) {
        state.selectedSkills.push(skills[idx].id);
      }
    }
  }

  if (state.selectedSkills.length > 0) {
    console.log(`\nSelected Skills: ${state.selectedSkills.join(', ')}`);
  }
  console.log();
}

// ============================================================================
// Step 4: Confirm and Apply
// ============================================================================

async function stepConfirmAndApply(state: InitState): Promise<void> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Step 4: Confirm Selection');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log(`Targets: ${state.targets.join(', ')}`);

  if (state.selectedMcps.length > 0) {
    console.log(`\nMCP Servers to add:`);
    for (const mcpId of state.selectedMcps) {
      console.log(`  • ${mcpId}`);
    }
  }

  if (state.selectedSkills.length > 0) {
    console.log(`\nSkills to add:`);
    for (const skillId of state.selectedSkills) {
      console.log(`  • ${skillId}`);
    }
  }

  if (state.selectedMcps.length === 0 && state.selectedSkills.length === 0) {
    console.log('\nNo items selected. Nothing to add.\n');
    return;
  }

  console.log();

  const readline = (await import('node:readline')).createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    readline.question('Add these items to your project? (Y/n): ', (input) => {
      readline.close();
      resolve(input.trim().toLowerCase());
    });
  });

  if (answer === 'y' || answer === 'yes') {
    console.log('\nAdding items...\n');

    // Add MCPs
    for (const mcpId of state.selectedMcps) {
      const shortName = mcpId.replace('@modelcontextprotocol/server-', '')
        .replace(/^@/, '');
      const mcpOptions: McpAddOptions = {
        packageId: mcpId,
        targets: state.targets,
        noRegister: false,
      };
      await mcpAdd(mcpOptions);
    }

    // Add Skills
    for (const skillId of state.selectedSkills) {
      const skillOptions: SkillAddOptions = {
        skillId,
        targets: state.targets,
        noRegister: false,
      };
      await skillAdd(skillOptions);
    }

    console.log('\n✅ All items added successfully!');
  } else {
    console.log('\nCancelled. No changes made.');
  }
  console.log();
}
