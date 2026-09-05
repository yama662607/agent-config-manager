set shell := ["bash", "-c"]

default: check

# Build the native runtime and verify the complete quality gate.
check: fmt-check lint test package-check

setup:
    cargo fetch --locked

build:
    node scripts/build-native.mjs

fmt-check:
    cargo fmt --all --check

lint:
    cargo clippy --all-targets --locked -- -D warnings

fix:
    cargo fmt --all

test *args="":
    cargo test --locked {{args}}

test-unit *args="":
    cargo test --locked --test types_test --test adapters_test --test validate_test {{args}}

test-integration *args="":
    cargo test --locked --test cli_test --test migration_test --test skill_test --test plugin_test --test tui_test {{args}}

package-check:
    node scripts/check-package.mjs --source

prepare-native: build
    node scripts/prepare-native.mjs

test-smoke: prepare-native
    node scripts/package-smoke.mjs

dev *args="":
    cargo run --locked --bin acm -- {{args}}

clean:
    cargo clean

# Review dependency changes before committing them.
upgrade:
    test -z "$(git status --porcelain)"
    cargo update
    just check
