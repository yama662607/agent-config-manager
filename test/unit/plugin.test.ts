import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('Plugin Scanner', () => {
  const TEST_HOME = path.join(os.tmpdir(), 'acm-plugin-test');

  before(async () => {
    await fs.rm(TEST_HOME, { recursive: true, force: true });
    process.env.HOME = TEST_HOME;

    // Create a mock Codex plugin
    const codexPluginDir = path.join(TEST_HOME, '.codex', '.tmp', 'plugins', 'plugins', 'test-plugin');
    await fs.mkdir(path.join(codexPluginDir, '.codex-plugin'), { recursive: true });
    await fs.mkdir(path.join(codexPluginDir, 'skills', 'test-skill'), { recursive: true });
    await fs.mkdir(path.join(codexPluginDir, 'agents'), { recursive: true });

    await fs.writeFile(
      path.join(codexPluginDir, '.codex-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'test-plugin',
        version: '1.0.0',
        description: 'A test plugin',
        author: { name: 'Test Author' },
        license: 'MIT',
        keywords: ['test', 'plugin'],
      })
    );
    await fs.writeFile(
      path.join(codexPluginDir, 'skills', 'test-skill', 'SKILL.md'),
      '---\nname: test-skill\ndescription: A test skill\n---\n# Test Skill\n'
    );
    await fs.writeFile(
      path.join(codexPluginDir, 'agents', 'test-agent.md'),
      'You are a test agent.'
    );
    await fs.writeFile(
      path.join(codexPluginDir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          'test-mcp': { command: 'npx', args: ['-y', 'test-mcp'] }
        }
      })
    );

    // Create a mock Claude external plugin (MCP-only)
    const claudeExtDir = path.join(TEST_HOME, '.claude', 'plugins', 'marketplaces', 'claude-plugins-official', 'external_plugins', 'test-external');
    await fs.mkdir(path.join(claudeExtDir, '.claude-plugin'), { recursive: true });
    await fs.writeFile(
      path.join(claudeExtDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'test-external', description: 'External test', author: { name: 'Ext' } })
    );
    await fs.writeFile(
      path.join(claudeExtDir, '.mcp.json'),
      JSON.stringify({ 'test-http': { type: 'http', url: 'https://test.example.com/mcp' } })
    );
  });

  after(async () => {
    await fs.rm(TEST_HOME, { recursive: true, force: true });
  });

  it('should discover plugins from Codex directory', async () => {
    const { scanAllPlugins } = await import('../../src/plugin-scanner.js');
    const plugins = await scanAllPlugins();

    const testPlugin = plugins.find(p => p.name === 'test-plugin');
    assert.ok(testPlugin, 'Should find test-plugin');
    assert.strictEqual(testPlugin.skills, 1);
    assert.strictEqual(testPlugin.mcps, 1);
    assert.strictEqual(testPlugin.agents, 1);
    assert.strictEqual(testPlugin.agent, 'codex');
    assert.strictEqual(testPlugin.version, '1.0.0');
  });

  it('should discover plugins from Claude external directory', async () => {
    const { scanAllPlugins } = await import('../../src/plugin-scanner.js');
    const plugins = await scanAllPlugins();

    const extPlugin = plugins.find(p => p.name === 'test-external');
    assert.ok(extPlugin, 'Should find test-external');
    assert.strictEqual(extPlugin.skills, 0);
    assert.strictEqual(extPlugin.mcps, 1);
    assert.strictEqual(extPlugin.agent, 'claude');
  });

  it('should get plugin detail for install', async () => {
    const { getPluginDetail } = await import('../../src/plugin-scanner.js');
    const detail = await getPluginDetail('test-plugin');

    assert.ok(detail, 'Should get plugin detail');
    assert.strictEqual(detail!.skills.length, 1);
    assert.strictEqual(detail!.skills[0].id, 'test-skill');
    assert.strictEqual(detail!.agentFiles.length, 1);
    assert.strictEqual(detail!.agentFiles[0], 'test-agent.md');
    assert.ok(detail!.mcpConfigPath, 'Should have MCP config');
    assert.strictEqual(Object.keys(detail!.mcpServers).length, 1); // mcpServers is excluded
  });
});

describe('Plugin Metadata', () => {
  const TEST_HOME = path.join(os.tmpdir(), 'acm-plugin-meta-test');

  before(async () => {
    await fs.rm(TEST_HOME, { recursive: true, force: true });
    process.env.HOME = TEST_HOME;
  });

  after(async () => {
    await fs.rm(TEST_HOME, { recursive: true, force: true });
  });

  it('should load empty plugin metadata', async () => {
    const { loadPluginsMetadata } = await import('../../src/plugins-metadata.js');
    const data = await loadPluginsMetadata();
    assert.deepStrictEqual(data.plugins, {});
    assert.strictEqual(data.version, '1.0');
  });

  it('should add, list, and remove plugin entries', async () => {
    const { addPluginEntry, listPlugins, removePluginEntry, getPluginEntry } = await import('../../src/plugins-metadata.js');

    const entry: any = {
      name: 'test-plugin',
      version: '1.0.0',
      description: 'Test',
      agent: 'codex',
      sourcePath: '/test/path',
      skills: ['test-skill'],
      mcps: ['test-mcp'],
      agentFiles: ['test-agent.md'],
      knowledgeFiles: [],
      commandFiles: [],
      installedAt: new Date().toISOString(),
    };

    await addPluginEntry(entry);
    const plugins = await listPlugins();
    assert.strictEqual(plugins.length, 1);
    assert.strictEqual(plugins[0].name, 'test-plugin');

    const loaded = await getPluginEntry('test-plugin');
    assert.ok(loaded);
    assert.strictEqual(loaded!.skills[0], 'test-skill');

    const removed = await removePluginEntry('test-plugin');
    assert.ok(removed);
    assert.strictEqual((await listPlugins()).length, 0);
  });

  it('should return false when removing non-existent plugin', async () => {
    const { removePluginEntry } = await import('../../src/plugins-metadata.js');
    const removed = await removePluginEntry('non-existent');
    assert.ok(!removed);
  });
});

describe('Plugin CLI Integration', () => {
  const TEST_HOME = path.join(os.tmpdir(), 'acm-plugin-cli-test');

  before(async () => {
    await fs.rm(TEST_HOME, { recursive: true, force: true });
    process.env.HOME = TEST_HOME;

    // Create mock Codex plugin with skills and MCP
    const pluginDir = path.join(TEST_HOME, '.codex', '.tmp', 'plugins', 'plugins', 'cli-test-plugin');
    await fs.mkdir(path.join(pluginDir, '.codex-plugin'), { recursive: true });
    await fs.mkdir(path.join(pluginDir, 'skills', 'test-skill'), { recursive: true });
    await fs.writeFile(
      path.join(pluginDir, '.codex-plugin', 'plugin.json'),
      JSON.stringify({ name: 'cli-test-plugin', version: '1.0.0', description: 'CLI test', author: { name: 'Test' }, license: 'MIT' })
    );
    await fs.writeFile(
      path.join(pluginDir, 'skills', 'test-skill', 'SKILL.md'),
      '---\nname: test-skill\ndescription: A test skill\n---\n# Test\n'
    );
    await fs.writeFile(
      path.join(pluginDir, '.mcp.json'),
      JSON.stringify({ 'test-mcp': { command: 'echo', args: ['hello'] } })
    );

    // Create ~/.acm/catalog.toml
    const acmDir = path.join(TEST_HOME, '.acm');
    await fs.mkdir(acmDir, { recursive: true });
    // Initialize with empty skills/MCPs
    const TOML = await import('smol-toml');
    await fs.writeFile(
      path.join(acmDir, 'catalog.toml'),
      TOML.stringify({ version: '1.0', mcps: {}, skills: {} }),
      'utf8'
    );
  });

  after(async () => {
    await fs.rm(TEST_HOME, { recursive: true, force: true });
  });

  it('should install plugin to target agent dir', async () => {
    const { pluginInstall } = await import('../../src/cli-plugin.js');

    await pluginInstall('cli-test-plugin', ['--target', 'claude']);

    // Check plugin was copied to Claude
    const claudePluginDir = path.join(TEST_HOME, '.claude', 'plugins', 'cli-test-plugin');
    const exists = await fs.access(claudePluginDir).then(() => true).catch(() => false);
    assert.ok(exists, 'Plugin should be copied to Claude plugin dir');

    // Check .claude-plugin/plugin.json was created (manifest adaptation)
    const manifestExists = await fs.access(path.join(claudePluginDir, '.claude-plugin', 'plugin.json')).then(() => true).catch(() => false);
    assert.ok(manifestExists, 'Claude manifest should exist');

    // Check skills are in the plugin dir
    const skillExists = await fs.access(path.join(claudePluginDir, 'skills', 'test-skill', 'SKILL.md')).then(() => true).catch(() => false);
    assert.ok(skillExists, 'Skills should be in plugin dir');

    // Check skill is in catalog
    const { getSkill } = await import('../../src/catalog.js');
    const skill = await getSkill('test-skill');
    assert.ok(skill, 'Skill should be in catalog');

    // Check registry
    const { getPluginEntry } = await import('../../src/plugins-metadata.js');
    const entry = await getPluginEntry('cli-test-plugin');
    assert.ok(entry, 'Plugin should be in registry');
  });

  it('should skip already installed plugin', async () => {
    const { pluginInstall } = await import('../../src/cli-plugin.js');

    // Second install should skip
    await pluginInstall('cli-test-plugin', ['--target', 'claude']);
    // Should not throw - already installed
  });

  it('should list installed plugins', async () => {
    const { pluginList } = await import('../../src/cli-plugin.js');

    // Capture console output
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(' '));

    await pluginList();

    console.log = origLog;
    assert.ok(logs.some(l => l.includes('cli-test-plugin')), 'Should list installed plugin');
  });

  it('should uninstall plugin from agent dirs', async () => {
    const { pluginUninstall } = await import('../../src/cli-plugin.js');

    await pluginUninstall('cli-test-plugin', []);

    // Check Claude plugin dir removed
    const claudePluginDir = path.join(TEST_HOME, '.claude', 'plugins', 'cli-test-plugin');
    const exists = await fs.access(claudePluginDir).then(() => true).catch(() => false);
    assert.ok(!exists, 'Plugin should be removed from Claude');

    // Check registry removed
    const { getPluginEntry } = await import('../../src/plugins-metadata.js');
    const entry = await getPluginEntry('cli-test-plugin');
    assert.ok(!entry, 'Plugin should be removed from registry');
  });
});
