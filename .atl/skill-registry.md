# Skill Registry

**Delegator use only.** Any agent that launches sub-agents reads this registry to resolve compact rules, then injects them directly into sub-agent prompts. Sub-agents do NOT read this registry or individual SKILL.md files.

## User Skills

| Trigger | Skill | Path |
|---------|-------|------|
| When creating a PR, opening a PR, or preparing changes for review | branch-pr | C:/Users/henry/.claude/skills/branch-pr/SKILL.md |
| When writing Go tests, using teatest, or adding test coverage | go-testing | C:/Users/henry/.claude/skills/go-testing/SKILL.md |
| When creating a GitHub issue, reporting a bug, or requesting a feature | issue-creation | C:/Users/henry/.claude/skills/issue-creation/SKILL.md |
| When user says "judgment day", "dual review", "doble review", "juzgar" | judgment-day | C:/Users/henry/.claude/skills/judgment-day/SKILL.md |
| When user asks to create a new skill, add agent instructions, or document patterns for AI | skill-creator | C:/Users/henry/.claude/skills/skill-creator/SKILL.md |

## Compact Rules

Pre-digested rules per skill. Delegators copy matching blocks into sub-agent prompts as `## Project Standards (auto-resolved)`.

### branch-pr
- Every PR MUST link an approved GitHub issue — no exceptions
- Every PR MUST have exactly one `type:*` label
- Automated checks must pass before merge
- Blank PRs without issue linkage will be blocked by GitHub Actions
- Branch naming: `type/description` lowercase, only `a-z0-9._-`

### go-testing
- Use table-driven tests (`[]struct{ name, input, want }`) as the standard pattern
- Use `t.Run(tc.name, ...)` for subtests
- Use `teatest` for Bubbletea TUI component testing
- Golden files go in `testdata/` with `.golden` extension
- Never use `time.Sleep` in tests — use `teatest.WaitFor` instead

### issue-creation
- Blank issues are disabled — MUST use a bug report or feature request template
- Every issue gets `status:needs-review` automatically on creation
- A maintainer MUST add `status:approved` before any PR can be opened
- Questions go to Discussions, not issues

### judgment-day
- Launch exactly two blind judge sub-agents simultaneously (parallel, no communication)
- Each judge reviews the same target independently
- Synthesize findings after both return — identify consensus vs. disagreement
- Apply fixes only on clear consensus (both judges agree)
- Re-judge after fixes, max 2 iterations; escalate to user if still failing
- Never share one judge's findings with the other before synthesis

### skill-creator
- Skills live in `~/.claude/skills/{skill-name}/SKILL.md`
- Frontmatter MUST include: name, description (with Trigger: line), license, metadata.author, metadata.version
- Critical Patterns section is mandatory — this is what sub-agents use
- Keep skills focused on one concern — no omnibus skills
- Include allowed-tools in frontmatter if the skill uses specific tools

## Project Conventions

| File | Path | Notes |
|------|------|-------|
| AGENTS.md | AGENTS.md | GGA guardrails — 3 rules verified on every commit |
| CLAUDE.md | CLAUDE.md | Project steering — 3 layers: principles, criteria, decisions |

Read the convention files listed above for project-specific patterns and rules.
