// ============================================================================
// Skills Directory Registry Client
// ============================================================================

/** Maximum size for skill content (1MB) */
const MAX_SKILL_SIZE = 1024 * 1024;

/**
 * Validate that a URL is from GitHub.
 */
function validateGitHubUrl(inputUrl: string): boolean {
  try {
    const url = new URL(inputUrl);
    const allowedHosts = ['github.com', 'raw.githubusercontent.com', 'www.github.com'];
    return allowedHosts.includes(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Search the skills.directory registry for skills.
 */
export async function searchSkills(query: string): Promise<RegistrySkill[]> {
  const url = `https://api.skills-directory.com/v1/search?q=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Registry search failed');
    }

    const data = await response.json();
    return data.skills || [];
  } catch (error) {
    console.error('Failed to search registry. Please try again later.');
    return [];
  }
}

/**
 * Get detailed information about a skill from the registry.
 */
export async function getSkillInfo(skillName: string): Promise<RegistrySkillInfo | null> {
  const url = `https://api.skills-directory.com/v1/skills/${encodeURIComponent(skillName)}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error('Registry fetch failed');
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to fetch skill info. Please try again later.');
    return null;
  }
}

/**
 * Download a skill's SKILL.md content from GitHub.
 */
export async function downloadSkillContent(githubUrl: string): Promise<string> {
  // Validate URL is from GitHub
  if (!validateGitHubUrl(githubUrl)) {
    throw new Error('Only GitHub URLs are allowed');
  }

  // Parse GitHub URL to extract raw content URL
  const rawUrl = githubUrl.replace('github.com', 'raw.githubusercontent.com')
    .replace('/blob/', '/')
    .replace('/tree/', '/');

  // Ensure we point to SKILL.md
  const skillUrl = rawUrl.endsWith('SKILL.md') ? rawUrl : `${rawUrl}/SKILL.md`;

  // Validate final URL is still from GitHub
  if (!validateGitHubUrl(skillUrl)) {
    throw new Error('Invalid GitHub URL structure');
  }

  try {
    const response = await fetch(skillUrl);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    // Check content length
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_SKILL_SIZE) {
      throw new Error('Skill file too large');
    }

    const content = await response.text();

    // Double-check actual content size
    if (content.length > MAX_SKILL_SIZE) {
      throw new Error('Skill file too large');
    }

    return content;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message.includes('Only GitHub') || message.includes('Invalid GitHub')) {
      throw new Error(message);
    }
    // A 404 here almost always means the repository moved the skill rather than
    // that the user mistyped: the URL came from the catalog, where it worked
    // when the skill was installed. Saying "check the URL" sent people looking
    // in the wrong place.
    if (message.includes('404')) {
      throw new Error(
        `${skillUrl} is gone (404). The repository has moved or removed this ` +
          `skill; find its new path and reinstall from there.`
      );
    }
    throw new Error(`Could not download ${skillUrl}: ${message}`);
  }
}

/**
 * Every file in a skill directory on GitHub, as paths relative to it.
 *
 * A skill is a directory: SKILL.md is the entry point, and the references,
 * scripts and assets beside it are what the instructions point at. Fetching
 * only SKILL.md leaves a skill whose own instructions refer to files that are
 * not there — the same defect that cost 522 catalog skills 3,533 files when
 * plugins were imported.
 *
 * Returns null when the layout cannot be read, so the caller can still install
 * the SKILL.md it already has.
 */
export async function listSkillDirectory(
  githubUrl: string
): Promise<{ path: string; size: number }[] | null> {
  const parsed = githubUrl.match(
    /github\.com\/([^/]+)\/([^/]+)\/(?:tree|blob)\/([^/]+)\/(.+?)\/?$/
  );
  if (!parsed) return null;

  const [, owner, repo, ref, directory] = parsed;
  const base = directory.replace(/\/SKILL\.md$/, '');

  // The recursive tree is one request for any depth, and it is the only
  // endpoint that does not need a request per subdirectory.
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`;

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return null;

    const tree = (await response.json())?.tree;
    if (!Array.isArray(tree)) return null;

    const prefix = `${base}/`;
    return tree
      .filter((node: any) => node.type === 'blob' && node.path.startsWith(prefix))
      .map((node: any) => ({ path: node.path.slice(prefix.length), size: node.size ?? 0 }));
  } catch {
    return null;
  }
}

/** Fetch one file from a skill directory on GitHub. */
export async function downloadSkillFile(
  githubUrl: string,
  relativePath: string
): Promise<Buffer | null> {
  const base = githubUrl
    .replace('github.com', 'raw.githubusercontent.com')
    .replace('/blob/', '/')
    .replace('/tree/', '/')
    .replace(/\/SKILL\.md$/, '')
    .replace(/\/$/, '');

  const url = `${base}/${relativePath}`;
  if (!validateGitHubUrl(url)) return null;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Install a skill from GitHub URL.
 */
export async function installFromGitHub(
  githubUrl: string,
  skillName?: string
): Promise<{ name: string; content: string }> {
  // Fetch the repository info to get the default branch if needed
  const content = await downloadSkillContent(githubUrl);

  // Parse the skill name from the content if not provided
  if (!skillName) {
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    if (nameMatch) {
      skillName = nameMatch[1].trim().replace(/^["']|["']$/g, '');
    } else {
      // Extract from GitHub URL
      const urlMatch = githubUrl.match(/\/skills\/([^\/]+)/);
      skillName = urlMatch ? urlMatch[1] : 'unknown-skill';
    }
  }

  return { name: skillName, content };
}

// ============================================================================
// Types
// ============================================================================

export interface RegistrySkill {
  name: string;
  description: string;
  version: string;
  author: string;
  verticals: string[];
  stars: number;
  installs: number;
  repo: string;
  skill_md: string;
}

export interface RegistrySkillInfo {
  name: string;
  description: string;
  author: string;
  verticals: string[];
  updated: string;
  stars: number;
  installs: number;
  repo: string;
  skill_md: string;
  installation: {
    local: boolean;
    global: string;
  };
  links: {
    repo: string;
    skill_md: string;
  };
}
