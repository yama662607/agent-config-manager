# =============================================================================
# Configuration & Variables
# =============================================================================

set dotenv-load := true
set shell := ["bash", "-c"]

# Package manager
pm := "npm"

# =============================================================================
# Standard Interface (AI Agent Protocol)
# =============================================================================

# Default: Run read-only quality check
default: check

# Setup: Install dependencies
setup:
    @echo "Setting up environment..."
    {{pm}} install
    @echo "Setup complete! Run 'just check' to verify."

# Quality gate: Read-only verification (CI compatible)
check: build test
    @echo "All quality checks passed!"

# Auto-fix: Not applicable (no formatter configured)
fix:
    @echo "No auto-fix configured (no formatter/linter installed)."
    @echo "Consider adding Biome or ESLint/Prettier for auto-fix support."

# =============================================================================
# Testing & Verification
# =============================================================================

# Unit/integration tests with argument pass-through
test *args="":
    @echo "Running tests..."
    {{pm}} run test {{args}}

# Unit tests only
test-unit *args="":
    @echo "Running unit tests..."
    {{pm}} run test:unit {{args}}

# Integration tests only
test-integration *args="":
    @echo "Running integration tests..."
    {{pm}} run test:integration {{args}}

# Smoke tests (requires build)
test-smoke: build
    @echo "Running smoke tests..."
    {{pm}} run test:smoke

# =============================================================================
# Granular Tasks (Components of 'check')
# =============================================================================

# Type checking (implicit in build)
typecheck:
    @echo "Checking types..."
    {{pm}} run build

# =============================================================================
# Operations & Utilities
# =============================================================================

# Start development CLI
dev:
    @echo "Starting dev mode..."
    {{pm}} run dev

# Production build
build:
    @echo "Building..."
    {{pm}} run build

# Remove build artifacts
clean:
    @echo "Cleaning artifacts..."
    {{pm}} run clean

# =============================================================================
# Dependency Management
# =============================================================================

# Safety check: Ensure git working tree is clean
ensure-clean:
    @if [ -n "$(git status --porcelain)" ]; then \
        echo "Error: Working directory is dirty."; \
        echo "Please commit or stash changes before upgrading."; \
        exit 1; \
    fi

# Upgrade all packages (flow: git check -> baseline check -> update -> verify)
upgrade: ensure-clean check
    @echo "Baseline passed. Current code is stable."
    @echo "Starting full upgrade process..."
    {{pm}} update
    @echo "Verifying upgrade stability..."
    just check
    @echo "Upgrade complete!"

# =============================================================================
# Project-Specific Tasks
# =============================================================================

# Show CLI version
version: build
    @{{pm}} run dist/cli.js --version

# List MCP servers (requires build)
mcp-list: build
    @{{pm}} run dist/cli.js catalog mcp list
