# Changelog


## [1.0.3] — 2026-06-22

### Changed

- Migrated to CortexPrism v0.51.0 plugin API
- Renamed `ToolResult` → `ToolCallResult` to match SDK types
- Switched type imports from local `types.ts` to `cortex/plugins` module
- Updated `peerDependencies.cortex` to `>=0.51.0`
- Standardized UI settings: `default` → `defaultValue`, `enum` → `options` for select fields
- All code passes `deno fmt` and `deno lint`
## [Unreleased]

### Changed

- Renamed manifest file from `cortex.json` to `manifest.json` for consistency with Cortex standard
- Standardized UI section structure to `ui.settings` format
- Normalized parameter naming: `defaultValue` → `default`, `options` → `enum`
- Added `homepage` field with repository URL
- Added `dependencies` field to manifest

### Fixed

- Replaced `console.error` with `ctx.logger.error` in GitHub review posting helper

## [1.0.1] — 2026-06-15

### Added

- Initial release

## [1.0.1] — 2026-06-17

### Fixed

- Replaced non-existent `cortex/plugins` import with local `types.ts` containing inline type
  definitions
- Removed broken `cortex/plugins` import map from `deno.json`
- Fixed test files with complete mock contexts (`state.delete`, `state.list`,
  `config.get/set/getAll`, `logger`, `host`)
- Rewrote scaffold test files to test actual plugin tools instead of template leftovers
- Added `defaultValue` and `default` fields to `ToolParam` type for compatibility

## [1.0.0] — 2026-06-15

### Added

- Initial plugin scaffold: automated code review for GitHub pull requests
- **6 tools**: `review_pr`, `analyze_diff`, `check_security`, `check_style`, `suggest_fixes`,
  `review_checks`
- 5 built-in check categories: Security, Bugs, Style, Performance, Complexity
- GitHub API integration: fetch PR diffs, post inline comments and summary reviews
- Security scanning: hardcoded secrets, eval(), unsafe innerHTML, SQL injection patterns, weak
  crypto
- Style checking: multi-language support (TypeScript, JavaScript, Python, Go)
- Fix suggestion generator with diff-ready patches and explanations
- Git diff parser supporting unified diff format
- Configurable severity filtering (info/warning/error/critical) and auto-approve threshold

### Changed

- (v1.0.0-rc1) Refactored to use spec-compliant `ToolContext` in all execute functions
- (v1.0.0-rc1) Moved GitHub token and config loading to `onLoad` lifecycle hook
- (v1.0.0-rc1) Replaced `console.log` with proper `ctx.logger` (lifecycle only) and `console.error`
  (helpers)

### Dependencies

- Cortex >=1.0.0
- Deno v2.0+ runtime
- GitHub personal access token (for PR posting)
