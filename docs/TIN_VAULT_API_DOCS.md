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

## Updating Scalar

Task 2 wires up a self-hosted Scalar viewer for `openapi.yaml`. After syncing
the spec to a new upstream commit (above), bump the viewer to point at the
new `public/developers/openapi.yaml` per Task 2 Step 1, so the served docs
reflect the newly synced spec.

## Licence notices

Keep all of the following in place; none of them should be deleted or have
their content altered beyond what the sync process above produces:

- `public/developers/LICENSES/outline-openapi-BSD-3-Clause.txt` — the
  vendored upstream BSD-3-Clause LICENSE for `outline/openapi`.
- The BSD-3-Clause header block prepended to the top of the generated
  `public/developers/openapi.yaml`.
- The MIT license header in `standalone.js` (the Scalar viewer bundle added
  in Task 2).

## Rollback

### Rollback strategy

No database migrations, no data changes, and no credential or prefix changes, so every rollback below is lossless.

| Situation | Action | Time |
| --- | --- | --- |
| Anything wrong after deploy (fastest) | On the server: set `OUTLINE_TAG=<sha7 from Task 5 Step 1>` in `/root/outline/.env`, then `cd /root/outline && docker compose up -d outline`. Watchtower only follows `latest`, so the pinned tag stays put. | ~1 min |
| Permanent revert of everything | GitHub → the PR → **Revert** → merge the revert PR. The image build and Watchtower redeploy `latest` automatically. Then remove `OUTLINE_TAG` from `.env` and run `docker compose up -d outline` to follow `latest` again. | ~15 min |
| Only the OAuth hand-off misbehaves | `git revert <Task 3 commit>` in a small PR. The portal and links stay. | ~15 min |
| Only the portal misbehaves | `git revert <Task 2 commit>` and `<Task 4 commit>` (links would point at a missing page otherwise). OAuth fix stays. | ~15 min |

After any rollback: `curl -s -o /dev/null -w '%{http_code}' https://docs.tin.info/` returns 200, and apex and workspace discovery return 200.
