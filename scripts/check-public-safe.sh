#!/bin/bash
#
# Fail if tracked files contain content that must not appear in a public repository:
# private repository names, real user paths, or credentials.
#
# Run manually, from CI, or from `prepack`.

set -uo pipefail

cd "$(dirname "$0")/.."

status=0

report() {
  echo "✗ $1"
  echo "$2"
  echo
  status=1
}

# Private tooling this project must not reference by name.
hits=$(git grep -nI -iE 'the external tool' -- . ':(exclude)scripts/check-public-safe.sh' 2>/dev/null)
[ -n "$hits" ] && report "Private tool name found" "$hits"

# Real home directories. Placeholders like /Users/username are fine.
# `git grep` provides the lookahead here; plain grep on macOS does not.
hits=$(git grep -nI --perl-regexp '/Users/(?!username)[a-z]' -- . ':(exclude)scripts/check-public-safe.sh' 2>/dev/null)
[ -n "$hits" ] && report "Real user path found" "$hits"

# Private git remotes.
hits=$(git grep -nI -E 'git@github\.com:' -- . ':(exclude)scripts/check-public-safe.sh' 2>/dev/null)
[ -n "$hits" ] && report "SSH git remote found (use https:// for public references)" "$hits"

# Credentials. Values only — key names alone appear legitimately in docs and tests.
hits=$(git grep -nI -E '(ghp_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})' -- . ':(exclude)scripts/check-public-safe.sh' 2>/dev/null)
[ -n "$hits" ] && report "Possible credential found" "$hits"

# The build output is what actually ships, and it is not tracked, so git grep
# never sees it. Source maps in particular can embed absolute paths.
if [ -d dist ]; then
  # BSD grep has no lookahead, so the placeholder is excluded afterwards.
  hits=$(grep -rIl '/Users/[a-z]' dist 2>/dev/null | while read -r f; do
    grep -Iq '/Users/[a-z]' "$f" && ! grep -Iq '^/Users/username' "$f" && echo "$f"
  done)
  [ -n "$hits" ] && report "Real user path in build output" "$hits"

  hits=$(grep -rIlE '(ghp_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16})' dist 2>/dev/null | grep -v 'cli-publish')
  [ -n "$hits" ] && report "Possible credential in build output" "$hits"
fi

if [ $status -eq 0 ]; then
  echo "✓ No private references in tracked files or build output"
fi

exit $status
