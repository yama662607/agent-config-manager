#![allow(dead_code)]
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

pub struct Fixture {
    pub temp: tempfile::TempDir,
    pub home: PathBuf,
    pub catalog: PathBuf,
    pub project: PathBuf,
}
impl Fixture {
    pub fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("home");
        let catalog = temp.path().join("catalog");
        let project = temp.path().join("project");
        for dir in [&home, &catalog, &project] {
            fs::create_dir_all(dir).unwrap();
        }
        Self {
            temp,
            home,
            catalog,
            project,
        }
    }
    pub fn command(&self) -> Command {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_acm"));
        cmd.current_dir(&self.project)
            .env("HOME", &self.home)
            .env("USERPROFILE", &self.home)
            .env("ACM_CATALOG_DIR", &self.catalog)
            .env_remove("CLAUDE_CONFIG_DIR")
            .env_remove("CODEX_HOME");
        cmd
    }
    pub fn run(&self, args: &[&str]) -> Output {
        self.command().args(args).output().unwrap()
    }
    pub fn ok(&self, args: &[&str]) -> String {
        let output = self.run(args);
        assert!(
            output.status.success(),
            "{args:?}: {}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap()
    }
    pub fn fail(&self, args: &[&str]) -> String {
        let output = self.run(args);
        assert!(!output.status.success(), "Unexpected success: {args:?}");
        String::from_utf8(output.stderr).unwrap()
    }
    pub fn json(&self, args: &[&str]) -> Value {
        let mut args = args.to_vec();
        args.push("--json");
        serde_json::from_str(&self.ok(&args)).unwrap()
    }
    pub fn file(&self, relative: &str, content: &str) -> PathBuf {
        let path = self.temp.path().join(relative);
        write(&path, content);
        path
    }
    pub fn skill(&self, id: &str) -> PathBuf {
        self.file(&format!("sources/{id}/SKILL.md"), &format!("---\nname: {id}\ndescription: A complete skill fixture with useful supporting files.\n---\n# Guide\n"));
        self.file(
            &format!("sources/{id}/scripts/run.sh"),
            "#!/bin/sh\necho fixture\n",
        );
        self.temp.path().join("sources").join(id)
    }
    #[cfg(unix)]
    pub fn providers(&self) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let python = Command::new("python3")
            .args(["-c", "import sys; print(sys.executable)"])
            .output()
            .unwrap();
        assert!(python.status.success());
        let python = String::from_utf8(python.stdout).unwrap();
        let script = format!("#!{}\n{}", python.trim(), include_str!("provider.py"));
        let bin = self.temp.path().join("bin");
        fs::create_dir_all(&bin).unwrap();
        for name in ["claude", "codex", "grok", "agy", "gh"] {
            let path = bin.join(name);
            fs::write(&path, &script).unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
        }
        bin
    }
    #[cfg(unix)]
    pub fn mocked(&self, args: &[&str]) -> Output {
        let mut paths = vec![self.temp.path().join("bin")];
        paths.extend(std::env::split_paths(&std::env::var_os("PATH").unwrap()));
        self.command()
            .env("PATH", std::env::join_paths(paths).unwrap())
            .args(args)
            .output()
            .unwrap()
    }
    #[cfg(unix)]
    pub fn mock_ok(&self, args: &[&str]) -> Value {
        let mut args = args.to_vec();
        args.push("--json");
        let output = self.mocked(&args);
        assert!(
            output.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        serde_json::from_slice(&output.stdout).unwrap()
    }
}
pub fn write(path: &Path, content: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}
pub fn json_file(path: &Path) -> Value {
    serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
}
pub fn toml_file(path: &Path) -> Value {
    serde_json::to_value(toml::from_str::<toml::Value>(&fs::read_to_string(path).unwrap()).unwrap())
        .unwrap()
}
