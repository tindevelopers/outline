# TIN KB Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the "TIN Vault" product brand to "TIN KB" on every shipped, user-visible surface plus the filenames that carry it, as one PR that self-deploys through GHCR and Watchtower.

**Architecture:** A rename, not a refactor. Most surfaces are driven by the single `env.APP_NAME` value; the rest are literal strings and eight onboarding documents. The one structural change is the OpenAPI generator script, which must be retargeted so the next upstream sync cannot regenerate the old brand. Retained identifiers (protocols, headers, credential prefixes, container names) are untouched.

**Tech Stack:** TypeScript, React, Koa, MobX, Vitest, Python 3 + Pillow (artwork only).

**Spec:** `docs/superpowers/specs/2026-09-27-tin-kb-rebrand-design.md`
**Branch:** `feat/tin-kb-rebrand` (based on `dda4f2174`)
**Rollback anchor:** `dda4f21`

## Global Constraints

- Never run tests against the production database. Before any test command:
  `export DATABASE_URL="$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" NODE_ENV=test TZ=UTC`
- Do not change: `outline://`, `Outline-Signature`, `/outline`, `ol_api_` / `ol_at_` / `ol_rt_` / `ol_whs_`, `outline-markdown`, GHCR image name, database name, `LICENSE`, upstream URLs, non-`en_US` locales.
- Do not rename anything under `docs/superpowers/` or `docs/legal/`.
- Naming rule: **TIN KB** in space-constrained UI; **TIN Knowledge Base** in the PWA `name` field and first mention in flowing prose.
- Use oxfmt via `yarn format`; never hand-tune whitespace.
- One commit per task.

---

## File map

| File | Responsibility |
| --- | --- |
| `server/env.ts:886` | `APP_NAME`, the single source for title, emails, Slack copy, settings dialogs |
| `app.json`, `vite.config.ts` | PWA manifest and build-time manifest injection |
| `app/scenes/Launchpad/**` | Apex login and workspace launcher |
| `app/actions/definitions/navigation.tsx` | Help menu item |
| `plugins/*/client/index.tsx` | Integration descriptions |
| `server/onboarding/*.md` | Documents seeded into every new workspace |
| `scripts/openapi/build-tin-kb-spec.mjs` | Upstream spec transform; guards against leftover branding |
| `public/developers/**` | API portal and generated spec |
| `public/email/header-logo.png` | The only image carrying brand text |

---

### Task 1: Core value, manifest, and PWA metadata

**Files:**
- Modify: `server/env.ts:886`, `app.json:2`, `vite.config.ts:128-129`

**Interfaces:**
- Produces: `env.APP_NAME === "TIN KB"`, consumed by ~70 existing call sites.

- [ ] **Step 1: Change the constant**

In `server/env.ts`, line 886:

```ts
  public APP_NAME = "TIN KB";
```

- [ ] **Step 2: Change the manifest**

In `app.json`, line 2:

```json
  "name": "TIN KB",
```

- [ ] **Step 3: Change the build-time manifest injection**

In `vite.config.ts`, lines 128-129:

```ts
          name: "TIN Knowledge Base",
          short_name: "TIN KB",
```

- [ ] **Step 4: Verify the constant propagates**

Run: `grep -rn 'APP_NAME' server/routes/app.ts server/emails/templates/components/Header.tsx`
Expected: both still read `env.APP_NAME;` (no change needed; they pick up the new value).

- [ ] **Step 5: Type-check**

Run: `yarn tsc`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add server/env.ts app.json vite.config.ts
git commit -m "feat: rename the app brand constant and PWA metadata to TIN KB"
```

---

### Task 2: Launchpad, navigation, and login strings

**Files:**
- Modify: `app/scenes/Launchpad/components/BrandPanel.tsx:209`, `app/scenes/Launchpad/components/AuthCard.tsx:99`, `app/scenes/Launchpad/components/VaultStatus.tsx:153`, `app/scenes/Launchpad/index.tsx:127`, `app/scenes/Launchpad/theme.ts:2-3`, `app/actions/definitions/navigation.tsx:171`, `app/scenes/Login/urls.ts:66`

- [ ] **Step 1: Change the Launchpad eyebrow**

`app/scenes/Launchpad/components/BrandPanel.tsx:209`:

```tsx
        <span className="eyebrow">{t("TIN KB")}</span>
```

- [ ] **Step 2: Change the sign-in heading**

`app/scenes/Launchpad/components/AuthCard.tsx:99`:

```tsx
        <h1>{t("Sign in to TIN KB")}</h1>
```

- [ ] **Step 3: Change the no-membership message**

`app/scenes/Launchpad/components/VaultStatus.tsx:153`:

```tsx
              "You are signed in as {{ email }}. That account is not a member of any TIN KB workspace. A workspace administrator can grant access.",
```

- [ ] **Step 4: Update the Launchpad comments**

`app/scenes/Launchpad/index.tsx:127`: "The TIN KB Launchpad: the apex authentication and workspace launch".

`app/scenes/Launchpad/theme.ts:2-3`: "Design tokens for the TIN KB Launchpad, mirroring `design/tin-kb-launchpad/base.css`."

- [ ] **Step 5: Change the help menu item**

`app/actions/definitions/navigation.tsx:171`:

```tsx
  name: ({ t }) => t("TIN KB Guide"),
```

- [ ] **Step 6: Change the login error**

`app/scenes/Login/urls.ts:66`:

```ts
    throw new Error("Host is not a TIN KB installation");
```

- [ ] **Step 7: Type-check and commit**

Run: `yarn tsc`
Expected: no errors.

```bash
git add app/scenes/Launchpad app/actions/definitions/navigation.tsx app/scenes/Login/urls.ts
git commit -m "feat: rename Launchpad, navigation, and login branding to TIN KB"
```

---

### Task 3: Plugin integration descriptions

**Files:**
- Modify: `plugins/figma/client/index.tsx:14`, `plugins/github/client/index.tsx:14`, `plugins/gitlab/client/index.tsx:14`, `plugins/linear/client/index.tsx:14`, `plugins/matomo/client/index.tsx:15`, `plugins/umami/client/index.tsx:15`, `plugins/webhooks/client/index.tsx:15`, `plugins/zapier/client/index.tsx:14`

- [ ] **Step 1: Replace the brand in all eight descriptions**

Each file has exactly one occurrence in its description string; replace `TIN Vault` with `TIN KB`, leaving the sentence otherwise intact. Example, `plugins/github/client/index.tsx:14`:

```tsx
        "Connect your GitHub account to TIN KB to enable rich, realtime, issue and pull request previews inside documents.",
```

- [ ] **Step 2: Confirm no occurrence remains**

Run: `grep -rn 'TIN Vault' plugins/`
Expected: no output.

- [ ] **Step 3: Type-check and commit**

Run: `yarn tsc`
Expected: no errors.

```bash
git add plugins
git commit -m "feat: rename plugin integration descriptions to TIN KB"
```

---

### Task 4: Onboarding documents and the provisioner

**Files:**
- Modify: `server/onboarding/Getting Started.md`, `server/onboarding/Integrations & API.md`, `server/onboarding/Our Editor.md`
- Rename: `server/onboarding/What is TIN Vault.md` → `server/onboarding/What is TIN KB.md`
- Modify: `server/commands/accountProvisioner.ts:296,309`

- [ ] **Step 1: Rename the document**

```bash
git mv "server/onboarding/What is TIN Vault.md" "server/onboarding/What is TIN KB.md"
```

- [ ] **Step 2: Update the provisioner lookup key**

`server/commands/accountProvisioner.ts:309` must match the new filename (the extension is stripped by the loader):

```ts
      "What is TIN KB",
```

- [ ] **Step 3: Apply the naming rule to the documents**

In each document, replace `TIN Vault` with `TIN KB`. Where a sentence already ends in "knowledge base", the short form is required to avoid "TIN Knowledge Base is a place to build your team knowledge base". Specifically:

- `What is TIN KB.md:1`, `:15`, `:19` — short form.
- `Getting Started.md:1`, `:5` — short form.
- `Our Editor.md:1`, `:5` — short form.
- `Integrations & API.md:3`, `:15`, `:19` — short form. On `:3` the sentence already reads "supports many of the most popular tools", so it needs no long form.

- [ ] **Step 4: Confirm the provisioner target exists**

Run: `ls server/onboarding/` and `grep -n 'What is TIN' server/commands/accountProvisioner.ts`
Expected: the file exists with the new name and the provisioner names it exactly.

- [ ] **Step 5: Commit**

```bash
git add server/onboarding server/commands/accountProvisioner.ts
git commit -m "feat: rename onboarding documents and provisioner copy to TIN KB"
```

---

### Task 5: Test expectations

**Files:**
- Modify: `server/routes/index.test.ts:22,29,42,383,389,400`, `plugins/slack/server/api/hooks.test.ts:223`

- [ ] **Step 1: Update the page-title expectations**

`server/routes/index.test.ts:22,29,42`:

```ts
    expect(body).toContain("<title>TIN KB</title>");
```

- [ ] **Step 2: Update the portal expectations**

`server/routes/index.test.ts:383,389,400`:

```ts
  it("serves the TIN KB API portal on the apex", async () => {
```

```ts
    expect(html).toContain("<title>TIN KB API</title>");
```

```ts
    expect(body).toContain("title: TIN KB API");
```

- [ ] **Step 3: Update the Slack expectation**

`plugins/slack/server/api/hooks.test.ts:223`:

```ts
      "It looks like you haven’t linked your TIN KB account to Slack yet"
```

- [ ] **Step 4: Run the focused tests**

The `/developers` block in `server/routes/index.test.ts` depends on Task 6's
portal changes, so it is expected to fail until then. Run only the share-title
and Slack tests here:

Run:
```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" NODE_ENV=test TZ=UTC && \
node_modules/.bin/vitest run server/routes/index.test.ts -t "standard title" && \
node_modules/.bin/vitest run plugins/slack/server/api/hooks.test.ts
```
Expected: PASS. If these fail, the strings changed in earlier tasks do not match the code — fix the code, not the test. The full file is run again in Task 6 Step 9 and Task 10.

- [ ] **Step 5: Commit**

```bash
git add server/routes/index.test.ts plugins/slack/server/api/hooks.test.ts
git commit -m "test: update brand expectations to TIN KB"
```

---

### Task 6: Developers portal and the OpenAPI generator

**Files:**
- Modify: `public/developers/index.html:6`, `public/developers/init.js:1,6,14`, `server/routes/index.ts:155`
- Rename: `scripts/openapi/build-tin-vault-spec.mjs` → `scripts/openapi/build-tin-kb-spec.mjs`
- Regenerate: `public/developers/openapi.yaml`, `public/developers/openapi.upstream.json`

- [ ] **Step 1: Rename the generator**

```bash
git mv scripts/openapi/build-tin-vault-spec.mjs scripts/openapi/build-tin-kb-spec.mjs
```

- [ ] **Step 2: Retarget the replacements**

In `scripts/openapi/build-tin-kb-spec.mjs`, the three rewrite lines become:

```js
    .replace(/\bOutline API\b/g, "TIN KB API")
    .replace(/\bOutline(’|')s\b/g, "TIN KB$1s")
    .replace(/\bOutline\b/g, "TIN KB")
```

The snake/kebab example values become:

```js
    .replace(/\boutline-api-/g, "tin-kb-api-")
    .replace(/\/webhooks\/outline\b/g, "/webhooks/tin-kb")
```

Leave `outline-markdown` untouched (the comment above these lines says why).

- [ ] **Step 3: Retarget the metadata constants and header**

```js
spec.info.title = "TIN KB API";
spec.info.contact = {
  name: "TIN KB Support",
  email: "support.docs@tin.info",
};
spec.servers = [
  { url: `${BASE}/api`, description: "TIN KB (all workspaces)" },
];
```

and the output header:

```js
  `# TIN KB API specification, derived from outline/openapi@${commit}.\n# Original work licensed as follows:\n${notice}\n${body}`
```

- [ ] **Step 4: Extend the guard to catch a partial rename**

Replace the leftover check:

```js
const preLicenseBody = yaml.dump(spec, { lineWidth: -1, noRefs: true });
const leftovers = preLicenseBody.match(/getoutline\.com|\bOutline\b|\bTIN Vault\b/g);
if (leftovers) {
  console.error(
    `branding left in output: ${[...new Set(leftovers)].join(", ")}`
  );
  process.exit(1);
}
```

- [ ] **Step 5: Accept the pinned commit from the record file**

Replace the `argv` handling near the top so the script reads the pin, keeping an override:

```js
const [input, commitArg] = process.argv.slice(2);
if (!input) {
  console.error("usage: build-tin-kb-spec.mjs <spec3.yml> [commit]");
  process.exit(1);
}
const pin = JSON.parse(
  fs.readFileSync("public/developers/openapi.upstream.json", "utf8")
);
const commit = commitArg ?? pin.commit;
```

Also update the two usage lines at the top of the file to `build-tin-kb-spec.mjs`.

- [ ] **Step 6: Update the portal shell and config**

`public/developers/index.html:6`:

```html
    <title>TIN KB API</title>
```

`public/developers/init.js` — line 1 comment becomes `// TIN KB API portal: ...`, line 6 description becomes `"TIN KB"`, line 14 becomes `metaData: { title: "TIN KB API" },`.

`server/routes/index.ts:155` comment: "First-party TIN KB API portal. Apex only, ...".

- [ ] **Step 7: Regenerate the spec against the pinned upstream commit**

```bash
curl -fsSL "https://raw.githubusercontent.com/outline/openapi/40f51b75efad/spec3.yml" -o /tmp/spec3.yml
node scripts/openapi/build-tin-kb-spec.mjs /tmp/spec3.yml
```

Expected: `ok: public/developers/openapi.yaml`, exit 0.

- [ ] **Step 8: Confirm the regeneration changed only branding**

```bash
git diff --stat public/developers/openapi.yaml
git diff public/developers/openapi.yaml | grep '^[+-]' | grep -iv 'tin vault\|tin kb\|^[+-][+-]'
```

Expected: the second command prints nothing — every changed line is a brand line. Investigate any other line before continuing.

- [ ] **Step 9: Run the portal test**

Run:
```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" NODE_ENV=test TZ=UTC && \
node_modules/.bin/vitest run server/routes/index.test.ts
```
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add scripts/openapi public/developers server/routes/index.ts
git commit -m "feat: rename the API portal and retarget the spec generator to TIN KB"
```

---

### Task 7: Operational doc and design asset renames

**Files:**
- Rename: `docs/TIN_VAULT_API_DOCS.md` → `docs/TIN_KB_API_DOCS.md`
- Rename: `design/tin-vault-launchpad/` → `design/tin-kb-launchpad/`
- Modify: `app/scenes/Launchpad/theme.ts:3` (already updated in Task 2 to point at the new path)

- [ ] **Step 1: Rename the API docs file**

```bash
git mv docs/TIN_VAULT_API_DOCS.md docs/TIN_KB_API_DOCS.md
```

- [ ] **Step 2: Update its content**

Replace `TIN Vault` with `TIN KB` throughout, rename the title to "TIN KB API docs", and update the two references to `scripts/openapi/build-tin-vault-spec.mjs` to `scripts/openapi/build-tin-kb-spec.mjs`. Update the sync command's commit message example to "chore: sync TIN KB API spec to outline/openapi@$C".

- [ ] **Step 3: Rename the design directory and files**

```bash
mkdir -p design/tin-kb-launchpad
git mv design/tin-vault-launchpad/base.css design/tin-kb-launchpad/base.css
git mv design/tin-vault-launchpad/option-a-signal-gate.html design/tin-kb-launchpad/option-a-signal-gate.html
git mv design/tin-vault-launchpad/option-b-vault-night.html design/tin-kb-launchpad/option-b-vault-night.html
git mv design/tin-vault-launchpad/option-c-paper-ink.html design/tin-kb-launchpad/option-c-paper-ink.html
git mv design/tin-vault-launchpad/switcher-concept.html design/tin-kb-launchpad/switcher-concept.html
```

File basenames keep their descriptive names; only the directory changes, because `theme.ts` references the directory path.

- [ ] **Step 4: Confirm nothing references the old paths**

Run: `grep -rn 'tin-vault-launchpad\|TIN_VAULT_API_DOCS\|build-tin-vault-spec' app server shared plugins scripts docs design public`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add docs design app/scenes/Launchpad/theme.ts
git commit -m "docs: rename the API docs and Launchpad design assets to TIN KB"
```

---

### Task 8: Email header logo

**Files:**
- Modify: `public/email/header-logo.png`

- [ ] **Step 1: Install the brotli module fontTools needs for woff2**

```bash
python3 -m pip install --user brotli
```

Expected: installs into the user site-packages.

- [ ] **Step 2: Decompress Manrope to TTF**

```bash
python3 -c "
from fontTools.ttLib import TTFont
f = TTFont('public/fonts/manrope-latin.woff2')
f.flavor = None
f.save('/tmp/manrope.ttf')
print('ok')
"
```

- [ ] **Step 3: Build the new lockup**

Extract the mark from `public/images/tin-logo.png` (no text) and render "KB" in Manrope ExtraBold, navy `#35496B`, at a cap height matching the mark, composited on a transparent 159×48 canvas. Write to `/tmp/header-logo-kb.png` first so the current asset is untouched until reviewed.

- [ ] **Step 4: Review before installing**

Read `/tmp/header-logo-kb.png` and compare against the outgoing `public/email/header-logo.png` ("tin VAULT"). Check: matching navy, matching weight, KB baseline aligned with the mark, no clipping at 159×48. If it does not match, show candidates instead of installing.

- [ ] **Step 5: Install and confirm dimensions**

```bash
cp /tmp/header-logo-kb.png public/email/header-logo.png
python3 -c "
import struct
d=open('public/email/header-logo.png','rb').read(33)
print(struct.unpack('>II', d[16:24]))
"
```

Expected: `(159, 48)`.

- [ ] **Step 6: Commit**

```bash
git add public/email/header-logo.png
git commit -m "feat: rebuild the email header logo for TIN KB"
```

---

### Task 9: Regenerate the i18n source catalog

**Files:**
- Modify: `shared/i18n/locales/en_US/translation.json`

- [ ] **Step 1: Regenerate**

Run: `yarn build:i18n`
Expected: extraction completes; `en_US/translation.json` updated.

- [ ] **Step 2: Inspect the diff**

Run: `git diff shared/i18n/locales/en_US/translation.json`
Expected: keys containing "TIN Vault" replaced by "TIN KB" equivalents. Any key removed because its source string no longer exists (for example "Sign in to TIN Vault.") is expected. Do not hand-add translation strings.

- [ ] **Step 3: Confirm no old brand remains in the source catalog**

Run: `grep -n 'TIN Vault' shared/i18n/locales/en_US/translation.json`
Expected: no output.

- [ ] **Step 4: Confirm non-English catalogs were not touched**

Run: `git status --short shared/i18n/locales/`
Expected: only `en_US/translation.json` is modified.

- [ ] **Step 5: Commit**

```bash
git add shared/i18n/locales/en_US/translation.json
git commit -m "chore: regenerate the en_US catalog for the TIN KB rename"
```

---

### Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Pin the test database**

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" NODE_ENV=test TZ=UTC
echo "$DATABASE_URL"
```

Expected: ends in `/outline-test`. Stop if it does not.

- [ ] **Step 2: Type-check, lint, format**

```bash
yarn tsc && yarn lint && yarn format:check
```

Expected: all pass. Run `yarn format` and commit any formatting changes.

- [ ] **Step 3: Run the affected tests**

```bash
node_modules/.bin/vitest run server/routes plugins/slack
```

Expected: PASS.

- [ ] **Step 4: Run the broader suite**

```bash
yarn test
```

Expected: PASS, or only pre-existing failures. Record any failure and confirm it also fails on `dda4f2174`.

- [ ] **Step 5: Production build**

```bash
yarn build
```

Expected: completes; `vite:build`, `build:i18n`, `build:server` all succeed.

- [ ] **Step 6: Residual-brand grep**

```bash
grep -rIn -i 'tin vault\|tin-vault\|TIN_VAULT' app server shared plugins public scripts app.json vite.config.ts --exclude-dir=graphify-out
```

Expected: exactly these, and nothing else:
- `app/components/Icons/OutlineIcon.tsx:16` — retained cache-buster.
- `scripts/openapi/build-tin-kb-spec.mjs` — the leftover guard's own regex.

Any other match is a defect. Fix and re-run.

- [ ] **Step 7: Reconcile retained identifiers**

```bash
grep -rn 'outline://\|Outline-Signature\|ol_api_\|outline-markdown' app server shared plugins scripts | head -20
```

Expected: unchanged from `dda4f2174`. Confirm with `git diff dda4f2174 --stat` that none of these files appear.

- [ ] **Step 8: Confirm the diff is confined to scope**

```bash
git diff dda4f2174 --stat
```

Expected: only files listed in this plan. No dependency, lockfile, migration, or infra files.

---

### Task 11: Pull request, merge, and smoke test

**Files:** none

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin feat/tin-kb-rebrand
gh pr create --base main --title "Rename TIN Vault to TIN KB" --body "Implements docs/superpowers/specs/2026-09-27-tin-kb-rebrand-design.md. Renames the brand across every shipped user-visible surface, retargets the OpenAPI generator so upstream sync cannot revert it, and rebuilds the email header logo. No behavior, route, auth, database, or infrastructure changes. Rollback: pin OUTLINE_TAG=dda4f21 in /root/outline/.env and docker compose up -d outline."
```

- [ ] **Step 2: Confirm CI passes**

Run: `gh pr checks --watch`
Expected: all checks pass.

- [ ] **Step 3: Merge**

```bash
gh pr merge --squash --delete-branch
```

Expected: merged; triggers the image build workflow.

- [ ] **Step 4: Watch the image build**

```bash
gh run list --workflow=build-image.yml --limit 1
gh run watch
```

Expected: completes successfully; image pushed to GHCR.

- [ ] **Step 5: Post-deploy smoke test**

Allow one Watchtower poll interval (300s), then on each of the four hosts, confirm the tab title reads TIN KB and the login page shows no "TIN Vault":

```bash
for h in docs.tin.info programming.docs.tin.info tin.docs.tin.info clients.docs.tin.info; do
  printf '%s -> ' "$h"; curl -fsS "https://$h/auth/signin" | grep -o '<title>[^<]*</title>' | head -1
done
curl -fsS https://docs.tin.info/developers | grep -o '<title>[^<]*</title>'
```

Expected: `TIN KB`, and `TIN KB API` for the portal.

- [ ] **Step 6: Report outcome and hand over the Parts 2-3 checklist**

Report each check result including any failure verbatim. Then deliver the manual follow-up: workspace name changes (3 workspaces), the content edits, and the runbook corrections.

---

## Self-Review

**Spec coverage:** Sections 4.1-4.6 map to Tasks 1-7; section 4.5 to Task 6 Steps 1-5; section 5 to Task 8; section 6 to Tasks 5 and 10; section 7 to Task 11 Step 1; section 9 is handed over, not implemented, per its scope.

**Placeholders:** none. Every step names exact files and shows exact replacement content.

**Type consistency:** `build-tin-kb-spec.mjs` is the single generator name used in Tasks 6, 7, 10. `env.APP_NAME` is the single constant name throughout. The Task 2 `theme.ts` path reference and Task 7 directory rename agree on `design/tin-kb-launchpad`.

**Known ordering dependency:** Task 2 Step 4 updates `theme.ts` to reference the new directory before Task 7 performs the rename. Both land in the same PR, so no intermediate state is deployed; the order avoids a dangling reference in the final tree.
