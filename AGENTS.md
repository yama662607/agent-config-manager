# Agent Configuration Guide

This document contains guidelines and instructions for AI agents working on this project.

## Project Overview

`agent-config-sync` is a cross-agent configuration manager for MCP servers and skills. It directly edits native config files without requiring manifests or sync steps.

**Tech Stack:**
- Language: TypeScript (ES modules)
- Runtime: Node.js >= 20.0.0
- Build: tsc (TypeScript compiler)
- Test: tsx (Node.js built-in test runner)

## Justfile Usage (AI Agent Protocol)

This project expects agents to use `just` commands to keep quality high.

### Daily Commands
- `just check` — Run all read-only checks (build, tests).
- `just fix` — Not applicable (no auto-formatter configured).

### Workflow
1. After editing files: Run `just check` to verify quality
2. If errors occur: Fix the issues manually, then `just check` again
3. Before committing: Ensure `just check` passes

### Targeted Commands
- `just build` — Build the project (typecheck + compilation)
- `just test [args]` — Run all tests (argument pass-through)
- `just test-unit [args]` — Run unit tests only
- `just test-integration [args]` — Run integration tests only
- `just test-smoke` — Run smoke tests (requires build)
- `just dev` — Run CLI in development mode
- `just clean` — Remove build artifacts

### Dependency Management
- `just upgrade` — Upgrade all dependencies safely (checks git cleanliness first)

## Project Structure

```
agent-config-sync/
├── src/              # Source code
├── dist/             # Compiled output (generated)
├── test/             # Test files
│   ├── unit/         # Unit tests
│   └── integration/  # Integration tests
├── justfile          # Task runner commands
├── package.json      # Dependencies and scripts
└── tsconfig.json     # TypeScript configuration
```

## Key Commands (npm scripts)

The project also supports direct npm scripts:
- `npm run build` - Compile TypeScript to `dist/`
- `npm run clean` - Remove `dist/` directory
- `npm run dev` - Run CLI in development mode with tsx
- `npm run check` - Clean and build (alias for quality check)

## Testing

Tests use Node.js built-in test runner with tsx:
- Unit tests: `test/unit/*.test.ts`
- Integration tests: `test/integration/*.test.ts`
- Run with: `npm run test` or `just test`

## Quality Standards

Since this project doesn't use a formatter or linter:
- Follow existing code style
- Use TypeScript strict mode (already configured)
- Ensure type safety with `strict: true`
- Keep functions focused and modules small
