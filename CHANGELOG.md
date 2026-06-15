# Changelog — PR Review Agent

## [1.0.0] — 2026-06-15

### Added
- Initial plugin scaffold: automated code review for GitHub pull requests
- **6 tools**: `review_pr`, `analyze_diff`, `check_security`, `check_style`, `suggest_fixes`, `review_checks`
- 5 built-in check categories: Security, Bugs, Style, Performance, Complexity
- GitHub API integration: fetch PR diffs, post inline comments and summary reviews
- Security scanning: hardcoded secrets, eval(), unsafe innerHTML, SQL injection patterns, weak crypto
- Style checking: multi-language support (TypeScript, JavaScript, Python, Go)
- Fix suggestion generator with diff-ready patches and explanations
- Git diff parser supporting unified diff format
- Configurable severity filtering (info/warning/error/critical) and auto-approve threshold

### Changed
- (v1.0.0-rc1) Refactored to use spec-compliant `ToolContext` in all execute functions
- (v1.0.0-rc1) Moved GitHub token and config loading to `onLoad` lifecycle hook
- (v1.0.0-rc1) Replaced `console.log` with proper `ctx.logger` (lifecycle only) and `console.error` (helpers)

### Dependencies
- Cortex >=1.0.0
- Deno v2.0+ runtime
- GitHub personal access token (for PR posting)
