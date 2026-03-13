// ============================================================================
// Skills Directory Registry Client
// ============================================================================

/**
 * Search the skills.directory registry for skills.
 */
export async function searchSkills(query: string): Promise<RegistrySkill[]> {
  const url = `https://api.skills-directory.com/v1/search?q=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Registry search failed: ${response.status}`);
    }

    const data = await response.json();
    return data.skills || [];
  } catch (error) {
    console.error(`Failed to search registry: ${error}`);
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
      throw new Error(`Registry fetch failed: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`Failed to fetch skill info: ${error}`);
    return null;
  }
}

/**
 * Download a skill's SKILL.md content from GitHub.
 */
export async function downloadSkillContent(githubUrl: string): Promise<string> {
  // Parse GitHub URL to extract raw content URL
  const rawUrl = githubUrl.replace('github.com', 'raw.githubusercontent.com')
    .replace('/blob/', '/')
    .replace('/tree/', '/');

  // Ensure we point to SKILL.md
  const skillUrl = rawUrl.endsWith('SKILL.md') ? rawUrl : `${rawUrl}/SKILL.md`;

  try {
    const response = await fetch(skillUrl);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    return await response.text();
  } catch (error) {
    throw new Error(`Failed to download skill: ${error}`);
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
