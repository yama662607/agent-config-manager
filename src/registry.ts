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
    throw new Error(`Failed to download skill. Check the URL and try again.`);
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
