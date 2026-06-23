// deno-lint-ignore-file
/**
 * CortexPrism PR Review Agent Plugin
 *
 * Automated code review on pull requests — analyzes diffs for bugs,
 * security issues, style violations, and performance concerns.
 * Posts inline comments and summary reviews to GitHub.
 *
 * #16 in the official plugin registry.
 */

import type { PluginContext, Tool, ToolCallResult } from 'cortex/plugins';

// ---------------------------------------------------------------------------
// Module-level config (loaded in onLoad)
// ---------------------------------------------------------------------------

interface PRReviewConfig {
  githubToken: string;
  autoApprove: string;
  maxFilesToReview: number;
}

let config: PRReviewConfig = {
  githubToken: '',
  autoApprove: 'none',
  maxFilesToReview: 50,
};

// ---------------------------------------------------------------------------
// Check categories
// ---------------------------------------------------------------------------

const CHECK_CATEGORIES: Record<string, { name: string; description: string; patterns: RegExp[] }> =
  {
    security: {
      name: 'Security',
      description: 'Hardcoded secrets, unsafe functions, injection risks',
      patterns: [
        /password\s*[=:]\s*["'][^"'\s]{4,}["']/i,
        /api[_-]?key\s*[=:]\s*["'][^"'\s]{8,}["']/i,
        /secret\s*[=:]\s*["'][^"'\s]{8,}["']/i,
        /token\s*[=:]\s*["'][^"'\s]{8,}["']/i,
        /eval\s*\(/,
        /exec\s*\(\s*["'`]/,
        /dangerouslySetInnerHTML/,
        /innerHTML\s*=/,
      ],
    },
    bugs: {
      name: 'Bugs',
      description: 'Common bug patterns, null derefs, race conditions',
      patterns: [
        /console\.(log|warn|error|debug)\s*\(/,
        /\.then\s*\(\s*\)/,
        /catch\s*\(\s*\)\s*\{\s*\}/,
        /if\s*\(\s*.*\s*=\s*[^=]/,
        /typeof\s+.*\s*===\s*["']undefined["']/,
        /\.forEach\s*\(.*async/,
      ],
    },
    style: {
      name: 'Style',
      description: 'Naming conventions, formatting, best practices',
      patterns: [
        /\bvar\s+/,
        /==(?!=)/,
        /\/\/\s*TODO/,
        /\/\/\s*FIXME/,
      ],
    },
    performance: {
      name: 'Performance',
      description: 'Inefficient patterns, memory leaks, blocking operations',
      patterns: [
        /\.innerHTML\s*\+=\s*/,
        /document\.write\s*\(/,
        /setTimeout\s*\(.*,\s*0\s*\)/,
        /for\s*\(\s*.*\s*in\s*.*\)/,
      ],
    },
    complexity: {
      name: 'Complexity',
      description: 'Deep nesting, long functions, too many parameters',
      patterns: [
        /if\s*\([^)]*\)\s*\{[^}]*if\s*\([^)]*\)\s*\{[^}]*if\s*\([^)]*\)\s*\{/,
      ],
    },
  };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReviewFinding {
  file: string;
  line: number;
  severity: 'info' | 'warning' | 'error' | 'critical';
  category: string;
  message: string;
  suggestion?: string;
}

interface ReviewResult {
  prNumber?: number;
  repo?: string;
  totalFiles: number;
  totalFindings: number;
  findings: ReviewFinding[];
  summary: string;
  recommendation: 'approve' | 'comment' | 'request_changes';
}

interface DiffFile {
  filename: string;
  addedLines: { newLineNumber: number; content: string }[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<string, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
};

function meetsMinSeverity(severity: string, minSeverity: string): boolean {
  return (SEVERITY_RANK[severity] ?? 0) >= (SEVERITY_RANK[minSeverity] ?? 0);
}

function getGitHubHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'CortexPrism-PRReview/1.0.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function parseDiffFiles(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let currentFile: DiffFile | null = null;
  let newLineNum = 0;

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ')) {
      continue;
    }

    if (line.startsWith('+++ ')) {
      const filename = line.replace(/^\+\+\+\s+[ab]\//, '').trim();
      currentFile = { filename, addedLines: [] };
      files.push(currentFile);
      newLineNum = 0;
      continue;
    }

    if (line.startsWith('@@')) {
      const match = line.match(/\+(\d+)/);
      newLineNum = match ? parseInt(match[1]) - 1 : 0;
      continue;
    }

    if (currentFile && line.startsWith('+') && !line.startsWith('+++')) {
      newLineNum++;
      currentFile.addedLines.push({ newLineNumber: newLineNum, content: line.substring(1) });
    } else if (!line.startsWith('-') && !line.startsWith('+')) {
      newLineNum++;
    }
  }

  return files;
}

function generateFixSuggestion(
  snippet: string,
  issue: string,
): { suggestion: string; replacement?: string; explanation: string } {
  const issueLower = issue.toLowerCase();

  if (
    issueLower.includes('secret') || issueLower.includes('hardcoded') ||
    issueLower.includes('password')
  ) {
    return {
      suggestion: 'Move this value to an environment variable or secret store.',
      replacement: snippet.replace(/=\s*["'][^"']*["']/, '= Deno.env.get("SECRET_KEY") ?? ""'),
      explanation: 'Hardcoded values should be extracted to configuration.',
    };
  }
  if (issueLower.includes('console.log') || issueLower.includes('console')) {
    return {
      suggestion: 'Replace with structured logging.',
      replacement: snippet.replace(
        /console\.(log|warn|error|debug)\s*\(([^)]*)\)/,
        'ctx.logger.info($2)',
      ),
      explanation: 'Use ctx.logger instead of console methods in Cortex plugins.',
    };
  }
  if (issueLower.includes('eval')) {
    return {
      suggestion: 'Remove eval() — it enables arbitrary code execution.',
      explanation: 'eval() is dangerous with user-provided input.',
    };
  }
  if (issueLower.includes('var ')) {
    return {
      suggestion: 'Replace var with const or let.',
      replacement: snippet.replace(/\bvar\s+/g, 'const '),
      explanation: 'var has function scope and hoisting issues.',
    };
  }

  return {
    suggestion: 'Review the code against best practices for this pattern.',
    explanation:
      'Apply standard best practices: validate inputs, handle errors, follow language conventions.',
  };
}

// ---------------------------------------------------------------------------
// Tool: review_pr
// ---------------------------------------------------------------------------

const reviewPr: Tool = {
  definition: {
    name: 'review_pr',
    description: 'Perform a comprehensive code review on a GitHub pull request.',
    params: [
      {
        name: 'repo',
        type: 'string',
        description: 'GitHub repository in owner/name format',
        required: true,
      },
      {
        name: 'pr_number',
        type: 'number',
        description: 'Pull request number to review',
        required: true,
      },
      {
        name: 'post_comments',
        type: 'boolean',
        description: 'Whether to post review comments',
        required: false,
      },
      {
        name: 'severity',
        type: 'string',
        description: 'Minimum severity to report',
        required: false,
        enum: ['info', 'warning', 'error', 'critical'],
      },
    ],
    capabilities: ['network:fetch'],
  },

  execute: async (args: Record<string, unknown>, _ctx: PluginContext): Promise<ToolCallResult> => {
    const start = Date.now();
    const toolName = 'review_pr';
    try {
      if (!args.repo || typeof args.repo !== 'string' || !args.repo.includes('/')) {
        return {
          toolName,
          success: false,
          output: '',
          error: "repo must be in 'owner/name' format",
          durationMs: Date.now() - start,
        };
      }
      const prNumber = args.pr_number;
      if (typeof prNumber !== 'number' || prNumber < 1) {
        return {
          toolName,
          success: false,
          output: '',
          error: 'pr_number must be a positive integer',
          durationMs: Date.now() - start,
        };
      }

      const repo = args.repo as string;
      const postComments = args.post_comments === true;
      const minSeverity = (args.severity as string) || 'warning';

      if (!config.githubToken) {
        return {
          toolName,
          success: false,
          output: '',
          error: 'GitHub token not configured. Set githubToken in plugin settings.',
          durationMs: Date.now() - start,
        };
      }

      // Fetch PR diff from GitHub
      const diffUrl = `https://api.github.com/repos/${repo}/pulls/${prNumber}`;
      const diffResponse = await fetch(diffUrl, {
        headers: {
          ...getGitHubHeaders(config.githubToken),
          Accept: 'application/vnd.github.v3.diff',
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!diffResponse.ok) {
        return {
          toolName,
          success: false,
          output: '',
          error: `GitHub API error: ${diffResponse.status} ${diffResponse.statusText}`,
          durationMs: Date.now() - start,
        };
      }

      const diff = await diffResponse.text();
      const files = parseDiffFiles(diff);

      if (files.length > config.maxFilesToReview) {
        return {
          toolName,
          success: false,
          output: '',
          error: `PR has ${files.length} changed files, exceeds max of ${config.maxFilesToReview}`,
          durationMs: Date.now() - start,
        };
      }

      // Run all check categories
      const allFindings: ReviewFinding[] = [];
      for (const file of files) {
        for (const [catKey, cat] of Object.entries(CHECK_CATEGORIES)) {
          for (const line of file.addedLines) {
            for (const pattern of cat.patterns) {
              if (pattern.test(line.content)) {
                const severity = catKey === 'security'
                  ? 'error'
                  : catKey === 'bugs'
                  ? 'warning'
                  : 'info';
                if (meetsMinSeverity(severity, minSeverity)) {
                  allFindings.push({
                    file: file.filename,
                    line: line.newLineNumber,
                    severity,
                    category: cat.name,
                    message: `Potential ${catKey} issue detected at line ${line.newLineNumber}`,
                    suggestion: `Review this line for ${catKey} concerns.`,
                  });
                }
              }
            }
          }
        }
      }

      // Generate summary
      const counts = { critical: 0, error: 0, warning: 0, info: 0 };
      for (const f of allFindings) counts[f.severity]++;

      let recommendation: ReviewResult['recommendation'] = 'comment';
      if (counts.critical + counts.error === 0 && counts.warning === 0) recommendation = 'approve';
      else if (counts.critical + counts.error > 0) recommendation = 'request_changes';

      const summary = `Reviewed ${files.length} files with ${allFindings.length} findings ` +
        `(critical: ${counts.critical}, error: ${counts.error}, warning: ${counts.warning}, info: ${counts.info}).`;

      // Post to GitHub if requested
      if (postComments) {
        await postGitHubReview(repo, prNumber, {
          prNumber,
          repo,
          totalFiles: files.length,
          totalFindings: allFindings.length,
          findings: allFindings,
          summary,
          recommendation,
        });
      }

      return {
        toolName,
        success: true,
        output: JSON.stringify({
          prNumber,
          repo,
          totalFiles: files.length,
          totalFindings: allFindings.length,
          findings: allFindings,
          summary,
          recommendation,
        }),
        durationMs: Date.now() - start,
      };
    } catch (error) {
      return {
        toolName,
        success: false,
        output: '',
        error: `PR review failed: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - start,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Tool: analyze_diff
// ---------------------------------------------------------------------------

const analyzeDiff: Tool = {
  definition: {
    name: 'analyze_diff',
    description: 'Analyze a raw git diff for issues.',
    params: [
      {
        name: 'diff',
        type: 'string',
        description: 'Raw git diff content to analyze',
        required: true,
      },
      {
        name: 'language',
        type: 'string',
        description: 'Primary programming language',
        required: false,
      },
    ],
    capabilities: [],
  },

  execute: async (args: Record<string, unknown>, _ctx: PluginContext): Promise<ToolCallResult> => {
    const start = Date.now();
    const toolName = 'analyze_diff';
    try {
      if (!args.diff || typeof args.diff !== 'string') {
        return {
          toolName,
          success: false,
          output: '',
          error: 'diff must be a non-empty string',
          durationMs: Date.now() - start,
        };
      }

      const diff = args.diff as string;
      const files = parseDiffFiles(diff);
      const findings: ReviewFinding[] = [];

      for (const file of files) {
        for (const [catKey, cat] of Object.entries(CHECK_CATEGORIES)) {
          for (const line of file.addedLines) {
            for (const pattern of cat.patterns) {
              if (pattern.test(line.content)) {
                findings.push({
                  file: file.filename,
                  line: line.newLineNumber,
                  severity: catKey === 'security'
                    ? 'error'
                    : catKey === 'bugs'
                    ? 'warning'
                    : 'info',
                  category: cat.name,
                  message: `Potential ${catKey} issue detected`,
                });
              }
            }
          }
        }
      }

      return {
        toolName,
        success: true,
        output: JSON.stringify({
          files: files.length,
          findings: findings.length,
          findings,
          language: args.language,
        }),
        durationMs: Date.now() - start,
      };
    } catch (error) {
      return {
        toolName,
        success: false,
        output: '',
        error: `Diff analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - start,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Tool: check_security
// ---------------------------------------------------------------------------

const checkSecurity: Tool = {
  definition: {
    name: 'check_security',
    description:
      'Deep security analysis of code content. Checks for hardcoded secrets, unsafe patterns.',
    params: [
      { name: 'content', type: 'string', description: 'Code content to analyze', required: true },
      {
        name: 'file_path',
        type: 'string',
        description: 'Path of the file being analyzed',
        required: false,
      },
    ],
    capabilities: [],
  },

  execute: async (args: Record<string, unknown>, _ctx: PluginContext): Promise<ToolCallResult> => {
    const start = Date.now();
    const toolName = 'check_security';
    try {
      if (!args.content || typeof args.content !== 'string') {
        return {
          toolName,
          success: false,
          output: '',
          error: 'content must be a non-empty string',
          durationMs: Date.now() - start,
        };
      }

      const content = args.content as string;
      const filePath = (args.file_path as string) || 'unknown';
      const lines = content.split('\n');
      const findings: ReviewFinding[] = [];

      const secPatterns: [string, RegExp, string][] = [
        [
          'Hardcoded secret',
          /(password|passwd|secret|token|api[_-]?key|auth)\s*[=:]\s*["'][^"'\s]{4,}["']/i,
          'Move secrets to environment variables.',
        ],
        ['Eval usage', /eval\s*\(/, 'Avoid eval(); it enables code injection.'],
        ['Unsafe exec', /exec\s*\(\s*["'`]/, 'Avoid shell command construction with user input.'],
        ['Unsafe innerHTML', /innerHTML\s*=/, 'Use textContent or safe DOM APIs instead.'],
        [
          'dangerouslySetInnerHTML',
          /dangerouslySetInnerHTML/,
          'This React prop bypasses XSS protection.',
        ],
        ['Weak crypto', /MD5|SHA-?1\b/i, 'Use SHA-256 or stronger hashing.'],
        ['SQL injection risk', /("|')\s*\+\s*\w+\s*\+\s*("|')/, 'Use parameterized queries.'],
        [
          'Hardcoded URL with credentials',
          /https?:\/\/[^\s"']*password[^\s"']*/i,
          'URL contains credentials.',
        ],
      ];

      for (let i = 0; i < lines.length; i++) {
        for (const [name, pattern, suggestion] of secPatterns) {
          if (pattern.test(lines[i])) {
            findings.push({
              file: filePath,
              line: i + 1,
              severity: name.includes('Hardcoded') || name.includes('injection')
                ? 'critical'
                : 'error',
              category: 'Security',
              message: `${name}: ${lines[i].trim().substring(0, 80)}`,
              suggestion,
            });
          }
        }
      }

      return {
        toolName,
        success: true,
        output: JSON.stringify({
          file: filePath,
          lines: lines.length,
          findings: findings.length,
          findings,
        }),
        durationMs: Date.now() - start,
      };
    } catch (error) {
      return {
        toolName,
        success: false,
        output: '',
        error: `Security check failed: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - start,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Tool: check_style
// ---------------------------------------------------------------------------

const checkStyle: Tool = {
  definition: {
    name: 'check_style',
    description: 'Check code for style and best practice violations.',
    params: [
      { name: 'content', type: 'string', description: 'Code content to check', required: true },
      { name: 'language', type: 'string', description: 'Programming language', required: true },
    ],
    capabilities: [],
  },

  execute: async (args: Record<string, unknown>, _ctx: PluginContext): Promise<ToolCallResult> => {
    const start = Date.now();
    const toolName = 'check_style';
    try {
      if (!args.content || typeof args.content !== 'string') {
        return {
          toolName,
          success: false,
          output: '',
          error: 'content must be a non-empty string',
          durationMs: Date.now() - start,
        };
      }
      if (!args.language || typeof args.language !== 'string') {
        return {
          toolName,
          success: false,
          output: '',
          error: 'language must be a non-empty string',
          durationMs: Date.now() - start,
        };
      }

      const content = args.content as string;
      const language = (args.language as string).toLowerCase();
      const lines = content.split('\n');
      const findings: ReviewFinding[] = [];

      const styleChecks: Record<string, [string, RegExp, string][]> = {
        typescript: [
          ['var usage', /\bvar\s+/, 'Use const or let instead of var.'],
          ['== instead of ===', /[^=!]==[^=]/, 'Use strict equality (===).'],
          [
            'console.log left in code',
            /console\.(log|warn|debug)\s*\(/,
            'Remove debugging console statements.',
          ],
          ['any type usage', /:\s*any\b/, "Avoid using 'any'."],
        ],
        javascript: [
          ['var usage', /\bvar\s+/, 'Use const or let instead of var.'],
          ['== instead of ===', /[^=!]==[^=]/, 'Use strict equality (===).'],
        ],
        python: [
          ['print left in code', /\bprint\s*\(/, 'Use logging instead of print().'],
          ['Bare except', /except\s*:/, 'Catch specific exceptions.'],
          ['Mutable default arg', /def\s+\w+\s*\(.*=\s*\[\]/, 'Avoid mutable default arguments.'],
        ],
        go: [
          ['Unhandled error', /(\w+),\s*_\s*:=/, 'Check pattern may be ignoring errors.'],
        ],
      };

      const rules = styleChecks[language] || [];
      for (let i = 0; i < lines.length; i++) {
        for (const [name, pattern, suggestion] of rules) {
          if (pattern.test(lines[i])) {
            findings.push({
              file: 'unknown',
              line: i + 1,
              severity: 'info',
              category: 'Style',
              message: `${name}: ${lines[i].trim().substring(0, 100)}`,
              suggestion,
            });
          }
        }
      }

      return {
        toolName,
        success: true,
        output: JSON.stringify({
          language,
          lines: lines.length,
          findings: findings.length,
          findings,
        }),
        durationMs: Date.now() - start,
      };
    } catch (error) {
      return {
        toolName,
        success: false,
        output: '',
        error: `Style check failed: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - start,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Tool: suggest_fixes
// ---------------------------------------------------------------------------

const suggestFixes: Tool = {
  definition: {
    name: 'suggest_fixes',
    description: 'Generate specific fix suggestions for issues found in code.',
    params: [
      {
        name: 'code_snippet',
        type: 'string',
        description: 'The code snippet that needs fixing',
        required: true,
      },
      {
        name: 'issue_description',
        type: 'string',
        description: 'Description of the issue to fix',
        required: true,
      },
    ],
    capabilities: [],
  },

  execute: async (args: Record<string, unknown>, _ctx: PluginContext): Promise<ToolCallResult> => {
    const start = Date.now();
    const toolName = 'suggest_fixes';
    try {
      if (!args.code_snippet || typeof args.code_snippet !== 'string') {
        return {
          toolName,
          success: false,
          output: '',
          error: 'code_snippet must be a non-empty string',
          durationMs: Date.now() - start,
        };
      }
      if (!args.issue_description || typeof args.issue_description !== 'string') {
        return {
          toolName,
          success: false,
          output: '',
          error: 'issue_description must be a non-empty string',
          durationMs: Date.now() - start,
        };
      }

      const snippet = args.code_snippet as string;
      const issue = args.issue_description as string;
      const fix = generateFixSuggestion(snippet, issue);

      return {
        toolName,
        success: true,
        output: JSON.stringify({ original: snippet, issue, ...fix }),
        durationMs: Date.now() - start,
      };
    } catch (error) {
      return {
        toolName,
        success: false,
        output: '',
        error: `Fix suggestion failed: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - start,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Tool: review_checks
// ---------------------------------------------------------------------------

const reviewChecks: Tool = {
  definition: {
    name: 'review_checks',
    description: 'List or run the available review check categories.',
    params: [
      {
        name: 'action',
        type: 'string',
        description: 'Action to perform',
        required: false,
        enum: ['list', 'run'],
      },
      {
        name: 'categories',
        type: 'string',
        description: 'Comma-separated categories to run',
        required: false,
      },
    ],
    capabilities: [],
  },

  execute: async (args: Record<string, unknown>, _ctx: PluginContext): Promise<ToolCallResult> => {
    const start = Date.now();
    const toolName = 'review_checks';
    try {
      const action = (args.action as string) || 'list';

      if (action === 'list') {
        const categories = Object.entries(CHECK_CATEGORIES).map(([key, cat]) => ({
          id: key,
          name: cat.name,
          description: cat.description,
          patternCount: cat.patterns.length,
        }));
        return {
          toolName,
          success: true,
          output: JSON.stringify({ action: 'list', categories }),
          durationMs: Date.now() - start,
        };
      }

      return {
        toolName,
        success: true,
        output: JSON.stringify({
          action,
          categories: args.categories,
          message: 'Run category analysis using review_pr or analyze_diff.',
        }),
        durationMs: Date.now() - start,
      };
    } catch (error) {
      return {
        toolName,
        success: false,
        output: '',
        error: `Checks failed: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - start,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// GitHub API helper
// ---------------------------------------------------------------------------

async function postGitHubReview(
  repo: string,
  prNumber: number,
  result: ReviewResult,
): Promise<void> {
  if (!config.githubToken) return;

  const url = `https://api.github.com/repos/${repo}/pulls/${prNumber}/reviews`;

  const comments = result.findings
    .filter((f) => f.severity === 'error' || f.severity === 'critical')
    .slice(0, 20)
    .map((f) => ({
      path: f.file,
      line: f.line,
      body: `**${f.severity.toUpperCase()}**: ${f.message}\n\nSuggestion: ${
        f.suggestion || 'Review this finding.'
      }`,
    }));

  const body = {
    body: result.summary,
    event: result.recommendation === 'approve'
      ? 'APPROVE'
      : result.recommendation === 'request_changes'
      ? 'REQUEST_CHANGES'
      : 'COMMENT',
    comments,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: getGitHubHeaders(config.githubToken),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      console.error(`[pr-review] Failed to post GitHub review: ${response.status}`);
    }
  } catch (error) {
    console.error(
      `[pr-review] GitHub review post failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function onLoad(ctx: PluginContext): Promise<void> {
  const githubToken = await ctx.config.get<string>('githubToken');
  const autoApprove = await ctx.config.get<string>('autoApprove');
  const maxFilesToReview = await ctx.config.get<number>('maxFilesToReview');

  config = {
    githubToken: githubToken ?? '',
    autoApprove: autoApprove ?? 'none',
    maxFilesToReview: maxFilesToReview ?? 50,
  };

  ctx.logger.info('[cortex-plugin-pr-review] Loaded');
}

export async function onUnload(_ctx: PluginContext): Promise<void> {
  // No cleanup needed
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const tools: Tool[] = [
  reviewPr,
  analyzeDiff,
  checkSecurity,
  checkStyle,
  suggestFixes,
  reviewChecks,
];
