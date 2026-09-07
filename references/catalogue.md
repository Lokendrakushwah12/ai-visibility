# Crawler and referrer catalogue

The machine-readable version is `assets/agents.ts` — copy that rather than
retyping these tables. This file explains what's in it, what's deliberately
missing, and how to keep it current.

## Contents

- [Crawlers](#crawlers)
- [Assistant referrers](#assistant-referrers)
- [IP-range feeds](#ip-range-feeds)
- [Deliberately excluded](#deliberately-excluded)
- [Maintenance](#maintenance)

## Crawlers

Ordered — **first match wins**, so specific patterns must precede the generic
ones they are substrings of. `Claude-SearchBot` before `ClaudeBot`, or every
search fetch is miscounted as training.

| Agent | Vendor | Purpose | Verifiable |
|---|---|---|---|
| `OAI-SearchBot` | openai | search | yes |
| `ChatGPT-User` | openai | user | yes |
| `GPTBot` | openai | train | yes |
| `Claude-SearchBot` | anthropic | search | yes |
| `Claude-User` | anthropic | user | yes |
| `ClaudeBot` | anthropic | train | yes |
| `anthropic-ai`, `Claude-Web` | anthropic | train | no (retired UAs) |
| `Perplexity-User` | perplexity | user | yes |
| `PerplexityBot` | perplexity | search | yes |
| `meta-externalagent`, `FacebookBot` | meta | train | no |
| `meta-externalfetcher` | meta | user | no |
| `Applebot` | apple | search | no |
| `Amazonbot` | amazon | train | no |
| `Bytespider`, `TikTokSpider` | bytedance | train | no |
| `MistralAI-User` | mistral | user | no |
| `cohere-ai` | cohere | train | no |
| `DuckAssistBot` | duckduckgo | search | no |
| `YouBot` | you.com | search | no |
| `CCBot` | commoncrawl | train | no |
| `AI2Bot` | allenai | train | no |
| `Diffbot`, `Timpibot`, `ImagesiftBot`, `PanguBot` | various | train | no |
| `Devin` | cognition | dev | no |
| `Cursor` | cursor | dev | no |
| `Codex` | openai | dev | no |

The retired Anthropic UAs are kept on purpose: traffic still arrives claiming
them, and by now it is almost always impersonators. Counting them separately is
how you can see that.

Coding-agent UAs are the least stable entries here and none publish IP ranges.
Treat those counts as indicative.

## Assistant referrers

Matched against the **Referer host**, and against `?utm_source` for assistants
that tag outbound links (OpenAI is the main one).

`chatgpt.com` · `claude.ai` · `perplexity.ai` · `copilot.microsoft.com` ·
`gemini.google.com` · `grok.com` · `meta.ai` · `mistral.ai` · `you.com` ·
`phind.com` · `poe.com` · `t3.chat` · `kagi.com`

Anchor these patterns as `(^|\.)host$` so a subdomain matches but
`notchatgpt.com.evil.example` doesn't.

## IP-range feeds

Keyed by the agent's `verifyWith`:

| Key | Feed |
|---|---|
| `openai-gptbot` | `https://openai.com/gptbot.json` |
| `openai-searchbot` | `https://openai.com/searchbot.json` |
| `openai-chatgpt-user` | `https://openai.com/chatgpt-user.json` |
| `anthropic` | `https://claude.com/crawling/bots.json` (covers all three Claude bots) |
| `perplexity-bot` | `https://www.perplexity.com/perplexitybot.json` |
| `perplexity-user` | `https://www.perplexity.com/perplexity-user.json` |

**Parse these schema-agnostically.** OpenAI ships `{prefixes:[{ipv4Prefix}]}`,
others ship flat arrays or nest per-bot, and any of them can change shape without
warning. Walk the JSON for anything that looks like a CIDR:

```
/^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:]+)(?:\/\d{1,3})?$/
```

That survives all of it, and a feed you can't parse degrades to *unverified* —
never to a false positive. This matters more than it looks: a verifier that
throws on an unexpected shape silently stops verifying, and the dashboard keeps
showing plausible numbers.

Keep this out of the request path. It's a scheduled job — fetching six JSON
documents on a cold edge isolate to serve one page would be absurd. Cache the
parsed ranges for the duration of a run.

## Deliberately excluded

Leaving these out is a correctness decision, not an oversight:

- **`Google-Extended`** — a robots.txt token, *never* sent as a User-Agent, so it
  cannot appear in logs. Gemini grounding and AI Overviews both fetch as plain
  `Googlebot`, which means Google's AI reads are structurally invisible here.
  Anyone selling a "Google-Extended hits" chart is showing a zero.
- **`Applebot-Extended`** — same: robots.txt token, not a UA.
- **Plain `Googlebot` / `bingbot`** — classic search crawlers. Including them
  drowns the AI signal in ordinary SEO traffic, which existing tools already
  cover.

## Maintenance

- New bots appear every few months. When an unfamiliar UA shows real volume, look
  it up before adding it — plenty of traffic claims to be an AI crawler and isn't.
- Assign `purpose` from what the bot *does*, not what its name suggests. Getting
  `train` vs `search` wrong is the difference between "might matter next year"
  and "is producing citations today".
- Never rename an `id`. It's the key of the time series in `ai_visits.agent`.
