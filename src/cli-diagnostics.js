import fs from 'node:fs/promises';
import { discoverProject } from './project-discovery.js';
import { loadCatalog } from './catalog.js';
/**
 * Validate the current project configuration.
 */
export async function validate(options) {
    const errors = [];
    const warnings = [];
    // 1. Project discovery
    console.log('Checking project discovery...');
    try {
        const discovery = await discoverProject();
        console.log(`  ✓ Project root: ${discovery.root}`);
    }
    catch (error) {
        errors.push(`Project discovery failed: ${error.message}\n`);
    }
    // 2. Catalog references
    console.log('Checking catalog...');
    try {
        const catalog = await loadCatalog();
        console.log(`  ✓ Catalog loaded (${Object.keys(catalog.mcps).length} entries)`);
    }
    catch (error) {
        errors.push(`Catalog load failed: ${error.message}\n`);
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
                }
                else {
                    warnings.push(`${target}: empty config at ${configPath.path}\n`);
                }
            }
            else {
                console.log(`  ✓ ${target}: config parsed successfully`);
            }
        }
    }
    catch (error) {
        errors.push(`Config validation failed: ${error.message}\n`);
    }
    // Summary
    console.log();
    if (errors.length > 0) {
        console.error('Validation failed:\n');
        for (const error of errors) {
            console.error(`  ✗ ${error}`);
        }
        process.exitCode = 1;
    }
    else if (warnings.length > 0) {
        console.warn('Warnings:\n');
        for (const warning of warnings) {
            console.warn(`  ⚠ ${warning}`);
        }
        if (options.strict) {
            console.error('\nValidation failed (strict mode).');
            process.exitCode = 1;
        }
        else {
            console.log('\nValidation passed with warnings.');
        }
    }
    else {
        console.log('Validation passed.\n');
    }
}
/**
 * Run diagnostics and health checks.
 */
export async function doctor(options) {
    console.log('acsync Diagnostics\n');
    console.log('='.repeat(50));
    // 1. Project discovery
    console.log('\n[Project Discovery]');
    try {
        const discovery = await discoverProject();
        console.log(`  ✓ Project root: ${discovery.root}`);
        console.log(`  ✓ Detected targets:`);
        for (const [target, configPath] of discovery.targets.entries()) {
            const status = configPath.exists ? '✓' : '✗';
            console.log(`      ${status} ${target}: ${configPath.path}`);
        }
    }
    catch (error) {
        console.log(`  ✗ ${error.message}`);
    }
    // 2. Catalog health
    console.log('\n[Catalog Health]');
    try {
        const catalog = await loadCatalog();
        const entryCount = Object.keys(catalog.mcps).length;
        console.log(`  ✓ Catalog location: ${await getCatalogPath()}`);
        console.log(`  ✓ Entries: ${entryCount}`);
        console.log(`  ✓ Version: ${catalog.version}`);
    }
    catch (error) {
        console.log(`  ✗ ${error.message}`);
        if (options.fix) {
            console.log('  Attempting to fix...');
            try {
                const { initCatalog } = await import('./catalog.js');
                await initCatalog();
                console.log('  ✓ Catalog initialized');
            }
            catch (fixError) {
                console.log(`  ✗ Fix failed: ${fixError.message}`);
            }
        }
    }
    // 3. Environment checks
    console.log('\n[Environment]');
    await checkCommand('node', 'Node.js');
    await checkCommand('npm', 'npm');
    await checkCommand('npx', 'npx');
    // 4. Target readiness
    console.log('\n[Target Readiness]');
    try {
        const discovery = await discoverProject();
        for (const [target, configPath] of discovery.targets.entries()) {
            if (configPath.exists) {
                const size = (await fs.stat(configPath.path)).size;
                console.log(`  ✓ ${target}: config exists (${size} bytes)`);
            }
            else {
                console.log(`  ⚠ ${target}: config not found (run \`acsync mcp init\`)`);
            }
        }
    }
    catch (error) {
        console.log(`  ✗ ${error.message}`);
    }
    console.log('\n' + '='.repeat(50));
    console.log('\nFor more help, run `acsync --help` or visit the documentation.\n');
}
async function getCatalogPath() {
    const { getCatalogPath: getPath } = await import('./catalog.js');
    return getPath();
}
async function checkCommand(command, name) {
    try {
        const result = await commandExists(command);
        if (result) {
            console.log(`  ✓ ${name}: found`);
        }
        else {
            console.log(`  ⚠ ${name}: not found (may be required for some MCP servers)`);
        }
    }
    catch (error) {
        console.log(`  ⚠ ${name}: unable to check`);
    }
}
async function commandExists(command) {
    try {
        const isWindows = process.platform === 'win32';
        const result = await (isWindows ? `where ${command}` : `which ${command}`);
        return !!result;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=cli-diagnostics.js.map