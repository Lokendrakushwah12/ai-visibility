# ai-visibility

A skill for building a self-hosted **AI visibility / AEO tracker**: log which AI
crawlers read your site and which humans arrive from ChatGPT, Claude or
Perplexity, verify crawlers against vendors' published IP ranges, and probe
whether models actually recommend you.

Replaces the paid AEO tools (Profound, ByDefault, Peec) for the parts you can
honestly measure — and is explicit about the parts you can't.

## Install

**Claude Code plugin** (first-party):

```bash
claude plugin marketplace add Lokendrakushwah12/ai-visibility
claude plugin install ai-visibility@ai-visibility
```

**Any agent** via [vercel-labs/skills](https://github.com/vercel-labs/skills), a
third-party CLI — works with Claude Code, Cursor, Codex and others:

```bash
npx skills add Lokendrakushwah12/ai-visibility      # into ./<agent>/skills/
npx skills add -g Lokendrakushwah12/ai-visibility   # global
```

**By hand**, if you'd rather not run either:

```bash
git clone git@github.com:Lokendrakushwah12/ai-visibility.git
cp -R ai-visibility/skills/ai-visibility ~/.claude/skills/
```

The `skills/<name>/SKILL.md` layout is what lets one repo serve all three —
Claude Code plugins require it, and the `skills` CLI discovers it.

## What it covers

Two halves, either usable alone:

| Half | Question | Cost | Needs |
|---|---|---|---|
| **Traffic** | Who reads us? | $0 | a DB table + a request hook |
| **Prompts** | Who recommends us? | ~$0 | LLM API keys (free tiers work) |

- `SKILL.md` — the guide: data model, both halves, dashboard, verification steps
- `references/catalogue.md` — ~28 crawler UAs + 13 assistant referrers, IP-range
  feeds, what's deliberately excluded and why
- `references/probes.md` — the three probe modes, scoring, sampling, significance
- `references/interpretation.md` — how to read the numbers without fooling
  yourself. The most important file here.
- `references/adapters.md` — framework capture points, runtime headers, DB dialects
- `assets/agents.ts` — dependency-free catalogue + `classify()`, copy-ready
- `assets/schema.sql` — DDL for SQLite/libSQL and Postgres

## Why the interpretation file matters

A naive build of this produces numbers that are confidently wrong. Crawls are
not citations; unverified crawl counts are an upper bound because User-Agent is
free text; Google is structurally invisible because `Google-Extended` is a
robots.txt token that never appears as a User-Agent; and at ~24 sampled answers a
week, one answer moves a visibility score by ~4pp — so most week-to-week movement
is noise. The skill names each of these so the dashboard stays honest.

## Provenance

Extracted from a working implementation on
[engg.space](https://www.engg.space), then revised against an A/B evaluation:
three porting tasks run with and without the skill, graded on 33 assertions.
Several improvements came from the *baseline* runs out-designing the first draft
— notably K-sampling, model-version freezing and prompt-seeded brand exclusion.
