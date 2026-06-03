#!/usr/bin/env node
/**
 * Generate ~/.acm/skills-metadata.toml from existing catalog and skill files.
 * Enriches metadata with source decomposition, categories, and AI-generated tags.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const YAML = require('yaml');
const TOML = require('smol-toml');

const home = os.homedir();
const catalogPath = path.join(home, '.acm', 'catalog.toml');
const skillsDir = path.join(home, '.acm', 'skills');
const outputPath = path.join(home, '.acm', 'skills-metadata.toml');

// ============================================================================
// Plugin → Category Mapping
// ============================================================================
const PLUGIN_CATEGORY = {
  'hugging-face': 'ai-ml', 'ai-sdk': 'ai-ml', 'ai-gateway': 'ai-ml',
  'ai-elements': 'ai-ml', 'build-model': 'ai-ml', 'agents-sdk': 'ai-ml',
  'llm-trainer': 'ai-ml', 'community-evals': 'ai-ml', 'gradio': 'ai-ml',
  'jobs': 'ai-ml', 'paper-publisher': 'ai-ml', 'ai-generation-persistence': 'ai-ml',
  'vercel': 'cloud-platform', 'netlify': 'cloud-platform', 'cloudflare': 'cloud-platform',
  'durable-objects': 'cloud-platform',
  'twilio-developer-kit': 'communication', 'zoom': 'communication',
  'slack': 'communication', 'teams': 'communication', 'outlook-email': 'communication',
  'hubspot': 'communication',
  'build-web-data-visualization': 'data', 'dashboards-and-real-time-visualization': 'data',
  'airtable-cli': 'data', 'airtable-filters': 'data', 'airtable-overview': 'data',
  'canvas2d-data-visualization': 'data', 'd3-data-visualization': 'data',
  'data-visualization': 'data', 'mixpanel-headless': 'data', 'deepnote': 'data',
  'canva': 'design', 'accessibility-and-inclusive-visualization': 'design',
  'liquid-glass': 'design', 'swiftui-liquid-glass': 'design', 'frontend-design': 'design',
  'build-macos-apps': 'development', 'build-web-apps': 'development',
  'build-run-debug': 'development', 'chrome-devtools-plugin': 'development',
  'react-best-practices': 'development', 'shadcn-best-practices': 'development',
  'stripe-best-practices': 'development', 'packaging-notarization': 'development',
  'signing-entitlements': 'development', 'appkit-interop': 'development',
  'frontend-app-builder': 'development', 'frontend-testing-debugging': 'development',
  'cli-creator': 'development', 'aspnet-core': 'development',
  'codex-expo-run-actions': 'development', 'latex': 'development', 'hyperframes': 'development',
  'daloopa': 'finance', 'morningstar': 'finance',
  'game-studio': 'game-dev',
  'expo': 'mobile', 'build-ios-apps': 'mobile', 'android-emulator-qa': 'mobile',
  'android-performance': 'mobile',
  'life-science-research': 'science',
  'codex-security': 'security',
  'outlook-calendar': 'productivity', 'sharepoint': 'productivity',
  'google-drive': 'productivity', 'linear': 'productivity',
  'google-calendar': 'productivity', 'atlassian-rovo': 'productivity',
  'superpowers': 'meta', 'plugin-dev': 'meta', 'plugin-eval': 'meta',
  'skill-creator': 'meta', 'skill-installer': 'meta',
  'nvidia': 'hardware', 'cardputer': 'hardware',
  'cloudflare-deploy': 'cloud-platform',
  // Additional plugins
  'airtable': 'data', 'atlassian-rovo': 'productivity', 'base44': 'data',
  'box': 'productivity', 'browser': 'development', 'chrome': 'development',
  'circleci': 'development', 'claude-code-setup': 'meta',
  'claude-md-management': 'meta', 'coderabbit': 'development',
  'codex': 'meta', 'computer-use': 'ai-ml', 'cwc-makers': 'development',
  'dnb-finance-analytics': 'finance', 'example-plugin': 'meta',
  'figma': 'design', 'github': 'development', 'gmail': 'communication',
  'heygen': 'ai-ml', 'hookify': 'meta', 'math-olympiad': 'science',
  'mcp-server-dev': 'meta', 'metabase': 'data',
  'modern-web-guidance-plugin': 'development', 'moody-s': 'finance',
  'neon-postgres': 'data', 'openai-developers': 'ai-ml',
  'playground': 'development', 'posthog': 'data', 'presentations': 'design',
  'remotion': 'design', 'render': 'cloud-platform', 'session-report': 'meta',
  'stripe': 'development', 'supabase': 'cloud-platform',
  'temporal': 'development', 'test-android-apps': 'mobile',
  'wix': 'design', 'zotero': 'science',
};

const SKILL_CATEGORY_OVERRIDES = {
  'linear': 'productivity', 'commit': 'development',
};

// Skill-specific tag overrides for edge cases that keyword matching misses
const SKILL_TAG_OVERRIDES = {
  'codex-result-handling': ['codex', 'agent', 'output', 'internal'],
  'notion-spec-to-implementation': ['notion', 'planning', 'task', 'spec', 'project-management'],
  'raphael-pet': ['image', 'sprite', 'generation', 'codex', 'pet'],
  'codex-cli-runtime': ['codex', 'cli', 'runtime', 'internal'],
};

// ============================================================================
// Plugin → Default Tags (applied to ALL skills from a given plugin)
// ============================================================================
const PLUGIN_TAGS = {
  'vercel': ['vercel', 'deployment', 'web'],
  'netlify': ['netlify', 'deployment', 'web', 'jamstack'],
  'cloudflare': ['cloudflare', 'workers', 'edge', 'serverless'],
  'twilio-developer-kit': ['twilio', 'api', 'communication'],
  'zoom': ['zoom', 'video', 'communication'],
  'slack': ['slack', 'messaging', 'communication'],
  'teams': ['teams', 'microsoft', 'communication'],
  'outlook-email': ['outlook', 'microsoft', 'email'],
  'outlook-calendar': ['outlook', 'microsoft', 'calendar', 'scheduling'],
  'sharepoint': ['sharepoint', 'microsoft', 'document'],
  'daloopa': ['finance', 'excel', 'modeling', 'valuation', 'investment'],
  'morningstar': ['finance', 'fund', 'etf', 'investment'],
  'build-web-data-visualization': ['visualization', 'data', 'web', 'chart'],
  'build-web-apps': ['web', 'frontend', 'react', 'nextjs'],
  'build-macos-apps': ['macos', 'swift', 'swiftui', 'desktop'],
  'build-ios-apps': ['ios', 'swift', 'swiftui', 'mobile'],
  'expo': ['expo', 'react-native', 'mobile', 'ios', 'android'],
  'game-studio': ['gamedev', 'browser', 'game'],
  'codex-security': ['security', 'audit', 'vulnerability'],
  'superpowers': ['workflow', 'agent', 'orchestration'],
  'plugin-dev': ['plugin', 'agent', 'development'],
  'life-science-research': ['science', 'bioinformatics', 'research', 'api'],
  'hugging-face': ['huggingface', 'ml', 'model', 'python'],
  'nvidia': ['nvidia', 'gpu', 'cuda', 'infrastructure'],
  'chrome-devtools-plugin': ['chrome', 'devtools', 'debugging', 'browser'],
  'cloudflare-deploy': ['cloudflare', 'deployment'],
  'test-android-apps': ['android', 'mobile', 'testing', 'qa', 'adb'],
  'chrome': ['chrome', 'browser', 'devtools'],
  'browser': ['browser', 'automation'],
  'github': ['github', 'git', 'code-review'],
  'circleci': ['ci-cd', 'deployment'],
  'temporal': ['workflow', 'orchestration'],
  'mcp-server-dev': ['mcp', 'agent', 'development'],
  'claude-code-setup': ['claude', 'configuration', 'setup'],
  'claude-md-management': ['claude', 'configuration'],
  'coderabbit': ['code-review', 'automation'],
  'openai-developers': ['openai', 'llm', 'api'],
  'computer-use': ['browser', 'automation', 'llm'],
  'posthog': ['analytics', 'monitoring', 'data'],
  'metabase': ['analytics', 'dashboard', 'data', 'sql'],
  'neon-postgres': ['postgres', 'database', 'serverless'],
  'figma': ['figma', 'design', 'ui-ux'],
  'canva': ['canva', 'design'],
  'remotion': ['video', 'react', 'animation'],
  'presentations': ['presentation', 'design', 'slide'],
  'gmail': ['gmail', 'email', 'google'],
  'heygen': ['video', 'ai-ml', 'avatar'],
  'base44': ['data', 'api'],
  'dnb-finance-analytics': ['finance', 'analytics'],
  'moody-s': ['finance', 'analytics'],
  'hookify': ['hooks', 'plugin', 'automation'],
  'session-report': ['agent', 'reporting'],
  'math-olympiad': ['math', 'science'],
  'zotero': ['reference', 'research', 'bibliography'],
  'stripe': ['stripe', 'payment', 'api'],
  'render': ['deployment', 'hosting'],
  'supabase': ['supabase', 'database', 'authentication'],
  'box': ['storage', 'cloud'],
  'wix': ['wix', 'design', 'web'],
  'example-plugin': ['plugin', 'tutorial'],
  'playground': ['development', 'experimentation'],
  'cwc-makers': ['development'],
  'modern-web-guidance-plugin': ['web', 'frontend', 'guidance'],
  'airtable': ['airtable', 'database', 'data'],
};

// ============================================================================
// Keyword → Tag mapping for description-based extraction
// ============================================================================
const KEYWORD_TAGS = [
  // Languages / Runtimes
  { re: /\btypescript\b/i, tag: 'typescript' },
  { re: /\bjavascript\b/i, tag: 'javascript' },
  { re: /\bpython\b/i, tag: 'python' },
  { re: /\bswift(?!UI)/i, tag: 'swift' },
  { re: /\bkotlin\b/i, tag: 'kotlin' },
  { re: /\bjava\b/i, tag: 'java' },
  { re: /\brust\b/i, tag: 'rust' },
  { re: /\bgolang\b|\bgo\b/i, tag: 'go' },
  { re: /\bcsharp\b|\.net\b|asp\.?net|blazor/i, tag: 'csharp' },
  { re: /\bruby\b/i, tag: 'ruby' },
  { re: /\bphp\b/i, tag: 'php' },
  { re: /\bnode\.?js\b|\bnode\b/i, tag: 'nodejs' },
  { re: /\bbun\b/i, tag: 'bun' },
  { re: /\blatex\b|tex\s/i, tag: 'latex' },
  { re: /\bmicropython\b/i, tag: 'micropython' },

  // Frontend frameworks
  { re: /\breact\b|next\.?js|nextjs/i, tag: 'react' },
  { re: /\bvue\b/i, tag: 'vue' },
  { re: /\bangular\b/i, tag: 'angular' },
  { re: /\bsvelte\b/i, tag: 'svelte' },
  { re: /\btailwind\b/i, tag: 'tailwind' },
  { re: /\bshadcn\b/i, tag: 'shadcn' },
  { re: /\bexpo\b/i, tag: 'expo' },
  { re: /\breact\s*native\b/i, tag: 'react-native' },
  { re: /\bflutter\b/i, tag: 'flutter' },
  { re: /\bswiftui\b/i, tag: 'swiftui' },
  { re: /\bthree\.?js\b|r3f|react\s*three\s*fiber/i, tag: 'threejs' },
  { re: /\bphaser\b/i, tag: 'phaser' },
  { re: /\bd3\.?js\b|\bd3\b/i, tag: 'd3' },
  { re: /\bcanvas\s*2d\b/i, tag: 'canvas' },
  { re: /\baspt\.?net|blazor|razor\s*pages|mvc\b/i, tag: 'aspnet' },

  // Backend / Infra
  { re: /\bgraphql\b/i, tag: 'graphql' },
  { re: /\brest\b/i, tag: 'rest' },
  { re: /\bwebsocket\b/i, tag: 'websocket' },
  { re: /\bgrpc\b/i, tag: 'grpc' },
  { re: /\bdocker\b/i, tag: 'docker' },
  { re: /\bkubernetes\b|k8s/i, tag: 'kubernetes' },
  { re: /\bterraform\b/i, tag: 'terraform' },
  { re: /\bpostgres\b/i, tag: 'postgres' },
  { re: /\bmysql\b/i, tag: 'mysql' },
  { re: /\bmongodb\b/i, tag: 'mongodb' },
  { re: /\bredis\b/i, tag: 'redis' },
  { re: /\bsqlite\b/i, tag: 'sqlite' },
  { re: /\bprisma\b/i, tag: 'prisma' },
  { re: /\bdrizzle\b/i, tag: 'drizzle' },
  { re: /\bsupabase\b/i, tag: 'supabase' },
  { re: /\bfirebase\b/i, tag: 'firebase' },
  { re: /\bdatabase\b|\bdb\b|\bsql\b/i, tag: 'database' },
  { re: /\bcdn\b/i, tag: 'cdn' },
  { re: /\bcaching\b|\bcache\b/i, tag: 'caching' },
  { re: /\bstorage\b|blob/i, tag: 'storage' },
  { re: /\bedge\b/i, tag: 'edge' },
  { re: /\bserverless\b/i, tag: 'serverless' },
  { re: /\bworkers\b/i, tag: 'workers' },

  // Services / APIs
  { re: /\bvercel\b/i, tag: 'vercel' },
  { re: /\bnetlify\b/i, tag: 'netlify' },
  { re: /\bcloudflare\b/i, tag: 'cloudflare' },
  { re: /\bgithub\b/i, tag: 'github' },
  { re: /\bgitlab\b/i, tag: 'gitlab' },
  { re: /\bstripe\b/i, tag: 'stripe' },
  { re: /\btwilio\b/i, tag: 'twilio' },
  { re: /\bslack\b/i, tag: 'slack' },
  { re: /\bzoom\b/i, tag: 'zoom' },
  { re: /\bteams\b|microsoft\s*teams/i, tag: 'teams' },
  { re: /\boutlook\b/i, tag: 'outlook' },
  { re: /\bsharepoint\b/i, tag: 'sharepoint' },
  { re: /\bhubspot\b/i, tag: 'hubspot' },
  { re: /\blinear\b/i, tag: 'linear' },
  { re: /\bairtable\b/i, tag: 'airtable' },
  { re: /\bcanva\b/i, tag: 'canva' },
  { re: /\bfigma\b/i, tag: 'figma' },
  { re: /\bopenai\b/i, tag: 'openai' },
  { re: /\banthropic\b/i, tag: 'anthropic' },
  { re: /\bclaude\b/i, tag: 'claude' },
  { re: /\bhugging\s*face\b/i, tag: 'huggingface' },
  { re: /\bgoogle\s*drive\b/i, tag: 'google-drive' },
  { re: /\bgoogle\s*calendar\b/i, tag: 'google-calendar' },
  { re: /\batlassian\b|jira|confluence/i, tag: 'atlassian' },
  { re: /\bdeepnote\b/i, tag: 'deepnote' },
  { re: /\bmixpanel\b/i, tag: 'mixpanel' },
  { re: /\bsentry\b/i, tag: 'sentry' },
  { re: /\bdatadog\b/i, tag: 'datadog' },
  { re: /\buniprot\b/i, tag: 'uniprot' },
  { re: /\balphafold\b/i, tag: 'alphafold' },
  { re: /\bbiorxiv\b|medrxiv/i, tag: 'biorxiv' },

  // Domains / Functions
  { re: /\bfrontend\b/i, tag: 'frontend' },
  { re: /\bbackend\b/i, tag: 'backend' },
  { re: /\bfullstack\b/i, tag: 'fullstack' },
  { re: /\bmobile\b/i, tag: 'mobile' },
  { re: /\bdesktop\b/i, tag: 'desktop' },
  { re: /\bweb\b/i, tag: 'web' },
  { re: /\bcli\b/i, tag: 'cli' },
  { re: /\bsdk\b/i, tag: 'sdk' },
  { re: /\bapi\b/i, tag: 'api' },
  { re: /\bmcp\b/i, tag: 'mcp' },
  { re: /\bdeploy/i, tag: 'deployment' },
  { re: /\bdebug\b|\bdebugging\b/i, tag: 'debugging' },
  { re: /\btest(?:ing|s)?\b/i, tag: 'testing' },
  { re: /\bmonitoring\b|\bmonitor\b|\bobservability\b/i, tag: 'monitoring' },
  { re: /\bsecurity\b|\bsecure\b|\bvulnerab/i, tag: 'security' },
  { re: /\bauthentication\b|\bauth\b|\boauth\b|\blogin\b|sso\b/i, tag: 'authentication' },
  { re: /\baccessibility\b|a11y/i, tag: 'accessibility' },
  { re: /\bperformance\b|profiling\b|optimization\b|\bperf\b/i, tag: 'performance' },
  { re: /\bci\/cd\b|\bcicd\b|workflow/i, tag: 'ci-cd' },
  { re: /\bscaffold/i, tag: 'scaffolding' },
  { re: /\bgenerat(?:e|or)\b/i, tag: 'code-generation' },
  { re: /\bnotariz/i, tag: 'notarization' },
  { re: /\bsigning\b/i, tag: 'code-signing' },
  { re: /\bdesign\b/i, tag: 'design' },
  { re: /\bui\b|\bux\b/i, tag: 'ui-ux' },
  { re: /\bsearch\b/i, tag: 'search' },
  { re: /\bfilter\b/i, tag: 'filtering' },
  { re: /\bnotification/i, tag: 'notifications' },
  { re: /\bmessage|messaging\b|sms\b|mms\b/i, tag: 'messaging' },
  { re: /\bvoice\b|\bcall\b|phone\b/i, tag: 'voice' },
  { re: /\bvideo\b/i, tag: 'video' },
  { re: /\bemail\b/i, tag: 'email' },
  { re: /\bcalendar\b|scheduling\b/i, tag: 'calendar' },
  { re: /\bdocument\b|\bdoc\b/i, tag: 'document' },
  { re: /\bpowerpoint\b|\.pptx/i, tag: 'powerpoint' },
  { re: /\bexcel\b|\.xlsx|spreadsheet/i, tag: 'excel' },
  { re: /\breport\b/i, tag: 'reporting' },
  { re: /\bdashboard\b/i, tag: 'dashboard' },
  { re: /\bvisualization\b/i, tag: 'visualization' },
  { re: /\banalytics\b/i, tag: 'analytics' },
  { re: /\bfinancial model\b|modeling\b/i, tag: 'modeling' },
  { re: /\bfinancial\b|finance\b|trading\b|valuation\b/i, tag: 'finance' },
  { re: /\bresearch\b/i, tag: 'research' },
  { re: /\bscience\b|scientific\b|\bbioinformatics\b|\bgene\b|\bprotein\b/i, tag: 'science' },
  { re: /\bgame\b|gaming\b|playtest\b/i, tag: 'gamedev' },
  { re: /\bplugin\b/i, tag: 'plugin' },
  { re: /\bagent\b/i, tag: 'agent' },
  { re: /\bskill\b/i, tag: 'skill-dev' },
  { re: /\bhook\b/i, tag: 'hooks' },
  { re: /\bcommand\b/i, tag: 'slash-command' },
  { re: /\bconfiguration\b|config\b|settings?\b/i, tag: 'configuration' },
  { re: /\bmigration\b/i, tag: 'migration' },
  { re: /\bautomation\b/i, tag: 'automation' },
  { re: /\borchestrat/i, tag: 'orchestration' },
  { re: /\bworkflow\b/i, tag: 'workflow' },
  { re: /\bchat\b|conversation/i, tag: 'chat' },
  { re: /\bbot\b/i, tag: 'bot' },
  { re: /\bllm\b|large\s*language\b|\bgpt\b|\bai\b/i, tag: 'llm' },
  { re: /\bembedding\b/i, tag: 'embeddings' },
  { re: /\btraining\b|fine-?tun/i, tag: 'training' },
  { re: /\bevaluation\b|\beval\b/i, tag: 'evaluation' },
  { re: /\bbrowser\b/i, tag: 'browser' },
  { re: /\bxcode\b/i, tag: 'xcode' },
  { re: /\bsimulator\b/i, tag: 'simulator' },
  { re: /\badb\b/i, tag: 'adb' },
  { re: /\barchiving\b/i, tag: 'archiving' },
  { re: /\breview\b/i, tag: 'code-review' },
  { re: /\bmerge\b|pull\s*request\b|\bpr\b/i, tag: 'pull-request' },
  { re: /\bgit\b/i, tag: 'git' },
  { re: /\bgpu\b/i, tag: 'gpu' },
  { re: /\bcuda\b/i, tag: 'cuda' },
  { re: /\bnvidia\b/i, tag: 'nvidia' },
  { re: /\biot\b/i, tag: 'iot' },
  { re: /\bexpress(?:ion)?\b/i, tag: 'gene-expression' },
  { re: /\bpreprint\b/i, tag: 'preprint' },
  { re: /\bphenotype\b|\bphewas\b/i, tag: 'phenotype' },
  { re: /\bbiobank\b/i, tag: 'biobank' },
  { re: /\bgwas\b/i, tag: 'gwas' },
  { re: /\bvariant\b/i, tag: 'variant' },
  { re: /\bligand\b|\bbinding\b/i, tag: 'binding' },
  { re: /\bpubmed\b|pubtator/i, tag: 'pubmed' },
  { re: /\bdiff\b/i, tag: 'diff' },
  { re: /\bpatch\b/i, tag: 'patch' },
  { re: /\bnotion\b/i, tag: 'notion' },
  { re: /\bsprite/i, tag: 'sprite' },
  { re: /\bimage\b/i, tag: 'image' },
  { re: /\bpet\b/i, tag: 'pet' },
  { re: /\bplanning\b/i, tag: 'planning' },
  { re: /\bspec\b|specification/i, tag: 'spec' },
  { re: /\bproject management\b/i, tag: 'project-management' },
  { re: /\bavatar\b/i, tag: 'avatar' },
  { re: /\banimation\b/i, tag: 'animation' },
];

// ============================================================================
// Tag Generation
// ============================================================================

function generateTags(id, skillDesc, plugin) {
  const tags = new Set();

  // 1. Plugin-based default tags
  if (plugin && PLUGIN_TAGS[plugin]) {
    for (const t of PLUGIN_TAGS[plugin]) tags.add(t);
  }

  // 2. Description-based keyword extraction
  if (skillDesc) {
    const d = skillDesc.toLowerCase();
    for (const { re, tag } of KEYWORD_TAGS) {
      if (re.test(d)) tags.add(tag);
    }
  }

  // 3. Skill-name heuristics
  const lowerId = id.toLowerCase();
  if (/\bdebug\b/.test(lowerId)) tags.add('debugging');
  if (/\btest\b/.test(lowerId)) tags.add('testing');
  if (/\bdeploy\b/.test(lowerId)) tags.add('deployment');
  if (/\bbuild\b/.test(lowerId)) tags.add('build');
  if (/\bmonitor\b/.test(lowerId)) tags.add('monitoring');
  if (/\bscan\b/.test(lowerId)) tags.add('scanning');
  if (/\bsecurity\b/.test(lowerId)) tags.add('security');
  if (/\bfix\b/.test(lowerId)) tags.add('fix');
  if (/\bperformance\b/.test(lowerId)) tags.add('performance');
  if (/\bprofile\b/.test(lowerId)) tags.add('profiling');

  // Remove overly generic tags that add noise
  const noiseTags = new Set(['api', 'web', 'data', 'build', 'config', 'search', 'filtering', 'cli']);
  const filtered = [...tags].filter(t => {
    // Keep if not in noise set OR if it's the primary function of the skill
    if (!noiseTags.has(t)) return true;
    // For noise tags, only keep if they appear in the id
    return lowerId.includes(t);
  });

  // Limit to 10 tags max
  return filtered.slice(0, 10);
}

// ============================================================================
// Helpers
// ============================================================================

function guessCategory(id, desc) {
  if (!desc) return undefined;
  const d = desc.toLowerCase();
  if (/ai|llm|machine learning|model|gpt|claude|token|prompt|embedding|chatbot/.test(d)) return 'ai-ml';
  if (/deploy|hosting|vercel|netlify|cloudflare|worker|edge|serverless/.test(d)) return 'cloud-platform';
  if (/message|chat|call|voice|sms|phone|meeting|email|calendar|notification|communicat/.test(d)) return 'communication';
  if (/chart|graph|visualiz|dashboard|data|analytics|report|query|database|sql|airtable/.test(d)) return 'data';
  if (/design|ui|ux|css|style|layout|theme|color|accessib|canva/.test(d)) return 'design';
  if (/build|debug|test|compile|package|deploy|cli|sdk|api|framework|library|npm|node|typescript|react|vue|swift/.test(d)) return 'development';
  if (/financ|trading|stock|portfolio|invest|capital|market|comps?|valuation/.test(d)) return 'finance';
  if (/game|playtest|sprite|phaser|unity|3d|render/.test(d)) return 'game-dev';
  if (/ios|android|expo|react native|mobile|swift|app store|play store/.test(d)) return 'mobile';
  if (/gene|protein|bio|science|research|lab|chemistry|physics|molecule|cell|dna/.test(d)) return 'science';
  if (/secur|vulnerab|exploit|attack|pentest|audit|threat|scan/.test(d)) return 'security';
  if (/task|todo|note|document|schedule|planner|organize|productivity|meeting|brief/.test(d)) return 'productivity';
  if (/skill|plugin|agent|hook|command|mcp server|config|setup|troubleshoot/.test(d)) return 'meta';
  if (/gpu|cuda|nvidia|hardware|device|driver|firmware|iot/.test(d)) return 'hardware';
  return undefined;
}

// ============================================================================
// Main
// ============================================================================

function main() {
  const catalogRaw = fs.readFileSync(catalogPath, 'utf8');
  const catalog = TOML.parse(catalogRaw);

  const output = { version: '1.0', skills: {} };
  let totalSkills = 0, categorizedSkills = 0;
  const categoryCounts = {};
  const tagCounts = {};
  let totalTags = 0;

  for (const [id, entry] of Object.entries(catalog.skills)) {
    totalSkills++;
    const tags = entry.tags || [];
    const scannedIdx = tags.indexOf('scanned');

    // Decompose source
    let sourceType, agent, plugin;
    if (scannedIdx >= 0 && tags.length > scannedIdx + 1) {
      const sourceTag = tags[scannedIdx + 1];
      const parts = sourceTag.split(':');
      if (parts[0] === 'plugin' && parts[1] === 'codex-bundled') {
        sourceType = 'bundled'; agent = 'codex';
        plugin = parts.length > 2 ? parts[2] : undefined;
      } else if (parts.length >= 2) {
        sourceType = parts[0]; agent = parts[1];
        if (parts[0] === 'plugin' && parts.length > 2) plugin = parts[parts.length - 1];
      }
    }

    // Read SKILL.md
    let category, version, author, updatedAt, skillDesc = '';
    let frontmatterTags = [];
    try {
      const skillPath = path.join(skillsDir, id, 'SKILL.md');
      const content = fs.readFileSync(skillPath, 'utf8');
      updatedAt = fs.statSync(skillPath).mtime.toISOString();
      const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (m) {
        try {
          const fm = YAML.parse(m[1]);
          if (fm) {
            if (fm.category) category = String(fm.category).slice(0, 100);
            if (fm.version) version = String(fm.version).slice(0, 50);
            if (fm.author) author = String(fm.author).slice(0, 200);
            if (fm.description) skillDesc = String(fm.description);
            if (Array.isArray(fm.tags)) frontmatterTags = fm.tags.map(String);
          }
        } catch {
          const descMatch = m[1].match(/description:\s*(.+)/);
          if (descMatch) skillDesc = descMatch[1].trim();
        }
      }
    } catch {}

    // Determine category
    if (!category) {
      if (SKILL_CATEGORY_OVERRIDES[id]) category = SKILL_CATEGORY_OVERRIDES[id];
    }
    if (!category && plugin && PLUGIN_CATEGORY[plugin]) {
      category = PLUGIN_CATEGORY[plugin];
    }
    if (!category) category = guessCategory(id, skillDesc);

    if (category) { categorizedSkills++; categoryCounts[category] = (categoryCounts[category] || 0) + 1; }

    // Generate tags: merge overrides + frontmatter tags + AI-generated tags
    const overrideTags = SKILL_TAG_OVERRIDES[id] || [];
    const generatedTags = generateTags(id, skillDesc, plugin);
    const mergedTags = new Set([...overrideTags, ...frontmatterTags, ...generatedTags]);
    const finalTags = [...mergedTags].sort();

    for (const t of finalTags) { tagCounts[t] = (tagCounts[t] || 0) + 1; totalTags++; }

    output.skills[id] = {
      sourceType: sourceType || undefined,
      agent: agent || undefined,
      plugin: plugin || undefined,
      category: category || undefined,
      version: version || undefined,
      author: author || undefined,
      updatedAt: updatedAt || undefined,
      pinned: undefined,
      deprecated: undefined,
      tags: finalTags.length > 0 ? finalTags : undefined,
    };
  }

  // Write output
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, TOML.stringify(output), 'utf8');

  // Report
  console.log(`Total skills: ${totalSkills}`);
  console.log(`Categorized: ${categorizedSkills} (${((categorizedSkills/totalSkills)*100).toFixed(1)}%)`);
  console.log(`Uncategorized: ${totalSkills - categorizedSkills}`);
  console.log(`Total tags assigned: ${totalTags}`);
  console.log(`Unique tags: ${Object.keys(tagCounts).length}`);
  console.log(`Avg tags/skill: ${(totalTags/totalSkills).toFixed(1)}`);
  console.log(`\nCategory distribution:`);
  Object.entries(categoryCounts).sort((a,b) => b[1]-a[1]).forEach(([c,n]) => console.log(`  ${c}: ${n}`));
  console.log(`\nTop 40 tags:`);
  Object.entries(tagCounts).sort((a,b) => b[1]-a[1]).slice(0,40).forEach(([t,n]) => console.log(`  ${t}: ${n}`));
  console.log(`\nWritten to: ${outputPath}`);
}

main();
