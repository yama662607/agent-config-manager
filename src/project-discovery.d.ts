import type { ProjectDiscovery, TargetName } from './types.js';
/**
 * Discover the active project from the current working directory.
 *
 * Priority:
 * 1. Nearest ancestor that is a Git repository root
 * 2. Nearest ancestor containing any supported native config file
 * 3. Fail with clear error
 */
export declare function discoverProject(cwd?: string): Promise<ProjectDiscovery>;
/**
 * Get the relative path from project root to a config file.
 */
export declare function getRelativeConfigPath(projectRoot: string, target: TargetName): string;
