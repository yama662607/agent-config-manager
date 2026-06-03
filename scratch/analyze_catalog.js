import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as TOML from 'smol-toml';

async function main() {
  const home = os.homedir();
  const catalogPath = path.join(home, '.acm', 'catalog.toml');

  try {
    const content = await fs.readFile(catalogPath, 'utf8');
    const catalog = TOML.parse(content);

    const skills = catalog.skills || {};
    const mcps = catalog.mcps || {};

    const skillKeys = Object.keys(skills);
    const mcpKeys = Object.keys(mcps);

    console.log(`Total Skills in Catalog: ${skillKeys.length}`);
    console.log(`Total MCPs in Catalog: ${mcpKeys.length}`);

    // Analyze Skills
    console.log('\n--- Skill Details ---');
    const skillTags = {};
    const skillSources = {};
    let scannedSkillsCount = 0;
    
    for (const [id, skill] of Object.entries(skills)) {
      const tags = skill.tags || [];
      if (tags.includes('scanned')) {
        scannedSkillsCount++;
      }
      for (const tag of tags) {
        skillTags[tag] = (skillTags[tag] || 0) + 1;
      }
      
      // Look for agent source tags or paths
      // In cli-scan.ts: tags: ['scanned', skill.source]
      // where skill.source might be 'claude', 'codex', 'antigravity' (or similar)
      const sourceTag = tags.find(t => t !== 'scanned');
      if (sourceTag) {
        skillSources[sourceTag] = (skillSources[sourceTag] || 0) + 1;
      } else {
        skillSources['unknown'] = (skillSources['unknown'] || 0) + 1;
      }
    }

    console.log(`Scanned Skills: ${scannedSkillsCount}`);
    console.log('Skill Tags summary:', skillTags);
    console.log('Skill Sources (from scan):', skillSources);

    // Show some examples of skills in catalog
    console.log('\nSample Skills (first 10):');
    skillKeys.slice(0, 10).forEach(k => {
      console.log(`- ${k}: tags=[${skills[k].tags?.join(', ')}]`);
    });

    // Analyze MCPs
    console.log('\n--- MCP Details ---');
    const mcpTags = {};
    const mcpSources = {};
    let scannedMcpsCount = 0;

    for (const [id, mcp] of Object.entries(mcps)) {
      const tags = mcp.tags || [];
      if (tags.includes('scanned')) {
        scannedMcpsCount++;
      }
      for (const tag of tags) {
        mcpTags[tag] = (mcpTags[tag] || 0) + 1;
      }
      const sourceTag = tags.find(t => t !== 'scanned');
      if (sourceTag) {
        mcpSources[sourceTag] = (mcpSources[sourceTag] || 0) + 1;
      } else {
        mcpSources['unknown'] = (mcpSources['unknown'] || 0) + 1;
      }
    }

    console.log(`Scanned MCPs: ${scannedMcpsCount}`);
    console.log('MCP Tags summary:', mcpTags);
    console.log('MCP Sources (from scan):', mcpSources);

  } catch (error) {
    console.error('Error analyzing catalog:', error);
  }
}

main();
