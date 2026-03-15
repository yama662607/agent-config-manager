#!/usr/bin/env tsx
/**
 * Migration script to convert catalog skills from JSON-embedded to file-based format.
 */

import { migrateSkills, getSkillsDir } from '../src/catalog.js';
import fs from 'node:fs/promises';
import path from 'node:path';

async function main() {
  console.log('Checking catalog for migration...\n');

  // Check current state
  const skillsDir = getSkillsDir();
  const hasSkillsDir = await fs.access(skillsDir).then(() => true).catch(() => false);

  if (hasSkillsDir) {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    const existingSkills = entries.filter(e => e.isDirectory()).map(e => e.name);
    console.log(`Existing skills directory: ${skillsDir}`);
    console.log(`  Skills: ${existingSkills.length > 0 ? existingSkills.join(', ') : '(none)'}\n`);
  } else {
    console.log(`No skills directory exists yet.\n`);
  }

  // Run migration
  console.log('Running migration...');
  const migrated = await migrateSkills();

  if (migrated === 0) {
    console.log('✅ No migration needed. All skills are already in file-based format.');
    return;
  }

  console.log(`\n✅ Migrated ${migrated} skill(s) to file-based format.`);

  // Show results
  const entries = await fs.readdir(skillsDir, { withFileTypes: true });
  const skillFolders = entries.filter(e => e.isDirectory()).map(e => e.name);

  console.log(`\nSkills directory: ${skillsDir}`);
  console.log(`  Total skills: ${skillFolders.length}`);

  if (skillFolders.length > 0) {
    console.log(`  Skills:`);
    for (const skill of skillFolders) {
      const skillPath = path.join(skillsDir, skill, 'SKILL.md');
      const exists = await fs.access(skillPath).then(() => true).catch(() => false);
      const size = exists ? (await fs.stat(skillPath)).size : 0;
      console.log(`    - ${skill} (${exists ? size + ' bytes' : 'missing SKILL.md'})`);
    }
  }
}

main().catch(error => {
  console.error('Migration failed:', error);
  process.exit(1);
});
