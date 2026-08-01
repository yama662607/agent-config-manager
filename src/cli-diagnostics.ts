import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { discoverProject } from './project-discovery.js';
import { loadCatalog } from './catalog.js';
import os from 'node:os';
import { describeCatalogSource, getCatalogDir, getConfigPath } from './acm-config.js';

const execAsync = promisify(exec);

// ============================================================================
// Validate Command
// ============================================================================

export interface ValidateOptions {
  strict: boolean;
}

/**
 * Validate the current project configuration.
 */
export async function validate(options: ValidateOptions): Promise<void> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Project discovery
  console.log('Checking project discovery...');
  try {
    const discovery = await discoverProject();
    console.log(`  ✓ Project root: ${discovery.root}`);
  } catch (error) {
    errors.push(`Project discovery failed: ${(error as Error).message}\n`);
  }

  // 2. Catalog references
  console.log('Checking catalog...');
  try {
    const catalog = await loadCatalog();
    console.log(`  ✓ Catalog loaded (${Object.keys(catalog.mcps).length} entries)`);
  } catch (error) {
    errors.push(`Catalog load failed: ${(error as Error).message}\n`);
  }

  // 3. Native config parseability
  console.log('Checking native configs...');
  try {
    const discovery = await discoverProject();
    const { readNativeConfig } = await import('./config-adapters.js');

    for (const [target, configPath] of discovery.targets.entries()) {
      if (!configPath.exists) {
        console.log(`  ⚠ ${target}: config not found at ${configPath.path}`);
        continue;
      }

      const result = await readNativeConfig(target, configPath.path);
      if (result.config === null) {
        if (result.raw) {
          warnings.push(`${target}: failed to parse config at ${configPath.path}\n`);
        } else {
          warnings.push(`${target}: empty config at ${configPath.path}\n`);
        }
      } else {
        console.log(`  ✓ ${target}: config parsed successfully`);
      }
    }
  } catch (error) {
    errors.push(`Config validation failed: ${(error as Error).message}\n`);
  }

  // Summary
  console.log();
  if (errors.length > 0) {
    console.error('Validation failed:\n');
    for (const error of errors) {
      console.error(`  ✗ ${error}`);
    }
    process.exitCode = 1;
  } else if (warnings.length > 0) {
    console.warn('Warnings:\n');
    for (const warning of warnings) {
      console.warn(`  ⚠ ${warning}`);
    }
    if (options.strict) {
      console.error('\nValidation failed (strict mode).');
      process.exitCode = 1;
    } else {
      console.log('\nValidation passed with warnings.');
    }
  } else {
    console.log('Validation passed.\n');
  }
}

// ============================================================================
// Doctor Command
// ============================================================================

export interface DoctorOptions {
  fix: boolean;
  strict?: boolean;
  allowHome?: boolean;
}

/**
 * Run diagnostics and health checks.
 */
export async function doctor(options: DoctorOptions): Promise<{ hasErrors: boolean; hasWarnings: boolean }> {
  console.log('acm Diagnostics\n');
  console.log('='.repeat(50));

  let hasErrors = false;
  let hasWarnings = false;

  const allowHome = options.allowHome ?? false;

  // 1. Project discovery
  console.log('\n[Project Discovery]');
  try {
    const discovery = await discoverProject(process.cwd(), { allowHome });
    console.log(`  ✓ Project root: ${discovery.root}`);
    console.log(`  ✓ Detected targets:`);
    for (const [target, configPath] of discovery.targets.entries()) {
      const status = configPath.exists ? '✓' : '✗';
      console.log(`      ${status} ${target}: ${configPath.path}`);
      if (!configPath.exists) {
        hasWarnings = true;
      }
    }
  } catch (error) {
    console.log(`  ✗ ${(error as Error).message}`);
    hasErrors = true;
  }

  // 2. Catalog health
  console.log('\n[Catalog Health]');
  let catalogFixed = false;
  try {
    const catalog = await loadCatalog();
    const entryCount = Object.keys(catalog.mcps).length;
    console.log(`  ✓ Catalog location: ${await getCatalogPath()}`);
    console.log(`  ✓ Entries: ${entryCount}`);
    console.log(`  ✓ Version: ${catalog.version}`);
  } catch (error) {
    console.log(`  ✗ ${(error as Error).message}`);
    if (options.fix) {
      console.log('  Attempting to fix...');
      try {
        const { initCatalog } = await import('./catalog.js');
        await initCatalog();
        console.log('  ✓ Catalog initialized');
        catalogFixed = true;
      } catch (fixError) {
        console.log(`  ✗ Fix failed: ${(fixError as Error).message}`);
        hasErrors = true;
      }
    } else {
      hasErrors = true;
    }
  }

  // 3. Catalog location
  console.log('\n[Catalog]');
  const catalogDir = getCatalogDir();
  const source = describeCatalogSource();
  const sourceLabel = {
    env: 'ACM_CATALOG_DIR',
    config: `catalog_dir in ${formatHome(getConfigPath())}`,
    default: 'default (state directory)',
  }[source];
  try {
    await fs.access(catalogDir);
    console.log(`  ✓ ${formatHome(catalogDir)}  [${sourceLabel}]`);
  } catch {
    console.log(`  ✗ ${formatHome(catalogDir)} does not exist  [${sourceLabel}]`);
    hasWarnings = true;
  }

  // 4. Environment checks
  console.log('\n[Environment]');
  const hasNode = await checkCommand('node', 'Node.js');
  const hasNpm = await checkCommand('npm', 'npm');
  const hasNpx = await checkCommand('npx', 'npx');
  if (!hasNode || !hasNpm || !hasNpx) {
    hasWarnings = true;
  }

  // 4. Target readiness
  console.log('\n[Target Readiness]');
  try {
    const discovery = await discoverProject(process.cwd(), { allowHome });
    for (const [target, configPath] of discovery.targets.entries()) {
      if (configPath.exists) {
        const size = (await fs.stat(configPath.path)).size;
        console.log(`  ✓ ${target}: config exists (${size} bytes)`);
      } else {
        console.log(`  ⚠ ${target}: config not found (run \`acm mcp init\`)`);
        hasWarnings = true;
      }
    }
  } catch (error) {
    console.log(`  ✗ ${(error as Error).message}`);
    hasErrors = true;
  }

  console.log('\n' + '='.repeat(50));
  
  if (hasErrors) {
    console.error('\nDiagnostics failed with errors.');
    process.exitCode = 1;
  } else if (hasWarnings && options.strict) {
    console.error('\nDiagnostics failed with warnings (strict mode).');
    process.exitCode = 1;
  } else {
    console.log('\nFor more help, run `acm --help` or visit the documentation.\n');
  }

  return { hasErrors, hasWarnings };
}

async function getCatalogPath(): Promise<string> {
  const { getCatalogPath: getPath } = await import('./catalog.js');
  return getPath();
}

async function checkCommand(command: string, name: string): Promise<boolean> {
  try {
    const result = await commandExists(command);
    if (result) {
      console.log(`  ✓ ${name}: found`);
      return true;
    } else {
      console.log(`  ⚠ ${name}: not found (may be required for some MCP servers)`);
      return false;
    }
  } catch (error) {
    console.log(`  ⚠ ${name}: unable to check`);
    return false;
  }
}

async function commandExists(command: string): Promise<boolean> {
  try {
    const isWindows = process.platform === 'win32';
    const cmd = isWindows ? `where ${command}` : `which ${command}`;
    await execAsync(cmd);
    return true;
  } catch {
    return false;
  }
}

/** Collapse the home directory to `~` for display. */
function formatHome(absolutePath: string): string {
  const home = os.homedir();
  return absolutePath === home || absolutePath.startsWith(home + '/')
    ? '~' + absolutePath.slice(home.length)
    : absolutePath;
}
