# TIN Vault Launchpad Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the apex login screen of the TIN Outline fork with a membership-routed Launchpad (0/1/2+ workspaces), close the tenant-enumeration leak, and add an in-app workspace switcher on tenant subdomains.

**Architecture:** A server-side vault router intercepts apex sign-ins before provisioning, resolves membership by verified email across teams, and either hands off through the existing `/auth/redirect` transfer-token exchange (1 workspace) or issues a short-lived apex-scoped `vaultSession` cookie for the selector (2+) or no-access (0) states. The Launchpad is a root-only React scene inside the existing SPA; Caddy, OAuth callback URLs and tenant routing are untouched.

**Tech Stack:** TypeScript, Koa, Sequelize, Passport plugins (google, azure, email), React + MobX + styled-components, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-23-tin-vault-launchpad-design.md` (copy deck in its section 4 is the source of truth for every user-visible string; prototypes in `design/tin-vault-launchpad/`).

## Global Constraints

- Copy: use spec section 4 strings verbatim. Zero em-dashes in any user-visible string.
- i18n: never edit locale JSON by hand; wrap strings in `t()`/`<Trans>` and run `yarn build:i18n` once in Task 7.
- TypeScript strict, no `any`, no type assertions unless unavoidable; named exports; JSDoc on every exported function/component; curly braces always.
- Dependencies: yarn only; no new dependencies in this plan.
- Verification per task: `yarn test:server <file>` or `yarn test:app <file>`, plus `yarn lint` and `yarn tsc` before committing.
- Approved open decisions: Manrope self-hosted on Launchpad surfaces; `VAULT_ACCESS_EMAIL` env for the request-access mailto; returning-visitor shortcut ships in v1; root with a live tenant session elsewhere shows sign-in plus the hint shortcut.
- Vault mode detection rule (used everywhere): vault mode is active when at least one team exists and no team has `subdomain === null`. Single-tenant installs (a team without subdomain owns the apex) keep legacy behavior entirely.

---

### Task 1: Vault core utilities

**Files:**
- Create: `server/utils/vault.ts`
- Test: `server/utils/vault.test.ts`

**Interfaces:**
- Consumes: `Team`, `User` models; `parseDomain`, `getBaseDomain` from `@shared/utils/domains`; `env` from `@server/env`; `jsonwebtoken` default import (same as `server/models/User.ts`).
- Produces for later tasks:
  - `export async function isVaultMode(): Promise<boolean>`
  - `export async function isVaultRequest(ctx: Context): Promise<boolean>`
  - `export function issueVaultSession(email: string, service: string): string`
  - `export function setVaultSessionCookie(ctx: Context, email: string, service: string): void`
  - `export function clearVaultSessionCookie(ctx: Context): void`
  - `export function verifyVaultSession(ctx: Context): { email: string; service: string } | undefined`
  - `export type VaultOutcome = { kind: "single"; user: User; team: Team } | { kind: "choice"; email: string } | { kind: "none"; email: string }`
  - `export async function routeVaultSignIn(ctx: Context, service: string, email: string): Promise<VaultOutcome>`

- [x] **Step 1: Write the failing tests**

```ts
// server/utils/vault.test.ts
import { getTestDatabase } from "@server/test/support";
import { buildTeam, buildUser } from "@server/test/factories";
import { createContext } from "@server/test/context"; // if absent, use mock ctx per Step 3 note
import { isVaultMode, routeVaultSignIn, verifyVaultSession } from "./vault";

// mock ctx helper: { hostname, cookies: { get, set }, request: { hostname } }
```

Cases (implement with a small `mockCtx(hostname)` helper that records `cookies.set` calls):
1. `isVaultMode` false with a team whose subdomain is null; true with two teams that both have subdomains; false with zero teams.
2. `routeVaultSignIn` with one membership returns `{ kind: "single" }` carrying that team's user row and the team.
3. `routeVaultSignIn` with two memberships returns `{ kind: "choice" }` and sets a `vaultSession` cookie on the mock ctx.
4. `routeVaultSignIn` with zero memberships returns `{ kind: "none" }` and sets the cookie.
5. `verifyVaultSession` round-trips `issueVaultSession` email and service, and returns undefined for a garbage cookie.

- [x] **Step 2: Run tests to verify they fail**

Run: `yarn test:server server/utils/vault.test.ts`
Expected: FAIL, module not found.

- [x] **Step 3: Implement `server/utils/vault.ts`**

Core logic (full file in repo conventions):

```ts
const VAULT_COOKIE = "vaultSession";
const VAULT_TTL_MINUTES = 10;
let modeCache: { at: number; value: boolean } | undefined;

export async function isVaultMode(): Promise<boolean> {
  if (modeCache && Date.now() - modeCache.at < 30_000) {
    return modeCache.value;
  }
  const [total, withoutSubdomain] = await Promise.all([
    Team.count(),
    Team.count({ where: { subdomain: null } }),
  ]);
  const value = total > 0 && withoutSubdomain === 0;
  modeCache = { at: Date.now(), value };
  return value;
}

export async function isVaultRequest(ctx: Context): Promise<boolean> {
  const domain = parseDomain(ctx.hostname);
  if (domain.custom || domain.teamSubdomain) {
    return false;
  }
  return domain.host === parseDomain(env.URL).host && (await isVaultMode());
}

export async function routeVaultSignIn(ctx, service, email): Promise<VaultOutcome> {
  const accounts = await User.findAll({
    where: { email },
    include: [{ association: "team", required: true }],
  });
  const live = accounts.filter((account) => !account.isSuspended && !account.team.isSuspended);
  if (live.length === 1) {
    return { kind: "single", user: live[0], team: live[0].team };
  }
  setVaultSessionCookie(ctx, email, service);
  return live.length > 1 ? { kind: "choice", email } : { kind: "none", email };
}
```

Cookie: `ctx.cookies.set(VAULT_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: env.isProduction, expires: +10m, domain: parseDomain(env.URL).host })`. Token: `JWT.sign({ email, service, type: "vault", createdAt, expiresAt }, env.SECRET_KEY)`; verify with `JWT.verify` plus `type === "vault"` and `expiresAt` checks, try/catch to undefined. Also export `clearVaultSessionCookie` (expired, same domain) and a `resetVaultModeCache()` test helper.

- [x] **Step 4: Run tests to verify they pass**

Run: `yarn test:server server/utils/vault.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/utils/vault.ts server/utils/vault.test.ts
git commit -m "feat: add vault session and membership routing utilities"
```

---

### Task 2: Server flow wiring (signIn, team resolution, auth.config, env)

**Files:**
- Modify: `server/types.ts` (AuthenticationResult gains `vaultRedirect?: string`)
- Modify: `server/utils/authentication.ts` (early vaultRedirect return; sessions cookie gate)
- Modify: `server/utils/passport.ts` (skip apex fallback in vault mode; unknown subdomain never falls back in vault mode)
- Modify: `server/routes/api/auth/auth.ts` (auth.config vault flag, name gating, unknown-workspace flag)
- Modify: `server/routes/api/auth/schema.ts` (AuthConfigRes: `vault?: boolean`, `accessEmail?: string`, `workspaceNotFound?: boolean`)
- Modify: `server/env.ts` (`VAULT_ACCESS_EMAIL` optional string)
- Test: `server/routes/api/auth/auth.test.ts` (extend)

**Interfaces:**
- Consumes Task 1: `isVaultMode`, `isVaultRequest`.
- Produces: auth.config response contract used by Task 5 client (`vault`, `accessEmail`, `workspaceNotFound`, gated `name`).

- [x] **Step 1: Write the failing auth.config tests**

Add to `server/routes/api/auth/auth.test.ts` (follow existing fetch style in that file):
1. Apex host with two subdomained teams, unauthenticated: `data.vault === true`, `data.name === undefined`, `data.providers` non-empty, `data.accessEmail` equals env value when set.
2. Tenant subdomain host without `PublicBranding`: `data.name === undefined`; with the preference on: `data.name === team.name`.
3. Unknown subdomain host in vault mode: `data.workspaceNotFound === true` and no `name`.
4. Apex host with one team whose subdomain is null: legacy behavior, `data.vault` undefined and `data.name` present (regression guard).

- [x] **Step 2: Run to verify failure**

Run: `yarn test:server server/routes/api/auth/auth.test.ts`
Expected: FAIL on the new cases.

- [x] **Step 3: Implement**

`server/utils/authentication.ts`, top of `signIn` after destructuring:

```ts
if (result.vaultRedirect) {
  ctx.redirect(result.vaultRedirect);
  return;
}
```

Sessions cookie gate, replace `if (env.isCloudHosted && team.subdomain) {` with `if (team.subdomain) {` and update the comment to say multi-tenant installs (cloud or self-hosted) record the hint cookie on the base domain.

`server/utils/passport.ts` in `getTeamFromContext`, replace the fallback condition:

```ts
if (!team && !env.isCloudHosted && !(await isVaultRequest(context))) {
```

and inside the `domain.teamSubdomain` branch, when `findBySubdomain` returns null in vault mode, return undefined instead of falling through:

```ts
else if (domain.teamSubdomain) {
  team = await Team.findBySubdomain(domain.teamSubdomain);
  if (!team && (await isVaultRequest(context) || (await isVaultMode()))) {
    return undefined;
  }
}
```

(The second check covers unknown tenant subdomains, which are not vault requests but must not leak the fallback team.)

`server/routes/api/auth/auth.ts`:
- custom and teamSubdomain branches: `name: team.getPreference(TeamPreference.PublicBranding) ? team.name : undefined` and same condition for `logo`.
- apex fallback branch: `if (!env.isCloudHosted) { if (await isVaultMode()) { const unknown = !!parseDomain(ctx.request.hostname).teamSubdomain; ctx.body = { data: { providers: ..., vault: !unknown, workspaceNotFound: unknown || undefined, accessEmail: env.VAULT_ACCESS_EMAIL } }; return; } ...legacy... }`.
- `server/env.ts`: `public VAULT_ACCESS_EMAIL = environment.VAULT_ACCESS_EMAIL ?? "";` with JSDoc.

- [x] **Step 4: Run tests**

Run: `yarn test:server server/routes/api/auth/auth.test.ts`
Expected: PASS including regression cases.

- [x] **Step 5: Commit**

```bash
git commit -m "feat: make the apex a neutral vault host and gate tenant branding"
```

---

### Task 3: vault.workspaces and vault.transfer endpoints

**Files:**
- Create: `server/routes/api/vault/schema.ts`, `server/routes/api/vault/vault.ts`
- Modify: `server/routes/api/index.ts` (mount router)
- Test: `server/routes/api/vault/vault.test.ts`

**Interfaces:**
- Consumes Task 1: `verifyVaultSession`; `server/middlewares/authentication` with `{ optional: true }` for session callers.
- Produces for Tasks 5 and 6: `POST /api/vault.workspaces` → `{ data: { email, workspaces: Array<{ id, name, avatarUrl, url, slug }> } }`; `POST /api/vault.transfer` body `{ teamId }` → `{ data: { url } }`.

- [x] **Step 1: Write the failing tests**

Cases:
1. `vault.workspaces` without vault cookie or token: 401.
2. With vault session for an email holding two memberships: 200, exactly those two workspaces, each with `slug` equal to the team subdomain and `url` containing it; a third team the email does not belong to is absent.
3. With vault session for an email with zero memberships: 200 with empty `workspaces`.
4. `vault.transfer` with vault session and a member teamId: 200, `url` starts with the team url and contains `/auth/redirect?token=`.
5. `vault.transfer` with a non-member teamId: 403.
6. `vault.transfer` authenticated by a normal tenant session (build user, sign in via test helper) for another team of the same email: 200 (switcher path).
7. `vault.transfer` for a team whose `domain` (custom) is set: 403.

- [x] **Step 2: Run to verify failure**

Run: `yarn test:server server/routes/api/vault/vault.test.ts`
Expected: FAIL, 404 route missing.

- [x] **Step 3: Implement**

`vault.ts` sketch (full code in repo conventions, JSDoc on router handlers not required but schema zod objects yes):

```ts
router.post("vault.workspaces", rateLimiter(RateLimiterStrategy.TenPerMinute), async (ctx) => {
  const email = await resolveVaultEmail(ctx); // vault cookie, else optional auth user
  if (!email) throw AuthorizationError();
  const accounts = await User.findAll({ where: { email }, include: [{ association: "team", required: true }] });
  ctx.body = { data: { email, workspaces: accounts.filter(a => a.team.subdomain).map(a => ({
    id: a.teamId, name: a.team.name, avatarUrl: a.team.avatarUrl,
    url: a.team.url, slug: a.team.subdomain })) } };
});

router.post("vault.transfer", rateLimiter(RateLimiterStrategy.TenPerMinute), auth({ optional: true }), async (ctx) => {
  const { teamId } = ctx.input.body;
  const email = await resolveVaultEmail(ctx);
  if (!email) throw AuthorizationError();
  const team = await Team.findByPk(teamId);
  if (!team || !team.subdomain || team.domain) throw AuthorizationError();
  const target = await User.findOne({ where: { email, teamId } });
  if (!target || target.isSuspended) throw AuthorizationError();
  const token = encodeURIComponent(target.getTransferToken("vault"));
  ctx.body = { data: { url: `${team.url}/auth/redirect?token=${token}` } };
});
```

`resolveVaultEmail`: `verifyVaultSession(ctx)?.email ?? (ctx.state.auth?.user?.email if not suspended)`. Use the existing `rateLimiter` middleware and `RateLimiterStrategy` enum exactly as other API routes do (copy an existing usage, e.g. in `server/routes/api/auth/auth.ts` or `urls.ts`).

- [x] **Step 4: Run tests**

Run: `yarn test:server server/routes/api/vault/vault.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git commit -m "feat: add vault.workspaces and vault.transfer endpoints"
```

---

### Task 4: Provider vault branches (google, azure, email) and passport middleware

**Files:**
- Modify: `server/middlewares/passport.ts` (honor `result.vaultRedirect` before the user-null access-denied path)
- Modify: `plugins/google/server/auth/google.ts`
- Modify: `plugins/azure/server/auth/azure.ts`
- Modify: `plugins/email/server/auth/email.ts`
- Test: extend `server/middlewares/authentication.test.ts` only if trivial; otherwise rely on Task 1 tests plus manual checklist in Step 5.

**Interfaces:**
- Consumes Task 1 `isVaultRequest`, `routeVaultSignIn`; Task 2 `AuthenticationResult.vaultRedirect`.
- Produces: apex sign-ins never provision; single membership hands off via existing signIn transfer path.

- [x] **Step 1: Middleware change**

In `server/middlewares/passport.ts` success callback, before any `!user` handling:

```ts
if (result?.vaultRedirect) {
  return ctx.redirect(result.vaultRedirect);
}
```

- [x] **Step 2: Google and Azure insertion**

In each verify callback, immediately after the verified email is available and before `getTeamFromContext`/provisioning:

```ts
if (await isVaultRequest(context)) {
  const outcome = await routeVaultSignIn(context, config.id, profile.email.toLowerCase());
  if (outcome.kind === "single") {
    return done(null, outcome.user, { user: outcome.user, team: outcome.team, client });
  }
  return done(null, null, { vaultRedirect: "/" } as AuthenticationResult);
}
```

For azure use its verified email field (`profile.email ?? profile.upn`, lowercased) matching how the plugin already derives email for provisioning.

- [x] **Step 3: Email plugin insertion**

In the magic-link callback route, after the token email is verified and before `accountProvisioner`:

```ts
if (await isVaultRequest(ctx)) {
  const outcome = await routeVaultSignIn(ctx, "email", email);
  if (outcome.kind !== "single") {
    return ctx.redirect("/");
  }
  return signIn(ctx, "email", { user: outcome.user, team: outcome.team, client });
}
```

Keep the existing `auth.email` send route unchanged (it only mails a token; no membership leak).

- [x] **Step 4: Typecheck and lint**

Run: `yarn tsc && yarn lint`
Expected: clean.

- [x] **Step 5: Manual checklist (record in commit body)**

Local multi-tenant smoke: two teams with subdomains; apex Google sign-in with an email in both lands on selector; email in one redirects straight to that tenant; unknown email lands on no-access; tenant subdomain sign-in unchanged; single-team-no-subdomain install unchanged.

- [x] **Step 6: Commit**

```bash
git commit -m "feat: route apex sign-ins through the vault router in auth providers"
```

---

### Task 5: Launchpad client scene

**Files:**
- Create: `app/scenes/Launchpad/index.tsx`, `theme.ts`, `components/TinMark.tsx`, `components/BrandPanel.tsx`, `components/AuthCard.tsx`, `components/WorkspaceFinder.tsx`, `components/WorkspaceSelector.tsx`, `components/VaultStatus.tsx`
- Create: `app/hooks/useVaultWorkspaces.ts`
- Modify: `app/scenes/Login/Login.tsx` (render Launchpad when `config.vault`)
- Modify: `app/scenes/Login/index.tsx` if the wrapper needs the same guard
- Modify: `app/stores/AuthStore.ts` (Config type: `vault?: boolean`, `accessEmail?: string`, `workspaceNotFound?: boolean`)
- Modify: global styles for self-hosted Manrope and JetBrains Mono (`public/fonts/` woff2 files plus `@font-face` in the app global style entry)
- Test: `app/scenes/Launchpad/components/WorkspaceFinder.test.tsx`

**Interfaces:**
- Consumes: `POST /api/vault.workspaces`, `POST /api/vault.transfer` (Task 3); `config.vault` (Task 2); existing `AuthenticationProvider` component and AuthStore email-link request method for the three buttons.
- Produces: complete apex experience for states sign-in, selector, redirect, no-access, error, plus `workspaceNotFound` state reused by unknown tenant subdomains in `Login.tsx`.

- [x] **Step 1: Fonts**

Download Manrope 400,500,600,700,800 and JetBrains Mono 400,500 woff2 (latin subset) into `public/fonts/`, add `@font-face` rules with `font-display: swap` to the app global stylesheet, commit binaries.

- [x] **Step 2: Failing component test for WorkspaceFinder**

Render with testing-library (follow an existing app component test): typing `Bad Slug!` and submitting shows the invalid-input helper string from spec 4.1; typing `programming` and submitting shows `Opening programming.docs.tin.info` and does not call fetch.

- [x] **Step 3: Implement components**

Markup and interactions mirror `design/tin-vault-launchpad/option-a-signal-gate.html`; all strings via `t()` from spec section 4. `theme.ts` holds the palette tokens from spec 2.1 as a typed object consumed by styled-components in this scene only. `AuthCard` reuses `AuthenticationProvider` for provider buttons and the AuthStore email-link request for the email step; adds the returning-visitor shortcut button reading the `sessions` cookie via `getCookie("sessions")` (tiny-cookie, same as `useLoggedInSessions`) and rendering `Continue to <name>` when present. `WorkspaceSelector` uses `useVaultWorkspaces` (POST vault.workspaces, loading skeletons, error state) and on row click POSTs `vault.transfer` then `window.location.href = data.url`. `VaultStatus` covers redirect (spinner + `Continue manually` re-issuing the last handoff url), no-access (mailto `config.accessEmail`), and error states. `Login.tsx`: after config resolves, `if (config?.vault) return <Launchpad />;` and `if (config?.workspaceNotFound) return <WorkspaceNotFound />;` (small local component with spec 7 copy: heading `Workspace not found`, body `We could not find a workspace at this address, or you do not have access to it. Use the Launchpad to reach your workspaces.`, primary `Go to Launchpad` linking to the base origin).

- [x] **Step 4: Run tests, typecheck, lint**

Run: `yarn test:app app/scenes/Launchpad && yarn tsc && yarn lint`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git commit -m "feat: add the TIN Vault Launchpad scene at the apex"
```

---

### Task 6: In-app workspace switcher

**Files:**
- Create: `app/components/Sidebar/components/WorkspaceSwitcher.tsx`
- Modify: the sidebar header component that renders the current team identity (locate in `app/components/Sidebar/` during implementation; mount the switcher button there)
- Modify: `app/stores/AuthStore.ts` (`transferToTeam(teamId: string): Promise<string>` calling vault.transfer)
- Test: none new (data path covered by Task 3 tests); manual checklist in Step 4.

**Interfaces:**
- Consumes: `stores.auth.availableTeams` (already returned by auth.info), `AuthStore.transferToTeam`.
- Produces: menu per `design/tin-vault-launchpad/switcher-concept.html`: current row with check, `Your workspaces` list, `Launchpad, all workspaces` (base origin), `Sign in to another workspace` (clears sessions hint cookie then base origin).

- [x] **Step 1: Implement menu component**

Popover anchored to the sidebar team button; keyboard accessible (Escape closes, arrows move); rows call `transferToTeam` then navigate; current team row is not a link. Strings via `t()` from spec 4.7. Visibility: only when `availableTeams.length > 1`.

- [x] **Step 2: Wire AuthStore.transferToTeam**

```ts
@action
transferToTeam = async (teamId: string): Promise<string> => {
  const res = await client.post("/vault.transfer", { teamId });
  return res.url;
};
```

- [x] **Step 3: Typecheck and lint**

Run: `yarn tsc && yarn lint`
Expected: clean.

- [x] **Step 4: Manual checklist (commit body)**

Switch tenant A to B and back without re-login; menu lists only memberships; command-bar "Switch workspace" still works and shows the same set.

- [x] **Step 5: Commit**

```bash
git commit -m "feat: add sidebar workspace switcher with transfer-token handoff"
```

---

### Task 7: Hardening, i18n extraction, full verification

**Files:**
- Modify: `app/scenes/Launchpad/components/AuthCard.tsx` (Sign out and Switch account cookie semantics)
- Create: `server/routes/api/vault/` addition `vault.logout` (clears httpOnly vault cookie) if Sign out cannot clear it client-side
- Modify: locale JSON only via extraction output

- [x] **Step 1: Logout semantics**

Root `Sign out`: POST `vault.logout` (server clears `vaultSession`), then remove `sessions` and `lastSignedIn` cookies client-side on the base domain. `Switch account`: same plus force the provider chooser (no OIDC auto-redirect at apex, already true because multiple providers).

- [x] **Step 2: Extraction**

Run: `yarn build:i18n`
Inspect `git diff shared/i18n`; commit locale changes together with the code commit if the diff is limited to new Launchpad strings.

- [x] **Step 3: Full verification**

Run: `yarn tsc && yarn lint && yarn test:server server/utils/vault.test.ts server/routes/api/vault/vault.test.ts server/routes/api/auth/auth.test.ts && yarn test:app app/scenes/Launchpad`
Expected: all green.

- [x] **Step 4: Reduced-motion and contrast audit**

Check Launchpad styled-components for the `prefers-reduced-motion` guard and AA contrast on the orange primary button (white on `#E8591F`) and helper text on white; fix inline.

- [x] **Step 5: Commit**

```bash
git commit -m "chore: launchpad logout semantics, i18n extraction and audits"
```
