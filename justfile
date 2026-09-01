# =============================================================================
# Configuration & Variables
# =============================================================================

set dotenv-load := true
set shell := ["bash", "-c"]

# =============================================================================
# Standard Interface (AI Agent Protocol)
# =============================================================================

# Default: Run read-only quality check
default: check

# Setup: Build dependencies
setup:
    @echo "Setting up Rust environment..."
    cargo check
    @echo "Setup complete! Run 'just check' to verify."

# Quality gate: Read-only verification (CI compatible)
check: build test
    @echo "All quality checks passed!"

# Auto-fix: Run cargo clippy / fmt if configured
fix:
    @echo "Formatting and fixing Rust code..."
    cargo fmt --all || true

# =============================================================================
# Testing & Verification
# =============================================================================

# Run all Rust tests
test *args="":
    @echo "Running Rust tests..."
    cargo test {{args}}

# Run unit and integration tests
test-unit:
    @echo "Running unit tests..."
    cargo test --test types_test --test adapters_test --test validate_test

test-integration:
    @echo "Running integration tests..."
    cargo test --test skill_test --test cli_test

# =============================================================================
# Operations & Utilities
# =============================================================================

# Start development interactive TUI
dev:
    @echo "Launching Rust ACM TUI..."
    cargo run --bin acm

# Production release build
build:
    @echo "Building optimized Rust binary..."
    cargo build --release

# Clean build artifacts
clean:
    @echo "Cleaning target directory..."
    cargo clean
