/**
 * Catalogue of AI crawlers and AI assistant referrers, plus the classifier that
 * turns a raw request into an `ai_visits` row.
 *
 * Drop-in: no imports, no framework or DB coupling. Call classify() from
 * whatever runs before your response and insert the result.
 *
 * Two very different signals live here:
 *
 *  - CRAWL     a bot fetched the page. Never runs JS, so Umami / Vercel Analytics
 *              are blind to all of it. This is the only way to see it.
 *  - REFERRAL  a human clicked a link inside an AI assistant and landed on us.
 *              This is the signal that maps to actual traffic and signups.
 *
 * `purpose` matters more than most dashboards admit:
 *   train   corpus crawling. Shows up months later (or never) as model knowledge.
 *   search  the assistant's own index, feeding live answers. Correlates with citations.
 *   user    a real user's question triggered this exact fetch, right now.
 *   dev     coding agents (Cursor, Devin, Codex-style) pulling pages into a session.
 */

export type AgentPurpose = "train" | "search" | "user" | "dev" | "referral";

export type AiAgent = {
  /** Stable key stored in ai_visits.agent - never rename, it is the series key */
  id: string;
  vendor: string;
  purpose: AgentPurpose;
  /** Matched against the User-Agent header. */
  test: RegExp;
  /**
   * Key into your IP-range feed map (see references/catalogue.md). Absent = the vendor
   * publishes no verifiable range, so the row stays `verified = 0` forever and
   * you should treat its volume as an upper bound.
   */
  verifyWith?: string;
};

/**
 * Order matters: first match wins. More specific patterns must come before the
 * generic ones they are a substring of (Claude-SearchBot before ClaudeBot, etc).
 */
export const AI_CRAWLERS: AiAgent[] = [
  // ── OpenAI ────────────────────────────────────────────────────────────────
  // Three distinct bots that people constantly lump together. Only the last two
  // have anything to do with whether ChatGPT can cite you today.
  { id: "OAI-SearchBot", vendor: "openai", purpose: "search", test: /OAI-SearchBot/i, verifyWith: "openai-searchbot" },
  { id: "ChatGPT-User", vendor: "openai", purpose: "user", test: /ChatGPT-User/i, verifyWith: "openai-chatgpt-user" },
  { id: "GPTBot", vendor: "openai", purpose: "train", test: /GPTBot/i, verifyWith: "openai-gptbot" },

  // ── Anthropic ─────────────────────────────────────────────────────────────
  { id: "Claude-SearchBot", vendor: "anthropic", purpose: "search", test: /Claude-SearchBot/i, verifyWith: "anthropic" },
  { id: "Claude-User", vendor: "anthropic", purpose: "user", test: /Claude-User/i, verifyWith: "anthropic" },
  { id: "ClaudeBot", vendor: "anthropic", purpose: "train", test: /ClaudeBot/i, verifyWith: "anthropic" },
  // Retired UAs still seen in the wild; almost always impersonators by now.
  { id: "anthropic-ai", vendor: "anthropic", purpose: "train", test: /anthropic-ai|Claude-Web/i },

  // ── Perplexity ────────────────────────────────────────────────────────────
  { id: "Perplexity-User", vendor: "perplexity", purpose: "user", test: /Perplexity-User/i, verifyWith: "perplexity-user" },
  { id: "PerplexityBot", vendor: "perplexity", purpose: "search", test: /PerplexityBot/i, verifyWith: "perplexity-bot" },

  // ── Meta / Apple / Amazon / ByteDance ──────────────────────────────────────
  { id: "meta-externalagent", vendor: "meta", purpose: "train", test: /meta-externalagent|FacebookBot/i },
  { id: "meta-externalfetcher", vendor: "meta", purpose: "user", test: /meta-externalfetcher/i },
  { id: "Applebot", vendor: "apple", purpose: "search", test: /Applebot(?!-Extended)/i },
  { id: "Amazonbot", vendor: "amazon", purpose: "train", test: /Amazonbot/i },
  { id: "Bytespider", vendor: "bytedance", purpose: "train", test: /Bytespider|TikTokSpider/i },

  // ── Everyone else ─────────────────────────────────────────────────────────
  { id: "MistralAI-User", vendor: "mistral", purpose: "user", test: /MistralAI-User/i },
  { id: "cohere-ai", vendor: "cohere", purpose: "train", test: /cohere-ai|cohere-training-data-crawler/i },
  { id: "DuckAssistBot", vendor: "duckduckgo", purpose: "search", test: /DuckAssistBot/i },
  { id: "YouBot", vendor: "you.com", purpose: "search", test: /YouBot/i },
  { id: "CCBot", vendor: "commoncrawl", purpose: "train", test: /CCBot/i },
  { id: "AI2Bot", vendor: "allenai", purpose: "train", test: /AI2Bot|Ai2Bot-Dolma/i },
  { id: "Diffbot", vendor: "diffbot", purpose: "train", test: /Diffbot/i },
  { id: "Timpibot", vendor: "timpi", purpose: "train", test: /Timpibot/i },
  { id: "ImagesiftBot", vendor: "imagesift", purpose: "train", test: /ImagesiftBot/i },
  { id: "PanguBot", vendor: "huawei", purpose: "train", test: /PanguBot/i },

  // ── Coding agents ─────────────────────────────────────────────────────────
  // These UAs are less stable than the ones above and none of them publish IP
  // ranges - treat the counts as indicative, not authoritative.
  { id: "Devin", vendor: "cognition", purpose: "dev", test: /Devin/i },
  { id: "Cursor", vendor: "cursor", purpose: "dev", test: /Cursor(?:\/|-Agent|bot)/i },
  { id: "Codex", vendor: "openai", purpose: "dev", test: /\bCodex(?:\/|-)/i },
];

/**
 * NOT in the list above, on purpose:
 *
 *   Google-Extended    a robots.txt token only. It is never sent as a User-Agent,
 *                      so it cannot appear in logs. Gemini grounding and AI
 *                      Overviews both fetch as plain Googlebot, which means
 *                      Google's AI reads are structurally invisible here.
 *   Applebot-Extended  same deal - robots.txt token, not a UA.
 *
 * Anyone selling you a "Google-Extended hits" chart is showing you a zero.
 */

export type AiReferrer = { id: string; vendor: string; test: RegExp };

/** Matched against the Referer header host, and against ?utm_source. */
export const AI_REFERRERS: AiReferrer[] = [
  { id: "chatgpt.com", vendor: "openai", test: /(^|\.)(chatgpt\.com|chat\.openai\.com|openai\.com)$/i },
  { id: "claude.ai", vendor: "anthropic", test: /(^|\.)claude\.ai$/i },
  { id: "perplexity.ai", vendor: "perplexity", test: /(^|\.)perplexity\.(ai|com)$/i },
  { id: "copilot.microsoft.com", vendor: "microsoft", test: /(^|\.)(copilot\.microsoft\.com|bing\.com)$/i },
  { id: "gemini.google.com", vendor: "google", test: /(^|\.)(gemini\.google\.com|bard\.google\.com|aistudio\.google\.com)$/i },
  { id: "grok.com", vendor: "xai", test: /(^|\.)(grok\.com|x\.ai)$/i },
  { id: "meta.ai", vendor: "meta", test: /(^|\.)meta\.ai$/i },
  { id: "mistral.ai", vendor: "mistral", test: /(^|\.)(chat\.mistral\.ai|mistral\.ai)$/i },
  { id: "you.com", vendor: "you.com", test: /(^|\.)you\.com$/i },
  { id: "phind.com", vendor: "phind", test: /(^|\.)phind\.com$/i },
  { id: "poe.com", vendor: "poe", test: /(^|\.)poe\.com$/i },
  { id: "t3.chat", vendor: "t3", test: /(^|\.)t3\.chat$/i },
  { id: "kagi.com", vendor: "kagi", test: /(^|\.)kagi\.com$/i },
];

/** utm_source values assistants append themselves. OpenAI is the main one. */
const UTM_SOURCE_MAP: Record<string, { id: string; vendor: string }> = {
  "chatgpt.com": { id: "chatgpt.com", vendor: "openai" },
  openai: { id: "chatgpt.com", vendor: "openai" },
  perplexity: { id: "perplexity.ai", vendor: "perplexity" },
  "claude.ai": { id: "claude.ai", vendor: "anthropic" },
};

export type Classification = {
  kind: "crawl" | "referral";
  agent: string;
  vendor: string;
  purpose: AgentPurpose;
};

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Returns null for the ~99% of requests that are neither. Deliberately
 * allocation-light and regex-only: this runs on every request.
 */
export function classify(input: {
  userAgent: string | null;
  referer: string | null;
  utmSource?: string | null;
}): Classification | null {
  const ua = input.userAgent;

  if (ua) {
    for (const agent of AI_CRAWLERS) {
      if (agent.test.test(ua)) {
        return { kind: "crawl", agent: agent.id, vendor: agent.vendor, purpose: agent.purpose };
      }
    }
  }

  // A referral is a human, so it wins over nothing else - but we only reach here
  // when the UA looked like a normal browser, which is exactly right.
  const host = input.referer ? hostOf(input.referer) : null;
  if (host) {
    for (const ref of AI_REFERRERS) {
      if (ref.test.test(host)) {
        return { kind: "referral", agent: ref.id, vendor: ref.vendor, purpose: "referral" };
      }
    }
  }

  const utm = input.utmSource?.toLowerCase();
  if (utm && UTM_SOURCE_MAP[utm]) {
    const hit = UTM_SOURCE_MAP[utm]!;
    return { kind: "referral", agent: hit.id, vendor: hit.vendor, purpose: "referral" };
  }

  return null;
}

export function agentById(id: string): AiAgent | undefined {
  return AI_CRAWLERS.find((a) => a.id === id);
}
