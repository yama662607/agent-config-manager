use agent_config_manager::cli::{run_cli, Cli};
use agent_config_manager::core::operations::{error_code, redact_text, OperationFailure};
use clap::Parser;
use serde_json::json;

fn main() -> anyhow::Result<()> {
    let args: Vec<_> = std::env::args_os().collect();
    let json_requested = args
        .iter()
        .take_while(|arg| *arg != "--")
        .any(|arg| arg == "--json");
    let cli = match Cli::try_parse_from(&args) {
        Ok(cli) => cli,
        Err(error) => {
            if json_requested && error.use_stderr() {
                println!(
                    "{}",
                    json!({"ok":false,"error":{"code":"invalid_arguments","message":redact_text(&error.to_string())}})
                );
                std::process::exit(error.exit_code());
            }
            error.exit();
        }
    };
    let json_mode = cli.json;
    if let Err(e) = run_cli(cli) {
        if json_mode {
            let report = e.downcast_ref::<OperationFailure>().map(|error| error.report.clone()).unwrap_or_else(|| json!({"ok":false,"error":{"code":error_code(&e),"message":redact_text(&e.to_string())}}));
            println!("{report}");
        } else {
            eprintln!("Error: {}", redact_text(&e.to_string()));
        }
        std::process::exit(1);
    }
    Ok(())
}
