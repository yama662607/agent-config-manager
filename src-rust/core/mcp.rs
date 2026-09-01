use crate::adapters::{add_mcp_to_config, get_mcp_servers, remove_mcp_from_config, set_mcp_enabled};
use crate::catalog::catalog::get_mcp;
use crate::paths::get_agent_mcp_config_path;
use crate::types::{McpRecipe, McpStatus, McpWorkspaceStatus, TargetName};
use std::collections::HashMap;
use std::path::Path;

/// Get MCP workspace status across all specified targets
pub fn get_mcp_workspace_status<P: AsRef<Path>>(
    project_root: P,
    targets: &[TargetName],
) -> anyhow::Result<McpWorkspaceStatus> {
    let root = project_root.as_ref();
    let mut server_map: HashMap<String, McpStatus> = HashMap::new();

    for &target in targets {
        let config_path = get_agent_mcp_config_path(root, target);
        let servers = get_mcp_servers(target, &config_path)?;

        for (name, info) in servers {
            let entry = server_map.entry(name.clone()).or_insert_with(|| McpStatus {
                name: name.clone(),
                enabled: info.enabled,
                targets: Vec::new(),
                recipe: info.recipe.clone().unwrap_or_default(),
            });

            if !entry.targets.contains(&target) {
                entry.targets.push(target);
            }
            if info.enabled {
                entry.enabled = true;
            }
            if entry.recipe.command.is_none() && entry.recipe.url.is_none() {
                if let Some(r) = info.recipe {
                    entry.recipe = r;
                }
            }
        }
    }

    let mut servers: Vec<_> = server_map.into_values().collect();
    servers.sort_by(|a, b| a.name.cmp(&b.name));
    let enabled_count = servers.iter().filter(|s| s.enabled).count();
    let total_count = servers.len();

    Ok(McpWorkspaceStatus {
        project_root: root.display().to_string(),
        servers,
        total_count,
        enabled_count,
    })
}

/// Add an MCP server to specified targets
pub fn mcp_add<P: AsRef<Path>>(
    project_root: P,
    package_id: &str,
    targets: &[TargetName],
    custom_recipe: Option<&McpRecipe>,
) -> anyhow::Result<()> {
    let root = project_root.as_ref();

    let recipe = if let Some(r) = custom_recipe {
        r.clone()
    } else if let Some(cat_entry) = get_mcp(package_id)? {
        cat_entry.recipe
    } else {
        // Default npx recipe
        McpRecipe {
            command: Some("npx".to_string()),
            args: Some(vec!["-y".to_string(), package_id.to_string()]),
            url: None,
            cwd: None,
            env: None,
            transport: Some(crate::types::TransportType::Stdio),
        }
    };

    for &target in targets {
        let config_path = get_agent_mcp_config_path(root, target);
        add_mcp_to_config(target, &config_path, package_id, &recipe)?;
    }

    Ok(())
}

/// Remove an MCP server from specified targets
pub fn mcp_remove<P: AsRef<Path>>(
    project_root: P,
    server_name: &str,
    targets: &[TargetName],
) -> anyhow::Result<()> {
    let root = project_root.as_ref();
    for &target in targets {
        let config_path = get_agent_mcp_config_path(root, target);
        remove_mcp_from_config(target, &config_path, server_name)?;
    }
    Ok(())
}

/// Enable an MCP server on specified targets
pub fn mcp_enable<P: AsRef<Path>>(
    project_root: P,
    server_name: &str,
    targets: &[TargetName],
) -> anyhow::Result<()> {
    let root = project_root.as_ref();
    for &target in targets {
        let config_path = get_agent_mcp_config_path(root, target);
        set_mcp_enabled(target, &config_path, server_name, true)?;
    }
    Ok(())
}

/// Disable an MCP server on specified targets
pub fn mcp_disable<P: AsRef<Path>>(
    project_root: P,
    server_name: &str,
    targets: &[TargetName],
) -> anyhow::Result<()> {
    let root = project_root.as_ref();
    for &target in targets {
        let config_path = get_agent_mcp_config_path(root, target);
        set_mcp_enabled(target, &config_path, server_name, false)?;
    }
    Ok(())
}
