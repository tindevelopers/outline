# TIN Vault API docs

This documents how the TIN Vault API specification is vendored, kept in sync
with upstream Outline, and served.

## What is served

| File | Purpose |
| --- | --- |
| `public/developers/openapi.yaml` | Generated. The TIN Vault–branded OpenAPI spec, derived from `outline/openapi` and rewritten by `scripts/openapi/build-tin-vault-spec.mjs`. Servers and OAuth URLs point at `https://docs.tin.info`. |
| `public/developers/openapi.upstream.json` | Generated. Records which upstream commit `openapi.yaml` was built from and when. |
| `public/developers/LICENSES/outline-openapi-BSD-3-Clause.txt` | Vendored copy of the upstream `outline/openapi` LICENSE (BSD-3-Clause), fetched at the same pinned commit. |
| `scripts/openapi/build-tin-vault-spec.mjs` | The transform script. Rewrites Outline branding and `getoutline.com` URLs to TIN Vault / `docs.tin.info` equivalents, and fails if any branding survives. |

## Syncing with upstream

Run this after every `upstream-sync/*` merge that touches `server/routes/api/**`:

```bash
C=$(gh api repos/outline/openapi/commits/main -q .sha | cut -c1-12)
curl -fsSL "https://raw.githubusercontent.com/outline/openapi/$C/spec3.yml" -o /tmp/outline-spec3.yml
curl -fsSL "https://raw.githubusercontent.com/outline/openapi/$C/LICENSE" -o public/developers/LICENSES/outline-openapi-BSD-3-Clause.txt
node scripts/openapi/build-tin-vault-spec.mjs /tmp/outline-spec3.yml "$C"
git diff --stat public/developers/   # review, then commit as "chore: sync TIN Vault API spec to outline/openapi@$C"
```

If the script exits with `branding left in output: ...`, add a targeted
`.replace()` for the reported string in `scripts/openapi/build-tin-vault-spec.mjs`
and re-run. Never remove or weaken that guard.

`outline/openapi@main` tracks Outline's latest API, which may be ahead of the
Outline version this fork has merged. Review the spec diff against the
fork's `server/routes/api` changes before committing a sync.

## Updating Scalar

The commit that serves the self-hosted portal vendors a first-party Scalar viewer at `/developers`
(apex only; workspace hosts redirect there — see `server/routes/index.ts`).
It is pinned to `@scalar/api-reference@1.71.0` and configured with no
`proxyUrl`, `withDefaultFonts: false`, and `agent: { disabled: true }`, so
"Try it" stays same-origin with `/api` and nothing is fetched from
scalar.com. To bump the pinned version:

```bash
cd /tmp && npm pack @scalar/api-reference@<version> && tar -xzf scalar-api-reference-<version>.tgz
cp package/dist/browser/standalone.js /path/to/outline/public/developers/vendor/scalar/standalone.js
curl -fsSL https://raw.githubusercontent.com/scalar/scalar/main/LICENSE -o /path/to/outline/public/developers/LICENSES/scalar-MIT.txt
```

`dist/browser/standalone.js` is the real path in 1.71.0 (there is no
`package/LICENSE` in the npm tarball — the package.json `license` field says
`MIT`, and the upstream `scalar/scalar` repo LICENSE at its `main` branch is
the canonical text; the monorepo license is not versioned per-package tag).

After copying the new bundle:

1. Diff `public/developers/init.js` against the new version's config schema.
   The tarball doesn't ship `@scalar/types`, so `npm pack @scalar/types@<version>`
   (matching the `@scalar/types` version in `package/package.json`'s
   `dependencies`) and check
   `package/dist/api-reference/api-reference-configuration.d.ts` (top-level
   keys: `title`, `authentication`, `servers`, `withDefaultFonts`,
   `hideDarkModeToggle`, `metaData`, `favicon`, `customCss`, …) and
   `package/dist/api-reference/types.d.ts` (the per-source `agent?: { key?,
   disabled?, hideAddApi? }` key, and `authentication.preferredSecurityScheme`
   in `authentication-configuration.d.ts`). Drop or rename any key that no
   longer exists and note the change here.
2. Grep the new bundle for hosts it could still talk to:
   `grep -o '[a-z0-9.-]*\.scalar\.com\|cdn\.jsdelivr\.net\|fonts\.googleapis\.com' standalone.js`.
   As of 1.71.0 the bundle's config schema has a hard-coded
   `proxyUrl: { default: 'https://proxy.scalar.com' }`, but that default is
   only used by Scalar's own dashboard/registry "workspace" UI (not
   `createApiReference`); the internal fetch helper resolves an unset
   `proxyUrl` (`e.options.proxyUrl ?? ''`) to an empty string, which the
   `My()` URL-prefixing helper treats as "no proxy" and passes the request
   URL through unmodified. `fonts.googleapis.com` / `cdn.jsdelivr.net` do not
   appear in the bundle at all. Re-check this on every version bump — it is
   not enforced by a type, only by the bundle's runtime behaviour.
3. Verify `/developers` in a browser: open dev tools Network tab, confirm
   every request stays same-origin (only `docs.tin.info`, no
   `proxy.scalar.com` / `api.scalar.com` / `fonts.googleapis.com`), and check
   the console for CSP violations.

## Licence notices

Keep all of the following in place; none of them should be deleted or have
their content altered beyond what the sync process above produces:

- `public/developers/LICENSES/outline-openapi-BSD-3-Clause.txt` — the
  vendored upstream BSD-3-Clause LICENSE for `outline/openapi`.
- The BSD-3-Clause header block prepended to the top of the generated
  `public/developers/openapi.yaml`.
- `public/developers/LICENSES/scalar-MIT.txt` — the MIT license text for the
  vendored Scalar viewer bundle. `standalone.js` carries a one-line
  top-of-file banner pointing back at this file; the npm tarball ships no
  `LICENSE` file (only `"license": "MIT"` in `package.json`), so the full
  text is fetched from the `scalar/scalar` repository instead.

## Notes

- The apex OAuth `authorizationUrl` (`https://docs.tin.info/oauth/authorize`)
  hands off to the OAuth client's own workspace, so it works for users of the
  workspace that owns the client. Published clients used from other
  workspaces should use that workspace's own `/oauth/authorize` instead.
- "Try it" in the portal runs against the apex, so unauthenticated endpoints
  that infer the workspace from the host (e.g. `auth.config`) behave
  differently there than they do on a workspace host.

## Rollback

### Rollback strategy

No database migrations, no data changes, and no credential or prefix changes, so every rollback below is lossless.

| Situation | Action | Time |
| --- | --- | --- |
| Anything wrong after deploy (fastest) | On the server: set `OUTLINE_TAG=<sha7 of the previously deployed image>` in `/root/outline/.env`, then `cd /root/outline && docker compose up -d outline`. Watchtower only follows `latest`, so the pinned tag stays put. | ~1 min |
| Permanent revert of everything | GitHub → the PR → **Revert** → merge the revert PR. The image build and Watchtower redeploy `latest` automatically. Then remove `OUTLINE_TAG` from `.env` and run `docker compose up -d outline` to follow `latest` again. | ~15 min |
| Only the OAuth hand-off misbehaves | `git revert <the commit that hands apex OAuth authorize off to the client's workspace>` in a small PR. The portal and links stay. | ~15 min |
| Only the portal misbehaves | `git revert <the commit that serves the portal>` and `<the commit that links to it from API documentation>` (links would point at a missing page otherwise). OAuth fix stays. | ~15 min |

After any rollback: `curl -s -o /dev/null -w '%{http_code}' https://docs.tin.info/` returns 200, and apex and workspace discovery return 200.
