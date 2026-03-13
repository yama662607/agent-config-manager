import type { TargetName } from './types.js';
import { discoverProject } from './project-discovery.js';
import { promptTargets, promptMcps, promptSkills, promptConfirm } from './prompts/index.js';
import { mcpAdd, type McpAddOptions } from './cli-mcp.js';
import { skillAdd, type SkillAddOptions } from './cli-skill.js';

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
 * Run the interactive init wizard using TUI prompts.
 */
export async function runInteractiveInit(options: InitOptions): Promise<void> {
  const discovery = await discoverProject();
  const projectRoot = discovery.root;

  console.log(`📁 Project: ${projectRoot}\n`);

  // Initialize state
  const state: InitState = {
    targets: [],
    selectedMcps: [],
    selectedSkills: [],
  };

  // Step 1: Select targets
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Step 1: Select Target Agents');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  state.targets = await promptTargets(options.targets);
  console.log(`Selected: ${state.targets.join(', ')}\n`);

  // Step 2: Select MCPs
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Step 2: Select MCP Servers');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  state.selectedMcps = await promptMcps();

  // Step 3: Select skills
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Step 3: Select Skills');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  state.selectedSkills = await promptSkills();

  // Step 4: Confirm and apply
  const confirmed = await promptConfirm(state.targets, state.selectedMcps, state.selectedSkills);

  if (confirmed) {
    console.log('\nAdding items...\n');

    // Add MCPs
    for (const mcpId of state.selectedMcps) {
      const mcpOptions: McpAddOptions = {
        packageId: mcpId,
        targets: state.targets,
        noRegister: false,
      };
      try {
        await mcpAdd(mcpOptions);
      } catch (error) {
        console.error(`Failed to add MCP ${mcpId}: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    }

    // Add Skills
    for (const skillId of state.selectedSkills) {
      const skillOptions: SkillAddOptions = {
        skillId,
        targets: state.targets,
        noRegister: false,
      };
      try {
        await skillAdd(skillOptions);
      } catch (error) {
        console.error(`Failed to add skill ${skillId}: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    }

    console.log('\n✅ Setup complete!');
    console.log('\nRun these commands to see your configuration:');
    console.log(`  acsync mcp      # Show MCP status`);
    console.log(`  acsync skill    # Show skill status`);
  } else {
    console.log('\nCancelled. No changes made.');
  }
}
