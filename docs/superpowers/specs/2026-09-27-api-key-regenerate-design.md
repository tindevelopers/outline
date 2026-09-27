# API Key Regenerate: Design Spec

Status: approved (design)
Date: 2026-09-27
Scope: Add a "Regenerate" action to personal API keys, alongside the existing
Copy and Revoke actions. Rotation is in place, with a choice of immediate
invalidation or a 48-hour grace period for the previous secret.
Base revision: `dda4f2174` (`origin/main`)
Branch: `feat/tin-kb-rebrand` (this work may be split onto its own branch)

## 1. Goal

Let a user rotate the secret of an existing API key without losing the key's
identity. The key keeps its `id`, `name`, `scope`, and `expiresAt`; only the
secret changes. The user chooses, at the moment of regenerating, whether the
outgoing secret stops working immediately or keeps working for a further 48
hours so that every place the key is configured can be updated first.

The existing audit surface is extended rather than invented: the new action
joins the `api_keys` event namespace that already backs the Auditing log.

## 2. Motivation

The only remediation available today is Revoke, which deletes the key. A user
who suspects a leak, or who wants to age a credential, must delete the key and
create a replacement, losing the key's name, scopes, and expiry, and leaving a
gap in which every consumer is broken with no overlap. Rotation with an
optional overlap window fixes both problems.

## 3. Current state

Inventory at `dda4f2174`:

| Concern | Location |
| --- | --- |
| Secret generation | `server/models/ApiKey.ts` `BeforeValidate` hook: `prefix + randomString(38)`, stored as `hash`, `last4`; plaintext only in the `value` virtual |
| Lookup | `ApiKey.findByToken` matches `secret` (deprecated) or `hash` |
| Authentication | `server/middlewares/authentication.ts` calls `findByToken`, then rejects if `expiresAt` has passed, then checks `canAccess` |
| Caching | None. The only `findByToken` call site is the authentication middleware, so a hash change takes effect on the next request |
| Routes | `server/routes/api/apiKeys/apiKeys.ts`: `create`, `list`, `delete` |
| Policy | `server/policies/apiKey.ts`: `read`, `update`, `delete` for owner-with-preference or admin |
| Client store | `app/stores/ApiKeysStore.ts`: list, create, delete |
| Client menu | `app/hooks/useApiKeyMenuActions.ts` → Copy, Revoke |
| Client dialog | `app/scenes/Settings/components/ApiKeyRevokeDialog.tsx` |

The `secret` and `hash` columns are nullable, and new keys populate only
`hash`. `last4` is a non-secret preview.

## 4. Data model

The row must be able to keep two secrets valid at once, so add two nullable
columns to `apiKeys`:

| Column | Type | Purpose |
| --- | --- | --- |
| `previousHash` | `STRING`, nullable, unique | The hash of the secret being retired. Unique so it is indexed for lookup and so at most one row can own it. |
| `previousHashExpiresAt` | `DATE`, nullable | The moment the retired secret stops authenticating. Null means no grace window. |

A migration adds both columns inside a transaction, in the style of
`server/migrations/20240929194201-add-hash-to-api-key.js`. The `down` migration
removes them.

Model changes in `server/models/ApiKey.ts`:

1. A static helper generates a secret and returns `{ value, hash, last4 }`. The
   existing `BeforeValidate` hook is refactored to call it, so both key creation
   and rotation go through one code path.
2. A new instance method rotates the key: it sets `previousHash` to the current
   `hash` and `previousHashExpiresAt` to now plus the grace period when grace is
   requested, otherwise null; writes the freshly generated secret into `value`,
   `hash`, and `last4`; then persists with `saveWithCtx` under the event name
   `regenerate`. The plaintext stays on the instance so the route can return it.
3. `findByToken` gains a third `Op.or` branch that matches `previousHash` only
   while `previousHashExpiresAt` is greater than now.
4. `previousHash` is marked `@SkipChangeset` like `hash`, so it never appears in
   an event's changeset.

`shared/validations.ts` gains `ApiKeyValidation.defaultGracePeriodHours = 48`,
so the server decides the window and the client labels it from the same number.

## 5. Server API

A new `apiKeys.regenerate` route in `server/routes/api/apiKeys/apiKeys.ts`,
modelled on `create`:

- `rateLimiter(RateLimiterStrategy.TwentyFivePerMinute)`
- `auth({ type: AuthenticationType.APP })`, matching create and delete, so an
  API key or OAuth token can never mint or rotate another key
- `validate(T.APIKeysRegenerateSchema)` and `transaction()`
- load the key through the `withUser` scope with a `UPDATE` lock, as `delete`
  does, then `authorize(user, "regenerate", key)`
- rotate, then respond with `presentApiKey`, which already includes `value`

Request body: `{ id: uuid, gracePeriod: boolean }`, where `gracePeriod`
defaults to `false`.

Policy: extend the existing `read`/`update`/`delete` rule on `ApiKey` in
`server/policies/apiKey.ts` to also allow `regenerate`. The result is that the
owner of the key, or an admin of the team, may regenerate it, matching Revoke
exactly.

Audit: add `api_keys.regenerate` in three places that enumerate the namespace:

- `ApiKeyEvent["name"]` union in `server/types.ts`
- `EventHelper.AUDIT_EVENTS` in `shared/utils/EventHelper.ts`
- the ignored `api_keys.*` case group in
  `plugins/webhooks/server/tasks/DeliverWebhookTask.ts` (its
  `assertUnreachable` default makes this mandatory, and api key events are not
  delivered to webhooks today)

The event carries the `name` of the key, like create and delete.

Presenter: add `previousHashExpiresAt` to `presentApiKey` so the client can
report an active window.

## 6. Client

- `ApiKeysStore.regenerate(apiKey, { gracePeriod })` posts to
  `/apiKeys.regenerate`, then applies `addPolicies` and `add(res.data)`. Because
  the response carries `value`, the row renders the new secret with its existing
  Copy affordance, the same as immediately after a create.
- `app/models/ApiKey.ts` gains a `previousHashExpiresAt` field and a computed
  that is true while that timestamp is in the future.
- `regenerateApiKeyActionFactory` in `app/actions/definitions/apiKeys.tsx`,
  using `ReplaceIcon`, hidden when `apiKey.isExpired` (expired keys already
  offer Delete). It is added to `useApiKeyMenuActions` between Copy and Revoke,
  so both the row menu and the right-click context menu pick it up without
  further wiring.
- A new `app/scenes/Settings/components/ApiKeyRegenerateDialog.tsx`: a warning
  that the current secret will be replaced, an `InputSelect` offering
  "Immediately" and "After 48 hours", and a submit button that reads
  `Regenerate`. On success it toasts that the new value must be copied now
  because it is shown only once.
- `ApiKeyListItem` shows a tertiary "Previous key valid until …" line while a
  grace window is active, so the overlap is not invisible to the user.

All new strings are written as `t(...)` calls and extracted by `yarn build:i18n`;
no locale file is hand-edited.

## 7. Developers API portal

`public/developers/openapi.yaml` is generated by
`scripts/openapi/build-tin-vault-spec.mjs`, which rewrites a vendored upstream
spec. The upstream spec will never contain this fork's endpoint, so hand-editing
the generated file would be overwritten on the next sync. The generator instead
injects the `/apiKeys.regenerate` path after the recursive rewrite pass and
before the leftover-branding guard, reusing the upstream `ApiKey` schema and the
`ApiKeys` tag, with `operationId` `apiKeysRegenerate`. The injected descriptions
are passed through the existing `rewrite()` function so their branding stays
consistent with the rest of the document, and the guard therefore also covers
them.

The generated `openapi.yaml` is then rebuilt by running the script against the
pinned upstream commit recorded in `public/developers/openapi.upstream.json`.
`previousHashExpiresAt` is documented on the shared `ApiKey` schema.

If the pinned upstream spec cannot be fetched, the work stops and reports that,
rather than hand-editing the generated artifact.

## 8. Semantics and edge cases

| Case | Behaviour |
| --- | --- |
| Immediate | `previousHash` and `previousHashExpiresAt` are null; the outgoing secret fails on the next request. |
| Grace | `previousHashExpiresAt` is now + 48h; the outgoing secret authenticates until then. |
| Second rotation inside a window | The first outgoing secret is dropped, because only the immediately previous secret is retained. This is intended and is covered by a test. |
| Expired key | The menu hides Regenerate; an admin may still regenerate via the API, which resets the secret but not `expiresAt`. |
| Client caching | None exists, so invalidation is immediate. |
| Key in the grace window and the consumer is also expired | Authentication rejects on `expiresAt` before the grace check matters, so an expired key stays unusable. |

## 9. Verification

Pin the test database before running anything:

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" NODE_ENV=test TZ=UTC
```

Then:

1. `yarn tsc`
2. `yarn lint` and `yarn format:check`
3. `yarn test server/routes/api/apiKeys/apiKeys.test.ts server/models/ApiKey.test.ts`
4. `yarn build`, and inspect the `build:i18n` diff for the new keys
5. Re-run the OpenAPI generator and confirm it exits 0, `openapi.yaml` gains the
   new path, and no upstream branding survives

New tests:

- server route: owner regenerates, old secret immediately rejected, new secret
  authenticates; owner regenerates with grace, old secret still authenticates and
  expires after the window; non-owner forbidden; admin allowed; viewer own key;
  unauthenticated rejected; a second grace rotation drops the first secret
- model: `findByToken` matches `previousHash` only inside the window; rotation
  sets and clears the columns as specified

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| The unmerged `feat/tin-kb-rebrand` work renames the generator script and `docs/TIN_VAULT_API_DOCS.md` | Land the injection in whichever file exists at merge time; note the coupling in the PR |
| Regenerating needs network access to the pinned upstream spec | Fall back only by reporting the failure; never hand-edit the generated OpenAPI file |
| Grace window silently widening the credential surface | The window is fixed at 48 hours, server-decided, surfaced in the UI, and bounded by a test |
| Two concurrent regenerations racing on one row | The route locks the row `FOR UPDATE` inside a transaction, as delete does |

## 11. Rollback

The migration only adds nullable columns, so a code revert leaves them in place
harmlessly; the `down` migration removes them. No existing data is rewritten, so
both rollbacks are lossless.

## 12. Out of scope

- Rotating OAuth tokens, sessions, or webhook signing secrets.
- Configurable or longer grace periods.
- Notifying consumers of a key, or displaying key usage by IP/user agent.
- Bulk regeneration across several keys.
