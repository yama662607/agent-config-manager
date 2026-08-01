/**
 * `acm scan` CLI command
 *
 * Scans all three agents for skills and MCPs, optionally importing to catalog.
 */

import { scanAllSkills, scanAllMcps, type ScannedSkill, type ScannedMcp } from './scanner.js';
import { addSkillFromDir, normalizeSkillPackage, getSkill, addMcp, normalizeMcpPackage, getMcp } from './catalog.js';
import { padRightWide, truncateWide } from './table-utils.js';
import type { McpRecipe } from './types.js';
import path from 'node:path';
import fs from 'node:fs/promises';

// ============================================================================
// Helpers
// ============================================================================

function parseFlag(argv: string[], ...names: string[]): boolean {
  return argv.some(a => names.includes(a));
}

// ============================================================================
// Scan Command
// ============================================================================

export async function scanCommand(argv: string[]): Promise<void> {
  const skillsOnly = parseFlag(argv, '--skills-only', '--skills');
  const mcpOnly = parseFlag(argv, '--mcp-only', '--mcp', '--mcps');
  const dryRun = parseFlag(argv, '--dry-run');

  if (skillsOnly && mcpOnly) {
    console.error('Cannot use both --skills-only and --mcp-only.');
    process.exitCode = 1;
    return;
  }

  const doSkills = !mcpOnly;
  const doMcps = !skillsOnly;

  // ---- Skills ----
  if (doSkills) {
    console.log('🔍 Scanning skills across agents...\n');
    const skills = await scanAllSkills();
    printSkillScanResults(skills);

    if (!dryRun && skills.length > 0) {
      console.log('\n📦 Importing skills to catalog...\n');
      const result = await importSkillsToCatalog(skills);
      printImportSummary(result);
    } else if (dryRun) {
      console.log('\n💡 Run without --dry-run to import these skills to the catalog.');
    }
  }

  // ---- MCPs ----
  if (doMcps) {
    if (doSkills) console.log();
    console.log('🔍 Scanning MCPs across agents...\n');
    const mcps = await scanAllMcps();
    printMcpScanResults(mcps);

    if (!dryRun && mcps.length > 0) {
      console.log('\n📦 Importing MCPs to catalog...\n');
      const result = await importMcpsToCatalog(mcps);
      printMcpImportSummary(result);
    } else if (dryRun) {
      console.log('\n💡 Run without --dry-run to import these MCPs to the catalog.');
    }
  }
}

// ============================================================================
// Display
// ============================================================================

function printSkillScanResults(skills: ScannedSkill[]): void {
  if (skills.length === 0) {
    console.log('  No skills found.');
    return;
  }

  const ID_WIDTH = 35;
  const SOURCE_WIDTH = 30;

  const borderH = '┌' + '─'.repeat(ID_WIDTH + 2) + '┬' + '─'.repeat(SOURCE_WIDTH + 2) + '┐';
  const borderM = '├' + '─'.repeat(ID_WIDTH + 2) + '┼' + '─'.repeat(SOURCE_WIDTH + 2) + '┤';
  const borderF = '└' + '─'.repeat(ID_WIDTH + 2) + '┴' + '─'.repeat(SOURCE_WIDTH + 2) + '┘';

  console.log(`  Found ${skills.length} skill(s):\n`);
  console.log(borderH);
  console.log('│ ' + padRightWide('Skill ID', ID_WIDTH) + ' │ ' + padRightWide('Source', SOURCE_WIDTH) + ' │');
  console.log(borderM);

  for (const skill of skills) {
    const id = truncateWide(skill.id, ID_WIDTH);
    const source = truncateWide(skill.source, SOURCE_WIDTH);
    console.log('│ ' + padRightWide(id, ID_WIDTH) + ' │ ' + padRightWide(source, SOURCE_WIDTH) + ' │');
  }

  console.log(borderF);
}

function printMcpScanResults(mcps: ScannedMcp[]): void {
  if (mcps.length === 0) {
    console.log('  No MCPs found.');
    return;
  }

  const ID_WIDTH = 25;
  const SOURCE_WIDTH = 15;
  const STATUS_WIDTH = 8;

  const borderH = '┌' + '─'.repeat(ID_WIDTH + 2) + '┬' + '─'.repeat(SOURCE_WIDTH + 2) + '┬' + '─'.repeat(STATUS_WIDTH + 2) + '┐';
  const borderM = '├' + '─'.repeat(ID_WIDTH + 2) + '┼' + '─'.repeat(SOURCE_WIDTH + 2) + '┼' + '─'.repeat(STATUS_WIDTH + 2) + '┤';
  const borderF = '└' + '─'.repeat(ID_WIDTH + 2) + '┴' + '─'.repeat(SOURCE_WIDTH + 2) + '┴' + '─'.repeat(STATUS_WIDTH + 2) + '┘';

  console.log(`  Found ${mcps.length} MCP server(s):\n`);
  console.log(borderH);
  console.log('│ ' + padRightWide('MCP ID', ID_WIDTH) + ' │ ' + padRightWide('Source', SOURCE_WIDTH) + ' │ ' + padRightWide('Enabled', STATUS_WIDTH) + ' │');
  console.log(borderM);

  for (const mcp of mcps) {
    const id = truncateWide(mcp.id, ID_WIDTH);
    const source = truncateWide(mcp.source, SOURCE_WIDTH);
    const status = mcp.enabled === false ? 'disabled' : 'enabled';
    console.log('│ ' + padRightWide(id, ID_WIDTH) + ' │ ' + padRightWide(source, SOURCE_WIDTH) + ' │ ' + padRightWide(status, STATUS_WIDTH) + ' │');
  }

  console.log(borderF);
}

// ============================================================================
// Import
// ============================================================================

interface ImportResult {
  added: number;
  skipped: number;
  errors: number;
}

async function importSkillsToCatalog(skills: ScannedSkill[]): Promise<ImportResult> {
  let added = 0;
  let skipped = 0;
  let errors = 0;

  for (const skill of skills) {
    try {
      // Check if already in catalog
      const existing = await getSkill(skill.id);
      if (existing) {
        skipped++;
        continue;
      }

      // Copy the whole skill directory, not just SKILL.md: skills routinely
      // carry references/, scripts/ and assets/ that are useless without it.
      const sourceDir = path.dirname(skill.skillPath);
      const entry = normalizeSkillPackage(skill.id, skill.content, {
        tags: ['scanned', skill.source],
      });

      await addSkillFromDir(skill.id, sourceDir, {
        displayName: entry.displayName,
        description: entry.description,
        tags: entry.tags,
        license: entry.license,
      });

      const extras = (await fs.readdir(sourceDir)).filter((name) => name !== 'SKILL.md').length;
      console.log(`  ✅ ${skill.id} (from ${skill.source}${extras > 0 ? `, +${extras} files` : ''})`);
      added++;
    } catch (error: any) {
      console.error(`  ❌ ${skill.id}: ${error.message}`);
      errors++;
    }
  }

  return { added, skipped, errors };
}

async function importMcpsToCatalog(mcps: ScannedMcp[]): Promise<ImportResult> {
  let added = 0;
  let skipped = 0;
  let errors = 0;

  // Load existing enhanced metadata for enrichment
  const { loadMcpsMetadata, saveMcpsMetadata } = await import('./mcps-metadata.js');
  const metaFile = await loadMcpsMetadata();
  let metaChanged = false;

  for (const mcp of mcps) {
    try {
      // Check if already in catalog
      const existing = await getMcp(mcp.id);
      if (existing) {
        skipped++;
        continue;
      }

      // Normalize and add to catalog
      const entry = normalizeMcpPackage(mcp.id, {
        recipe: mcp.recipe,
        tags: ['scanned', mcp.source],
      });

      await addMcp(entry);

      // Also add to enhanced metadata if not already there
      if (!metaFile.mcps[mcp.id]) {
        // Try fuzzy match for existing metadata
        let found = false;
        for (const [key, meta] of Object.entries(metaFile.mcps)) {
          if (key.includes(mcp.id) || mcp.id.includes(key) ||
              (meta.package && mcp.id.includes(meta.package))) {
            found = true;
            break;
          }
        }
        if (!found) {
          const isPlugin = mcp.source.startsWith('plugin:');
          metaFile.mcps[mcp.id] = {
            displayName: entry.displayName,
            descriptionJa: entry.description,
            category: guessMcpCategory(mcp.id),
            language: guessMcpLanguage(mcp.id, mcp.recipe),
            transport: mcp.recipe.transport || 'stdio',
            package: detectNpmPackage(mcp.recipe),
            sourceType: isPlugin ? 'plugin' : 'config',
            agent: mcp.agent,
            addedAt: new Date().toISOString(),
            tags: ['scanned'],
          };
          metaChanged = true;
        }
      }

      console.log(`  ✅ ${mcp.id} (from ${mcp.source})`);
      added++;
    } catch (error: any) {
      console.error(`  ❌ ${mcp.id}: ${error.message}`);
      errors++;
    }
  }

  if (metaChanged) {
    await saveMcpsMetadata(metaFile);
  }

  return { added, skipped, errors };

function guessMcpCategory(id: string): string {
  const lower = id.toLowerCase();
  if (/github|gitlab|bitbucket|git\b|code-review|coderabbit|sentry|xcode/i.test(lower)) return 'development';
  if (/browser|playwright|chrome|puppeteer|selenium/i.test(lower)) return 'browser';
  if (/search|brave|tavily|exa|perplexity|context7/i.test(lower)) return 'search';
  if (/postgres|mysql|sqlite|database|duckdb|neon|supabase|clickhouse|airtable/i.test(lower)) return 'database';
  if (/slack|teams|discord|zoom|twilio|gmail|email|calendar/i.test(lower)) return 'communication';
  if (/notion|linear|jira|asana|todo|task|zapier/i.test(lower)) return 'productivity';
  if (/docker|kubernetes|terraform|vercel|netlify|cloudflare|aws|datadog|prometheus/i.test(lower)) return 'infrastructure';
  if (/figma|blender|canva|excalidraw|remotion|design/i.test(lower)) return 'design';
  if (/arxiv|paper|research|scholar|crossref|openalex|zotero|reference|typst/i.test(lower)) return 'academic';
  if (/memory|sequential|thinking|superpowers|agent/i.test(lower)) return 'ai-tool';
  if (/anki|obsidian|note|knowledge|apple-note/i.test(lower)) return 'knowledge';
  if (/finance|stripe|payment|solana|crypto|trading/i.test(lower)) return 'finance';
  if (/home-assistant|arduino|esp32|iot|hardware|device/i.test(lower)) return 'hardware';
  if (/unity|unreal|godot|game/i.test(lower)) return 'gamedev';
  if (/file|filesystem/i.test(lower)) return 'system';
  return 'development';
}

function guessMcpLanguage(id: string, recipe: McpRecipe): string {
  const lower = id.toLowerCase();
  if (/python|jupyter|blender|\.py\b/i.test(lower)) return 'Python';
  if (/go-|golang|kubernetes|docker|daytona|terraform/i.test(lower)) return 'Go';
  if (/unity|unreal/i.test(lower)) return 'C#';
  if (recipe.command === 'uv' || recipe.command === 'python' || recipe.command === 'python3') return 'Python';
  if (recipe.command === 'go' || recipe.command === 'golang') return 'Go';
  return 'TypeScript';
}

function detectNpmPackage(recipe: McpRecipe): string | undefined {
  if (recipe.command === 'npx' && recipe.args?.length) {
    for (const arg of recipe.args) {
      if (arg.startsWith('-')) continue;
      if (arg.startsWith('@') || arg.includes('/')) return arg.replace(/@latest$/, '');
    }
  }
  return undefined;
}
}

function printImportSummary(result: ImportResult): void {
  console.log(`\n  Skills: ${result.added} added, ${result.skipped} already in catalog, ${result.errors} errors`);
}

function printMcpImportSummary(result: ImportResult): void {
  console.log(`\n  MCPs: ${result.added} added, ${result.skipped} already in catalog, ${result.errors} errors`);
}
