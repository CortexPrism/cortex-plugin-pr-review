# CortexPrism PR Review Agent

Automated code review on pull requests — analyzes diffs for bugs, security issues, style violations, and performance concerns. Posts inline comments and summary reviews to GitHub.

## Installation

```bash
cortex plugin install cortex-plugin-pr-review
```

Or install from local development:

```bash
git clone https://github.com/CortexPrism/cortex-plugin-pr-review.git
cd cortex-plugin-pr-review
cortex plugin install .
```

## Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `githubToken` | string (secret) | — | GitHub personal access token for PR API access and posting comments |
| `autoApprove` | string | `none` | Auto-approval threshold: `none`, `info_only`, or `warning_max` |
| `maxFilesToReview` | number | `50` | Maximum number of changed files to review in a single PR |

### GitHub Token Permissions

Your token needs:
- `repo` scope for private repos
- `public_repo` scope for public repos

## Tools

### `review_pr`
Perform a comprehensive code review on a GitHub PR.

```json
{
  "repo": "CortexPrism/cortex",
  "pr_number": 42,
  "post_comments": false,
  "severity": "warning"
}
```

### `analyze_diff`
Analyze a raw git diff for issues. Useful for local changes.

```json
{
  "diff": "diff --git a/mod.ts b/mod.ts\n+console.log('debug')",
  "language": "typescript"
}
```

### `check_security`
Deep security analysis — checks for hardcoded secrets, unsafe functions, injection risks, and OWASP Top 10 patterns.

```json
{
  "content": "const API_KEY = 'sk-abc123...';",
  "file_path": "config.ts"
}
```

### `check_style`
Check code for style and best practice violations by language.

```json
{
  "content": "var x = 1;\nif (x == 2) { console.log(x); }",
  "language": "typescript"
}
```

### `suggest_fixes`
Generate specific fix suggestions for code issues. Returns diff-ready patches.

```json
{
  "code_snippet": "const API_KEY = 'hardcoded-secret';",
  "issue_description": "Hardcoded secret in config file"
}
```

### `review_checks`
List available review check categories.

```json
{ "action": "list" }
```

## Check Categories

| Category | What It Checks |
|----------|---------------|
| **Security** | Hardcoded secrets, eval(), dangerouslySetInnerHTML, SQL injection patterns |
| **Bugs** | console.log leftovers, empty catch blocks, async/await patterns |
| **Style** | var usage, loose equality, naming conventions |
| **Performance** | innerHTML +=, synchronous loops, redundant operations |
| **Complexity** | Deep nesting (>3 levels), long functions |

## Usage Example

```
> Review PR #42 in CortexPrism/cortex

1. review_pr → { repo: "CortexPrism/cortex", pr_number: 42, severity: "warning" }
→ Returns findings: 3 warnings (2 bugs, 1 style), 0 errors
→ Recommendation: comment
```

## Capabilities

| Capability | Purpose |
|------------|---------|
| `network:fetch` | GitHub API access for fetching PR diffs and posting reviews |
| `fs:read` | Local diff and file analysis |

## Development

```bash
deno task test
deno fmt && deno lint

# Test with a real PR
cortex plugin call cortex-plugin-pr-review review_pr '{"repo":"CortexPrism/cortex","pr_number":1}'
```

## License

MIT
