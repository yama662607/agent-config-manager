import fs from 'node:fs/promises';
import path from 'node:path';
// ============================================================================
// Constants
// ============================================================================
/** Native config file paths for each target relative to project root */
const TARGET_CONFIG_PATHS = {
    claude: '.mcp.json',
    codex: path.join('.codex', 'config.toml'),
    gemini: path.join('.gemini', 'settings.json'),
};
// ============================================================================
// Project Discovery
// ============================================================================
/**
 * Discover the active project from the current working directory.
 *
 * Priority:
 * 1. Nearest ancestor that is a Git repository root
 * 2. Nearest ancestor containing any supported native config file
 * 3. Fail with clear error
 */
export async function discoverProject(cwd = process.cwd()) {
    const gitRoot = await findGitRoot(cwd);
    const projectRoot = gitRoot ?? (await findNativeConfigRoot(cwd));
    if (!projectRoot) {
        throw new Error('Not inside a managed project. ' +
            'Navigate to a Git repository or a directory with native agent config files.');
    }
    const targets = await resolveNativeConfigPaths(projectRoot);
    return { root: projectRoot, targets };
}
/**
 * Find the nearest Git repository root by traversing upwards.
 */
async function findGitRoot(cwd) {
    let current = path.resolve(cwd);
    while (true) {
        const gitDir = path.join(current, '.git');
        try {
            const stat = await fs.stat(gitDir);
            if (stat.isDirectory()) {
                return current;
            }
        }
        catch {
            // .git doesn't exist, continue
        }
        const parent = path.dirname(current);
        if (parent === current) {
            // Reached root
            return null;
        }
        current = parent;
    }
}
/**
 * Find the nearest ancestor containing any supported native config file.
 */
async function findNativeConfigRoot(cwd) {
    let current = path.resolve(cwd);
    while (true) {
        for (const targetPath of Object.values(TARGET_CONFIG_PATHS)) {
            const fullPath = path.join(current, targetPath);
            try {
                await fs.access(fullPath);
                return current;
            }
            catch {
                // File doesn't exist, try next
            }
        }
        const parent = path.dirname(current);
        if (parent === current) {
            // Reached root
            return null;
        }
        current = parent;
    }
}
/**
 * Resolve native config paths for all targets relative to the project root.
 */
async function resolveNativeConfigPaths(projectRoot) {
    const targets = new Map();
    for (const [target, relativePath] of Object.entries(TARGET_CONFIG_PATHS)) {
        const fullPath = path.join(projectRoot, relativePath);
        let exists = false;
        try {
            await fs.access(fullPath);
            exists = true;
        }
        catch {
            // File doesn't exist
        }
        targets.set(target, {
            target,
            path: fullPath,
            exists,
        });
    }
    return targets;
}
// ============================================================================
// Utilities
// ============================================================================
/**
 * Get the relative path from project root to a config file.
 */
export function getRelativeConfigPath(projectRoot, target) {
    return TARGET_CONFIG_PATHS[target];
}
//# sourceMappingURL=project-discovery.js.map