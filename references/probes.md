# The three probes

Each probe answers a different question. Build them behind one interface so a
project can enable whichever keys it has — a missing key should disable a probe,
never fail a run.

## Contents

- [The probe interface](#the-probe-interface)
- [Memory probes](#memory-probes)
- [Retrieval probe](#retrieval-probe)
- [Index probe](#index-probe)
- [Extracting the score](#extracting-the-score)
- [Sampling and significance](#sampling-and-significance)
- [Weighting alternatives](#weighting-alternatives)
- [Pacing and ceilings](#pacing-and-ceilings)

## The probe interface

```ts
type ProbeMode = "memory" | "retrieval" | "index";

type Probe = {
  id: string;
  mode: ProbeMode;
  model: string;
  /** Minimum ms between two calls to THIS probe. Free tiers are strict. */
  minIntervalMs: number;
  enabled: () => boolean;              // usually !!process.env.SOME_KEY
  run: (prompt: string) => Promise<{
    text: string;
    urls: string[];
    positionOverride?: number | null;  // index mode: raw search rank
  }>;
};
```

`enabled()` reading an env var is what makes the whole thing degrade gracefully:
enumerate the probes, filter by `enabled()`, and if none are enabled exit with a
message instead of throwing.

## Memory probes

**Question:** does the model know us with no web access? **Moves in:** months,
on model releases.

Any OpenAI-compatible `/chat/completions` endpoint with tools off. Free tiers
that work well here: Cerebras, Groq, Mistral, Gemini. One factory covers all of
them — they differ only in base URL, env key and default model.

Use `temperature: 0`. You are measuring a corpus, not sampling creativity, and
run-to-run variance is noise in a time series.

Wrap the prompt. Two failure modes to head off:

```
<prompt>

Answer from your own knowledge - you do not have web access and should not
pretend to. Name specific sites or products, most recommended first, as a
numbered list. If you genuinely don't know of any, say so plainly rather than
guessing.
```

Without it, models hedge into "I can't browse the web" (an answer about the tool,
not about you) or return prose with no rankable list. The "say so plainly" clause
matters — it separates *doesn't know* from *invents plausible names*, and an
invented competitor set poisons share-of-voice.

Memory probes return no URLs; `cited` is always false in this mode by
construction.

## Retrieval probe

**Question:** would a model that *can* search cite us? **Moves in:** weeks.

Gemini with the `google_search` tool is the one real vendor retrieval stack
available free:

```ts
POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent
headers: { "x-goog-api-key": GEMINI_API_KEY }
body:    { contents: [{ role: "user", parts: [{ text: prompt }] }],
           tools: [{ google_search: {} }] }
```

Do **not** wrap this prompt — you want its natural retrieval behaviour.

Pull citations from `candidates[0].groundingMetadata.groundingChunks[].web`. A
trap worth knowing: `web.uri` is a `vertexaisearch` redirect, so your real
hostname survives only in `web.domain`. Collect **both** and let the analyzer
check each, or you'll score genuine citations as misses.

## Index probe

**Question:** can the search layer find us for this query at all? **Moves in:**
days. Cheapest and most actionable — it tells you whether the problem is
upstream of the model entirely.

Query a search API directly (Exa, Brave, Serper) and record the raw rank of your
domain in the results as `positionOverride`. In this mode `position` is the
search rank, not a rank among named brands — that's the number that determines
whether a model ever sees you.

`mentioned` is "we appear in the top N"; N is worth an env var (10 is a sensible
default) because changing it silently changes the metric.

## Extracting the score

From `{ text, urls }`, derive four values:

- **mentioned** — a brand-alias regex hit anywhere in the text.
- **position** — 1-based order of first appearance among all recognised brands
  (yours + competitors), sorted by string index. Models write ordered lists more
  often than not, so "who got named first" is real signal.
- **cited** — any URL whose host equals your domain or ends with `.yourdomain`.
- **competitors** — every other recognised brand, in order of appearance.

Two implementation details that cause silent wrongness:

**Alias matching.** Use explicit non-alphanumeric lookarounds, not `\b`:

```ts
new RegExp(`(?<![a-z0-9])(?:${aliases.map(escape).join("|")})(?![a-z0-9])`, "i")
```

Two distinct failure modes, and independent implementations keep hitting them:

- **Dots.** `\blevels\.fyi\b` misbehaves because `.` is itself a word boundary,
  so the alias silently never matches and the brand reads as absent forever.
- **Substrings of ordinary prose or longer names.** `Ramp` matches "fiat
  on-**ramp**"; `Ada` matches "**Ada**lytics"; `Simplify` matches the verb.

The lookarounds fix the first. Only tight aliases fix the second — assume your
name occurs inside unrelated English and inside competitors' names, and test
exactly those cases. A false positive reads as success, which is why it survives
longer than a miss.

**URL sources.** Merge provider-supplied citation arrays with URLs scraped from
the answer text (`/https?:\/\/[^\s)\]<>"']+/gi`, trimming trailing punctuation).
Some providers return no citation array at all, and a markdown link in prose is
still a citation.

**Strip brands the prompt named.** A prompt like "is X better than Y for Z" seeds
both names; the model repeating them is an echo, not a recommendation. Remove any
brand appearing in the prompt text before scoring the answer, or the prompts you
were most curious about are the ones that inflate most.

**Never put a model in the scoring path.** Asking an LLM to judge "did this
answer recommend us" is the obvious shortcut and it ruins the series: the judge's
biases and its own version drift land inside your metric, and a change in the
number stops being attributable. Deterministic extraction is auditable, free,
and reproducible — the last of which is what a time series is made of.

## Sampling and significance

`temperature: 0` reduces variance; it does not measure it. One sample per cell
has no error bar, so you cannot distinguish a real move from a rephrasing.

**Sample K times per cell** (K=3 is plenty) and average *within* each
`(period, model, prompt)` cell before averaging across cells. Averaging all
answers together instead lets a prompt that happened to run more often dominate.

Then do the arithmetic that tells you when to ignore your own dashboard. At 12
prompts × 2 probes ≈ 24 answers, **one answer is ~4pp**:

- report integers — decimals imply precision you don't have
- treat sub-10pp period-over-period moves as noise
- read the 4-period trend, not the last delta
- return `null`, never `0%`, when nothing was named — no denominator means
  nothing was measured, and a plotted zero is indistinguishable from a collapse

**Ship the gate as a query, not a caveat.** A comparison that refuses to call a
change real unless it clears the combined margins delivers the number
pre-qualified. A warning in a README gets read once; the query runs every time.

**Freeze the model version.** Prompt ids must never be renumbered because they
key the series — a silent model upgrade breaks it identically and far less
visibly. Store the resolved model string per row and treat a change as a series
break. Prefer a dated model id over a floating alias like `-latest`.

**Don't pool vendors.** Averaging a grounded vendor with open-weight memory
probes yields a number describing no real user. Nominate one vendor to carry the
headline — ideally the grounded one you can also receive referral traffic from,
since that's the only surface where the probe half and the traffic half can
corroborate each other. Others inform the trend.

## Weighting alternatives

Raw `position` is the simple default and it's fine. If you want rank to carry
weight, normalise each answer to exactly 1.0 of credit split by `1/log2(rank+1)`
— "one answer is one ballot", so a model naming twenty brands can't outvote one
naming three.

Disclose its consequence rather than treating it as a bug: **share dilutes as the
competitor list grows.** Rank 1 of 12 scores *below* rank 3 of 3 under this
formula. That's defensible — being one of three named is a stronger position than
one of twelve — but it means your score moves when you add a competitor to the
tracked list, which anyone reading the trend has to know.

## Pacing and ceilings

**Pace per probe, not globally.** Free tiers are strict and asymmetric — one
provider at ~5 requests/minute shouldn't slow a provider that allows 100. Track
the last call time per probe and sleep only that probe. A full run taking a few
minutes is the rate limit, not slowness.

**Cadence: weekly.** These scores move in weeks; daily multiplies cost ~7× for
noise. Memory and retrieval are free, so the ceilings only need to guard the
paid index probe:

- **Once per day maximum**, regardless of invocations — so a human re-running the
  script by hand costs nothing.
- **A monthly search cap** from an env var, with a sane default.
- **`--force`** to override both, for when you actually mean it.
- **Print month-to-date count and estimated spend on every run**, so the budget
  is visible without going to a billing page.

Make both ceilings **skip rather than fail**. A run that exits non-zero in CI
because a budget was hit trains everyone to ignore the alert.

**Always ship a dry mode** (`--dry`): runs the prompts, prints what it would
record, writes nothing and spends nothing. It's the first thing to run after
wiring a new key, and the only safe way to smoke-test in someone else's project.

**A pure-logic self-test earns its keep.** Alias matching, position ordering and
URL extraction are all pure functions over strings — a couple of dozen
assertions with no network and no DB catch the regex mistakes above immediately,
and run in a second after any edit to the prompt or competitor lists.
