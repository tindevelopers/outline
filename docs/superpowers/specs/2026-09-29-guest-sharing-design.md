# Guest Sharing and Access Levels: Design Spec

Status: approved (design)
Date: 2026-09-29
Scope: Share a collection or a page with someone outside the workspace without
making them a workspace member. Adds a fourth access level, "Can comment", and
makes the existing (currently unreachable) Guest role inviteable from the share
dialog.
Base revision: `09a17222c` (`origin/main`)
Branch: `droid/share-collections-with`

## 1. Goal

Let a workspace admin, or anyone holding Manage on a specific collection or
page, invite an outside email address to that item only. The invited person
signs in, sees nothing beyond what was shared with them, and can be given one of
three levels: view only, view and comment, or edit content. They can never
manage the item and can never invite anyone else.

Two problems are solved at once:

1. Sharing with an outside party today goes through `users.invite`, which
   creates a full workspace user with access to every non-private collection.
2. Guests are capped at read-or-comment-or-edit, which requires a per-item
   level between `read` and `read_write` that does not exist yet.

## 2. Motivation

The request as stated: "when you share to an outside party's email address, you
have to invite them to the whole workspace; we would like the ability to have
more roles — admin, editor, guest — and to share a collection or a page."

The reference model is Slack: a guest is a real person with a real identity,
scoped to the items they were added to, with a per-item capability, and no
ability to add people.

## 3. Current state

Inventory at `09a17222c`:

| Concern | Location | State |
| --- | --- | --- |
| Roles | `shared/types.ts` `UserRole` | `admin`, `member` (labelled "Editor"), `viewer`, `guest` all exist |
| Guest usage | `server/models/User.ts` `isGuest` | Wired through 40+ policy branches and the websocket layer |
| Guest creation | `server/commands/userInviter.ts:73-90` | **Impossible.** Every invite is coerced to Viewer or Member |
| Invite UI | `app/scenes/Invite.tsx` | Offers Admin / Editor / Viewer only |
| Per-item access | `server/models/UserMembership.ts`, `GroupMembership.ts` | `read` / `read_write` / `admin`, on a collection *or* a document |
| Permission storage | `server/migrations/20181227001547-collection-permissions.js:18` | Plain `STRING` column, no database enum |
| Guest scoping | `server/policies/collection.ts:42,76` | Guests require an explicit membership even when the collection is non-private |
| Guest exclusions | `server/policies/user.ts:19-32`, `apiKey.ts`, `integration.ts`, `team.ts`, `group.ts` | Guests cannot list users, invite, create API keys, or reach integrations |
| Commenting gate | `server/policies/document.ts:53-66` | Guests may comment only when the workspace setting is `Everyone` |
| Collection comment switch | `server/models/Collection.ts` `commenting` | Per-collection boolean, `null` means inherit |
| Share dialog invite | `app/components/Sharing/Collection/SharePopover.tsx:190`, `.../Document/SharePopover.tsx` | Calls `users.invite` with `team.defaultUserRole`, then creates a membership as a second call |
| Invite email | `server/emails/templates/InviteEmail.tsx` | Carries `token` (`getInviteToken()`) already |
| Member list | `app/scenes/Settings/components/UserRoleFilter.tsx` | Admin / Member / Viewer only |
| Audit events | `shared/utils/EventHelper.ts:70`, `server/types.ts:188` | `users.invite` exists; enumerations are asserted exhaustively |

Two facts that shape the design: the permission column is a string, so a new
level needs no migration; and the Guest role's scoping rules are already
correct, so no policy needs to be invented for isolation, only for capping.

## 4. Roles and access levels

Roles answer who someone is; access levels answer what they can do on one item.
They stay separate.

| Role | Who | Ambient access |
| --- | --- | --- |
| Admin | Staff | Everything, including settings |
| Editor (`member`) | Staff | All non-private collections |
| Viewer | Staff | Read-only, all non-private collections |
| Guest | Outside person | **None.** Only items with an explicit membership |

| Access level | Value | Grantable to a guest | Grantable to staff |
| --- | --- | --- | --- |
| View only | `read` | yes | yes |
| Can comment | `comment` (new) | yes | yes |
| Can edit | `read_write` | yes | yes |
| Manage | `admin` | **no** | yes |

## 5. Data model

`CollectionPermission` and `DocumentPermission` in `shared/types.ts` each gain
`Comment = "comment"`. The ordering is `read` < `comment` < `read_write` <
`admin`, but no code depends on enum ordering; the meaning is expressed through
the explicit permission arrays already used in the policies.

Changes:

1. Add the value to both enums in `shared/types.ts`.
2. Add it to the `@IsIn([Object.values(CollectionPermission)])` validators on
   `UserMembership` (`server/models/UserMembership.ts`) and
   `GroupMembership` (`server/models/GroupMembership.ts`), so a `comment`
   membership can be written.
3. No migration. The column is a plain string and the value is new, so existing
   rows are unaffected and the `down` path is a code revert.
4. `Collection.commenting` and the workspace `TeamPreference.Commenting` keep
   their current meaning and are not replaced by the new level.

One intentional consequence: because the collection `permission` column validates
against `CollectionPermission`, "Can comment" also becomes selectable as the
*collection-wide* default for all members in `InputSelectPermission`. That is
coherent (all members may comment on everything in the collection) and is
covered by a test. If it is unwanted, the option list is filtered in the
component rather than the enum.

## 6. Policy changes

Server-side rules, all in `server/policies/`:

| Ability | Change |
| --- | --- |
| `read` Collection / Document | Accept `Comment` in the membership arrays, alongside `Read`, `ReadWrite`, `Admin` |
| `readDocument` Collection | Same, so a comment grant on a collection lets its pages be read |
| `comment` Document | Accept `Comment` in the membership arrays. The workspace gate stays: a guest may still only comment when the workspace setting is `Everyone`. `collection.commenting === false` still blocks it |
| `updateDocument` / `createDocument` / `deleteDocument` | Unchanged: `ReadWrite` or `Admin` only, so a comment-only member cannot write |
| `share` Collection / Document | Unchanged |
| `inviteGuest` Collection / Document | **New.** Allow when the actor is not a guest, the team is mutable, the item is active, and the actor is either an Admin or holds `Admin` (Manage) on that item |
| `update`, `archive`, `delete`, `export`, `restore` | Unchanged |

Capping guests is enforced on the write path, not only in the UI: membership
creation and update reject `permission: admin` when the target user `isGuest`.
The guest cap on inviting follows from `inviteGuest` itself, which rejects guest
actors.

The permission arrays currently repeated across the policies move to module
constants in `server/policies/collection.ts` and `document.ts`, so the new level
cannot be added to one call site and missed at another. Every existing
`permission !== CollectionPermission.ReadWrite` comparison
(`collection.ts:104,122,150`, `routes/api/collections/collections.ts:635`) is
audited as part of this change, since those checks assume a three-value set.

## 7. Server: guest invite

A new command `server/commands/guestInviter.ts`, exposed as
`POST /api/users.inviteGuest` in `server/routes/api/users/users.ts`. It lives
with the user routes because it creates a user; the route stays thin and
delegates to the command.

Request body:

```
{
  email: string,
  name?: string,
  collectionId?: uuid,
  documentId?: uuid,
  permission: "read" | "comment" | "read_write"
}
```

Exactly one of `collectionId` or `documentId` is required. `permission` is
validated against the guest-grantable subset, so `admin` is rejected by the
schema as well as by the policy.

The command runs inside a transaction and:

1. Normalizes the email (trim, lowercase) and loads the target item with its
   membership scope.
2. Authorizes `inviteGuest` on the target.
3. Finds an existing user in the team by email:
   - none: creates a `User` with `role: Guest`, `invitedById`, and the
     `InviteSent` flag.
   - an existing Guest: reuses it, no role change.
   - an existing staff user: reuses it and **does not change the role**. An
     editor remains an editor; the membership is the only thing added.
4. Creates the membership, or updates the permission if the user already holds
   one on that item. Idempotent.
5. Schedules the guest invite email.
6. Writes the audit event.

Two deliberate differences from `userInviter`:

- **No domain allowlist check.** `userInviter` rejects emails outside the
  workspace's allowed domains unless the inviter is an admin
  (`server/commands/userInviter.ts:47-53`). Guest invites are the case that
  allowlist is meant to exclude, so the check is bypassed here and kept intact
  for staff invites.
- **No ambient role.** The invited account is created as a Guest, so nothing
  beyond the membership is granted.

Rate limiting mirrors `users.invite` (`RateLimiterStrategy.FiftyPerHour`).

`users.invite` additionally stops accepting `role: Guest`. Today the role union
permits it and `userInviter` silently coerces it to Member
(`server/commands/userInviter.ts:73-90`), so a caller asking for a guest gets a
workspace member with access to every non-private collection. That request
becomes a validation error pointing at `users.inviteGuest`.

Audit: a new `users.invite_guest` event name added in the three places that
enumerate the namespace, following the pattern already established for
`api_keys.regenerate`:

- `server/types.ts` `UserEvent["name"]` union
- `shared/utils/EventHelper.ts` `AUDIT_EVENTS`
- the `users.*` case group in
  `plugins/webhooks/server/tasks/DeliverWebhookTask.ts`, whose
  `assertUnreachable` default makes this mandatory

The event carries the target item id and the granted permission.

Email: `InviteEmail` gains a guest variant — "shared *<item name>* with you"
rather than "join the workspace" — reusing the existing token link.

## 8. Client

Share dialog (both `app/components/Sharing/Collection/SharePopover.tsx` and
`app/components/Sharing/Document/SharePopover.tsx`): when the search text is an
email address that matches no existing user, the picker offers "Invite as guest"
with a permission select defaulting to **Can comment**. Confirming calls the new
store method once, replacing the current two-call sequence
(`users.invite` followed by `memberships.create`) for the outside-email case.

- `app/stores/UsersStore.ts` gains `inviteGuest`, posting to
  `/api/users.inviteGuest`.
- `app/components/InputMemberPermissionSelect.tsx` call sites gain the "Can
  comment" option. The permission option lists are currently duplicated across
  five components — `InputSelectPermission.tsx`, both `SharePopover.tsx` files,
  both `AccessControlList.tsx` files, `DocumentMemberList.tsx`, and
  `DocumentMemberListItem.tsx` — and are consolidated into one shared list so
  the new level cannot be missed in one of them.
- Settings → Members: `app/scenes/Settings/components/UserRoleFilter.tsx` gains
  a Guest entry so guests are reviewable and revocable in one place.
  `UserRoleHelper.displayName` already handles the label.
- Guest invites are **not** added to `app/scenes/Invite.tsx`. A guest without an
  item grant is meaningless, so guest creation stays in the share dialog where
  the grant is chosen in the same action.
- When the last membership is removed from a guest, the dialog offers "also
  remove this guest from the workspace", calling the existing user delete route.
  Suspension is available separately and unchanged.

## 9. Guest experience

- The sidebar shows only the collections and pages the guest holds a membership
  on; the existing "Shared with me" section already renders memberships.
- The comment box appears only when all three gates pass: the workspace
  commenting setting allows guests, the item grants `comment` or higher, and the
  collection's `commenting` switch is not disabled.
- Comments carry the guest's name and initial like any other author, through the
  existing avatar and presenter path.
- Guests can subscribe to items they can read and receive comment
  notifications; `subscribe` already requires only `read` on the item.
- Guests cannot reach settings, templates, invites, API keys, integrations, the
  user directory, or mention suggestions. All of this is existing policy; the
  only new rule is the cap on `admin` memberships.
- Download and export stay off for guests unless the workspace enables
  `ViewersCanExport`.
- Search returns only what the guest can read, through the existing membership
  filtering.

## 10. Verification

Pin the test database before running anything:

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" NODE_ENV=test TZ=UTC
```

Then:

1. `yarn tsc`
2. `yarn lint` and `yarn format:check`
3. `yarn test server/policies/collection.test.ts server/policies/document.test.ts server/models/UserMembership.test.ts server/commands/guestInviter.test.ts server/routes/api/users/users.test.ts`
4. `yarn build`, and inspect the `build:i18n` diff for the new strings

New tests:

- policy: a guest with `comment` can read and comment and cannot write; a guest
  with `read_write` cannot manage; a non-private collection still grants nothing
  to a guest without a membership; `inviteGuest` allowed for an admin and for a
  Manage holder, refused for an editor without Manage, a viewer, and a guest
- membership: a `comment` grant on a collection propagates to its child
  documents through the existing sourced-membership path; `permission: admin`
  is rejected for a guest target
- command: new email creates a Guest with a membership and schedules one email;
  outside domain succeeds where a staff invite would fail; an existing staff
  user is reused without a role change; an existing guest is reused; a repeat
  invite is idempotent; `admin` permission is rejected
- route: the authorization matrix above, plus rate limiting and rejection of a
  request with both `collectionId` and `documentId`
- route: `users.invite` rejects `role: Guest` instead of silently producing a
  Member
- manual: sign in as a real guest and confirm the sidebar contains only granted
  items, the comment box appears and works when the workspace setting allows it,
  and no settings, invite, or member surfaces are reachable

## 11. Risks

| Risk | Mitigation |
| --- | --- |
| Guest code paths are dormant and largely untested | Treat the manual guest session as a required verification step, not optional. Realtime editing for guests is the highest-risk area: guests are deliberately excluded from the team websocket channel (`server/services/websockets.ts:199`, `queues/processors/WebsocketsProcessor.ts:978`), so document-level collaboration must be confirmed separately |
| SSO sign-in may turn away an outside email that the workspace domain rules do not allow | Confirm the auth path matches the already-invited account before the invite is sent, and test the flow end to end with an outside domain |
| Adding a fourth permission value silently changes behaviour at `!== ReadWrite` comparisons | Audit every comparison listed in section 6 and move the permission arrays to shared constants |
| An admin creates a guest, then promotes them to Editor unintentionally keeping broad grants | Promotion is the existing explicit role change; a guest's grants are memberships, so they stay as they were and remain visible in Settings → Members |
| Emails to outside domains land in spam, so guests never arrive | The invite email is the only delivery path today; deliverability is worth a spot check on a real outside address during verification |

## 12. Rollback

No schema change and no migration, so a code revert is complete. Guest accounts
created before the revert remain as users with role `guest`; with the invite
path removed they cannot be created again, and their memberships continue to
behave under existing policy.

## 13. Out of scope

- **Public link improvements**, approved as a separate spec: a per-link expiry
  choice of 1 day / 7 / 30 / 90 / Never, defaulting to 30 days. Public links
  stay view-only, and anonymous visitors still cannot comment.
- **Visitor analytics**, approved as a separate spec: per-visitor sessions,
  minutes on page, and navigation path, with guest traffic distinguishable from
  member traffic. The recommended approach is an explicit page-activity
  telemetry endpoint writing to a new table with the same rollup pattern as
  `document_insights`, since the existing `views` table records that someone was
  on a page but not for how long, and events are not grouped into sessions.
- Guests managing a collection, inviting others, or seeing the member directory.
- Per-guest content redaction, watermarking, or IP-restricted access.
- Seat or billing accounting for guests.
- Bulk guest invites or CSV import of outside addresses.

## 14. Phasing

1. **Can comment level and guest invites.** Interdependent, since the default
   guest permission is Can comment. Enum and validators, policy changes, shared
   permission constants, sourced membership propagation, the invite command and
   route, the share dialog with a guest permission picker, the guest invite
   email, and the audit event. This delivers the request end to end.
2. **Review and lifecycle polish.** Guest entry in the role filter, the "remove
   this guest from the workspace" prompt when the last grant is dropped, and a
   check that comment notifications reach an outside inbox.
3. **Separate specs.** Public link expiry, then visitor analytics.
