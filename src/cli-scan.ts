/**
 * `acm scan` CLI command
 *
 * Scans all three agents for skills and MCPs, optionally importing to catalog.
 */

import { scanAllSkills, scanAllMcps, type ScannedSkill, type ScannedMcp } from './scanner.js';
import { addSkill, normalizeSkillPackage, getSkill, addMcp, normalizeMcpPackage, getMcp } from './catalog.js';
import { padRightWide, truncateWide } from './table-utils.js';

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

      // Parse and normalize
      const entry = normalizeSkillPackage(skill.id, skill.content, {
        tags: ['scanned', skill.source],
      });

      // Import to catalog (copies SKILL.md content)
      await addSkill(entry, skill.content);
      console.log(`  ✅ ${skill.id} (from ${skill.source})`);
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

  for (const mcp of mcps) {
    try {
      // Check if already in catalog
      const existing = await getMcp(mcp.id);
      if (existing) {
        skipped++;
        continue;
      }

      // Normalize and add
      const entry = normalizeMcpPackage(mcp.id, {
        recipe: mcp.recipe,
        tags: ['scanned', mcp.source],
      });

      await addMcp(entry);
      console.log(`  ✅ ${mcp.id} (from ${mcp.source})`);
      added++;
    } catch (error: any) {
      console.error(`  ❌ ${mcp.id}: ${error.message}`);
      errors++;
    }
  }

  return { added, skipped, errors };
}

function printImportSummary(result: ImportResult): void {
  console.log(`\n  Skills: ${result.added} added, ${result.skipped} already in catalog, ${result.errors} errors`);
}

function printMcpImportSummary(result: ImportResult): void {
  console.log(`\n  MCPs: ${result.added} added, ${result.skipped} already in catalog, ${result.errors} errors`);
}
