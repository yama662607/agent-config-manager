import type { TargetName } from './types.js';
import { discoverProject } from './project-discovery.js';
import { promptTargets, promptMcps, promptSkills, promptConfirm, MCP_BACK, SKILL_BACK } from './prompts/index.js';
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

  // Main loop with back navigation support
  let currentStep = 1;

  while (currentStep <= 4) {
    switch (currentStep) {
      case 1: {
        // Step 1: Select targets
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Step 1: Select Target Agents');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        state.targets = await promptTargets(options.targets);
        console.log(`Selected: ${state.targets.join(', ')}\n`);
        currentStep = 2;
        break;
      }

      case 2: {
        // Step 2: Select MCPs
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Step 2: Select MCP Servers');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        state.selectedMcps = await promptMcps(true); // Allow back navigation

        if (state.selectedMcps.includes(MCP_BACK)) {
          // User wants to go back to target selection
          currentStep = 1;
          console.log('← Returning to target selection...\n');
        } else {
          currentStep = 3;
        }
        break;
      }

      case 3: {
        // Step 3: Select skills
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Step 3: Select Skills');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        state.selectedSkills = await promptSkills(true); // Allow back navigation

        if (state.selectedSkills.includes(SKILL_BACK)) {
          // User wants to go back to MCP selection
          currentStep = 2;
          console.log('← Returning to MCP selection...\n');
        } else {
          currentStep = 4;
        }
        break;
      }

      case 4: {
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
          console.log(`  acm mcp      # Show MCP status`);
          console.log(`  acm skill    # Show skill status`);

          // Success - exit loop
          currentStep = 5;
        } else {
          console.log('\nCancelled. No changes made.');
          // Cancelled - exit loop
          currentStep = 5;
        }
        break;
      }
    }
  }
}
