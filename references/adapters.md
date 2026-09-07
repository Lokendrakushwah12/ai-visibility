# Adapters: runtimes, frameworks, databases

The architecture is portable; three things differ per project. Check all three
before writing capture code — getting the header names wrong produces rows with
NULL `ip` and `country`, which silently disables verification.

## Contents

- [Capture point per framework](#capture-point-per-framework)
- [Runtime headers](#runtime-headers)
- [Writing from the edge](#writing-from-the-edge)
- [Databases](#databases)
- [Scheduling](#scheduling)

## Capture point per framework

Anything that runs server-side before the response works. What matters is that it
sees every page request, can read headers, and can start work that outlives the
response.

| Stack | Where | Background primitive |
|---|---|---|
| Next.js ≤15 | `middleware.ts` | `event.waitUntil()` |
| Next.js 16+ | `proxy.ts` (middleware was renamed) | `event.waitUntil()` |
| SvelteKit | `hooks.server.ts` `handle` | `platform.context.waitUntil()` on CF; else unawaited promise |
| Nuxt / Nitro | server middleware in `server/middleware/` | `event.waitUntil()` |
| Remix / React Router | `entry.server.tsx` or a loader wrapper | unawaited promise |
| Astro | `src/middleware.ts` | `ctx.locals` + unawaited promise |
| Express / Hono | ordinary middleware | unawaited promise |
| Cloudflare Worker (no framework) | `fetch` handler | `ctx.waitUntil()` |

Where there's no `waitUntil`, an unawaited promise with a `.catch()` is fine —
just never `await` it in the request path.

**Matcher/filter.** Exclude Next internals, static assets and API routes, but
keep `robots.txt`, `sitemap.xml` and `llms.txt`: a bot fetching those is a
discovery signal. On Next this is one negative-lookahead matcher:

```
/((?!_next/static|_next/image|.*\.(?:png|jpg|jpeg|gif|svg|ico|webp|avif|css|js|woff|woff2|ttf|map)$).*)
```

Note the cost: on metered platforms this adds an invocation to every non-static
request. The work is one regex sweep plus, on a hit, one background fetch — but
the invocation itself is billable. Narrow the matcher if it shows up on a bill.

**Skip prefetches.** Every framework with a client router has some form of
speculative request, and counting them double-counts real users:

| Stack | Flag to skip on |
|---|---|
| Next.js | `next-router-prefetch` header, or `purpose: prefetch` |
| SvelteKit | `event.isDataRequest`, `event.isSubRequest` |
| Nuxt | `x-nuxt-no-ssr` / payload requests to `_payload.json` |
| Astro | prefetch sends `sec-purpose: prefetch` |
| Generic | `sec-purpose: prefetch` (Chrome sends this broadly) |

`sec-purpose: prefetch` is the emerging standard and worth checking regardless of
framework.

## Runtime headers

The client IP and country come from different headers per platform. Get these
wrong and every row has NULL `ip`, so nothing can ever be verified:

| Platform | Client IP | Country |
|---|---|---|
| Vercel | `x-forwarded-for` (first entry) | `x-vercel-ip-country` |
| Cloudflare | `cf-connecting-ip` | `cf-ipcountry` |
| Netlify | `x-nf-client-connection-ip` | `x-country` |
| Fly.io | `fly-client-ip` | `fly-region` (region, not country) |
| AWS CloudFront | `cloudfront-viewer-address` | `cloudfront-viewer-country` |
| Generic proxy | `x-forwarded-for` (first entry) | none |

`x-forwarded-for` is a **comma-separated chain**; the client is the first entry.
Taking the whole string, or the last entry, gives you a proxy address and every
verification fails. A defensive read that works everywhere:

```ts
const ip = (
  req.headers.get("cf-connecting-ip") ??
  req.headers.get("x-real-ip") ??
  req.headers.get("x-forwarded-for") ??
  ""
).split(",")[0]?.trim() || null;
```

Truncate `user_agent` and `referer` before storing (512 chars is generous). Both
are attacker-controlled free text and there is no reason to store kilobytes of it.

## Writing from the edge

Edge runtimes have no TCP sockets, so a Postgres driver or a full ORM usually
can't run there — and even where it can, pulling an ORM into every request's
bundle is a poor trade for one INSERT.

Options, in order of preference:

1. **HTTP database API** — Turso/libSQL `/v2/pipeline`, Neon HTTP, Supabase
   REST, PlanetScale HTTP. A ~70-line dependency-free `fetch` wrapper covers it.
2. **Platform binding** — D1 from a Worker, where the binding is already there.
3. **Queue or log drain** — post to a collector and batch-insert elsewhere. Best
   at high volume; more moving parts.
4. **Node runtime for the middleware** — simplest if the platform allows it and
   cold starts don't matter.

Whichever you pick, the insert is fire-and-forget with a swallowed error. A
tracking write must never be able to fail a page render, and a dropped row is a
rounding error against crawl volume.

## Databases

`assets/schema.sql` has SQLite/libSQL DDL plus a Postgres variant. Notes:

- **SQLite/libSQL/D1** — integer unix seconds for `ts`, `text` for JSON columns,
  `integer` for booleans. Partial indexes are supported and worth using for
  `verified IS NULL`.
- **Postgres** — `timestamptz`, `jsonb`, real `boolean`. Keep `verified` nullable
  so the tri-state survives; a `NOT NULL DEFAULT false` collapses "unchecked"
  into "failed" and the verifier can never find its work.
- **MySQL/PlanetScale** — no partial indexes; index `verified` plainly and accept
  a slightly wider verifier scan.
- **ORM registration** — if the project uses an ORM with a central schema file,
  register the new tables there (e.g. one `export * from "./schema-ai-visibility"`
  line) or queries will fail at runtime in ways that look like missing tables.

Whether migrations run through the ORM's tooling or by hand depends on the
project. Check how its existing migrations were actually applied rather than
assuming the ORM journal is the source of truth — plenty of projects apply SQL
directly and keep the journal only for types.

## Cloudflare Pages specifics

Pages differs from Workers in two ways that silently break this:

- **Files in `static/` never reach the Worker.** So `robots.txt` served as a
  static file is invisible to tracking — the discovery signal you were told to
  keep simply isn't there. Serve it from a route (`+server.ts` or equivalent) if
  you want those hits.
- **Pages Functions have no `scheduled` handler.** Neither cron job can live in
  the project; run both from GitHub Actions (or any external scheduler) against
  the database's REST API. A ~30-line `fetch` helper covers D1's HTTP endpoint —
  no driver needed.

Plain Workers have cron triggers and no static-file bypass, so neither applies
there. Check which one you're on before planning the scheduling.

## Scheduling

Two jobs, different cadences:

| Job | Cadence | Why |
|---|---|---|
| IP verification | every few hours | keeps the unchecked backlog small and bounded |
| Prompt runner | weekly | scores move in weeks; daily is ~7× cost for noise |

GitHub Actions, platform cron (Vercel Cron, Cloudflare **Workers** Cron
Triggers — not Pages, see above) or any external scheduler works. The verifier needs only DB access; the runner needs the probe
keys. Note that scheduled runs on shared CI are queued, not punctual — if exact
timing ever matters, trigger from outside rather than relying on cron precision.
