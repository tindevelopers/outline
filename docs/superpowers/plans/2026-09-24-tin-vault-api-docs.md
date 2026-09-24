# TIN Vault API Docs (white-label) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve a first-party "TIN Vault API" developer portal at `https://docs.tin.info/developers` (self-hosted Scalar + a vendored, rebranded copy of Outline's OpenAPI spec), point all in-app "API documentation" links at it, and fix apex OAuth discovery so the advertised endpoints actually work in vault mode.

**Architecture:** The portal is three static files under `public/developers/`, served by one new apex-only route. Tenant hosts redirect to the apex, so the portal is always same-origin with `https://docs.tin.info/api` and "Try it" needs no CORS and no proxy. A small Node script turns the pinned upstream `spec3.yml` into `openapi.yaml`, rebranding it and repointing servers and OAuth URLs. OAuth: `GET /oauth/authorize` on the apex hands off to the client's own workspace (`team.url/oauth/authorize?…`), so one static `authorizationUrl` works for every workspace. Apex discovery stops advertising dynamic client registration, which cannot succeed there.

**Tech Stack:** Koa (`koa-send`, `koa-router`), Scalar `@scalar/api-reference` 1.71.0 standalone bundle (vendored, MIT), `js-yaml` (already a dependency), Vitest.

**Spec:** Requirements come from the approved audit (session of 2026-09-24) plus the guardrails in Global Constraints below. There is no separate spec document.

## Global Constraints

- Do not change credential prefixes (`ol_api_`, `ol_at_`, `ol_rt_`, `ol_whs_`). No edits to `server/models/ApiKey.ts`, `server/models/oauth/*`, `server/models/WebhookSubscription.ts`.
- Self-host Scalar only. No `cdn.jsdelivr.net`, no Scalar CDN, no `proxyUrl` (never `proxy.scalar.com`), no Scalar fonts CDN (`withDefaultFonts: false`), Scalar AI agent disabled.
- API keys and API traffic stay first-party: the portal is same-origin with `/api`. Do not add CORS headers to `/api` or to the portal.
- Do not loosen the global CSP. Scripts load from `env.URL` (already allowed). No inline `<script>`.
- Fix apex OAuth discovery as part of this work.
- Add a documented process for keeping the vendored spec in sync with upstream.
- Keep the BSD-3-Clause notice (Outline OpenAPI) and the MIT notice (Scalar) in the source and distributed files.
- Make no licensing assumptions about commercial client workspaces. The BSL "Document Service" question goes in a separate note for legal and commercial review.
- Pins: upstream spec `outline/openapi@40f51b75efad`; Scalar `@scalar/api-reference@1.71.0`.
- Tests: run with the DB pinned to local. Never run tests against the `.env` or `.env.local` database, which is production:
  `export DATABASE_URL="$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" NODE_ENV=test TZ=UTC && node_modules/.bin/vitest run <files>`

---

## File map

| File | Responsibility |
|---|---|
| `scripts/openapi/build-tin-vault-spec.mjs` (new) | Upstream `spec3.yml` → rebranded `public/developers/openapi.yaml`. Fails if any Outline branding or getoutline.com URL survives |
| `public/developers/openapi.yaml` (generated, committed) | The TIN Vault spec, with the BSD-3 notice as a header comment |
| `public/developers/openapi.upstream.json` (new) | Pin record: upstream repo, commit, fetch date |
| `public/developers/index.html` (new) | Portal shell. No inline script |
| `public/developers/init.js` (new) | Scalar configuration: branding, first-party only |
| `public/developers/vendor/scalar/standalone.js` (vendored) | Scalar 1.71.0 browser bundle, MIT header intact |
| `public/developers/LICENSES/scalar-MIT.txt` (vendored) | Scalar licence text |
| `public/developers/LICENSES/outline-openapi-BSD-3-Clause.txt` (vendored) | Outline OpenAPI licence text |
| `server/routes/index.ts` (modify) | Apex-only `/developers` route; tenant hosts redirect to the apex |
| `server/routes/oauth/index.ts` (modify) | `GET /authorize` hand-off to the client's workspace on the vault apex |
| `server/routes/discovery/mcp.ts` (modify) | Don't advertise `registration_endpoint` when no workspace resolves (vault apex) |
| `shared/utils/UrlHelper.ts` + 3 settings scenes (modify) | "API documentation" → `/developers` |
| `docs/TIN_VAULT_API_DOCS.md` (new) | Sync process, licence notices, rollback |
| `docs/legal/bsl-document-service-review.md` (new) | Separate legal and commercial review note |

## Model routing

| Task | `model` | `subagent_type` | Justification |
|------|---------|-----------------|---------------|
| 1. Spec copy + update script + sync and legal docs | `sonnet` | `general-purpose` | Script + guard logic + two docs; judgment on residual branding strings |
| 2. Self-hosted Scalar + `/developers` route | `sonnet` | `general-purpose` | Multi-file (vendor, static, route, tests); CSP-sensitive but no policy change |
| 3. Main-domain OAuth hand-off + discovery | `opus` | `general-purpose` | Auth path (redirect target, vault mode); security rule 3 |
| 4. Link swap | `haiku` | `general-purpose` | 4 files, exact mechanical replacement |
| Per-task review | `sonnet` (`opus` for Task 3) | `general-purpose` | Per matrix |
| Final whole-branch review | `opus` | `general-purpose` | Final review of the whole change |
| 5. Ship + production verify | orchestrator | — | Production + user-held API key; not delegated |

---

### Task 1: Vendored TIN Vault spec + transform script + sync docs

**Files:**
- Create: `scripts/openapi/build-tin-vault-spec.mjs`, `public/developers/openapi.upstream.json`, `public/developers/LICENSES/outline-openapi-BSD-3-Clause.txt`, `docs/TIN_VAULT_API_DOCS.md`, `docs/legal/bsl-document-service-review.md`
- Generate: `public/developers/openapi.yaml`

**Interfaces:**
- Produces: `public/developers/openapi.yaml` with `info.title === "TIN Vault API"`, `servers[0].url === "https://docs.tin.info/api"`, OAuth `authorizationUrl === "https://docs.tin.info/oauth/authorize"`, `tokenUrl`/`refreshUrl === "https://docs.tin.info/oauth/token"`. Task 2 serves it; Task 3 makes the authorize URL work.

- [ ] **Step 1: Fetch the pinned upstream inputs**

```bash
mkdir -p public/developers/LICENSES scripts/openapi
curl -fsSL https://raw.githubusercontent.com/outline/openapi/40f51b75efad/spec3.yml -o /tmp/outline-spec3.yml
curl -fsSL https://raw.githubusercontent.com/outline/openapi/40f51b75efad/LICENSE -o public/developers/LICENSES/outline-openapi-BSD-3-Clause.txt
```

- [ ] **Step 2: Write the transform script**

`scripts/openapi/build-tin-vault-spec.mjs`:

```js
// Rebrands Outline's OpenAPI spec as the TIN Vault API. Usage:
//   node scripts/openapi/build-tin-vault-spec.mjs <upstream spec3.yml> <commit>
// Writes public/developers/openapi.yaml and openapi.upstream.json. Exits 1
// if any Outline branding or getoutline.com URL survives the rewrite.
import fs from "node:fs";
import yaml from "js-yaml";

const [input, commit] = process.argv.slice(2);
if (!input || !commit) {
  console.error("usage: build-tin-vault-spec.mjs <spec3.yml> <commit>");
  process.exit(1);
}

const BASE = "https://docs.tin.info";
const rewrite = (s) =>
  s
    .replace(/https:\/\/app\.getoutline\.com/g, BASE)
    .replace(/https:\/\/[a-z0-9-]+\.getoutline\.com/g, "https://workspace.docs.tin.info")
    .replace(/\[openapi specification\]\(https:\/\/github\.com\/outline\/openapi\)/g, `[OpenAPI specification](${BASE}/developers/openapi.yaml)`)
    .replace(/https:\/\/github\.com\/outline\/openapi\/blob\/main\/LICENSE/g, `${BASE}/developers/LICENSES/outline-openapi-BSD-3-Clause.txt`)
    .replace(/\bOutline API\b/g, "TIN Vault API")
    .replace(/\bOutline(’|')s\b/g, "TIN Vault$1s")
    .replace(/\bOutline\b/g, "TIN Vault");

// Recursively rewrite every string value. Keys, and so paths and schema
// names, stay untouched.
const walk = (v) =>
  typeof v === "string" ? rewrite(v)
  : Array.isArray(v) ? v.map(walk)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
  : v;

const spec = walk(yaml.load(fs.readFileSync(input, "utf8")));

spec.info.title = "TIN Vault API";
spec.info.contact = { name: "TIN Vault Support", email: "support.docs@tin.info" };
spec.info.license = {
  name: "BSD-3-Clause (specification derived from the Outline OpenAPI spec)",
  url: `${BASE}/developers/LICENSES/outline-openapi-BSD-3-Clause.txt`,
};
spec.servers = [{ url: `${BASE}/api`, description: "TIN Vault (all workspaces)" }];
const schemes = spec.components.securitySchemes;
schemes.BearerAuth.bearerFormat = "API key (ol_api_…) or OAuth access token";
const code = schemes.OAuth2.flows.authorizationCode;
code.authorizationUrl = `${BASE}/oauth/authorize`;
code.tokenUrl = `${BASE}/oauth/token`;
code.refreshUrl = `${BASE}/oauth/token`;

const body = yaml.dump(spec, { lineWidth: -1, noRefs: true });
const leftovers = body.match(/getoutline\.com|\bOutline\b/g);
if (leftovers) {
  console.error(`branding left in output: ${[...new Set(leftovers)].join(", ")}`);
  process.exit(1);
}

const notice = fs
  .readFileSync("public/developers/LICENSES/outline-openapi-BSD-3-Clause.txt", "utf8")
  .split("\n").map((l) => `# ${l}`.trimEnd()).join("\n");
fs.writeFileSync(
  "public/developers/openapi.yaml",
  `# TIN Vault API specification, derived from outline/openapi@${commit}.\n# Original work licensed as follows:\n${notice}\n${body}`
);
fs.writeFileSync(
  "public/developers/openapi.upstream.json",
  JSON.stringify({ repo: "https://github.com/outline/openapi", commit, fetchedAt: new Date().toISOString() }, null, 2) + "\n"
);
console.log("ok: public/developers/openapi.yaml");
```

- [ ] **Step 3: Generate the spec and confirm the guard passes**

Run: `node scripts/openapi/build-tin-vault-spec.mjs /tmp/outline-spec3.yml 40f51b75efad`
Expected: `ok: public/developers/openapi.yaml`. If it prints `branding left in output`, add one more `.replace` for the reported string and re-run. Never delete the guard.

Then: `grep -c "ol_api_" public/developers/openapi.yaml`
Expected: ≥ 1 (the credential prefix is documented unchanged).

- [ ] **Step 4: Write `docs/TIN_VAULT_API_DOCS.md`** with these sections, filled from this plan: *What is served* (the file map rows for `public/developers/*`), *Syncing with upstream* (steps below), *Updating Scalar* (Task 2 Step 1 with a new version), *Licence notices* (keep both `LICENSES/*` files, the BSD header in `openapi.yaml`, and the MIT header in `standalone.js`), and *Rollback* (copy the "Rollback strategy" section at the end of this plan).

*Syncing with upstream* is run after every `upstream-sync/*` merge that touches `server/routes/api/**`:

```bash
C=$(gh api repos/outline/openapi/commits/main -q .sha | cut -c1-12)
curl -fsSL "https://raw.githubusercontent.com/outline/openapi/$C/spec3.yml" -o /tmp/outline-spec3.yml
curl -fsSL "https://raw.githubusercontent.com/outline/openapi/$C/LICENSE" -o public/developers/LICENSES/outline-openapi-BSD-3-Clause.txt
node scripts/openapi/build-tin-vault-spec.mjs /tmp/outline-spec3.yml "$C"
git diff --stat public/developers/   # review, then commit as "chore: sync TIN Vault API spec to outline/openapi@$C"
```

- [ ] **Step 5: Write `docs/legal/bsl-document-service-review.md`.** Keep it factual. No conclusions.
  - The licence parameters, quoted verbatim from `LICENSE`: Licensor, Licensed Work 1.10.1, the Additional Use Grant and its "Document Service" definition, Change Date 2030-09-09, Change License Apache-2.0.
  - The question for counsel: does TIN's use, including workspaces named for clients (e.g. "CLS - Client"), fall under "a commercial offering that allows third parties … to access the functionality … by creating teams and documents controlled by such third parties"?
  - A statement that this white-label work changes branding only and does not change that analysis.

- [ ] **Step 6: Commit**

```bash
git add scripts/openapi public/developers/openapi.yaml public/developers/openapi.upstream.json public/developers/LICENSES/outline-openapi-BSD-3-Clause.txt docs/TIN_VAULT_API_DOCS.md docs/legal/bsl-document-service-review.md
git commit -m "feat: vendor the TIN Vault API spec with an upstream sync process"
```

---

### Task 2: Self-hosted Scalar portal at `/developers` (apex only)

**Files:**
- Vendor: `public/developers/vendor/scalar/standalone.js`, `public/developers/LICENSES/scalar-MIT.txt`
- Create: `public/developers/index.html`, `public/developers/init.js`
- Modify: `server/routes/index.ts` (new route before the `router.get("*", …)` catch-all at line 156)
- Test: `server/routes/index.test.ts`

**Interfaces:**
- Consumes: `public/developers/openapi.yaml` (Task 1).
- Produces: `GET https://docs.tin.info/developers` → the portal. `GET https://<ws>.docs.tin.info/developers[/*]` → 302 to the same path on `env.URL`.

- [ ] **Step 1: Vendor Scalar from npm (pinned) with its licence**

```bash
cd /tmp && npm pack @scalar/api-reference@1.71.0 && tar -xzf scalar-api-reference-1.71.0.tgz && cd -
mkdir -p public/developers/vendor/scalar
cp /tmp/package/dist/browser/standalone.js public/developers/vendor/scalar/standalone.js
cp /tmp/package/LICENSE public/developers/LICENSES/scalar-MIT.txt
head -c 300 public/developers/vendor/scalar/standalone.js   # confirm the bundle banner is intact
```

If `dist/browser/standalone.js` doesn't exist in 1.71.0, run `ls /tmp/package/dist` and take the browser standalone build from there. Record the actual path in `docs/TIN_VAULT_API_DOCS.md`.

- [ ] **Step 2: Write the failing route tests** (append to `server/routes/index.test.ts`)

```ts
describe("/developers", () => {
  const apexHost = () => new URL(env.URL).host;

  it("serves the TIN Vault API portal on the apex", async () => {
    const res = await server.get("/developers", { headers: { host: apexHost() } });
    const html = await res.text();
    expect(res.status).toEqual(200);
    expect(html).toContain("<title>TIN Vault API</title>");
    expect(html).not.toMatch(/<script>(?!<\/script>)/); // no inline scripts, CSP stays strict
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("serves the rebranded spec", async () => {
    const res = await server.get("/developers/openapi.yaml", { headers: { host: apexHost() } });
    const body = await res.text();
    expect(res.status).toEqual(200);
    expect(body).toContain("title: TIN Vault API");
    expect(body).not.toContain("app.getoutline.com");
  });

  it("redirects a workspace host to the apex portal", async () => {
    const res = await server.get("/developers", {
      headers: { host: `tin.${apexHost()}` },
      redirect: "manual",
    });
    expect(res.status).toEqual(302);
    expect(res.headers.get("location")).toEqual(`${env.URL}/developers`);
  });

  it("does not serve files outside public/developers", async () => {
    const res = await server.get("/developers/..%2f..%2fpackage.json", { headers: { host: apexHost() } });
    expect([400, 403, 404]).toContain(res.status);
  });
});
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `node_modules/.bin/vitest run server/routes/index.test.ts -t "/developers"` (with the DB pinned to local, per Global Constraints)
Expected: FAIL. `/developers` currently falls through to the app shell.

- [ ] **Step 4: Add the route** in `server/routes/index.ts`, directly before `router.get("*", …)`:

```ts
// First-party TIN Vault API portal. Apex only, so "Try it" is same-origin
// with /api and needs no CORS or proxy; workspace hosts redirect there.
router.get(["/developers", "/developers/*"], async (ctx) => {
  if (ctx.hostname !== new URL(env.URL).hostname) {
    ctx.redirect(`${env.URL}${ctx.path}`);
    return;
  }
  const file = ctx.path === "/developers" || ctx.path === "/developers/"
    ? "/developers/index.html"
    : ctx.path;
  await send(ctx, file, {
    root: path.resolve(__dirname, "../../../public"),
    maxAge: file.endsWith(".html") ? 0 : Day.ms,
  });
});
```

`koa-send` refuses paths that escape `root`, so traversal returns 404.

- [ ] **Step 5: Write `public/developers/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TIN Vault API</title>
    <link rel="icon" href="/images/favicon-32.png" />
  </head>
  <body>
    <div id="app"></div>
    <script src="/developers/vendor/scalar/standalone.js"></script>
    <script src="/developers/init.js"></script>
  </body>
</html>
```

- [ ] **Step 6: Write `public/developers/init.js`**

```js
// TIN Vault API portal: Scalar configured for first-party use only.
// No proxyUrl (API keys never leave this origin), no external fonts,
// no AI agent. Servers are pinned to this origin so "Try it" is same-origin.
Scalar.createApiReference("#app", {
  url: "/developers/openapi.yaml",
  servers: [{ url: `${location.origin}/api`, description: "TIN Vault" }],
  withDefaultFonts: false,
  agent: { disabled: true },
  authentication: { preferredSecurityScheme: "BearerAuth" },
  metaData: { title: "TIN Vault API" },
  favicon: "/images/favicon-32.png",
  hideDarkModeToggle: false,
  customCss: `
    @font-face { font-family: "Inter"; src: url("/fonts/Inter.var.woff2") format("woff2"); font-weight: 100 900; }
    @font-face { font-family: "Manrope"; src: url("/fonts/manrope-latin.woff2") format("woff2"); font-weight: 400 800; }
    .scalar-app { --scalar-font: "Inter", system-ui, sans-serif; --scalar-color-accent: #ce4a14; }
    .scalar-app h1, .scalar-app h2 { font-family: "Manrope", system-ui, sans-serif; }
    /* Branding: replace Scalar's footer credit with nothing (MIT permits this; the licence notice stays in LICENSES/). */
    .scalar-app a[href="https://www.scalar.com"] { display: none !important; }
  `,
});
```

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `node_modules/.bin/vitest run server/routes/index.test.ts` (DB pinned)
Expected: all PASS, including the existing tests in the file.

- [ ] **Step 8: Commit**

```bash
git add public/developers/index.html public/developers/init.js public/developers/vendor public/developers/LICENSES/scalar-MIT.txt server/routes/index.ts server/routes/index.test.ts
git commit -m "feat: serve a self-hosted TIN Vault API portal at /developers"
```

---

### Task 3: Fix apex OAuth discovery

**Files:**
- Modify: `server/routes/oauth/index.ts` (add `GET /authorize` before the existing `router.post("/authorize", …)`)
- Modify: `server/routes/discovery/mcp.ts:24-28`
- Test: `server/routes/discovery/mcp.test.ts`, `server/routes/oauth/index.test.ts`

**Interfaces:**
- Consumes: `isVaultRequest(ctx)` from `server/utils/vault.ts`; `OAuthClient.findByClientId`; `Team.url`.
- Produces: `GET https://docs.tin.info/oauth/authorize?client_id=…&…` → 302 to `<client's team url>/oauth/authorize?<same query>`. Every other host and case falls through to the existing app route unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `server/routes/oauth/index.test.ts`:

```ts
describe("GET /oauth/authorize on the vault apex", () => {
  const apexHost = () => new URL(env.URL).host;
  const vaultMode = () =>
    vi.spyOn(Team, "count").mockImplementation(async (o) => (o?.where ? 0 : 2));

  beforeEach(() => resetVaultModeCache());

  it("hands off to the client's own workspace with the query intact", async () => {
    setSelfHosted();
    const team = await buildTeam({ subdomain: faker.internet.domainWord() });
    const client = await buildOAuthClient({ teamId: team.id });
    const spy = vaultMode();
    const qs = `client_id=${client.clientId}&redirect_uri=https%3A%2F%2Fexample.com%2Fcb&response_type=code&state=xyz`;

    const res = await server.get(`/oauth/authorize?${qs}`, {
      headers: { host: apexHost() },
      redirect: "manual",
    });

    expect(res.status).toEqual(302);
    expect(res.headers.get("location")).toEqual(`${team.url}/oauth/authorize?${qs}`);
    spy.mockRestore();
  });

  it("falls through for an unknown client", async () => {
    setSelfHosted();
    const spy = vaultMode();
    const res = await server.get(`/oauth/authorize?client_id=nope`, {
      headers: { host: apexHost() },
      redirect: "manual",
    });
    expect(res.status).toEqual(200); // app shell renders its normal "client not found" state
    spy.mockRestore();
  });

  it("does nothing on a workspace host", async () => {
    setSelfHosted();
    const team = await buildTeam({ subdomain: faker.internet.domainWord() });
    const client = await buildOAuthClient({ teamId: team.id });
    const res = await server.get(`/oauth/authorize?client_id=${client.clientId}`, {
      headers: { host: `${team.subdomain}.${apexHost()}` },
      redirect: "manual",
    });
    expect(res.status).toEqual(200);
  });
});
```

Append to `server/routes/discovery/mcp.test.ts`:

```ts
it("does not advertise dynamic registration on the vault apex", async () => {
  setSelfHosted();
  resetVaultModeCache();
  const spy = vi.spyOn(Team, "count").mockImplementation(async (o) => (o?.where ? 0 : 2));
  const res = await server.get("/.well-known/oauth-authorization-server", {
    headers: { host: new URL(env.URL).host },
  });
  const body = await res.json();
  expect(res.status).toEqual(200);
  expect(body.authorization_endpoint).toEqual(`${new URL(env.URL).origin}/oauth/authorize`);
  expect(body.token_endpoint).toEqual(`${new URL(env.URL).origin}/oauth/token`);
  expect(body.registration_endpoint).toBeUndefined();
  spy.mockRestore();
});
```

Add the imports each file needs: `Team` from `@server/models`, `resetVaultModeCache` from `@server/utils/vault`, `faker`, `setSelfHosted`, `buildTeam`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `node_modules/.bin/vitest run server/routes/oauth/index.test.ts server/routes/discovery/mcp.test.ts` (DB pinned)
Expected: the hand-off test FAILS (no redirect) and the discovery test FAILS (`registration_endpoint` present).

- [ ] **Step 3: Add the hand-off route** in `server/routes/oauth/index.ts`, before `router.post("/authorize", …)`:

```ts
// On the vault apex nobody holds a workspace session, so consent can't
// happen here. Every OAuth client belongs to exactly one workspace: send the
// request there with its query untouched. The target comes from the team
// record, so this is not an open redirect.
router.get(
  "/authorize",
  rateLimiter(RateLimiterStrategy.OneHundredPerHour),
  async (ctx, next) => {
    const clientId = ctx.query.client_id;
    if (typeof clientId !== "string" || !(await isVaultRequest(ctx))) {
      return next();
    }
    const client = await OAuthClient.findByClientId(clientId);
    const team = client ? await Team.findByPk(client.teamId) : null;
    if (!team?.subdomain) {
      return next();
    }
    ctx.redirect(`${team.url}/oauth/authorize${ctx.search}`);
  }
);
```

Add `import { isVaultRequest } from "@server/utils/vault";`.

- [ ] **Step 4: Stop advertising DCR where it can't work** in `server/routes/discovery/mcp.ts`. Registration needs a resolved workspace, and it already 404s on the vault apex:

```ts
      ...(!env.OAUTH_DISABLE_DCR &&
        team &&
        mcpEnabled && {
          registration_endpoint: `${origin}/oauth/register`,
        }),
```

- [ ] **Step 5: Run the tests and confirm they pass, along with the existing OAuth and discovery suites**

Run: `node_modules/.bin/vitest run server/routes/oauth server/routes/discovery server/routes/index.test.ts` (DB pinned)
Expected: all PASS. The existing workspace-host discovery tests still show `registration_endpoint`.

If "falls through" returns 404 rather than 200, check that `koa-mount` passes `next()` downstream to `routes`. Fix it by registering the hand-off in `server/routes/index.ts` before the catch-all instead. Don't change the assertion.

- [ ] **Step 6: Commit**

```bash
git add server/routes/oauth/index.ts server/routes/discovery/mcp.ts server/routes/oauth/index.test.ts server/routes/discovery/mcp.test.ts
git commit -m "fix: hand apex OAuth authorize off to the client's workspace; drop DCR from apex discovery"
```

---

### Task 4: Point in-app "API documentation" links at the portal

**Files:**
- Modify: `shared/utils/UrlHelper.ts:5`, `app/scenes/Settings/APIAndAccess.tsx:57`, `app/scenes/Settings/ApiKeys.tsx:128`, `app/scenes/Settings/Applications.tsx:50`

- [ ] **Step 1: Change the link.** In `shared/utils/UrlHelper.ts`:

```ts
  public static developers = "/developers";
```

It opens with `window.open(url, "_blank")`. On a workspace host the server redirects to the apex portal (Task 2).

- [ ] **Step 2: Use it in the three settings scenes.** Replace each `href="https://www.getoutline.com/developers"` with `href={UrlHelper.developers}` and add `import { UrlHelper } from "@shared/utils/UrlHelper";` where missing.

- [ ] **Step 3: Verify no copies remain**

Run: `grep -rn "getoutline.com/developers" app shared server`
Expected: no output.

- [ ] **Step 4: Type-check, lint, format**

Run: `node_modules/.bin/tsc --noEmit -p . && node_modules/.bin/oxlint shared/utils/UrlHelper.ts app/scenes/Settings && node_modules/.bin/oxfmt shared/utils/UrlHelper.ts app/scenes/Settings/APIAndAccess.tsx app/scenes/Settings/ApiKeys.tsx app/scenes/Settings/Applications.tsx`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add shared/utils/UrlHelper.ts app/scenes/Settings/APIAndAccess.tsx app/scenes/Settings/ApiKeys.tsx app/scenes/Settings/Applications.tsx
git commit -m "feat: open the TIN Vault API portal from API documentation links"
```

---

### Task 5: Ship and verify end to end

- [ ] **Step 1: Record the rollback anchor before merging**

```bash
git fetch origin && git rev-parse --short=7 origin/main
```

Before merging, `origin/main` is what production runs (currently `5a0eed8`). Note it down: it is the known-good GHCR image tag, `ghcr.io/tindevelopers/outline:<sha7>`.

- [ ] **Step 2:** Open one PR with the four commits. Wait for CI to pass, including `test-server`. Merge. Make sure the image build runs, dispatching it manually if the push trigger doesn't start within 5 minutes. Wait for Watchtower to deploy the merge sha.

- [ ] **Step 3: Browser checks on `https://docs.tin.info/developers`**
  - Page title and header read "TIN Vault API". The TIN favicon shows. "Powered by Scalar" is not visible.
  - The console shows **no CSP violations**. If Scalar needs `'unsafe-eval'` or a blocked source, **stop**. Don't loosen the CSP; report back.
  - The network panel shows **only `docs.tin.info` requests**: no jsdelivr, scalar.com, proxy, or fonts CDN.
  - "Try it" on `POST /auth.info` with an API key **you** paste in returns 200 from `https://docs.tin.info/api/auth.info`.
- [ ] **Step 4: Redirect and link checks**
  - `https://tin.docs.tin.info/developers` → 302 to the apex portal.
  - Help menu → "API documentation" opens the portal.
- [ ] **Step 5: OAuth checks**
  - `curl -s https://docs.tin.info/.well-known/oauth-authorization-server`: no `registration_endpoint`; `authorization_endpoint` is the apex.
  - `curl -s https://tin.docs.tin.info/.well-known/oauth-authorization-server`: unchanged, including `registration_endpoint`.
  - Re-authorise an existing MCP connector: consent completes on the workspace host.

---

## Rollback strategy

No database migrations, no data changes, and no credential or prefix changes, so every rollback below is lossless.

| Situation | Action | Time |
|---|---|---|
| Anything wrong after deploy (fastest) | On the server: set `OUTLINE_TAG=<sha7 from Task 5 Step 1>` in `/root/outline/.env`, then `cd /root/outline && docker compose up -d outline`. Watchtower only follows `latest`, so the pinned tag stays put. | ~1 min |
| Permanent revert of everything | GitHub → the PR → **Revert** → merge the revert PR. The image build and Watchtower redeploy `latest` automatically. Then remove `OUTLINE_TAG` from `.env` and run `docker compose up -d outline` to follow `latest` again. | ~15 min |
| Only the OAuth hand-off misbehaves | `git revert <Task 3 commit>` in a small PR. The portal and links stay. | ~15 min |
| Only the portal misbehaves | `git revert <Task 2 commit>` and `<Task 4 commit>` (links would point at a missing page otherwise). OAuth fix stays. | ~15 min |

After any rollback: `curl -s -o /dev/null -w '%{http_code}' https://docs.tin.info/` returns 200, and apex and workspace discovery return 200.
