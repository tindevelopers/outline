# TIN Vault Launchpad: Design and Architecture Spec

Status: approved and implemented (commits c7a279d1b..9ff147bd6)
Date: 2026-09-23
Scope: design and architecture only. No implementation in this document's phase.
Reference prototype: `design/tin-vault-launchpad/option-a-signal-gate.html` (chosen direction),
supporting files `base.css`, `option-b-vault-night.html`, `option-c-paper-ink.html`,
`switcher-concept.html`.

## 1. Goals

Replace the default Outline login screen at `docs.tin.info` with a TIN-branded entry
experience, the Launchpad, that:

1. Authenticates once (Microsoft, Google, Email) and routes the user by membership:
   0 workspaces to a request-access state, 1 workspace straight there, 2 or more to a
   selector showing only authorized workspaces.
2. Never enumerates tenants publicly, before or after authentication.
3. Preserves every existing Outline route and flow: `/auth/*`, OAuth callbacks at
   `https://docs.tin.info/auth/google.callback` and `/auth/azure.callback`, `/api/*`,
   `/realtime`, wildcard tenant routing on `*.docs.tin.info`.
4. Adds a first-class in-app workspace switcher on tenant subdomains so users can move
   between authorized workspaces without logging out.

Non-goals for v1: marketing content on the root, workspace creation from the root,
cross-email identity merging, per-tenant theming of the Launchpad.

## 2. Design direction: Paper and Ink (Option C, approved switch)

Supersedes the earlier Signal Gate selection. Implemented layout: light
editorial sheet with a top bar (TIN lockup left, host right), a left-aligned
content column, a document-stack illustration on the right (hidden below
940px) and a hairline footer bar. Tokens, motion and accessibility rules
below are unchanged.

Reading: enterprise SaaS authentication portal and workspace launcher for internal teams
and external clients. Trust-first, premium, minimal. Dials: variance 5, motion 3,
density 3.

### 2.1 Tokens

- Brand navy `#35496B`, deep surfaces `#27395A`, `#1B2C45`, `#122036`, `#0C1624`.
- Single accent, TIN orange `#E8591F`, hover `#CE4A14`. Used for primary actions, the
  signal arcs, hover arrows and focus rings. Nothing else.
- Light surfaces: page `#F5F8FA`, card `#FFFFFF`, hairline `#E2E8EF`, ink `#1D2B3F`,
  muted `#5C6B80`. Dark-surface text `#E9EEF4`, muted `#97A6BA`.
- Type: Manrope (display and UI, weights 400 to 800) plus JetBrains Mono for slugs,
  hosts and micro-labels. Self-hosted with `font-display: swap` in production. The
  prototypes load both from Google Fonts for convenience only.
- Shape system, locked: interactive controls 10px radius, surfaces 14px, workspace
  tiles 10px. No pill cards, no mixed systems.
- Elevation tinted to navy, never pure black: `0 1px 2px rgba(16,32,54,.05),
  0 12px 32px rgba(16,32,54,.09)`.
- Motion: one entrance rise per state (450ms, staggered 50 to 190ms), hover transitions
  120 to 160ms, active press `translateY(1px)`. All wrapped in
  `prefers-reduced-motion: reduce`.

### 2.2 Layout, desktop

Single light sheet, `linear-gradient(180deg, #ffffff, #f5f8fa 340px)`, full viewport
height, content grid `minmax(0, 560px) minmax(0, 1fr)` capped at 1180px.

- Top bar: TIN lockup left, current host in mono right.
- Content column: headline, one sub-line, provider buttons as full-width left-aligned
  rows, the workspace finder in a bordered white box, one footer line.
- Right column: document-stack illustration with a single orange seal, decorative.
- Selector and terminal states render as left-aligned copy with hairline-divided
  rows, no cards.

### 2.3 Layout, mobile

Below 940px the grid collapses to one column, gutters tighten to 20px and the
illustration is hidden. The prototype control pill is prototype-only and ships
nowhere.

### 2.4 Accessibility

WCAG AA contrast on every text and control pairing (white on `#E8591F` passes for
large and UI text; body copy never sits on orange). Visible focus ring in orange,
2px, offset 2px. Labels above inputs, never placeholder-as-label. Workspace rows are
real buttons with arrow affordances. Skeletons carry `role="status"` where they
represent progress.

## 3. UX architecture and user journey

### 3.1 Identity model at the root

The root host becomes an explicit neutral hub. It never resolves to a team for
branding or provisioning purposes. Today `server/utils/passport.ts` and
`server/routes/api/auth/auth.ts` fall back to the most recently created team when the
host is the apex; that fallback is removed for vault-intent requests (section 6).

Authentication at the root establishes identity, not membership. A short-lived,
apex-scoped vault session carries the verified email and provider. Membership is then
computed as the set of teams holding a user row with that email, which is exactly
`user.availableTeams()` in `server/models/User.ts`. No new membership service.

### 3.2 Journey, anonymous visitor

```
visitor opens docs.tin.info
  -> Launchpad sign-in state (Microsoft / Google / Email, workspace finder)
  -> provider round trip; callback lands on docs.tin.info (URLs unchanged)
  -> vault router (server, section 6.2):
       identify email from provider, never provision
       memberships = teams with a user row for that email
       0  -> vault session -> no-access state
       1  -> 302 to <slug>.docs.tin.info/auth/redirect?token=<transfer>
             (transfer token minted for that team's user row; no root UI flash)
       2+ -> vault session -> 302 to / on root -> selector state
```

### 3.3 Journey, returning visitor

The relaxed `sessions` cookie (section 6.4) is set on the base domain at every tenant
sign-in. At the root it is a hint only, never authorization. The sign-in card shows a
primary shortcut, "Continue to <last workspace>", above the provider buttons when the
hint exists. Clicking navigates to the tenant host, where the existing host-scoped
session (or its login) applies.

### 3.4 Journey, deep link to a tenant

Unauthenticated user opens `programming.docs.tin.info/some/doc`: unchanged. The tenant
login renders with that tenant's providers, and the post-login transfer handoff returns
them to the original document. The Launchpad is not inserted into tenant flows.

### 3.5 "Know your workspace?"

A navigation aid, not a search. Client-side only: normalize to lowercase, validate
`^[a-z0-9-]{1,63}$`, then `window.location` to `https://<slug>.docs.tin.info`. No
server round trip, no autocomplete, no existence check. Invalid input shows inline
helper text. The tenant host then answers with its own login, or with the generic
not-found-or-no-access page (section 7), so the field leaks nothing.

### 3.6 In-app switching

On any tenant subdomain, the sidebar-top workspace button opens the switcher menu
(`design/tin-vault-launchpad/switcher-concept.html`): current workspace row with a
check, membership-filtered list of the others, then "Launchpad, all workspaces" and
"Sign in to another workspace". Data source is `auth.info.availableTeams`, already
returned by the server and already consumed by the command-bar "Switch workspace"
action in `app/actions/definitions/teams.tsx`, which keeps working and points at the
same list. Choosing a workspace calls `vault.transfer` (section 6.3) and navigates to
the returned tenant URL; the existing tenant session is untouched, so switching away
and back needs no re-login.

## 4. Screens and states, exact copy

All strings below are final copy. No string is added to translation files manually;
extraction happens in the normal flow.

### 4.1 Sign in (default)

- Brand panel headline: `One door to every workspace.`
- Brand panel sub: `TIN Vault keeps each team and client in its own isolated
  workspace. Sign in once and we take you to the ones you belong to.`
- Brand panel micro-line: `docs.tin.info, the single entry point for all TIN knowledge`
- Card heading: `Sign in`
- Card lead: `Use your TIN identity. Your workspaces follow your account.`
- Buttons: `Continue with Microsoft`, `Continue with Google`, `Continue with Email`
- Divider before workspace finder: `know your workspace?`
- Finder helper: `Goes straight to that workspace sign-in. Nothing is suggested,
  listed or searched.`
- Finder invalid input: `Use the workspace name from your invite, letters and dashes
  only.`
- Finder submitted: `Opening <slug>.docs.tin.info`
- Card footer: `Need access? Contact your TIN administrator.`
- Returning-visitor shortcut button (when sessions hint exists):
  `Continue to <workspace name>`

### 4.2 Selector (authenticated, 2 or more)

- Heading: `Choose a workspace`
- Lead: `Signed in as <email>. You are a member of these workspaces.`
- Rows: workspace tile initial, name, mono host `<slug>.docs.tin.info`, arrow.
- Footer links: `Sign out`, `Not <name>? Switch account`

### 4.3 Single workspace redirect

- Spinner with `role="status"`.
- Heading: `Taking you to <workspace name>`
- Mono line: `<slug>.docs.tin.info`
- Body: `Your only workspace. Signing you in now.`
- Ghost button: `Continue manually` (re-issues the same handoff URL)

### 4.4 No access (0 workspaces)

- Heading: `No workspaces yet`
- Body: `You are signed in as <email>. That account is not a member of any TIN Vault
  workspace. A workspace administrator can grant access.`
- Primary: `Request access` (mailto to the configured access address, section 9)
- Ghost: `Sign out`

### 4.5 Error

- Heading: `We could not complete that sign-in`
- Body: `The identity provider did not confirm your session. This is usually
  temporary and your credentials were not stored.`
- Primary: `Try again`, ghost: `Contact support`

### 4.6 Loading

Skeletons mirror final geometry: card with two button-shaped bars and three row-shaped
bars in the selector, shimmer per `base.css`. No circular spinners except the redirect
state, which is a genuine progress moment.

### 4.7 Switcher menu (in-app)

- Section label: `Your workspaces`
- Current row suffix: `current workspace`
- Footer items: `Launchpad, all workspaces`, `Sign in to another workspace`

## 5. Component hierarchy

New client code, all under the existing app conventions (functional components,
styled-components, MobX stores, named exports, JSDoc on exported members):

```
app/scenes/Launchpad/
  index.tsx                 route entry; picks state from useVaultState
  components/
    TinMark.tsx             SVG lockup, currentColor letters, orange signal
    BrandPanel.tsx          left panel, arcs motif, micro-line
    AuthCard.tsx            provider buttons, email, returning-visitor shortcut
    WorkspaceFinder.tsx     slug input, client-side validation, helper text
    WorkspaceSelector.tsx   membership list, calls vault.transfer per row
    VaultStatus.tsx         redirect, no-access and error states
app/hooks/useVaultState.ts  reads vault session presence and sessions hint
app/hooks/useVaultWorkspaces.ts  wraps vault.workspaces with loading and error
```

Server additions:

```
server/routes/api/vault/vault.ts   vault.workspaces, vault.transfer
server/utils/vault.ts              vault session issue and verify, membership query
server/routes/auth/index.ts        vault-intent branch in provider callbacks
```

The existing `TeamSwitcher` component and `switchTeam` action keep working; the sidebar
switcher menu is a new component in `app/components/Sidebar/` reusing
`stores.auth.availableTeams`.

## 6. Routing architecture

### 6.1 Recommendation

Implement inside the fork. Caddy already proxies `docs.tin.info` and
`*.docs.tin.info` wholesale to `outline:3000` (`deploy/caddy/Caddyfile`), so a
root-only scene needs zero proxy changes. A static site behind Caddy would require
cross-origin session reads for the authenticated selector, a second build artifact and
a duplicated auth UX, while buying nothing: the selector must call authenticated
Outline APIs anyway.

The Launchpad scene renders only when `parseDomain(window.location.hostname)
.teamSubdomain === ""` and the host equals the base domain. Tenant hosts never see it.

### 6.2 Vault router, post-callback

Provider callbacks keep their registered URLs. In `signIn`, when the OAuth state
carries vault intent (set by the root login buttons) and the callback host is the apex:

1. Resolve the verified email from the provider profile. Do not call
   `accountProvisioner`. Do not create or update any user row.
2. Query teams with a user row for that email (`availableTeams` semantics).
3. Exactly one: mint `user.getTransferToken(service)` for that team's user row and
   302 to `<team.url>/auth/redirect?token=...`, the existing exchange path.
4. Two or more, or zero: set the vault cookie (6.5) and 302 to `/`, where the app
   renders selector or no-access from `vault.workspaces`.

Email magic links at the root follow the same router: the link verifies the email
identity at the apex and enters step 2. Tenants keep their current email flow.

### 6.3 vault.transfer

`POST /api/vault.transfer`, body `{ teamId }`, authenticated by vault session or by a
root team session. Verifies membership (user row with the session email in that team),
returns `{ url }` where url is `<team.url>/auth/redirect?token=<fresh transfer token>`.
Rate limited. The server builds the URL from the Team record; client input never
influences the host, which closes open-redirect by construction.

### 6.4 sessions cookie relaxation

`server/utils/authentication.ts` writes the `sessions` cookie only when
`env.isCloudHosted`. Change the condition to "team has a subdomain", matching the fix
pattern of commits `040e2ac` and `e57bab1`. The cookie stays a non-privileged hint
(name, logo, url) on the base domain.

### 6.5 Vault cookie

Name `vaultSession`, httpOnly, SameSite=Lax, Secure, apex host only (never the base
domain wildcard), 10 minute TTL, JWT type `vault` containing email, provider and
verified-at. It grants no team access: `vault.workspaces` and `vault.transfer` are the
only consumers, and both re-check membership server-side.

### 6.6 Unchanged

`/auth/google.callback`, `/auth/azure.callback`, all `/auth/*` provider routes,
`/api/*`, `/realtime`, tenant subdomain resolution, custom domains, share domains,
Caddyfile, OAuth provider registrations.

## 7. Security considerations

- Tenant enumeration: `auth.config` currently returns `team.name` for any valid
  subdomain to anonymous callers. Gate name and logo behind the `PublicBranding`
  team preference. Unknown slugs and known-but-unauthorized slugs render the same
  generic tenant page, so the workspace finder is not an oracle.
- Membership privacy: `vault.workspaces` requires a vault or root session and returns
  only the caller's own memberships. No endpoint lists teams anonymously.
- Open redirect: handoff URLs are server-built from Team records; `parseDomain`
  rejects custom domains for vault transfers; the client-side finder validates the
  slug character set before constructing a same-base-domain URL.
- Tenant isolation: `accessToken` remains host-scoped. The vault cookie is apex-only
  and privilege-free. Transfer tokens stay short-lived and single-team.
- No silent provisioning: vault intent never reaches `accountProvisioner`; a stranger
  authenticating at the root lands in the no-access state, not in the fallback team.
  This removes the current apex fallback risk entirely.
- Rate limiting: `vault.workspaces` and `vault.transfer` behind the existing
  `rateLimiter` middleware; the finder needs none (no server call).
- CSRF and CSP: unchanged; both new endpoints are same-origin POSTs through the
  existing csrf middleware, and no new external origins are introduced (fonts
  self-hosted).
- Logout semantics: tenant logout unchanged and host-scoped. Root `Sign out` clears
  the vault cookie and the sessions hint. `Switch account` additionally clears the
  sessions hint so the returning-visitor shortcut disappears.
- Known limitation, documented: membership matching is exact-email. A person using
  different emails per tenant sees only the workspaces of the email they signed in
  with. Identity merging is out of scope for v1.

## 8. Design system recommendations

- Keep one source of truth for tokens: extend the styled-components theme in
  `shared/styles` with the Launchpad palette rather than a parallel CSS file, so
  tenant surfaces can adopt the navy and orange gradually.
- Adopt Manrope as the TIN Vault brand face on login, Launchpad and switcher
  surfaces, self-hosted. Body copy inside documents keeps the existing editor
  typography; this is a chrome decision, not a content decision.
- Icons from `outline-icons` only in product code. The Microsoft and Google marks in
  the prototype become the same inline SVG brand glyphs, sourced once in
  `app/components/Icons/`.
- Reuse `base.css` geometry as the component spec: 46px control height, 10px control
  radius, 14px surface radius, 40px workspace tiles.

## 9. Implementation approach and phasing

Phase 1, server vault core: vault session utilities, vault router branch in provider
callbacks and email flow, `vault.workspaces`, `vault.transfer`, tests for membership
routing (0, 1, 2+), no-provisioning guarantee and URL construction.

Phase 2, Launchpad UI: root-only scene with sign-in, selector, redirect, no-access and
error states; sessions cookie relaxation; returning-visitor shortcut; `auth.config`
name gating.

Phase 3, switcher: sidebar menu on tenants wired to `availableTeams` and
`vault.transfer`; command-bar action kept and pointed at the same data.

Phase 4, hardening and polish: rate limits, generic unknown-tenant page, logout and
switch-account semantics, reduced-motion and contrast audit, mobile pass.

Each phase lands behind the existing CI (typecheck, lint, vitest) and deploys through
the current image pipeline; no Caddy or DNS change at any phase.

## 10. Open decisions for approval

1. Brand face: adopt Manrope self-hosted on Launchpad and login surfaces (recommended)
   or keep the current app font stack.
2. Request-access channel: `mailto:` to an env-configured address, proposed
   `VAULT_ACCESS_EMAIL` (recommended), or an in-app form later.
3. Returning-visitor shortcut from the sessions hint: ship in v1 (recommended) or v2.
4. Root visited with a live tenant session elsewhere: show sign-in plus the hint
   shortcut (recommended, host-scoped cookies make more impossible in v1).
