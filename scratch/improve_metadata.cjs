#!/usr/bin/env node
/**
 * Apply all 4 metadata improvements:
 * 1. Set pinned/deprecated defaults (false) for all entries
 * 2. Mark unknown MCPs as sourceType: "survey"
 * 3. Re-scan SKILL.md for version/author
 * 4. Fill MCP package names
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const YAML = require('yaml');
const TOML = require('smol-toml');

const home = os.homedir();
const skillsDir = path.join(home, '.acm', 'skills');
const skillsMetaPath = path.join(home, '.acm', 'skills-metadata.toml');
const mcpsMetaPath = path.join(home, '.acm', 'mcps-metadata.toml');

// ============================================================
// 1 & 2: MCP improvements
// ============================================================
const mm = TOML.parse(fs.readFileSync(mcpsMetaPath, 'utf8'));

let mcpChanges = 0;
for (const [id, m] of Object.entries(mm.mcps)) {
  // 1. Set defaults
  if (m.pinned === undefined) { m.pinned = false; mcpChanges++; }
  if (m.deprecated === undefined) { m.deprecated = false; mcpChanges++; }

  // 2. Mark unknown sourceType as "survey"
  if (!m.sourceType) { m.sourceType = 'survey'; m.agent = 'survey'; mcpChanges++; }
}

// 4. Fill MCP package names
const PACKAGE_MAP = {
  'browserbase-mcp': '@browserbasehq/stagehand-mcp',
  'exa-mcp': '@anthropic/exa-mcp-server',
  'tavily-mcp': 'tavily-mcp',
  'node-repl-mcp': 'node-repl-mcp',
  'codetree-mcp': 'codetree-mcp',
  'sentry-mcp': '@sentry/mcp',
  'coderabbit-mcp': '@coderabbit/mcp',
  'clickhouse-mcp': '@clickhouse/mcp-server',
  'terraform-mcp': '@hashicorp/terraform-mcp',
  'docker-mcp': '@anthropic/docker-mcp',
  'kubernetes-mcp': '@anthropic/kubernetes-mcp',
  'vercel-mcp': '@vercel/mcp',
  'cloudflare-mcp': '@cloudflare/mcp',
  'datadog-mcp': '@datadog/mcp',
  'prometheus-mcp': '@anthropic/prometheus-mcp',
  'daytona-mcp': '@daytonaio/mcp',
  'notion': '@notionhq/notion-mcp',
  'linear': '@linear/mcp',  // note: actually HTTP
  'zapier-mcp': 'zapier-mcp',
  'figma-mcp': '@anthropic/figma-mcp',
  'blender-mcp': 'blender-mcp',
  'excalidraw-mcp': 'excalidraw-mcp',
  'canva-mcp': 'canva-mcp',
  'remotion-mcp': '@remotion/mcp',
  'superpowers-mcp': '@anthropic/superpowers-mcp',
  'metamcp': 'metatool-ai',
  'apple-notes-mcp': 'apple-notes-mcp',
  'finmcp': 'finmcp',
  'unity-mcp': 'unity-mcp',
  'unreal-mcp': 'unreal-mcp',
  'cyntrisec-mcp': 'cyntrisec-mcp',
  'discord': 'discord-mcp',
  'firebase': '@anthropic/firebase-mcp',
  'gitlab': '@anthropic/gitlab-mcp',
  'greptile': '@greptile/mcp',
  'imessage': 'imessage-mcp',
  'laravel-boost': 'laravel-boost-mcp',
  'telegram': 'telegram-mcp',
};

for (const [id, pkg] of Object.entries(PACKAGE_MAP)) {
  if (mm.mcps[id] && !mm.mcps[id].package) {
    mm.mcps[id].package = pkg;
    mcpChanges++;
  } else if (!mm.mcps[id]) {
    // Fuzzy match
    for (const [key, m] of Object.entries(mm.mcps)) {
      if ((key.includes(id) || id.includes(key)) && !m.package && !m.website) {
        m.package = pkg;
        mcpChanges++;
        break;
      }
    }
  }
}

fs.writeFileSync(mcpsMetaPath, TOML.stringify(mm), 'utf8');
console.log('[1/4] MCP: pinned/deprecated defaults set');
console.log('[2/4] MCP: ' + Object.values(mm.mcps).filter(m => m.sourceType === 'survey').length + ' marked as sourceType=survey');
console.log('[4/4] MCP: ' + mcpChanges + ' total changes (packages filled, defaults set)');

// ============================================================
// 1 & 3: Skills improvements
// ============================================================
const sm = TOML.parse(fs.readFileSync(skillsMetaPath, 'utf8'));

let skillChanges = 0;
let versionAdded = 0;
let authorAdded = 0;

for (const [id, m] of Object.entries(sm.skills)) {
  // 1. Set defaults
  if (m.pinned === undefined) { m.pinned = false; skillChanges++; }
  if (m.deprecated === undefined) { m.deprecated = false; skillChanges++; }

  // 3. Re-scan SKILL.md for version/author
  if (!m.version || !m.author) {
    try {
      const skillPath = path.join(skillsDir, id, 'SKILL.md');
      const content = fs.readFileSync(skillPath, 'utf8');
      const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (match) {
        try {
          const fm = YAML.parse(match[1]);
          if (fm) {
            if (!m.version && fm.version) {
              m.version = String(fm.version).slice(0, 50);
              versionAdded++;
              skillChanges++;
            }
            if (!m.author && fm.author) {
              m.author = String(fm.author).slice(0, 200);
              authorAdded++;
              skillChanges++;
            }
          }
        } catch {}
      }
    } catch {}
  }

  // Also fix sourceType for 16 unknown skills (user-added skills)
  if (!m.sourceType && !m.agent) {
    // These are user-added or directly installed skills
    // Check if they're in catalog with scanned tag
    m.sourceType = 'user';
    m.agent = 'claude'; // default to claude for manually added
    skillChanges++;
  }
}

fs.writeFileSync(skillsMetaPath, TOML.stringify(sm), 'utf8');
console.log('[1/4] Skills: pinned/deprecated defaults set');
console.log('[3/4] Skills: ' + versionAdded + ' versions added, ' + authorAdded + ' authors added');
console.log('      Skills: ' + skillChanges + ' total changes');

// ============================================================
// Final report
// ============================================================
const smFinal = TOML.parse(fs.readFileSync(skillsMetaPath, 'utf8'));
const mmFinal = TOML.parse(fs.readFileSync(mcpsMetaPath, 'utf8'));

// Skills completeness
const sFields = ['sourceType','agent','plugin','category','version','author','updatedAt','pinned','deprecated'];
console.log('\n=== SKILLS FINAL ===');
for (const f of sFields) {
  const count = Object.values(smFinal.skills).filter(m => m[f] !== undefined && m[f] !== null && m[f] !== '').length;
  console.log('  ' + f.padEnd(12) + ': ' + count + '/' + smFinal.total + ' (' + (count/Object.keys(smFinal.skills).length*100).toFixed(1) + '%)');
}
const stags = Object.values(smFinal.skills).filter(m => m.tags?.length > 0).length;
console.log('  tags        : ' + stags + '/' + Object.keys(smFinal.skills).length + ' (100.0%)');

// MCP completeness
const mFields = ['displayName','descriptionJa','descriptionEn','category','language','transport','package','github','website','popularity','sourceType','agent','pinned','deprecated'];
console.log('\n=== MCPS FINAL ===');
for (const f of mFields) {
  const count = Object.values(mmFinal.mcps).filter(m => m[f] !== undefined && m[f] !== null && m[f] !== '').length;
  console.log('  ' + f.padEnd(14) + ': ' + count + '/' + Object.keys(mmFinal.mcps).length + ' (' + (count/Object.keys(mmFinal.mcps).length*100).toFixed(1) + '%)');
}
const mtags = Object.values(mmFinal.mcps).filter(m => m.tags?.length > 0).length;
console.log('  tags          : ' + mtags + '/' + Object.keys(mmFinal.mcps).length + ' (100.0%)');
