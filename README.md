# ai-visibility

A skill for building a self-hosted **AI visibility / AEO tracker**: log which AI
crawlers read your site and which humans arrive from ChatGPT, Claude or
Perplexity, verify crawlers against vendors' published IP ranges, and probe
whether models actually recommend you.

Covers the parts of the paid AEO tools (Profound, ByDefault, Peec) you can
honestly measure for free — and is explicit about the parts nobody can.

## Install

**Claude Code plugin:**

```bash
claude plugin marketplace add Lokendrakushwah12/ai-visibility
claude plugin install ai-visibility@ai-visibility
```

**Any agent** via [vercel-labs/skills](https://github.com/vercel-labs/skills), a
third-party CLI — Claude Code, Cursor, Codex and others:

```bash
npx skills add Lokendrakushwah12/ai-visibility      # into ./<agent>/skills/
npx skills add -g Lokendrakushwah12/ai-visibility   # global
```

**By hand:**

```bash
git clone https://github.com/Lokendrakushwah12/ai-visibility.git
cp -R ai-visibility/skills/ai-visibility ~/.claude/skills/
```

The `skills/<name>/SKILL.md` layout is what lets one repo serve all three —
Claude Code plugins require it, and the `skills` CLI discovers the same path.

## Use it

Once installed, just describe what you want; the skill triggers on its own:

> "google analytics shows me nothing for my docs pages — is ChatGPT even
> crawling them? set up server-side logging and somewhere to look at it"

> "leadership keeps asking whether we show up in AI search. build something
> in-repo that answers it, both the bots and whether models mention us"

> "how should I score model mentions so the number isn't garbage?"

It builds the capture, the schema, the verification job and the dashboard for
your stack — then tells you which numbers to distrust.

## The two halves

Either is usable alone. Traffic is free and needs no API keys, so it's the
sensible first step.

| Half | Question | Cost | Needs |
|---|---|---|---|
| **Traffic** | Who reads us? | $0 | a DB table + a request hook |
| **Prompts** | Who recommends us? | ~$0 | LLM API keys (free tiers work) |

### Traffic

Every request is classified against ~28 crawler User-Agents and ~13 assistant
referrer domains, then written to one row per hit. The column that carries the
insight is `purpose`, because these get lumped together constantly and mean
completely different things:

| purpose | Example | What it means |
|---|---|---|
| `train` | `GPTBot`, `CCBot` | corpus crawling — may pay off in a future model, or never |
| `search` | `OAI-SearchBot`, `PerplexityBot` | the live index that produces citations **today** |
| `user` | `ChatGPT-User`, `Claude-User` | a real person's question caused this exact fetch, right now |
| `dev` | Cursor, Devin | coding agents pulling pages into a session |
| `referral` | `chatgpt.com` referer | a human clicked through from an assistant |

A scheduled job then checks each hit's source IP against the vendor's published
range, because User-Agent is free text and `GPTBot` is among the most
impersonated strings on the web.

### Prompts

Three probes, deliberately never averaged together — they answer different
questions on different timescales, and the fix differs per cell:

| Mode | Asks | Moves in |
|---|---|---|
| `memory` | Does the model know us with **no** web access? | months, on model releases |
| `retrieval` | Would a model that *can* search cite us? | weeks |
| `index` | Can the search layer find us for this query at all? | days |

Visibility is **answers naming us ÷ answers naming anybody** — not ÷ all
answers, because an answer recommending nobody is information about the prompt,
not about you.

## What's in here

- `SKILL.md` — the guide: data model, both halves, dashboard, verification steps
- `references/interpretation.md` — how to read the numbers without fooling
  yourself. **The most important file here.**
- `references/catalogue.md` — the crawler + referrer tables, IP-range feeds,
  what's deliberately excluded and why
- `references/probes.md` — probe implementation, scoring, sampling, significance
- `references/adapters.md` — framework capture points, runtime headers, DB dialects
- `assets/agents.ts` — dependency-free catalogue + `classify()`, copy-ready
- `assets/schema.sql` — DDL for SQLite/libSQL and Postgres

## What it deliberately won't do

The honesty is the point — a naive build of this produces numbers that are
confidently wrong:

- **Crawls are not citations.** `GPTBot` volume is not evidence anyone was
  recommended anything.
- **Unverified crawl counts are an upper bound.** Vendors publishing no IP range
  can never be proven, and that's a property of the vendor, not fraud.
- **Google is structurally invisible.** `Google-Extended` is a robots.txt token
  that is never sent as a User-Agent; Gemini grounding fetches as plain
  `Googlebot`. Anyone selling you a "Google-Extended hits" chart is showing a zero.
- **No real-browser ChatGPT or Claude sessions.** Past the ToS problem, a
  logged-in session carries your memory and history — you'd measure what the
  assistant says *to you specifically*, which is optimistic in a way you can't
  correct for.
- **Most weekly movement is noise.** At ~24 sampled answers a week, one answer
  moves the score ~4pp. The skill tells you to gate on significance rather than
  react.

## Provenance

Extracted from a working implementation on
[engg.space](https://www.engg.space), then revised against an A/B evaluation:
three porting tasks (Next.js + Turso, SvelteKit + D1, scoring-only) run with and
without the skill and graded on 33 assertions.

**33/33 with the skill, 14/33 without** — at ~23% more tokens. The baselines were
strong, independently reaching for a purpose taxonomy and `waitUntil`; what they
consistently missed were the quiet failures — prefetch double-counting, the
tri-state `verified` column, the share-of-voice denominator.

Most of the revisions came from *reading the runs*, not the scores. Several came
from a baseline out-designing the first draft: K-sampling per cell, freezing the
model version as a series break, prompt-seeded brand exclusion, and never
letting an LLM grade the LLM. The eval set is in `evals/` if you want to re-run it.

## Install counts

A daily workflow snapshots GitHub's traffic data into
[`traffic/SUMMARY.md`](traffic/SUMMARY.md). It exists because GitHub keeps only
a **14-day rolling window** and discards the rest, so anything not captured is
lost for good.

Clones cover every install path — `claude plugin marketplace add`,
`npx skills add`, and manual `git clone` — and can't be told apart.
`claude plugin update` re-fetches, so `uniques` is the better proxy for people
than `count`. None of it measures actual *use*: a skill is static markdown with
no runtime, so acquisition is the only thing observable.
