mod common;
use common::*;
use std::fs;
use std::path::PathBuf;

fn source(fixture: &Fixture, location: &str, version: &str, payload: &str) -> PathBuf {
    fixture.file(
        &format!("{location}/.codex-plugin/plugin.json"),
        &format!(r#"{{"name":"shared-name","version":"{version}"}}"#),
    );
    fixture.file(&format!("{location}/payload.txt"), payload);
    fixture.temp.path().join(location)
}

#[test]
fn missing_local_source_cannot_be_replaced_by_an_unrelated_same_name_plugin() {
    let fixture = Fixture::new();
    fixture.file("home/.acm/config.toml", "discovery_roots = []\n");
    let original = source(&fixture, "original", "1.0", "original owner");
    fixture.ok(&[
        "plugin",
        "import",
        original.to_str().unwrap(),
        "--as",
        "owned",
    ]);
    fs::remove_dir_all(original).unwrap();
    source(
        &fixture,
        "home/.codex/plugins/cache/foreign",
        "9.0",
        "unrelated owner",
    );
    let metadata = fs::read(fixture.catalog.join("plugins-metadata.toml")).unwrap();
    for options in [vec![], vec!["--dry-run"], vec!["--force"]] {
        let mut args = vec!["plugin", "update", "owned", "--catalog"];
        args.extend(options);
        assert!(fixture
            .fail(&args)
            .contains("explicitly select its replacement"));
        assert_eq!(
            fs::read_to_string(fixture.catalog.join("plugins/owned/payload.txt")).unwrap(),
            "original owner"
        );
        assert_eq!(
            fs::read(fixture.catalog.join("plugins-metadata.toml")).unwrap(),
            metadata
        );
    }
}

#[test]
fn existing_local_source_wins_over_an_unrelated_higher_version() {
    let fixture = Fixture::new();
    fixture.file("home/.acm/config.toml", "discovery_roots = []\n");
    let original = source(&fixture, "original", "1.0", "original owner");
    fixture.ok(&[
        "plugin",
        "import",
        original.to_str().unwrap(),
        "--as",
        "owned",
    ]);
    source(
        &fixture,
        "home/.codex/plugins/cache/foreign",
        "9.0",
        "unrelated owner",
    );
    fs::write(original.join("payload.txt"), "same owner updated").unwrap();
    fixture.ok(&["plugin", "update", "owned", "--catalog"]);
    assert_eq!(
        fs::read_to_string(fixture.catalog.join("plugins/owned/payload.txt")).unwrap(),
        "same owner updated"
    );
}

#[test]
fn catalog_only_plugin_does_not_adopt_a_foreign_source() {
    let fixture = Fixture::new();
    fixture.file("home/.acm/config.toml", "discovery_roots = []\n");
    source(&fixture, "catalog/plugins/owned", "1.0", "catalog only");
    source(
        &fixture,
        "home/.codex/plugins/cache/foreign",
        "9.0",
        "unrelated owner",
    );
    fixture.ok(&["plugin", "update", "owned", "--catalog"]);
    assert_eq!(
        fs::read_to_string(fixture.catalog.join("plugins/owned/payload.txt")).unwrap(),
        "catalog only"
    );
}

#[cfg(unix)]
#[test]
fn legacy_installation_blocks_catalog_removal_and_unlink() {
    let fixture = Fixture::new();
    let original = source(&fixture, "original", "1.0", "original owner");
    fixture.ok(&["plugin", "add", original.to_str().unwrap(), "--as", "owned"]);
    let metadata_path = fixture.catalog.join("plugins-metadata.toml");
    let mut metadata = toml_file(&metadata_path);
    metadata["plugins"]["owned"]["installedFor"] = serde_json::json!(["codex"]);
    fs::write(&metadata_path, toml::to_string(&metadata).unwrap()).unwrap();
    let before = fs::read(&metadata_path).unwrap();
    for action in ["remove", "unlink"] {
        assert!(fixture
            .fail(&["plugin", action, "owned", "--catalog"])
            .contains("Uninstall owned from its providers"));
        assert!(fs::symlink_metadata(fixture.catalog.join("plugins/owned"))
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read(&metadata_path).unwrap(), before);
        assert_eq!(
            fs::read_to_string(original.join("payload.txt")).unwrap(),
            "original owner"
        );
    }
    metadata["plugins"]["owned"]["installedFor"] = serde_json::json!([]);
    fs::write(&metadata_path, toml::to_string(&metadata).unwrap()).unwrap();
    fixture.ok(&["plugin", "unlink", "owned", "--catalog"]);
    assert!(fs::symlink_metadata(fixture.catalog.join("plugins/owned")).is_err());
    assert!(original.join("payload.txt").is_file());
}

#[cfg(unix)]
#[test]
fn catalog_removal_and_unlink_wait_for_in_flight_native_installation() {
    use std::process::Stdio;
    use std::time::{Duration, Instant};

    for action in ["remove", "unlink"] {
        let fixture = Fixture::new();
        let original = source(&fixture, "original", "1.0", "original owner");
        fixture.ok(&["plugin", "add", original.to_str().unwrap(), "--as", "owned"]);
        let provider = fixture.providers().join("codex");
        let script = fs::read_to_string(&provider).unwrap();
        let shebang = script.lines().next().unwrap();
        fs::write(
            &provider,
            format!(
                r#"{shebang}
import os, pathlib, sys, time
home = pathlib.Path(os.environ['HOME'])
if sys.argv[1:3] == ['plugin', 'add']:
    (home / 'install-started').touch()
    deadline = time.monotonic() + 8
    while not (home / 'release-install').exists():
        if time.monotonic() >= deadline:
            sys.exit(19)
        time.sleep(0.02)
print('{{}}')
"#
            ),
        )
        .unwrap();
        let mut install = fixture
            .command()
            .env("ACM_CODEX_BIN", &provider)
            .args(["plugin", "install", "owned", "--home", "-t", "codex"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while !fixture.home.join("install-started").exists() && Instant::now() < deadline {
            if install.try_wait().unwrap().is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        let reached_provider = fixture.home.join("install-started").exists();
        if !reached_provider {
            let _ = install.kill();
            let output = install.wait_with_output().unwrap();
            panic!(
                "Native installation never reached the provider: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        let mut removal = fixture
            .command()
            .args(["plugin", action, "owned", "--catalog"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        std::thread::sleep(Duration::from_millis(300));
        let premature_completion = removal.try_wait().unwrap().is_some();
        fixture.file("home/release-install", "release");
        let install_output = install.wait_with_output().unwrap();
        let removal_output = removal.wait_with_output().unwrap();
        assert!(
            install_output.status.success(),
            "{}",
            String::from_utf8_lossy(&install_output.stderr)
        );
        assert!(
            !premature_completion,
            "Catalog {action} must wait for the native installation to finish"
        );
        assert!(!removal_output.status.success());
        assert!(String::from_utf8_lossy(&removal_output.stderr)
            .contains("Uninstall owned from its providers"));
        let metadata = toml_file(&fixture.catalog.join("plugins-metadata.toml"));
        assert!(metadata["plugins"]["owned"]["nativeInstallations"]["codex:home"].is_object());
        assert!(fs::symlink_metadata(fixture.catalog.join("plugins/owned"))
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(
            fs::read_to_string(original.join("payload.txt")).unwrap(),
            "original owner"
        );
    }
}
