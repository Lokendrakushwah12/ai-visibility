# Reading the numbers without fooling yourself

Read this before designing any UI. Every rule below exists because the obvious
reading of a chart is wrong, and the wrong reading drives real decisions —
usually about `robots.txt`, which is the one place a mistake costs you traffic
you can't get back.

## Crawls are not citations

The single most common error. Three different things get called "AI traffic":

- `train` (`GPTBot`, `CCBot`, `Bytespider`) is corpus crawling. It might pay off
  in a model release next year, or never. It is **not** evidence anyone was
  recommended anything.
- `search` (`OAI-SearchBot`, `Claude-SearchBot`, `PerplexityBot`) feeds the live
  index that produces citations *today*. This correlates with being cited.
- `user` (`ChatGPT-User`, `Claude-User`, `Perplexity-User`) means a real person's
  question caused that exact fetch, right then. Not a scheduled crawl.

This is why `purpose` exists as a column and why the dashboard must split on it.
A big `train` number and a zero `search` number is a specific, actionable
diagnosis; blended into one "AI crawls" figure it's invisible.

## Unverified crawl counts are an upper bound

User-Agent is a free-text header, and `GPTBot` is one of the most impersonated
strings on the web — precisely because sites grant those UAs trust. Show
**Proven %** (the share whose source IP fell inside the vendor's published range)
next to every crawl count, and read the unverified remainder as "unproven".

Vendors that publish no range can never be proven and sit at 0% forever. That's
a property of the vendor, not evidence of fraud. Label it "unprovable" rather
than implying the traffic is fake.

## Google is structurally invisible

`Google-Extended` is a robots.txt token that is never sent as a User-Agent.
Gemini grounding and AI Overviews both fetch as plain `Googlebot`. So a missing
Google row does **not** mean Google isn't reading you — it means this measurement
cannot see it. Say so in the UI, or someone will act on the gap.

## Crawl-to-refer is the number with teeth

Pages taken per visitor sent back, per vendor. It's the closest thing to a value
exchange: a vendor crawling thousands of pages and referring nobody is taking
without giving. Check it before touching `robots.txt` — and note that blocking
`train` bots doesn't affect citations, while blocking `search` bots does.

## A mention and a citation are different signals

A **mention** is model memory — it named you from training. A **citation** is
live retrieval — it actually linked you. Either can occur without the other, and
they move on different timescales. Don't collapse them into one "visibility"
figure.

## Never average across probe modes

`memory`, `retrieval` and `index` answer different questions with different
latencies (months, weeks, days). A mean over all three is a number with no
referent. Every query groups by mode; every chart says which mode it's showing.

## Know when to ignore your own dashboard

At the sample sizes this runs on, most week-to-week movement is noise. Twelve
prompts across two probes is ~24 answers, so **one answer is ~4pp**. A 5-10pp
weekly move is one model phrasing something differently, and reacting to it means
optimising for a coin flip.

Report integers, treat sub-10pp moves as noise, and read direction over four
periods rather than the last delta. Better still, make the comparison itself
refuse to call a change real unless it clears the combined margins — then nobody
has to remember this rule.

Corollary: a score of `null` (nobody named anybody) and a score of `0%` (others
named, you weren't) are different facts. Plotting the first as zero invents a
collapse that didn't happen.

## Don't pool vendors

"Never average across modes" has a twin one level down. Averaging a grounded
vendor with open-weight memory probes produces a number that describes no actual
user — nobody queries an average of four models.

Nominate one vendor to carry the headline, ideally the grounded one you can also
receive referral traffic from: that's the only surface where the probe half and
the traffic half corroborate each other, so it's the only place a visibility move
should show up in traffic too. Everything else informs the trend.

## A model upgrade is a series break

Prompt ids are frozen because they key the time series. A silent model upgrade
breaks it exactly as thoroughly and much less visibly — the number moves, nothing
in your config changed, and you go looking for a content explanation that doesn't
exist. Record the resolved model per row, prefer dated ids to `-latest` aliases,
and mark version changes on the chart.

## The scoring denominator

Visibility is **answers naming us ÷ answers naming anybody**. An answer that
recommends nobody ("it depends on your situation, try searching…") is information
about the prompt, not about you. Including those in the denominator means a batch
of evasive answers reads as a visibility drop that never happened.

Show the excluded count on hover so the number stays auditable — otherwise the
first person to recompute it by hand will get a different answer and stop
trusting the dashboard.

## What this deliberately cannot measure

Be honest about the ceiling, because the paid tools aren't:

- **No real-browser ChatGPT or Claude runs.** Past the ToS problem, a logged-in
  session carries memory, custom instructions and chat history — you'd be
  measuring what the assistant says **to you specifically**, which is
  systematically optimistic in a way you cannot quantify or correct for. It also
  can't run in CI.
- **No free read on OpenAI's or Anthropic's retrieval stack.** Gemini grounding
  is the one real vendor stack available at $0. A free open-weight model is the
  closest proxy for a given lineage — same family, different model, not what the
  product runs.
- **Memory scores are directional, not transferable.** Corpora overlap heavily
  (Common Crawl, the public web), so a memory score is comparable to *itself over
  time*, not across vendors. Read the trend, not the absolute.
- **You never see prompt text.** `user`-purpose fetches and referrals prove a
  live question happened and show which page it resolved to. The topic is a
  proxy; the wording is gone.

## Sanity checks that catch a broken build

- Plain browser traffic in `ai_visits` → the classifier matches too broadly.
- Every row `verified IS NULL` → the verification job isn't running.
- Every row `verified = 0` → probably fetching feeds but failing to parse them.
- `train` present, `search` and `user` both zero → plausible for a new site;
  suspicious for an established one (check the matcher isn't excluding paths).
- A visibility score of exactly 0% or 100% → check the denominator before
  believing it.
- Scores that move every single run → likely one sample per cell with no
  averaging, i.e. you're plotting sampling noise.
- Identical prompt scored twice gives different numbers → something
  non-deterministic is in the extraction path, usually an LLM judge.
