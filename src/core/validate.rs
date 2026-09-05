use crate::types::{IssueSeverity, ValidationIssue};
use regex::Regex;
use std::path::Path;
use std::sync::OnceLock;

static SKILL_NAME_RE: OnceLock<Regex> = OnceLock::new();
static FRONTMATTER_RE: OnceLock<Regex> = OnceLock::new();

/// Validate a skill name to prevent path traversal and shell issues
pub fn validate_skill_name(name: &str) -> anyhow::Result<()> {
    if name.is_empty() {
        anyhow::bail!("Skill name cannot be empty");
    }
    if name.len() > 100 {
        anyhow::bail!("Skill name too long (max 100 characters)");
    }

    let re = SKILL_NAME_RE.get_or_init(|| Regex::new(r"^[a-zA-Z0-9._-]+$").unwrap());
    if !re.is_match(name) {
        anyhow::bail!(
            "Skill name must contain only alphanumeric characters, hyphens, underscores, and dots"
        );
    }

    if name.contains("..") || name.contains('/') || name.contains('\\') {
        anyhow::bail!("Skill name cannot contain path traversal characters");
    }

    if name.starts_with('.') || name.starts_with('-') || name.ends_with('.') || name.ends_with('-')
    {
        anyhow::bail!("Skill name cannot start or end with a dot or dash");
    }

    Ok(())
}

/// Validate SKILL.md Frontmatter (Proposal 4)
pub fn validate_skill_directory<P: AsRef<Path>>(
    skill_dir: P,
) -> anyhow::Result<Vec<ValidationIssue>> {
    let dir = skill_dir.as_ref();
    let mut issues = Vec::new();

    if !dir.exists() || !dir.is_dir() {
        issues.push(ValidationIssue {
            severity: IssueSeverity::Error,
            message: format!("Directory does not exist: {}", dir.display()),
        });
        return Ok(issues);
    }

    let skill_md = dir.join("SKILL.md");
    if !skill_md.exists() {
        issues.push(ValidationIssue {
            severity: IssueSeverity::Error,
            message: "Missing required SKILL.md file".to_string(),
        });
        return Ok(issues);
    }

    let content = match std::fs::read_to_string(&skill_md) {
        Ok(c) => c,
        Err(e) => {
            issues.push(ValidationIssue {
                severity: IssueSeverity::Error,
                message: format!("Cannot read SKILL.md: {}", e),
            });
            return Ok(issues);
        }
    };

    let dir_name = dir.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let frontmatter_issues = validate_skill_content(&content, dir_name);
    issues.extend(frontmatter_issues);

    Ok(issues)
}

/// Validate SKILL.md content & frontmatter
pub fn validate_skill_content(content: &str, expected_dir_name: &str) -> Vec<ValidationIssue> {
    let mut issues = Vec::new();

    let re = FRONTMATTER_RE
        .get_or_init(|| Regex::new(r"(?s)^---\r?\n(.*?)\r?\n---(?:\r?\n(.*))?$").unwrap());

    let caps = match re.captures(content) {
        Some(c) => c,
        None => {
            issues.push(ValidationIssue {
                severity: IssueSeverity::Error,
                message: "Missing YAML Frontmatter (must start with '---' and end with '---')"
                    .to_string(),
            });
            return issues;
        }
    };

    let yaml_text = caps.get(1).map_or("", |m| m.as_str());
    let parsed: Result<serde_yaml::Value, _> = serde_yaml::from_str(yaml_text);

    match parsed {
        Err(e) => {
            issues.push(ValidationIssue {
                severity: IssueSeverity::Error,
                message: format!("Invalid YAML syntax in Frontmatter: {}", e),
            });
            return issues;
        }
        Ok(val) => {
            // Check 'name' field
            if let Some(name_val) = val.get("name") {
                if let Some(name) = name_val.as_str() {
                    if let Err(e) = validate_skill_name(name) {
                        issues.push(ValidationIssue {
                            severity: IssueSeverity::Error,
                            message: format!("Invalid 'name' in frontmatter: {}", e),
                        });
                    }
                    if !expected_dir_name.is_empty() && name != expected_dir_name {
                        issues.push(ValidationIssue {
                            severity: IssueSeverity::Warning,
                            message: format!(
                                "Skill name '{}' does not match directory name '{}'",
                                name, expected_dir_name
                            ),
                        });
                    }
                } else {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Error,
                        message: "'name' field in frontmatter must be a string".to_string(),
                    });
                }
            } else {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Error,
                    message: "Missing required 'name' field in frontmatter".to_string(),
                });
            }

            // Check 'description' field
            if let Some(desc_val) = val.get("description") {
                if let Some(desc) = desc_val.as_str() {
                    let trimmed = desc.trim();
                    if trimmed.is_empty() {
                        issues.push(ValidationIssue {
                            severity: IssueSeverity::Error,
                            message: "'description' in frontmatter cannot be empty".to_string(),
                        });
                    } else if trimmed.len() < 20 {
                        issues.push(ValidationIssue {
                            severity: IssueSeverity::Warning,
                            message: format!(
                                "Short description ({} chars). Recommended: 50-300 characters for agent discovery.",
                                trimmed.len()
                            ),
                        });
                    } else if trimmed.len() > 500 {
                        issues.push(ValidationIssue {
                            severity: IssueSeverity::Warning,
                            message: format!(
                                "Long description ({} chars). Recommended: <= 500 characters.",
                                trimmed.len()
                            ),
                        });
                    }
                } else {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Error,
                        message: "'description' field in frontmatter must be a string".to_string(),
                    });
                }
            } else {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Error,
                    message: "Missing required 'description' field in frontmatter".to_string(),
                });
            }
        }
    }

    issues
}
