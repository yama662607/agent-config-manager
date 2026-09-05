mod common;
use common::*;
use serde_json::{json, Value};
use std::fs;

fn plugin(f: &Fixture, id: &str) {
    f.file(
        &format!("sources/{id}/.claude-plugin/plugin.json"),
        &json!({"name":id,"version":"1.0.0","apps":{"test":{}},"hooks":{"custom":true}})
            .to_string(),
    );
    f.file(
        &format!("sources/{id}/skills/probe/SKILL.md"),
        "---\nname: probe\ndescription: Harmless native validation fixture.\n---\n",
    );
    f.ok(&[
        "plugin",
        "import",
        f.temp.path().join("sources").join(id).to_str().unwrap(),
    ]);
}

#[cfg(unix)]
fn providers(f: &Fixture) {
    use std::os::unix::fs::PermissionsExt;
    use std::process::Command;
    let python = Command::new("python3")
        .args(["-c", "import sys;print(sys.executable)"])
        .output()
        .unwrap();
    assert!(python.status.success());
    let script = format!(
        "#!{}\n{}",
        String::from_utf8(python.stdout).unwrap().trim(),
        r#"
import json,os,pathlib,subprocess,sys,time
home=pathlib.Path(os.environ['HOME']);name=pathlib.Path(sys.argv[0]).name;args=sys.argv[1:]
with (home/'native-calls.jsonl').open('a') as file:file.write(json.dumps([name]+args)+'\n')
if (home/('sleep-'+name)).exists():time.sleep(20)
if (home/('spawn-'+name)).exists():
 subprocess.Popen([sys.executable,'-c',"import pathlib,time;time.sleep(0.8);pathlib.Path("+repr(str(home/'orphan-wrote'))+").write_text('unexpected')"])
 time.sleep(20)
if (home/('large-'+name)).exists():print('x'*2000000);sys.exit(0)
if (home/('fail-'+name)).exists():print('token=private_fixture_credential',file=sys.stderr);sys.exit(19)
if args[:3]==['plugin','marketplace','add'] and (home/('duplicate-'+name)).exists():print('marketplace already added from a different source',file=sys.stderr);sys.exit(17)
if args==['plugin','marketplace','list','--json']:print((home/(name+'.marketplaces')).read_text());sys.exit(0)
if name=='grok' and len(args)>1 and args[1]=='install' and (home/'already-grok').exists():print('repo already installed',file=sys.stderr);sys.exit(17)
if name=='claude' and len(args)>1 and args[1]=='enable':print('already enabled at user scope',file=sys.stderr);sys.exit(17)
if len(args)>1 and args[1]=='enable' and (home/('fail-enable-'+name)).exists():sys.exit(18)
if args==['plugin','list','--json']:
 print((home/(name+'.listing')).read_text());sys.exit(0)
print('{}')
"#
    );
    for target in ["claude", "codex", "antigravity", "grok"] {
        let path = f.file(&format!("providers/{target}"), &script);
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }
}

#[cfg(unix)]
fn command(f: &Fixture, args: &[&str]) -> std::process::Command {
    let mut command = f.command();
    for target in ["claude", "codex", "antigravity", "grok"] {
        command.env(
            format!("ACM_{}_BIN", target.to_uppercase()),
            f.temp.path().join("providers").join(target),
        );
    }
    command.args(args).arg("--json");
    command
}

#[cfg(unix)]
fn output(f: &Fixture, args: &[&str], success: bool) -> Value {
    let output = command(f, args).output().unwrap();
    assert_eq!(
        output.status.success(),
        success,
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout)
        .unwrap_or_else(|error| panic!("{error}: {}", String::from_utf8_lossy(&output.stdout)))
}

#[cfg(unix)]
fn listing(f: &Fixture, target: &str, value: Value) {
    f.file(&format!("home/{target}.listing"), &value.to_string());
}

#[cfg(unix)]
#[test]
fn live_shapes_distinguish_installation_enabled_and_reconcile() {
    let f = Fixture::new();
    providers(&f);
    plugin(&f, "probe");
    listing(
        &f,
        "claude",
        json!([{ "id":"probe@acm-catalog", "scope":"user", "enabled":false }]),
    );
    listing(
        &f,
        "codex",
        json!({"installed":[{"pluginId":"probe@acm-catalog","name":"probe","marketplaceName":"acm-catalog","installed":true,"enabled":true}],"available":[]}),
    );
    listing(
        &f,
        "grok",
        json!([{"status":"installed","name":"probe","source":f.catalog.join("marketplace/plugins/probe"),"marketplace":null}]),
    );
    f.file("home/antigravity.listing", "No imported plugins.");
    let before = fs::read(f.catalog.join("plugins-metadata.toml")).unwrap();
    let report = output(
        &f,
        &["plugin", "verify", "probe", "--home", "-t", "all"],
        true,
    );
    let targets = report["plugins"][0]["targets"].as_array().unwrap();
    assert_eq!(targets[0]["state"], "disabled");
    assert_eq!(targets[1]["state"], "installed");
    assert_eq!(targets[2]["state"], "missing");
    assert_eq!(targets[3]["state"], "installed");
    assert!(targets[3]["enabled"].is_null());
    assert_eq!(
        fs::read(f.catalog.join("plugins-metadata.toml")).unwrap(),
        before
    );
    output(
        &f,
        &[
            "plugin",
            "verify",
            "probe",
            "--home",
            "-t",
            "all",
            "--reconcile",
        ],
        true,
    );
    let metadata = toml_file(&f.catalog.join("plugins-metadata.toml"));
    let installs = &metadata["plugins"]["probe"]["nativeInstallations"];
    assert_eq!(installs["claude:home"]["enabled"], false);
    assert_eq!(installs["codex:home"]["enabled"], true);
    assert!(installs["grok:home"].get("enabled").is_none());
    assert_eq!(
        f.json(&["plugin", "show", "probe", "--home", "-t", "grok"])["plugin"]["enabled"],
        false
    );
    assert!(installs.get("antigravity:home").is_none());
    let status = f.json(&["plugin", "show", "probe", "--home", "-t", "claude"]);
    assert_eq!(status["plugin"]["enabled"], false);
    assert_eq!(status["plugin"]["placement"]["claude"], "disabled");
    fs::remove_file(f.home.join("native-calls.jsonl")).unwrap();
    output(
        &f,
        &["plugin", "update", "probe", "--home", "-t", "claude,grok"],
        true,
    );
    assert!(
        !f.home.join("native-calls.jsonl").exists(),
        "disabled and newly observed enabled-unknown installations must not be activated by update"
    );
}

#[cfg(unix)]
#[test]
fn unknown_and_ambiguous_observations_never_erase_records_and_query_once() {
    let f = Fixture::new();
    providers(&f);
    plugin(&f, "probe");
    plugin(&f, "second");
    output(
        &f,
        &["plugin", "install", "probe", "-t", "codex,grok,antigravity"],
        true,
    );
    let before = fs::read(f.catalog.join("plugins-metadata.toml")).unwrap();
    listing(&f, "codex", json!({"new_schema":[]}));
    listing(
        &f,
        "grok",
        json!([{"status":"installed","name":"probe","source":"/unrelated/plugin"}]),
    );
    listing(
        &f,
        "antigravity",
        json!({"imports":[{"name":"probe","source":"antigravity","components":["skills"]}]}),
    );
    fs::remove_file(f.home.join("native-calls.jsonl")).unwrap();
    let report = output(
        &f,
        &[
            "plugin",
            "verify",
            "probe",
            "second",
            "--reconcile",
            "-t",
            "codex,grok,antigravity",
        ],
        false,
    );
    assert_eq!(report["error"]["code"], "verification_unknown");
    for target in report["plugins"][0]["targets"].as_array().unwrap() {
        assert_eq!(target["state"], "unknown");
    }
    assert_eq!(
        fs::read(f.catalog.join("plugins-metadata.toml")).unwrap(),
        before
    );
    assert_eq!(
        fs::read_to_string(f.home.join("native-calls.jsonl"))
            .unwrap()
            .lines()
            .count(),
        3
    );
}

#[cfg(unix)]
#[test]
fn claude_scope_and_marketplace_are_part_of_identity() {
    let f = Fixture::new();
    providers(&f);
    plugin(&f, "probe");
    output(
        &f,
        &["plugin", "install", "probe", "--project", "-t", "claude"],
        true,
    );
    listing(
        &f,
        "claude",
        json!([
          {"id":"probe@acm-catalog","scope":"user","enabled":true},
          {"id":"probe@acm-catalog","scope":"project","projectPath":f.temp.path().join("another-project"),"enabled":false},
          {"id":"probe@other-marketplace","scope":"project","projectPath":f.project,"enabled":true}
        ]),
    );
    let report = output(
        &f,
        &[
            "plugin",
            "verify",
            "probe",
            "--project",
            "-t",
            "claude",
            "--reconcile",
        ],
        true,
    );
    assert_eq!(report["plugins"][0]["targets"][0]["state"], "missing");
    let installs = &toml_file(&f.catalog.join("plugins-metadata.toml"))["plugins"]["probe"]
        ["nativeInstallations"];
    assert!(installs.as_object().unwrap().is_empty());
    let row =
        json!({"id":"probe@acm-catalog","scope":"project","projectPath":f.project,"enabled":true});
    listing(&f, "claude", json!([row, row]));
    assert_eq!(
        output(
            &f,
            &[
                "plugin",
                "verify",
                "probe",
                "--project",
                "-t",
                "claude",
                "--reconcile"
            ],
            false
        )["plugins"][0]["targets"][0]["state"],
        "unknown"
    );
}

#[cfg(unix)]
#[test]
fn provider_limits_errors_and_explicit_executable_selection() {
    let f = Fixture::new();
    providers(&f);
    plugin(&f, "probe");
    f.file("home/fail-codex", "true");
    let report = output(&f, &["plugin", "verify", "probe", "-t", "codex"], false);
    assert!(!report.to_string().contains("private_fixture_credential"));
    fs::remove_file(f.home.join("fail-codex")).unwrap();
    f.file("home/large-codex", "true");
    let report = output(&f, &["plugin", "verify", "probe", "-t", "codex"], false);
    assert!(report.to_string().contains("limit"));
    fs::remove_file(f.home.join("large-codex")).unwrap();
    f.file("home/sleep-codex", "true");
    let start = std::time::Instant::now();
    let result = command(&f, &["plugin", "verify", "probe", "-t", "codex"])
        .env("ACM_PROVIDER_TIMEOUT_MS", "100")
        .output()
        .unwrap();
    assert!(!result.status.success());
    assert!(start.elapsed() < std::time::Duration::from_secs(3));
    assert!(String::from_utf8_lossy(&result.stdout).contains("timed out"));
    fs::remove_file(f.home.join("sleep-codex")).unwrap();
    f.file("home/spawn-codex", "true");
    let result = command(&f, &["plugin", "verify", "probe", "-t", "codex"])
        .env("ACM_PROVIDER_TIMEOUT_MS", "100")
        .output()
        .unwrap();
    assert!(!result.status.success());
    std::thread::sleep(std::time::Duration::from_secs(1));
    assert!(
        !f.home.join("orphan-wrote").exists(),
        "timeout must stop installer descendants"
    );
    fs::remove_file(f.home.join("spawn-codex")).unwrap();
    listing(&f, "codex", json!({"installed":[],"available":[]}));
    f.file(
        "home/.acm/config.toml",
        &format!(
            "[provider_commands]\ncodex = {:?}\n",
            f.temp.path().join("providers/codex").to_str().unwrap()
        ),
    );
    let result = command(&f, &["plugin", "verify", "probe", "-t", "codex"])
        .env_remove("ACM_CODEX_BIN")
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
}

#[cfg(unix)]
#[test]
fn partial_update_retries_only_undeployed_digest_after_source_was_updated() {
    let f = Fixture::new();
    providers(&f);
    plugin(&f, "probe");
    output(
        &f,
        &["plugin", "install", "probe", "-t", "claude,codex"],
        true,
    );
    f.file(
        "sources/probe/skills/probe/new.md",
        "Updated upstream content",
    );
    f.file("home/fail-codex", "true");
    let failed = output(
        &f,
        &["plugin", "update", "probe", "-t", "claude,codex"],
        false,
    );
    assert_eq!(failed["retryTargets"], json!(["codex"]));
    let metadata = toml_file(&f.catalog.join("plugins-metadata.toml"));
    let installs = &metadata["plugins"]["probe"]["nativeInstallations"];
    assert_ne!(
        installs["claude:home"]["deployedDigest"],
        installs["codex:home"]["deployedDigest"]
    );
    fs::remove_file(f.home.join("fail-codex")).unwrap();
    fs::remove_file(f.home.join("native-calls.jsonl")).unwrap();
    let result = output(
        &f,
        &["plugin", "update", "probe", "-t", "claude,codex"],
        true,
    );
    assert_eq!(result[0]["updated"], true);
    let calls = fs::read_to_string(f.home.join("native-calls.jsonl")).unwrap();
    assert!(!calls.contains("claude"));
    assert!(calls.contains("codex"));
    let metadata = toml_file(&f.catalog.join("plugins-metadata.toml"));
    let installs = &metadata["plugins"]["probe"]["nativeInstallations"];
    assert_eq!(
        installs["claude:home"]["deployedDigest"],
        installs["codex:home"]["deployedDigest"]
    );
}

#[cfg(unix)]
#[test]
fn activation_failure_retains_installed_record_but_not_successful_digest() {
    let f = Fixture::new();
    providers(&f);
    plugin(&f, "probe");
    f.file("home/fail-enable-grok", "true");
    output(&f, &["plugin", "install", "probe", "-t", "grok"], false);
    let metadata = toml_file(&f.catalog.join("plugins-metadata.toml"));
    let installation = &metadata["plugins"]["probe"]["nativeInstallations"]["grok:home"];
    assert_eq!(installation["activationPending"], true);
    assert!(installation.get("deployedDigest").is_none());
    assert_eq!(
        f.json(&["plugin", "show", "probe", "-t", "grok"])["plugin"]["enabled"],
        false
    );
    fs::remove_file(f.home.join("fail-enable-grok")).unwrap();
    output(&f, &["plugin", "update", "probe", "-t", "grok"], true);
    let metadata = toml_file(&f.catalog.join("plugins-metadata.toml"));
    let installation = &metadata["plugins"]["probe"]["nativeInstallations"]["grok:home"];
    assert!(installation.get("activationPending").is_none());
    assert!(installation.get("deployedDigest").is_some());
}

#[cfg(unix)]
#[test]
fn grok_existing_install_is_updated_only_after_exact_source_verification() {
    let f = Fixture::new();
    providers(&f);
    plugin(&f, "probe");
    f.file("home/already-grok", "true");
    listing(
        &f,
        "grok",
        json!([{"name":"probe","status":"installed","source":f.catalog.join("marketplace/plugins/probe")} ]),
    );
    output(&f, &["plugin", "install", "probe", "-t", "grok"], true);
    let calls = fs::read_to_string(f.home.join("native-calls.jsonl")).unwrap();
    assert!(calls.contains("\"plugin\", \"update\", \"probe\""));
    assert!(calls.contains("\"plugin\", \"enable\", \"probe\""));
    fs::remove_file(f.home.join("native-calls.jsonl")).unwrap();
    let before = fs::read(f.catalog.join("plugins-metadata.toml")).unwrap();
    listing(
        &f,
        "grok",
        json!([{"name":"probe","status":"installed","source":"/foreign/plugin"}]),
    );
    let failure = output(&f, &["plugin", "install", "probe", "-t", "grok"], false);
    assert!(failure.to_string().contains("could not be matched"));
    assert!(!fs::read_to_string(f.home.join("native-calls.jsonl"))
        .unwrap()
        .contains("\"update\""));
    assert_eq!(
        fs::read(f.catalog.join("plugins-metadata.toml")).unwrap(),
        before
    );
}

#[cfg(unix)]
#[test]
fn confirming_unrecorded_missing_plugin_does_not_initialize_catalog_metadata() {
    let f = Fixture::new();
    providers(&f);
    listing(&f, "claude", json!([]));
    let result = output(
        &f,
        &[
            "plugin",
            "verify",
            "absent",
            "--home",
            "-t",
            "claude",
            "--reconcile",
        ],
        true,
    );
    assert_eq!(result["plugins"][0]["targets"][0]["state"], "missing");
    assert_eq!(result["plugins"][0]["targets"][0]["reconciled"], false);
    assert!(!f.catalog.join("plugins-metadata.toml").exists());
}

#[cfg(unix)]
#[test]
fn repeated_install_preserves_unknown_fields_and_rejects_malformed_records_before_mutation() {
    let f = Fixture::new();
    providers(&f);
    plugin(&f, "probe");
    output(&f, &["plugin", "install", "probe", "-t", "codex"], true);
    let path = f.catalog.join("plugins-metadata.toml");
    let mut metadata = toml_file(&path);
    metadata["plugins"]["probe"]["nativeInstallations"]["codex:home"]["customFutureData"] =
        json!({"keep":42});
    fs::write(&path, toml::to_string(&metadata).unwrap()).unwrap();
    output(&f, &["plugin", "install", "probe", "-t", "codex"], true);
    let mut metadata = toml_file(&path);
    assert_eq!(
        metadata["plugins"]["probe"]["nativeInstallations"]["codex:home"]["customFutureData"]
            ["keep"],
        42
    );
    metadata["plugins"]["probe"]["nativeInstallations"]["codex:home"]["enabled"] = json!("invalid");
    fs::write(&path, toml::to_string(&metadata).unwrap()).unwrap();
    let before = fs::read(&path).unwrap();
    fs::remove_file(f.home.join("native-calls.jsonl")).unwrap();
    output(&f, &["plugin", "install", "probe", "-t", "codex"], false);
    assert!(!f.home.join("native-calls.jsonl").exists());
    assert_eq!(fs::read(&path).unwrap(), before);
    assert!(!f
        .run(&["plugin", "list", "--home", "-t", "codex", "--json"])
        .status
        .success());
}

#[cfg(unix)]
#[test]
fn dotted_plugin_ids_acquire_distinct_reconciliation_locks() {
    let f = Fixture::new();
    providers(&f);
    listing(&f, "claude", json!([]));
    let start = std::time::Instant::now();
    output(
        &f,
        &[
            "plugin",
            "verify",
            "foo.one",
            "foo.two",
            "--reconcile",
            "--home",
            "-t",
            "claude",
        ],
        true,
    );
    assert!(start.elapsed() < std::time::Duration::from_secs(5));
}

#[cfg(unix)]
#[test]
fn duplicate_marketplace_is_accepted_only_for_the_exact_requested_source() {
    let f = Fixture::new();
    providers(&f);
    plugin(&f, "probe");
    f.file("home/duplicate-codex", "true");
    f.file("home/codex.marketplaces", &json!({"marketplaces":[{"name":"acm-catalog","marketplaceSource":{"sourceType":"local","source":"/old/catalog/marketplace"}}]}).to_string());
    let failure = output(&f, &["plugin", "install", "probe", "-t", "codex"], false);
    assert!(failure
        .to_string()
        .contains("different or unverified source"));
    let calls = fs::read_to_string(f.home.join("native-calls.jsonl")).unwrap();
    assert!(!calls.contains("\"codex\", \"plugin\", \"add\""));
    f.file("home/codex.marketplaces", &json!({"marketplaces":[{"name":"acm-catalog","marketplaceSource":{"sourceType":"local","source":f.catalog.join("marketplace")}}]}).to_string());
    output(&f, &["plugin", "install", "probe", "-t", "codex"], true);
    assert!(fs::read_to_string(f.home.join("native-calls.jsonl"))
        .unwrap()
        .contains("\"codex\", \"plugin\", \"add\""));
}

#[test]
fn compatibility_is_evidence_based_and_conversion_preview_is_read_only() {
    let f = Fixture::new();
    plugin(&f, "probe");
    let report = f.json(&["plugin", "compatibility", "probe", "-t", "all"]);
    for target in report[0]["targets"].as_array().unwrap() {
        let capabilities = target["capabilities"].as_array().unwrap();
        assert!(capabilities
            .iter()
            .any(|c| c["capability"] == "skills" && c["state"] == "supported"));
        assert!(capabilities
            .iter()
            .any(|c| c["capability"] == "apps" && c["state"] == "unknown"));
        assert!(capabilities
            .iter()
            .any(|c| c["capability"] == "hooks" && c["state"] == "unknown"));
    }
    let before = fs::read(f.catalog.join("plugins-metadata.toml")).unwrap();
    let report = f.json(&["plugin", "convert", "probe", "--dry-run"]);
    assert!(report.get("compatibility").is_some());
    assert!(!f.catalog.join("marketplace").exists());
    assert_eq!(
        fs::read(f.catalog.join("plugins-metadata.toml")).unwrap(),
        before
    );
}
