use agent_config_manager::cli::{run_cli, Cli};
use clap::Parser;

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    if let Err(e) = run_cli(cli) {
        eprintln!("Error: {}", e);
        std::process::exit(1);
    }
    Ok(())
}
