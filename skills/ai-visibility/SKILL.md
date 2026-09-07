---
name: ai-visibility
description: Build a self-hosted AI visibility / AEO tracker — log which AI crawlers (GPTBot, ClaudeBot, OAI-SearchBot, PerplexityBot) fetch your pages and which humans arrive from ChatGPT/Claude/Perplexity, verify crawlers against vendors' published IP ranges, and probe whether models actually recommend you across memory/retrieval/index modes with share-of-voice scoring. Use this whenever the user mentions AI crawler tracking, AEO, GEO, "LLM SEO", answer-engine optimisation, bot traffic analytics, "am I visible in ChatGPT", share of voice in AI answers, llms.txt, or porting an ai-visibility dashboard into another project — even when they only say "track AI bots", "see if ChatGPT knows my site", or "SEO for LLMs".
---

# AI visibility tracker

Builds a self-hosted answer to "do AI systems read us, and do they recommend us?"
It replaces the paid AEO tools (Profound, ByDefault, Peec) for the parts you can
honestly measure for free.

Two halves. They answer different questions and are worth building in either
order — but **build the traffic half first if the user has no preference**: it is
free, needs no API keys, and starts producing data the moment it deploys.

| Half | Question | Cost | Needs |
|---|---|---|---|
| **Traffic** | Who reads us? | $0 | a DB table + a request hook |
| **Prompts** | Who recommends us? | ~$0 | LLM API keys (free tiers work) |

The value is not the charts. It is the taxonomy and the honesty rules — a naive
build of this produces numbers that are confidently wrong, in ways this skill
names explicitly. Read `references/interpretation.md` before designing any UI.

## Why it can't come from normal analytics

Bots don't run JavaScript. GA, Umami, Vercel Analytics, Plausible — all of them
see **zero** AI crawler traffic, because all of them are client-side beacons.
Server-side logging is the only way to see any of it. Say this to the user if
they ask why their existing analytics doesn't already show it.

## Data model

Two tables. `assets/schema.sql` has SQLite/libSQL DDL plus a Postgres variant;
adapt names to the project's conventions rather than importing verbatim.

**`ai_visits`** — one row per crawler hit or assistant referral:

```
id, ts, kind, agent, vendor, purpose, path, ip, user_agent, referer, country, verified
```

- `kind` — `crawl` (a bot fetched us) or `referral` (a human clicked through from
  an assistant). Wildly different signals; never sum them.
- `purpose` — `train` | `search` | `user` | `dev` | `referral`. **The single most
  important column.** See the taxonomy below.
- `verified` — tri-state on purpose: `NULL` not yet checked, `1` source IP inside
  the vendor's published range, `0` failed or the vendor publishes no range.
  A boolean would conflate "unproven" with "fake".

**One row per hit, not a daily roll-up.** A roll-up (`date × agent × count`) is
genuinely tempting — thousands of rows a year instead of millions — and it costs
you three things that are hard to get back:

- **IP verification becomes impossible.** Proving a crawler needs its individual
  source IP, and a roll-up has nowhere to put it. `Proven %` disappears.
- **Path-level analysis disappears** — crawl budget per page is one of the few
  genuinely actionable views here.
- **Referrals lose their detail**, and those are the rows closest to revenue.

Retention is what makes per-hit affordable, so add the prune on day one rather
than reaching for a roll-up when the table gets big.

**`ai_prompt_runs`** — one row per (prompt × provider × run):

```
id, ts, run_date, prompt_id, prompt, provider, model, mode,
mentioned, position, cited, cited_urls, competitors, answer, error
```

- `mode` — `memory` | `retrieval` | `index`. Averaging across modes is
  meaningless; every query must group by it.
- `answer` — keep the full text. When a score moves you will want to read *why*,
  and a number alone can't tell you.
- `run_date` as `YYYY-MM-DD` so a day's runs group cleanly regardless of clock
  time or timezone drift between runners.

## Half 1 — Traffic

### The purpose taxonomy

This is the part most dashboards get wrong, and getting it right is most of the
value. These bots are constantly lumped together and they mean different things:

- **`train`** — corpus crawling (`GPTBot`, `ClaudeBot`, `CCBot`, `Bytespider`).
  Might pay off in a model release next year, or never. Not a citation signal.
- **`search`** — the assistant's own live index (`OAI-SearchBot`,
  `Claude-SearchBot`, `PerplexityBot`). This is what produces citations *today*.
- **`user`** — a real person's question triggered this exact fetch, right now
  (`ChatGPT-User`, `Claude-User`, `Perplexity-User`). The strongest signal in the
  table, and the closest thing you get to observed demand.
- **`dev`** — coding agents pulling pages into a session (Cursor, Devin, Codex).
- **`referral`** — a human arrived from an assistant's UI.

A single "AI traffic" number blends all five and tells you nothing actionable.

### Capture

Get the catalogue and classifier from `assets/agents.ts` — a dependency-free
`classify({ userAgent, referer, utmSource })` returning `null` for the ~99% of
requests that are neither. It matches User-Agent against ~28 crawlers, then
Referer host against ~13 assistant domains, then `?utm_source`. Order matters:
specific patterns precede the generic ones they're substrings of
(`Claude-SearchBot` before `ClaudeBot`).

Wire it into whatever runs before the response. For Next.js that's
`middleware.ts` (or `proxy.ts` on Next 16+). `references/adapters.md` covers
other frameworks and runtimes.

Four things the capture must do, each for a reason:

1. **Never block the response.** Fire the insert into a background primitive —
   `event.waitUntil()` on edge runtimes, or an unawaited promise with a catch.
   A tracking write must not be able to slow down or fail a page.
2. **Skip prefetches.** Next's router prefetch sends `next-router-prefetch` /
   `purpose: prefetch`; counting those double-counts every real user.
3. **Store the raw IP**, taken as the *first* entry of `x-forwarded-for` (it's a
   comma-separated chain). Verification happens later and needs the original.
4. **Skip API routes and static assets** via the matcher, but **keep
   `robots.txt`, `sitemap.xml` and `llms.txt`** — a bot fetching those is a
   discovery signal worth having.

On edge runtimes, avoid pulling a full ORM into the request path; a small raw
HTTP writer keeps the bundle honest. See `references/adapters.md`.

### Verifying crawlers

User-Agent is a free-text header, and `GPTBot` is among the most impersonated
strings on the web. Treat unverified counts as an **upper bound**.

A scheduled job (every few hours) fetches each vendor's published IP-range feed,
matches unchecked rows' source IPs by CIDR, and sets `verified`. Feed URLs are in
`references/catalogue.md`. Cache the feeds — they change rarely and you are
re-checking many rows against the same ranges.

Vendors publishing no feed can never be proven and sit at 0% forever. Surface
that as "unprovable", not as suspected fraud — it's a property of the vendor.

## Half 2 — Prompts

### Three probes, not one score

"Are we visible to AI" is three questions. Collapsing them into one number is
exactly what makes the commercial dashboards useless, because the fix differs:

| Mode | Asks | Moves in |
|---|---|---|
| **memory** | Does the model know us with *no* web access? | model releases — months |
| **retrieval** | Would a model that *can* search cite us? | weeks |
| **index** | Can the search layer find us for this query at all? | days |

Read a prompt's row across all three:

- **memory 0, indexed** → findable, but models haven't absorbed it. Get written
  about, wait for a corpus refresh. Slow.
- **memory 0, not indexed** → you don't rank for this query at all. Write the
  page, fix the structure. **Actionable this month.**
- **memory hit, not indexed** → known but not currently findable. Usually a page
  that died or was never linked.

One blended percentage shows the same "not mentioned" for all three.

`references/probes.md` has provider-by-provider implementation, free-tier limits
and rate-limit handling.

### Scoring

Visibility is **answers naming us ÷ answers naming anybody** — not ÷ all answers.
An answer that recommends nobody ("it depends, try searching…") is information
about the prompt, not about you; letting a batch of evasive answers into the
denominator reads as a visibility drop that never happened. Show the excluded
count somewhere so the number stays auditable.

When the denominator is empty, the score is **`null`, not 0%**. Nobody was named,
so nothing was measured — and a zero plotted on a trend line is indistinguishable
from a real collapse. This is the same mistake as a boolean `verified` column:
"no data" and "bad result" must not share a value.

Extract four things per answer (mechanics in `references/probes.md`):

- **mentioned** — named at all
- **position** — 1-based order of first appearance among recognised brands.
  Models write ordered lists more often than not, so "who got named first" is
  real signal. In `index` mode this is the raw search rank instead.
- **cited** — actually linked your domain. Much stronger than a mention: a
  mention is model memory, a citation is live retrieval. Either can occur alone.
- **competitors** — who else was named, i.e. share of voice.

**Extract deterministically. Never ask a model to score the answer.** It is the
obvious shortcut and it destroys the series: the grader's own biases and version
drift end up inside your metric, and you can no longer tell a change in your
visibility from a change in the grader. Regex and string positions are auditable
and free; an LLM judge is neither.

**Strip brands the prompt itself named.** If the prompt says "is Ramp better than
Brex for expense management", the model repeating both is not a recommendation —
it's an echo. Scoring seeded mentions as visibility inflates exactly the prompts
you were most curious about.

**Match aliases on non-alphanumeric boundaries, not `\b`.** Two distinct traps,
and every implementation hits at least one:

- dots — `\blevels\.fyi\b` misbehaves because `.` is itself a word boundary
- substrings of ordinary prose — `Ramp` matches "fiat on-**ramp**", `Ada`
  matches "**Ada**lytics"

Assume your brand name occurs inside unrelated English and inside longer brand
names. A false positive here is worse than a miss, because it reads as success.

### How much movement is real

The skill of this measurement is knowing when *not* to react, and small-N
arithmetic decides that. Twelve prompts across two free memory probes is ~24
answers a week, so **one answer moves the number by ~4pp**. A weekly wobble of
5-10pp is a single model phrasing something differently.

Three things follow, and they're worth building in rather than writing down:

- **Sample each cell K times** (K=3 is enough) and average *within* the
  `(period, model, prompt)` cell before averaging across cells. `temperature: 0`
  reduces variance but never measures it; one sample per cell has no error bar
  at all, and you cannot tell noise from signal without one.
- **Report integers, and gate on significance.** Ship the comparison as a query
  that refuses to call a period-over-period change real unless it clears the
  combined margins — a number that arrives pre-qualified beats a prose caveat
  nobody reads.
- **Read the 4-run trend, not the last run.** Direction over four periods is
  meaningful at this N; a single delta is not.

**Freeze the model version.** Prompt ids must never be renumbered because they
key the time series — and a silent model upgrade breaks that series just as
thoroughly, far more invisibly. The number moves, nothing in your config
changed, and you go hunting for a content explanation that doesn't exist. Record the resolved model string on
every row (the schema has a `model` column) and treat a change as a **series
break**, not a data point. Pinning a dated model id beats a floating alias.

**Don't pool vendors.** "Never average across modes" has a twin one level down:
averaging a grounded vendor with open-weight memory probes produces a
number describing no real user. Pick one vendor to carry the headline — ideally
the grounded one you can *also* receive referral traffic from, because that is
the only surface where the probe half and the traffic half corroborate each
other. The rest inform the trend and stay out of the headline.

### Curating prompts and competitors

- Prompts must be **questions a person would type**, not keyword strings. "best
  job boards for new grad engineers" is a real chat message; "job board new grad
  SWE" is an SEO keyword nobody says to an assistant.
- **Keep the set small and stable.** Twelve prompts tracked six months beats
  sixty tracked two weeks. Never reuse or renumber a prompt `id` — it's the key
  of the time series, and churn destroys the thing you're paying for.
- Anything absent from the competitor list is **invisible** to share-of-voice.
  When a brand shows up in an `answer` that isn't tracked, add it.

### Where the prompts should come from

The tracked prompts are guesses. Profound's moat is that theirs aren't — they buy
hundreds of millions of real conversations from consumer panels. You can't
reproduce that, but you can reproduce a sliver from your own `ai_visits`:

`purpose = 'user'` fetches and `kind = 'referral'` arrivals both mean a live
human question resolved to one of your pages. You never see the prompt text, but
you see the path, which is a usable proxy for topic — and unlike the guesses,
it's measured. **When a path recurs there and no tracked prompt covers it, that's
the prompt to add** (or the page to write).

### Cost ceilings

Memory and retrieval probes run on free tiers. A search-index probe (Exa,
Brave, Serper) is usually the only paid path, and it likely shares a key with
something that matters more. Put ceilings in the runner that **skip rather than
fail**, so a re-run by hand costs nothing:

- once per day maximum, regardless of invocations
- a monthly search cap from an env var
- `--force` to override both
- print month-to-date spend on every run
- **refuse to run while the brand is still a placeholder** — a first live run
  that records everything against `"YOUR BRAND"` silently poisons the start of
  the series, which is the one period you can never re-measure

Weekly is the right default cadence: the underlying scores move in weeks, and
daily multiplies cost ~7× for noise.

## Dashboard

Whatever the stack, these are the views that earn their place:

- **Crawls by vendor** over a window, with a **Proven %** column from `verified`.
- **Purpose split** — the `train`/`search`/`user` breakdown, so nobody reads
  corpus crawling as citations.
- **Most-crawled paths** — where the models actually spend crawl budget. Usually
  far more lopsided than expected, and `/robots.txt` ranking high is normal.
- **Crawl-to-refer ratio** — pages taken per visitor sent back, per vendor. The
  number with teeth, and the one to check before touching `robots.txt`.
- **Recent activity** — newest first, with `purpose` visible per row.
- **By-prompt table** — one row per prompt, one column per mode, so the
  three-way read above is possible at a glance.

Gate it. An allowlist checked against the session, returning **404 rather than
403** so the route's existence isn't advertised, is enough for a single-operator
admin area.

## Retention

`ai_visits` grows with crawl volume, which grows on its own. Add a prune from the
start rather than discovering the table is huge:

```sql
DELETE FROM ai_visits WHERE ts < unixepoch() - 60*60*24*180;
```

## Verify it works

Don't declare done on "it deployed". Check, in this order:

1. `curl -A "GPTBot" https://<site>/` then confirm one `ai_visits` row with
   `kind=crawl`, `agent=GPTBot`, `purpose=train`.
2. `curl -H "Referer: https://chatgpt.com/" https://<site>/` → `kind=referral`.
3. A normal browser request writes **nothing** — if plain visits are landing in
   the table, the classifier is matching too broadly.
4. Response timing is unchanged with tracking on (the write must be off the
   request path).
5. Run the prompt runner in dry mode first and confirm it **spends nothing** —
   not merely that it skips the insert. A `--dry` that still calls the billable
   API and then declines to write is not a dry run, and it's an easy thing to
   ship by accident.
6. Re-run the same prompt twice and confirm the recorded score is identical.
   If it isn't, extraction is non-deterministic (usually an LLM in the scoring
   path) and the time series will drift on its own.

## Reference files

- `references/catalogue.md` — full crawler + referrer tables, IP-range feed URLs,
  what's deliberately excluded and why, maintenance notes
- `references/probes.md` — the three probes provider by provider, scoring
  extraction, free tiers, rate limits
- `references/interpretation.md` — how to read every number without fooling
  yourself. **Read before building UI.**
- `references/adapters.md` — DB dialects, runtime header differences, capture
  points per framework
- `assets/agents.ts` — dependency-free catalogue + `classify()`, copy-ready
- `assets/schema.sql` — DDL for SQLite/libSQL and Postgres
