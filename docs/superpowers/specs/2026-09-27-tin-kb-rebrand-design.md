# TIN Vault → TIN KB Rebrand: Design Spec

Status: approved (design), pending spec review
Date: 2026-09-27
Scope: Part 1 only — the code rename in this fork. Parts 2 and 3 (live workspace
and content edits) are out of scope here and are covered by the follow-up
checklist in section 9.
Base revision: `dda4f2174` (`origin/main`; rollback anchor `dda4f21`)
Branch: `feat/tin-kb-rebrand`

## 1. Goal

Rename the product brand "TIN Vault" to "TIN KB" on every shipped,
user-visible surface, plus the filenames that carry the brand name. Change
nothing else: no behavior, routes, authentication, database values,
infrastructure identifiers, or dependencies.

The result ships as one PR merged to `main`, which triggers the
**Build and publish image** workflow (`.github/workflows/build-image.yml`) to
publish `ghcr.io/tindevelopers/outline`, which Watchtower on the Hetzner host
pulls within its 300s poll interval and applies by restarting only the
`outline` container (`docker-compose.hetzner.yml`). No manual deploy step.

## 2. Motivation

"TIN Vault" is the brand applied by commit `37838f48f` (2026-09-18, "feat:
rebrand visible surfaces as TIN Vault"), which replaced the upstream "Outline"
branding. That commit is the template: it touched every surface once. Two
surfaces have been added since and are **not** covered by the originating
runbook (see section 8): the apex Launchpad scene and the developers API
portal.

## 3. Naming rules

| Context | Form | Rationale |
| --- | --- | --- |
| Browser tab title, PWA `short_name`, plugin descriptions, eyebrow labels, error strings, API spec title | **TIN KB** | Space-constrained. Most of these are driven by the single `env.APP_NAME` value (section 4.1). |
| PWA manifest `name` field, first mention in flowing prose (onboarding documents, API spec introduction) | **TIN Knowledge Base** | Full name where there is room. |

The rule resolves per occurrence, not mechanically. Worked example: the
onboarding opener currently reads "TIN Vault is a place to build your team
knowledge base". The long form there would produce "TIN Knowledge Base is a
place to build your team knowledge base", so that line uses the short form and
the surrounding sentence is left as is.

## 4. Change set

Inventory taken 2026-09-27 at `dda4f2174`: 74 matches across shipped surfaces
(`app`, `server`, `shared`, `plugins`, `public`, `scripts`, `app.json`,
`vite.config.ts`). Counts are indicative; the residual-brand check in section 6
is the gate, not this table.

### 4.1 Single source of truth

| File | Change |
| --- | --- |
| `server/env.ts:886` | `public APP_NAME = "TIN Vault";` → `"TIN KB"` |

`APP_NAME` is read in roughly 70 places, and every one of them is
user-visible prose rather than behaviour. It drives: the page and document
title (`server/routes/app.ts:118,213`, `app/components/Layout.tsx`,
`PageTitle.tsx`), the in-app brand mark (`app/components/Branding.tsx`), email
subject lines, bodies, and the header alt text (`server/emails/templates/**`),
onboarding collection copy (`server/commands/accountProvisioner.ts:296`),
search-discovery strings (`server/routes/discovery/opensearch.ts:12-13`),
Slack copy (`plugins/slack/server/**`), settings dialogs across the app and
plugins, and the display names for OIDC clients
(`plugins/oidc/server/auth/oidcRouter.ts:238`) and WebAuthn passkeys
(`plugins/passkeys/server/auth/passkeys.ts:28`).

This single line therefore covers a large share of the rename for free. The
two display-name cases are safe: both are human-readable names, not
identifiers — the WebAuthn relying-party *ID* is the domain and does not read
`APP_NAME`. Confirm both still read correctly after the change.

### 4.2 Manifest and PWA

| File | Change |
| --- | --- |
| `app.json:2` | Heroku app manifest `name` → `TIN KB`. An app label rather than prose, so the short form applies |
| `vite.config.ts:128-129` | PWA manifest `name` → `TIN Knowledge Base`, `short_name` → `TIN KB` |

### 4.3 Launchpad (added after the source runbook)

| File | Change |
| --- | --- |
| `app/scenes/Launchpad/components/BrandPanel.tsx:209` | Eyebrow `t("TIN VAULT")` → `t("TIN KB")` |
| `app/scenes/Launchpad/components/AuthCard.tsx:99` | Heading `t("Sign in to TIN Vault")` → short form |
| `app/scenes/Launchpad/components/VaultStatus.tsx:153` | "not a member of any TIN Vault workspace" → short form |
| `app/scenes/Launchpad/index.tsx:127`, `theme.ts:2-3` | Comments; `theme.ts` also references the `design/tin-vault-launchpad/` path, which is renamed in section 4.7 |

### 4.4 Developers API portal (added after the source runbook)

| File | Change |
| --- | --- |
| `public/developers/index.html:6` | `<title>TIN Vault API</title>` → `TIN KB API` |
| `public/developers/init.js:1,6,14` | Comment, Scalar `servers.description`, `metaData.title` |
| `public/developers/openapi.yaml` | **Generated.** Regenerate via the transform script; do not hand-edit |
| `server/routes/index.ts:155` | Comment |
| `server/routes/index.test.ts:383,389,400` | Test name and expected strings |

### 4.5 Generator script — required for the rename to survive upstream sync

`scripts/openapi/build-tin-vault-spec.mjs` rewrites upstream wording with
`.replace(/\bOutline\b/g, "TIN Vault")` and a guard that exits 1 if `Outline`
or `getoutline.com` survives. Editing only the generated `openapi.yaml` would
let the next `upstream-sync/*` merge regenerate **TIN Vault** and silently
revert this work.

Changes:

1. Now reads `public/developers/openapi.upstream.json`, which is already
   committed with the pinned upstream commit, instead of taking the commit as
   `argv[2]`. `argv[2]` stays supported as an override for pre-merge preview.
2. Replacement target `TIN Vault` → `TIN KB` in the three `.replace()` calls
   (lines 32-34) and in `spec.info.title`, `spec.info.contact.name`,
   `spec.servers[].description` (lines 55, 57, 61), and the output header
   comment (line 100).
3. The snake/kebab example values added in `cd9b3e08c` (lines 37-38) become
   `tin-kb-api-` and `/webhooks/tin-kb`. These are documentation example
   strings only; no real value changes. The `outline-markdown` export format
   stays, per the comment already at lines 35-36.
4. Extend the guard to also fail on `\bTIN Vault\b` in the pre-license body,
   so a future partial rename cannot ship.
5. File renamed to `scripts/openapi/build-tin-kb-spec.mjs`; update the usage
   line, `docs/TIN_VAULT_API_DOCS.md`, and the commit-message example there.

### 4.6 Application surfaces

| Area | Files | Change |
| --- | --- | --- |
| Navigation | `app/actions/definitions/navigation.tsx:171` | `t("TIN Vault Guide")` → `t("TIN KB Guide")` |
| Login | `app/scenes/Login/urls.ts:66` | "Host is not a TIN Vault installation" → short form |
| Plugin descriptions | `plugins/{figma,github,gitlab,linear,matomo,umami,webhooks,zapier}/client/index.tsx` | "TIN Vault" → "TIN KB" |
| Onboarding documents | `server/onboarding/{Getting Started,Integrations & API,Our Editor}.md` | Prose, per section 3 naming rule |
| Onboarding document (renamed) | `server/onboarding/What is TIN Vault.md` → `What is TIN KB.md` | Prose, plus `server/commands/accountProvisioner.ts:309` lookup key |
| Tests | `server/routes/index.test.ts:22,29,42`, `plugins/slack/server/api/hooks.test.ts:223` | Expected strings |
| Translations | `shared/i18n/locales/en_US/translation.json:1095,1111` | **Generated.** Regenerate with `yarn build:i18n`; never hand-edit |

### 4.7 Documentation and design assets

| Path | Treatment |
| --- | --- |
| `docs/TIN_VAULT_API_DOCS.md` → `docs/TIN_KB_API_DOCS.md` | Operational doc; rename file and update all brand references and the generator filename |
| `design/tin-vault-launchpad/` → `design/tin-kb-launchpad/` (directory + 5 files) | Live reference used by `app/scenes/Launchpad/theme.ts:3`; rename and update that reference |
| `docs/legal/bsl-document-service-review.md` | Historical review record; **leave as is** |
| `docs/superpowers/plans/*`, `docs/superpowers/specs/*` | Historical records; **leave filename and content as is** |

### 4.8 Explicitly retained — must not change

`outline://` desktop protocol, `Outline-Signature` webhook header, `/outline`
Slack slash command, `ol_api_` / `ol_at_` / `ol_rt_` / `ol_whs_` credential
prefixes, `outline-markdown` export format, GHCR image name and Docker
identifiers, database name, `LICENSE` terms, the BSD-3-Clause attribution
block in the generated spec, upstream repository URLs, and non-`en_US` locale
catalogs.

`app/components/Icons/OutlineIcon.tsx:16` keeps `?v=tin-vault-20260918`. It is
a cache-buster query string on an image that is not changing, not rendered
text; changing it would force a pointless cache miss for every client.

## 5. Artwork

Only one image contains brand text: `public/email/header-logo.png` (159×48,
"tin **VAULT**"), rendered as the header of outbound email. Every other asset
is the TIN mark with no words and needs no change: `public/images/Icon-1024.png`,
`icon-192.png`, `icon-512.png`, `icon-monochrome-1024.png`,
`icon-monochrome-512.png`, `icon-maskable-1024.png`, `icon-maskable-192.png`,
`icon-maskable-512.png`, `tin-logo.png`, and the favicons.

Plan: lift the clean mark from `public/images/tin-logo.png` (712×474, no text),
render "KB" in Manrope ExtraBold, and composite at 159×48 with a transparent
background. Manrope is the locked display face for the brand
(`design/tin-kb-launchpad/base.css:36`, renamed in section 4.7;
`public/fonts/manrope-latin.woff2`). Colours: navy `#35496B` for the wordmark,
matching the outgoing art.

The image is visually reviewed against the outgoing lockup before it enters
the commit. If the weight or spacing does not match, candidates are shown for
a decision instead of the asset being shipped.

## 6. Verification

Tests must never run against the production database. Pin the test database
first, as the repo's existing plan documents:

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" NODE_ENV=test TZ=UTC
```

(`.env.test` points at `postgres://…@127.0.0.1:5432/outline-test`.)

Then:

1. `yarn tsc`
2. `yarn lint` and `yarn format:check`
3. `yarn test server/routes/index.test.ts plugins/slack`, then the broader suite
4. `yarn build` (runs `vite:build`, `build:i18n`, `build:server`). The
   `build:i18n` step regenerates `shared/i18n/locales/en_US/translation.json`;
   inspect that diff. `en_US` is the source catalog, so keys the extractor
   leaves behind may be removed by hand. Non-`en_US` catalogs are not touched.
5. Residual-brand grep over shipped surfaces:

   ```bash
   grep -rIn -i 'tin vault\|tin-vault\|TIN_VAULT' app server shared plugins public scripts app.json vite.config.ts --exclude-dir=graphify-out
   ```

   Exactly three classes of match are expected and correct:
   - `app/components/Icons/OutlineIcon.tsx:16` — the retained cache-buster, by
     design (section 4.8).
   - the renamed generator script — its leftover guard must contain the literal
     `TIN Vault` in order to detect it. This is the only sanctioned occurrence.
   - any stale `en_US` keys the extractor did not drop; remove these.

   Every other match is a defect and the line must be fixed.
6. Run the generator against the committed upstream pin and confirm it exits 0
   and that the produced `openapi.yaml` contains no `TIN Vault`.
7. Reconcile against the prior audit categories in
   `.factory/audits/tin-vault-phase-1-audit.html`, confirming the
   COMPATIBILITY / DEPENDENCY / INFRASTRUCTURE / LEGAL / EXTERNAL LINK
   categories are untouched.

Post-merge smoke test, on each of `docs.tin.info`, `programming.docs.tin.info`,
`tin.docs.tin.info`, `clients.docs.tin.info`: tab title reads TIN KB, login page
shows no "TIN Vault", and `https://docs.tin.info/developers` renders with the
TIN KB API title. Email header renders the new logo via a test send.

## 7. Deploy and rollback

Local `main` was 3 commits behind `origin/main` at the start of this work and
has been fast-forwarded to `dda4f2174`, so the OAuth refresh-retry fix
(`61150fa51`) and the Caddy deploy-gap fix (`2ad903cff`) are present. Do not
rebase or reset over them.

Rollback, from `docs/TIN_VAULT_API_DOCS.md`:

| Situation | Action |
| --- | --- |
| Fastest, post-deploy | On the host, set `OUTLINE_TAG=<previous sha7>` in `/root/outline/.env`, then `cd /root/outline && docker compose up -d outline`. Watchtower only follows `latest`, so the pin holds. Previous good revision: `dda4f21`. |
| Permanent | Revert the PR on GitHub and merge the revert; the image build and Watchtower redeploy `latest` automatically. |

> **Correction to the source runbook.** It instructs running
> `deploy/scripts/rollback.sh`. No such script exists in this repository;
> `deploy/` contains only `bootstrap-ssh.sh`, `caddy/`, `healthwatch/`, and
> `mattermost-relay/`. The procedure above is the one documented in
> `docs/TIN_KB_API_DOCS.md` and is what actually exists. The runbook should be
> corrected when it is next edited.

No database migrations, data changes, or credential changes, so both rollbacks
are lossless.

## 8. Deviations from the source runbook

The originating runbook ("Rename TIN Vault to TIN KB", Gene Foo, 2026-09-27,
status Proposed) differs from this repository in five ways. This spec supersedes
its Part 1.

| Runbook | Actual |
| --- | --- |
| `server/env.ts:876` | `server/env.ts:886` |
| 30 matches in 20 files | 74 matches across shipped surfaces at `dda4f2174` |
| No mention of the Launchpad | `app/scenes/Launchpad/` carries the brand in 5 files |
| No mention of the developers portal | `public/developers/` and `openapi.yaml` carry the brand, and the generator script will revert a naive rename |
| Rollback via `deploy/scripts/rollback.sh` | Script does not exist; see section 7 |

Confirmed correct in the runbook: commit `37838f48f` as the template, the
GHCR → Watchtower deploy chain, the test locations, and the `translation.json`
keys.

## 9. Out of scope — follow-up checklist

To be handed over for manual execution. These require live admin or database
access to three separate workspaces, which this work does not have.

- [ ] **Workspace names.** Settings → Details → Name, for each workspace:
      `docs.tin.info` / `tin.docs.tin.info`, `programming.docs.tin.info`,
      `clients.docs.tin.info`. Names were not verified when the runbook was
      written. Installed PWAs keep the old name until reinstalled.
- [ ] **Content, `tin.docs.tin.info`.** Rename collection **TIN Vault Guide**
      and its page _Welcome to TIN Vault_; update the collection description.
- [ ] **Content, `programming.docs.tin.info`.** Update _Setting up TIN Vault MCP
      and writing documentation with Claude_, _Documentation_, and the single
      mention in the `shell-base-admin` hosted-domain design page.
- [ ] **Content, search sweep.** Search every workspace for `"TIN Vault"` and
      update the remaining matches; a renamed page keeps its URL, since Outline
      retains the id suffix.
- [ ] **Rename the runbook itself last** and mark it Done.
- [ ] **Correct the runbook's Part 1** to match section 8, and its rollback
      step to match section 7.

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| Naive portal edit reverted by the next upstream sync | Generator-script change plus an extended guard (section 4.5) |
| `APP_NAME` change leaks into a non-visible or behavioural surface | Every one of its ~70 consumers was reviewed: all are user-visible prose or display names, none is an identifier. Re-grep before and after, and confirm the OIDC and WebAuthn display names render correctly |
| Tests run against the production database | Test database pinned explicitly before any test command (section 6) |
| Historic docs mistaken for current brand | Historical records left untouched and called out in section 4.7 |
| Email logo regeneration looks off-brand | Visual review against the outgoing lockup before commit |
