# Guest Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin, or anyone with Manage on a specific collection or page, invite an outside email address to that item alone, at view-only or edit level, with no workspace-wide access and no ability to invite others.

**Architecture:** Outside people become real `User` rows with `role: Guest`, which the policy layer already scopes to explicit memberships. A new transactional endpoint, `POST /api/users.inviteGuest`, creates the account, the membership, and the invite email in one request, replacing the current two-call sequence in the share dialogs that silently created full workspace members. No permission levels are added and no schema changes.

**Tech Stack:** TypeScript, Koa, Sequelize (PostgreSQL), Zod validation, MobX + React, Vitest, styled-components.

**Spec:** `docs/superpowers/specs/2026-09-29-guest-sharing-design.md`

**Already implemented (do not redo):** the `inviteGuest` policy abilities on `Collection` and `Document`, with tests, including the refusal of guest actors. See `server/policies/collection.ts` and `server/policies/document.ts`.

**Test setup:** every task that runs tests needs the test database pinned first:

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" NODE_ENV=test TZ=UTC
```

Dependencies are already installed in this worktree; invoke tools directly (`./node_modules/.bin/vitest`, `./node_modules/.bin/tsc`) since the `yarn` binary on PATH is v1 and the project pins v4.

---

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `server/emails/templates/GuestInviteEmail.tsx` | Invite email for outside collaborators: names the shared item instead of asking them to join the workspace |
| `server/commands/guestInviter.ts` | The whole guest invite transaction: find-or-create the guest account, attach the membership, send the email |
| `server/commands/guestInviter.test.ts` | Command-level tests, independent of HTTP |
| `app/scenes/Settings/components/RemoveGuestDialog.tsx` | Confirms removal of a guest account that no longer holds any grant |

**Modified**

| File | Change |
| --- | --- |
| `server/models/UserMembership.ts` | Guest cap hook |
| `server/models/GroupMembership.ts` | Guest cap hook |
| `server/models/UserMembership.test.ts`, `server/models/GroupMembership.test.ts` | Guest cap coverage |
| `server/commands/userInviter.ts` | Refuses the guest role defensively |
| `server/routes/api/users/schema.ts` | `users.invite` rejects guest; new `UsersInviteGuestSchema` |
| `server/routes/api/users/users.ts` | New `users.inviteGuest` route |
| `server/routes/api/users/users.test.ts` | Guest invite route and role rejection tests |
| `shared/utils/EventHelper.ts`, `server/types.ts`, `plugins/webhooks/server/tasks/DeliverWebhookTask.ts` | `users.invite_guest` audit event registration |
| `app/stores/UsersStore.ts` | `inviteGuest` action |
| `app/components/Sharing/components/Suggestions.tsx` | Email suggestion reads "Invite as guest" |
| `app/components/Sharing/Collection/SharePopover.tsx`, `app/components/Sharing/Document/SharePopover.tsx` | Emails become guests; Manage hidden while a guest is pending |
| `app/scenes/Settings/components/UserRoleFilter.tsx` | Guests filter |
| `app/components/Sharing/Collection/AccessControlList.tsx`, `.../Document/AccessControlList.tsx` | Offer guest removal when the last grant is dropped |

---

## Task 1: Cap guests below Manage

**Files:**
- Modify: `server/models/UserMembership.ts`
- Modify: `server/models/GroupMembership.ts`
- Test: `server/models/UserMembership.test.ts`, `server/models/GroupMembership.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `server/models/UserMembership.test.ts`, inside the top-level `describe("UserMembership", ...)`:

```ts
  describe("guest cap", () => {
    it("should reject an admin membership for a guest", async () => {
      const collection = await buildCollection();
      const guest = await buildGuestUser({ teamId: collection.teamId });

      await expect(
        UserMembership.create({
          createdById: guest.id,
          userId: guest.id,
          collectionId: collection.id,
          permission: CollectionPermission.Admin,
        })
      ).rejects.toThrow("Guests cannot be granted manage permissions");
    });

    it("should allow a read_write membership for a guest", async () => {
      const collection = await buildCollection();
      const guest = await buildGuestUser({ teamId: collection.teamId });

      const membership = await UserMembership.create({
        createdById: guest.id,
        userId: guest.id,
        collectionId: collection.id,
        permission: CollectionPermission.ReadWrite,
      });

      expect(membership.permission).toEqual(CollectionPermission.ReadWrite);
    });
  });
```

`buildGuestUser` is exported from `@server/test/factories`; add it to that file's import list.

Add to `server/models/GroupMembership.test.ts`:

```ts
  describe("guest cap", () => {
    it("should reject an admin membership for a group containing a guest", async () => {
      const team = await buildTeam();
      const admin = await buildAdmin({ teamId: team.id });
      const guest = await buildGuestUser({ teamId: team.id });
      const collection = await buildCollection({ teamId: team.id });
      const group = await buildGroup({
        teamId: team.id,
        createdById: admin.id,
      });
      await GroupUser.create({
        groupId: group.id,
        userId: guest.id,
        createdById: admin.id,
      });

      await expect(
        GroupMembership.create({
          createdById: admin.id,
          collectionId: collection.id,
          groupId: group.id,
          permission: CollectionPermission.Admin,
        })
      ).rejects.toThrow("Guests cannot be granted manage permissions");
    });
  });
```

Import `GroupUser`, `buildAdmin`, `buildGuestUser`, and `GroupMembership` in that file as needed. Check the existing import block before editing so you extend it rather than replace it.

- [ ] **Step 2: Run them and watch them fail**

```bash
./node_modules/.bin/vitest run server/models/UserMembership.test.ts server/models/GroupMembership.test.ts
```

Expected: FAIL. Both writes currently succeed, which is the hole this task closes.

- [ ] **Step 3: Add the user-side hook**

In `server/models/UserMembership.ts`, alongside the existing `checkLastAdminBeforeUpdate` hook:

```ts
  @BeforeCreate
  @BeforeUpdate
  static async checkGuestPermissionScope(
    model: UserMembership,
    options: SaveOptions<UserMembership>
  ) {
    if (model.permission !== CollectionPermission.Admin) {
      return;
    }

    const user =
      model.user ??
      (await User.findByPk(model.userId, {
        transaction: options.transaction,
      }));

    if (user?.isGuest) {
      throw ValidationError("Guests cannot be granted manage permissions");
    }
  }
```

`ValidationError` is already imported; add `BeforeCreate` to the `sequelize-typescript` import list.

- [ ] **Step 4: Add the group-side hook**

In `server/models/GroupMembership.ts`:

```ts
  @BeforeCreate
  @BeforeUpdate
  static async checkGuestPermissionScope(
    model: GroupMembership,
    options: SaveOptions<GroupMembership>
  ) {
    if (model.permission !== CollectionPermission.Admin) {
      return;
    }

    const groupUsers = await GroupUser.findAll({
      where: { groupId: model.groupId },
      attributes: ["userId"],
      transaction: options.transaction,
    });

    const guestCount = await User.count({
      where: {
        id: groupUsers.map((groupUser) => groupUser.userId),
        role: UserRole.Guest,
      },
      transaction: options.transaction,
    });

    if (guestCount > 0) {
      throw ValidationError("Guests cannot be granted manage permissions");
    }
  }
```

Add `BeforeCreate`, `SaveOptions`, `GroupUser`, `User`, `UserRole`, and `ValidationError` to that file's imports as needed. If the file already imports `UserRole` from `@shared/types`, reuse it.

- [ ] **Step 5: Run the tests**

```bash
./node_modules/.bin/vitest run server/models/UserMembership.test.ts server/models/GroupMembership.test.ts server/models/User.test.ts
```

Expected: PASS, including `User.test.ts`, which changes roles to and from `guest` and exercises membership cascades.

- [ ] **Step 6: Commit**

```bash
git add server/models/UserMembership.ts server/models/GroupMembership.ts server/models/UserMembership.test.ts server/models/GroupMembership.test.ts
git commit -m "feat: prevent guests from being granted manage permissions"
```

---

## Task 2: Stop `users.invite` from accepting the guest role

**Files:**
- Modify: `server/routes/api/users/schema.ts` (`UsersInviteSchema`)
- Modify: `server/commands/userInviter.ts`
- Test: `server/routes/api/users/users.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `describe("#users.invite", ...)` in `server/routes/api/users/users.test.ts`:

```ts
  it("should reject the guest role", async () => {
    const admin = await buildAdmin();
    const res = await server.post("/api/users.invite", admin, {
      body: {
        invites: [
          {
            email: "outsider@example.com",
            name: "Outsider",
            role: "guest",
          },
        ],
      },
    });
    expect(res.status).toEqual(400);
  });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
./node_modules/.bin/vitest run server/routes/api/users/users.test.ts -t "should reject the guest role"
```

Expected: FAIL with status 200, because the schema accepts `guest` and `userInviter` silently coerces it to Member.

- [ ] **Step 3: Reject the role in the schema**

In `server/routes/api/users/schema.ts`, in `UsersInviteSchema`:

```ts
        role: z
          .enum(UserRole)
          .refine((role) => role !== UserRole.Guest, {
            error:
              "Guests are invited to a specific collection or document with users.inviteGuest",
          }),
```

- [ ] **Step 4: Add the defensive check in the command**

In `server/commands/userInviter.ts`, at the top of the `for (const invite of filteredInvites)` loop:

```ts
    if (invite.role === UserRole.Guest) {
      throw ValidationError(
        "Guests are invited to a specific collection or document with users.inviteGuest"
      );
    }
```

Add `ValidationError` to the `@server/errors` import, which currently imports only `DomainNotAllowedError`.

- [ ] **Step 5: Run the tests**

```bash
./node_modules/.bin/vitest run server/routes/api/users/users.test.ts server/commands/userInviter.test.ts
```

Expected: PASS, including the existing invite tests that use `member`, `viewer`, and `admin`.

- [ ] **Step 6: Commit**

```bash
git add server/routes/api/users/schema.ts server/commands/userInviter.ts server/routes/api/users/users.test.ts
git commit -m "fix: refuse the guest role on users.invite instead of silently creating a member"
```

---

## Task 3: Guest invite email

**Files:**
- Create: `server/emails/templates/GuestInviteEmail.tsx`

- [ ] **Step 1: Read the sibling template first**

Read `server/emails/templates/InviteEmail.tsx`. It is the canonical shape for an invitation email and its component imports are what the snippet below assumes. If any component name differs there, follow that file rather than the snippet.

- [ ] **Step 2: Create the template**

```tsx
import * as React from "react";
import env from "@server/env";
import type { EmailProps } from "./BaseEmail";
import BaseEmail, { EmailMessageCategory } from "./BaseEmail";
import Body from "./components/Body";
import Button from "./components/Button";
import EmailTemplate from "./components/EmailLayout";
import EmptySpace from "./components/EmptySpace";
import Footer from "./components/Footer";
import Header from "./components/Header";
import Heading from "./components/Heading";

type Props = EmailProps & {
  name: string;
  actorName: string;
  teamName: string;
  teamUrl: string;
  /** The name of the collection or document that was shared. */
  itemName: string;
  /** Whether the shared item is a collection rather than a document. */
  isCollection: boolean;
  /** One-click sign-in token. */
  token?: string;
};

/**
 * Email sent to an outside collaborator when a collection or document is shared
 * with them. Unlike the workspace invite, it names the shared item and never
 * implies access to the workspace as a whole.
 */
export default class GuestInviteEmail extends BaseEmail<Props, void> {
  protected get category() {
    return EmailMessageCategory.Invitation;
  }

  protected subject({ actorName, itemName }: Props) {
    return this.t("{{ actorName }} shared “{{ itemName }}” with you", {
      actorName,
      itemName,
    });
  }

  protected preview({ isCollection }: Props) {
    return this.t(
      "You have been given access to a shared {{ itemType }} in {{ appName }}.",
      {
        itemType: isCollection ? "collection" : "document",
        appName: env.APP_NAME,
      }
    );
  }

  protected renderAsText({
    teamName,
    actorName,
    teamUrl,
    itemName,
    isCollection,
    token,
  }: Props): string {
    const link = token
      ? `${teamUrl}/auth/email.callback?token=${token}`
      : `${teamUrl}?ref=guest-invite-email`;

    return `
${this.t("{{ actorName }} shared “{{ itemName }}” with you", {
  actorName,
  itemName,
})}

${this.t(
  "You have been given access to this {{ itemType }} in the {{ teamName }} workspace.",
  { itemType: isCollection ? "collection" : "document", teamName }
)}

${this.t("Open now")}: ${link}
`;
  }

  protected render({
    teamName,
    actorName,
    teamUrl,
    itemName,
    isCollection,
    token,
  }: Props) {
    const link = token
      ? `${teamUrl}/auth/email.callback?token=${token}`
      : `${teamUrl}?ref=guest-invite-email`;

    return (
      <EmailTemplate previewText={this.preview}>
        <Header />

        <Body>
          <Heading>
            {this.t("{{ actorName }} shared “{{ itemName }}” with you", {
              actorName,
              itemName,
            })}
          </Heading>
          <p>
            {this.t(
              "You have been given access to this {{ itemType }} in the {{ teamName }} workspace.",
              {
                itemType: isCollection ? "collection" : "document",
                teamName,
              }
            )}
          </p>
          <EmptySpace height={10} />
          <p>
            <Button href={link}>{this.t("Open now")}</Button>
          </p>
        </Body>

        <Footer />
      </EmailTemplate>
    );
  }
}
```

Note the smart quotes in the copy: the source guidelines require them, so keep the curly quotes as written. Check how `InviteEmail` passes `previewText` (property style versus call) and match it.

- [ ] **Step 3: Verify it compiles**

```bash
./node_modules/.bin/tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add server/emails/templates/GuestInviteEmail.tsx
git commit -m "feat: add a guest invite email that names the shared item"
```

---

## Task 4: The `guestInviter` command

**Files:**
- Create: `server/commands/guestInviter.ts`
- Test: `server/commands/guestInviter.test.ts`

- [ ] **Step 1: Read two things before writing the test**

- `server/test/support.ts` — `withAPIContext(user, fn)` takes the actor and a callback, and provides `ctx.state.auth.user` and `ctx.state.transaction`. The tests below depend on that.
- `server/test/factories.ts` — confirm the names `buildAdmin`, `buildGuestUser`, `buildCollection`, `buildDocument`, `buildTeam`, `buildUser` and the `buildCollection`/`buildDocument` option shape (`teamId`, `collectionId`, `createdById`, `permission`).

- [ ] **Step 2: Write the failing tests**

Create `server/commands/guestInviter.test.ts`:

```ts
import { CollectionPermission, UserRole } from "@shared/types";
import { User, UserMembership } from "@server/models";
import {
  buildAdmin,
  buildCollection,
  buildDocument,
  buildGuestUser,
  buildTeam,
  buildUser,
} from "@server/test/factories";
import { withAPIContext } from "@server/test/support";
import guestInviter from "./guestInviter";

describe("guestInviter", () => {
  it("should create a guest scoped to the collection", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      createdById: admin.id,
    });

    const { user, membership } = await withAPIContext(admin, (ctx) =>
      guestInviter(ctx, {
        invite: {
          email: "outsider@example.com",
          name: "Outsider",
          collectionId: collection.id,
          permission: CollectionPermission.ReadWrite,
        },
      })
    );

    expect(user.email).toEqual("outsider@example.com");
    expect(user.role).toEqual(UserRole.Guest);
    expect(membership.collectionId).toEqual(collection.id);
    expect(membership.permission).toEqual(CollectionPermission.ReadWrite);
  });

  it("should allow an outside domain that a staff invite would reject", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      createdById: admin.id,
    });

    const { user } = await withAPIContext(admin, (ctx) =>
      guestInviter(ctx, {
        invite: {
          email: "someone@not-in-the-allowlist.test",
          collectionId: collection.id,
          permission: CollectionPermission.Read,
        },
      })
    );

    expect(user.role).toEqual(UserRole.Guest);
  });

  it("should reuse an existing staff user without changing their role", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const editor = await buildUser({
      teamId: team.id,
      email: "editor@example.com",
    });
    const collection = await buildCollection({
      teamId: team.id,
      createdById: admin.id,
    });

    const { user } = await withAPIContext(admin, (ctx) =>
      guestInviter(ctx, {
        invite: {
          email: "editor@example.com",
          collectionId: collection.id,
          permission: CollectionPermission.Read,
        },
      })
    );

    expect(user.id).toEqual(editor.id);
    expect(user.role).toEqual(UserRole.Member);
  });

  it("should reuse an existing guest and update the permission", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const guest = await buildGuestUser({
      teamId: team.id,
      email: "guest@example.com",
    });
    const collection = await buildCollection({
      teamId: team.id,
      createdById: admin.id,
    });

    const first = await withAPIContext(admin, (ctx) =>
      guestInviter(ctx, {
        invite: {
          email: "guest@example.com",
          collectionId: collection.id,
          permission: CollectionPermission.Read,
        },
      })
    );
    const second = await withAPIContext(admin, (ctx) =>
      guestInviter(ctx, {
        invite: {
          email: "guest@example.com",
          collectionId: collection.id,
          permission: CollectionPermission.ReadWrite,
        },
      })
    );

    expect(first.user.id).toEqual(guest.id);
    expect(second.user.id).toEqual(guest.id);
    expect(second.membership.id).toEqual(first.membership.id);
    expect(second.membership.permission).toEqual(
      CollectionPermission.ReadWrite
    );

    const count = await UserMembership.count({
      where: { userId: guest.id, collectionId: collection.id },
    });
    expect(count).toEqual(1);
  });

  it("should reject the manage permission", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      createdById: admin.id,
    });

    await expect(
      withAPIContext(admin, (ctx) =>
        guestInviter(ctx, {
          invite: {
            email: "outsider@example.com",
            collectionId: collection.id,
            permission: CollectionPermission.Admin,
          },
        })
      )
    ).rejects.toThrow();
  });

  it("should refuse an actor who only has edit permission", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const editor = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      createdById: admin.id,
      permission: null,
    });
    await UserMembership.create({
      createdById: admin.id,
      collectionId: collection.id,
      userId: editor.id,
      permission: CollectionPermission.ReadWrite,
    });

    await expect(
      withAPIContext(editor, (ctx) =>
        guestInviter(ctx, {
          invite: {
            email: "outsider@example.com",
            collectionId: collection.id,
            permission: CollectionPermission.Read,
          },
        })
      )
    ).rejects.toThrow();

    const created = await User.findOne({
      where: { email: "outsider@example.com" },
    });
    expect(created).toBeNull();
  });

  it("should allow an actor holding manage on the collection", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const manager = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      createdById: admin.id,
      permission: null,
    });
    await UserMembership.create({
      createdById: admin.id,
      collectionId: collection.id,
      userId: manager.id,
      permission: CollectionPermission.Admin,
    });

    const { user } = await withAPIContext(manager, (ctx) =>
      guestInviter(ctx, {
        invite: {
          email: "outsider@example.com",
          collectionId: collection.id,
          permission: CollectionPermission.Read,
        },
      })
    );

    expect(user.role).toEqual(UserRole.Guest);
  });

  it("should scope a document invite to the document", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      createdById: admin.id,
      permission: null,
    });
    const document = await buildDocument({
      teamId: team.id,
      collectionId: collection.id,
      createdById: admin.id,
    });

    const { membership } = await withAPIContext(admin, (ctx) =>
      guestInviter(ctx, {
        invite: {
          email: "outsider@example.com",
          documentId: document.id,
          permission: CollectionPermission.ReadWrite,
        },
      })
    );

    expect(membership.documentId).toEqual(document.id);
    expect(membership.collectionId).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests and watch them fail**

```bash
./node_modules/.bin/vitest run server/commands/guestInviter.test.ts
```

Expected: FAIL with a module-not-found error for `./guestInviter`.

- [ ] **Step 4: Write the command**

Create `server/commands/guestInviter.ts`:

```ts
import { CollectionPermission, UserRole } from "@shared/types";
import GuestInviteEmail from "@server/emails/templates/GuestInviteEmail";
import { ValidationError } from "@server/errors";
import { Collection, Document, User, UserMembership } from "@server/models";
import { UserFlag } from "@server/models/User";
import { authorize } from "@server/policies";
import type { APIContext } from "@server/types";

export type GuestInvite = {
  /** Email address of the outside collaborator. */
  email: string;
  /** Display name; defaults to the email address. */
  name?: string;
  /** Target collection, mutually exclusive with documentId. */
  collectionId?: string;
  /** Target document, mutually exclusive with collectionId. */
  documentId?: string;
  /** The level to grant. Never admin. */
  permission: CollectionPermission;
};

type Props = {
  invite: GuestInvite;
};

/**
 * Invites an outside email address to a single collection or document.
 * Creates the guest account when the email is unknown, attaches the
 * membership, and sends the invite email. Existing users keep their role:
 * a staff member who is shared an item receives only the membership.
 *
 * @param ctx The request context, carrying the actor and the transaction.
 * @param props.invite The invite to process.
 * @returns The guest user and the membership that was created or updated.
 * @throws ValidationError when the permission is admin or the target is ambiguous.
 */
export default async function guestInviter(
  ctx: APIContext,
  { invite }: Props
): Promise<{ user: User; membership: UserMembership }> {
  const { user: actor } = ctx.state.auth;
  const { transaction } = ctx.state;

  if (invite.permission === CollectionPermission.Admin) {
    throw ValidationError("Guests cannot be granted manage permissions");
  }
  if (!!invite.collectionId === !!invite.documentId) {
    throw ValidationError(
      "Exactly one of collectionId or documentId must be provided"
    );
  }

  const email = invite.email.trim().toLowerCase();

  const collection = invite.collectionId
    ? await Collection.findByPk(invite.collectionId, {
        userId: actor.id,
        rejectOnEmpty: true,
        transaction,
      })
    : null;

  const document = invite.documentId
    ? await Document.findByPk(invite.documentId, {
        userId: actor.id,
        rejectOnEmpty: true,
        transaction,
      })
    : null;

  if (collection) {
    authorize(actor, "inviteGuest", collection);
  } else if (document) {
    authorize(actor, "inviteGuest", document);
  } else {
    throw ValidationError(
      "Exactly one of collectionId or documentId must be provided"
    );
  }

  let target = await User.findOne({
    where: { teamId: actor.teamId, email },
    transaction,
  });

  if (!target) {
    target = await User.createWithCtx(
      ctx,
      {
        teamId: actor.teamId,
        name: invite.name?.trim() || email,
        email,
        role: UserRole.Guest,
        invitedById: actor.id,
        flags: {
          [UserFlag.InviteSent]: 1,
        },
      },
      { name: "invite_guest" }
    );
  }

  const item = collection ?? document;
  const where = collection
    ? { collectionId: collection.id, userId: target.id }
    : { documentId: document!.id, userId: target.id };

  let membership = await UserMembership.findOne({ where, transaction });

  if (membership) {
    membership.permission = invite.permission;
    await membership.saveWithCtx(ctx);
  } else {
    membership = await UserMembership.createWithCtx(ctx, {
      ...where,
      permission: invite.permission,
      createdById: actor.id,
    });
  }

  await new GuestInviteEmail({
    to: email,
    language: target.language,
    name: target.name,
    actorName: actor.name,
    teamName: actor.team.name,
    teamUrl: actor.team.url,
    itemName: item!.name,
    isCollection: !!collection,
    token: target.getInviteToken(),
  }).schedule();

  return { user: target, membership };
}
```

Notes for the implementer:

- `Collection.findByPk(id, { userId })` and `Document.findByPk(id, { userId })` are used this way across the test suite and preload memberships for the policy checks.
- `User.createWithCtx` and `UserMembership.createWithCtx` exist on the models' base class. Do not pass an event `name` to the membership call: `UserMembership` already publishes `documents.add_user` and `collections.add_user` events from its own `@AfterCreate` hook.
- `actor.team` is populated on the authenticated user in real requests; `withAPIContext` provides it in tests. If it is ever missing, load the team explicitly rather than assuming.
- The domain allowlist is deliberately not consulted here. Do not copy that block from `userInviter`.
- The email template and this command must agree on the prop names. If `GuestInviteEmail` ends up with different names, adjust this call to match the template, not the other way around.

- [ ] **Step 5: Run the tests**

```bash
./node_modules/.bin/vitest run server/commands/guestInviter.test.ts
```

Expected: PASS on all eight cases.

- [ ] **Step 6: Commit**

```bash
git add server/commands/guestInviter.ts server/commands/guestInviter.test.ts
git commit -m "feat: invite outside collaborators to a single collection or document"
```

---

## Task 5: The `users.inviteGuest` route

**Files:**
- Modify: `server/routes/api/users/schema.ts`
- Modify: `server/routes/api/users/users.ts`
- Modify: `shared/utils/EventHelper.ts`, `server/types.ts`, `plugins/webhooks/server/tasks/DeliverWebhookTask.ts`
- Test: `server/routes/api/users/users.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `server/routes/api/users/users.test.ts`:

```ts
describe("#users.inviteGuest", () => {
  it("should require authentication", async () => {
    const res = await server.post("/api/users.inviteGuest");
    expect(res.status).toEqual(401);
  });

  it("should invite a guest to a collection", async () => {
    const admin = await buildAdmin();
    const collection = await buildCollection({
      teamId: admin.teamId,
      createdById: admin.id,
    });
    const res = await server.post("/api/users.inviteGuest", admin, {
      body: {
        email: "outsider@example.com",
        name: "Outsider",
        collectionId: collection.id,
        permission: "read",
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.user.role).toEqual(UserRole.Guest);
    expect(body.data.membership.collectionId).toEqual(collection.id);
    expect(body.data.membership.permission).toEqual("read");
  });

  it("should reject the manage permission", async () => {
    const admin = await buildAdmin();
    const collection = await buildCollection({
      teamId: admin.teamId,
      createdById: admin.id,
    });
    const res = await server.post("/api/users.inviteGuest", admin, {
      body: {
        email: "outsider@example.com",
        collectionId: collection.id,
        permission: "admin",
      },
    });
    expect(res.status).toEqual(400);
  });

  it("should reject a request with both targets", async () => {
    const admin = await buildAdmin();
    const collection = await buildCollection({
      teamId: admin.teamId,
      createdById: admin.id,
    });
    const document = await buildDocument({
      teamId: admin.teamId,
      collectionId: collection.id,
    });
    const res = await server.post("/api/users.inviteGuest", admin, {
      body: {
        email: "outsider@example.com",
        collectionId: collection.id,
        documentId: document.id,
        permission: "read",
      },
    });
    expect(res.status).toEqual(400);
  });

  it("should not allow a viewer to invite a guest", async () => {
    const team = await buildTeam();
    const viewer = await buildViewer({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      createdById: viewer.id,
    });
    const res = await server.post("/api/users.inviteGuest", viewer, {
      body: {
        email: "outsider@example.com",
        collectionId: collection.id,
        permission: "read",
      },
    });
    expect(res.status).toEqual(403);
  });

  it("should not allow a guest to invite anyone, even holding manage", async () => {
    const team = await buildTeam();
    const guest = await buildGuestUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      createdById: guest.id,
      permission: null,
    });
    await UserMembership.create({
      createdById: guest.id,
      collectionId: collection.id,
      userId: guest.id,
      permission: CollectionPermission.Admin,
    });
    const res = await server.post("/api/users.inviteGuest", guest, {
      body: {
        email: "another@example.com",
        collectionId: collection.id,
        permission: "read",
      },
    });
    expect(res.status).toEqual(403);
  });
});
```

Import `UserMembership`, `CollectionPermission`, `buildViewer`, `buildGuestUser`, and `buildDocument` in that file if they are not already imported.

Two notes on these tests:

- The guest-cap hook from Task 1 would reject the `Admin` membership written directly in the last test. Write that membership with the hook bypassed, or construct the guest's manage access through a route instead. The simplest path is `UserMembership.create({...}, { hooks: false })`, which the model already supports elsewhere.
- `server.post(path, user, options)` is the existing test helper shape; the request body is nested under `body`.

- [ ] **Step 2: Run the tests and watch them fail**

```bash
./node_modules/.bin/vitest run server/routes/api/users/users.test.ts -t "users.inviteGuest"
```

Expected: FAIL — the route does not exist, so the authenticated cases return an error status.

- [ ] **Step 3: Add the request schema**

In `server/routes/api/users/schema.ts`:

```ts
export const UsersInviteGuestSchema = z.object({
  body: z.object({
    email: z.email().transform((email) => email.toLowerCase()),
    name: z.string().optional(),
    collectionId: z.uuid().optional(),
    documentId: z.uuid().optional(),
    permission: z.enum([
      CollectionPermission.Read,
      CollectionPermission.ReadWrite,
    ]),
  }),
});

export type UsersInviteGuestReq = z.infer<typeof UsersInviteGuestSchema>;
```

Add `CollectionPermission` to the `@shared/types` import in that file.

- [ ] **Step 4: Add the route**

In `server/routes/api/users/users.ts`, after the `users.invite` route:

```ts
router.post(
  "users.inviteGuest",
  rateLimiter(RateLimiterStrategy.FiftyPerHour),
  auth(),
  validate(T.UsersInviteGuestSchema),
  transaction(),
  async (ctx: APIContext<T.UsersInviteGuestReq>) => {
    const { user } = ctx.state.auth;
    const { email, name, collectionId, documentId, permission } =
      ctx.input.body;

    const { user: guest, membership } = await guestInviter(ctx, {
      invite: { email, name, collectionId, documentId, permission },
    });

    ctx.body = {
      data: {
        user: presentUser(guest, { includeEmail: true }),
        membership: presentMembership(membership),
      },
      policies: presentPolicies(user, [guest, membership]),
    };
  }
);
```

Add imports: `guestInviter` from `@server/commands/guestInviter`, and `presentMembership` from `@server/presenters` if it is not already imported.

- [ ] **Step 5: Register the audit event**

Add `"users.invite_guest"` to the `users` event name union in `server/types.ts`, mirroring the existing `users.invite` member:

```ts
    | {
        name: "users.invite_guest";
        userId: string;
        data: {
          email: string;
          name: string;
        };
      }
```

The event is produced by the third argument to `User.createWithCtx` in `guestInviter`, which is `{ name: "invite_guest" }`; the model base class fills `data` from the changeset, exactly as `userInviter` does with `{ name: "invite" }`. No separate event is needed for the membership.

Then:

- add `"users.invite_guest"` to the `AUDIT_EVENTS` list in `shared/utils/EventHelper.ts`, next to `"users.invite"`;
- add `case "users.invite_guest":` to the `users.*` group in the switch in `plugins/webhooks/server/tasks/DeliverWebhookTask.ts`, next to `case "users.invite":`. That switch has an `assertUnreachable` default, so `tsc` fails until this is done, which is the intended guard.

If `tsc` objects to the declared `data` shape because the changeset carries more fields than `email` and `name`, widen that member's `data` to `Record<string, unknown>` rather than casting at the call site, and note the reason in the commit message.

- [ ] **Step 6: Run the tests**

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vitest run server/routes/api/users/users.test.ts
```

Expected: both pass, including the six new cases.

- [ ] **Step 7: Commit**

```bash
git add server/routes/api/users/schema.ts server/routes/api/users/users.ts server/routes/api/users/users.test.ts shared/utils/EventHelper.ts server/types.ts plugins/webhooks/server/tasks/DeliverWebhookTask.ts
git commit -m "feat: add users.inviteGuest for sharing items with outside collaborators"
```

---

## Task 6: Share dialogs invite outside emails as guests

**Files:**
- Modify: `app/stores/UsersStore.ts`
- Modify: `app/components/Sharing/components/Suggestions.tsx`
- Modify: `app/components/Sharing/Collection/SharePopover.tsx`, `app/components/Sharing/Document/SharePopover.tsx`

- [ ] **Step 1: Add the store action**

In `app/stores/UsersStore.ts`, after `invite`:

```ts
  /**
   * Invites an outside email address to a single collection or document as a
   * guest, scoped to that item only.
   *
   * @param guest the invite to send.
   * @returns the created or reused user.
   */
  @action
  inviteGuest = async (guest: {
    email: string;
    name?: string;
    collectionId?: string;
    documentId?: string;
    permission: CollectionPermission | DocumentPermission;
  }): Promise<User> => {
    const res = await client.post(`/users.inviteGuest`, guest);
    invariant(res?.data, "Data should be available");

    let user: User;
    runInAction(() => {
      user = this.add(res.data.user);
      this.rootStore.addPolicies(res.policies);
      if (guest.collectionId) {
        this.rootStore.memberships.add(res.data.membership);
      } else {
        this.rootStore.userMemberships.add(res.data.membership);
      }
    });
    return user;
  };
```

Import `CollectionPermission` and `DocumentPermission` from `@shared/types`. Confirm the root store property names — `memberships` and `userMemberships` both exist on `RootStore`.

- [ ] **Step 2: Fix the suggestion label**

In `app/components/Sharing/components/Suggestions.tsx`, `getSuggestionForEmail` labels the row `email: t("Invite to workspace")`, which is now wrong for this dialog: an email typed here becomes a guest, not a workspace member.

```ts
    const getSuggestionForEmail = React.useCallback(
      (email: string) => ({
        id: email,
        name: email,
        avatarUrl: "",
        color: stringToColor(email),
        initial: email[0].toUpperCase(),
        email: t("Invite as guest"),
      }),
      [t]
    );
```

- [ ] **Step 3: Route emails through the guest invite in the collection dialog**

In `app/components/Sharing/Collection/SharePopover.tsx`, replace the `inviteAction.perform` body so emails call `users.inviteGuest` and everything else keeps its current path:

```tsx
        perform: async () => {
          const invited = await Promise.all(
            pendingIds.map(async (idOrEmail) => {
              if (isEmail(idOrEmail)) {
                const guest = await users.inviteGuest({
                  email: idOrEmail,
                  name: idOrEmail,
                  collectionId: collection.id,
                  permission,
                });
                return guest;
              }

              const user = users.get(idOrEmail);
              if (user) {
                await memberships.create({
                  collectionId: collection.id,
                  userId: user.id,
                  permission,
                });
                return user;
              }

              const group = groups.get(idOrEmail);
              if (group) {
                await groupMemberships.create({
                  collectionId: collection.id,
                  groupId: group.id,
                  permission,
                });
                return group;
              }

              return;
            })
          );
```

Keep the existing toast logic below it, including the single-invite special case.

Add this above the `permissions` memo:

```tsx
  const hasGuestPending = React.useMemo(
    () => pendingIds.some((id) => isEmail(id)),
    [pendingIds]
  );
```

and filter the permission list so a guest cannot be offered Manage:

```tsx
  const permissions = React.useMemo(
    () =>
      hasGuestPending
        ? basePermissions.filter(
            (permission) => permission.value !== CollectionPermission.Admin
          )
        : basePermissions,
    [basePermissions, hasGuestPending]
  );
```

`basePermissions` is the existing array this file already builds; leave it as it is and rename only if the surrounding names differ.

- [ ] **Step 4: Repeat for documents**

In `app/components/Sharing/Document/SharePopover.tsx`, make the same change, passing `documentId: document.id` to `users.inviteGuest` and using `userMemberships.create` for the non-email branch, which is what that file already calls.

- [ ] **Step 5: Verify by hand**

Start the app, open a collection, and:

- type an outside email, confirm the suggestion reads "Invite as guest"
- confirm the permission picker shows View only and Can edit, with no Manage
- add the email, and confirm the row appears in the access list with the chosen level
- add an existing staff member in the same session and confirm Manage comes back and that person is added as before

- [ ] **Step 6: Type-check and lint**

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/oxlint --type-aware app server shared plugins
```

Expected: tsc exits 0 and oxlint reports 0 errors. The warnings are pre-existing.

- [ ] **Step 7: Commit**

```bash
git add app/stores/UsersStore.ts app/components/Sharing
git commit -m "feat: invite outside emails as guests from the share dialog"
```

---

## Task 7: End-to-end verification of guest sharing

**Files:** none created; this task is evidence gathering.

- [ ] **Step 1: Full type, lint, and format check**

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/oxlint --type-aware app server shared plugins
./node_modules/.bin/oxfmt --check app server shared plugins
```

- [ ] **Step 2: Targeted server suites**

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" NODE_ENV=test TZ=UTC
./node_modules/.bin/vitest run server/commands/guestInviter.test.ts server/commands/userInviter.test.ts server/models/UserMembership.test.ts server/models/GroupMembership.test.ts server/policies/collection.test.ts server/policies/document.test.ts server/routes/api/users/users.test.ts server/routes/api/documents/documents.test.ts server/routes/api/collections/collections.test.ts
```

- [ ] **Step 3: Build**

```bash
./node_modules/.bin/vite build
```

Expected: success. If the full `yarn build` is unavailable because of the yarn 1 versus 4 mismatch, running vite directly is sufficient evidence that the client compiles; say so in the report rather than omitting the step.

- [ ] **Step 4: Manual guest session — the highest-risk verification**

1. As an admin, share a private collection with an outside address at View only.
2. Open the invite email's link in a private browser window and sign in as the guest.
3. Confirm the sidebar shows only that collection and its pages, and that search returns nothing else.
4. Open a page and confirm the comment box is present and a comment posts with the guest's name and initial.
5. Set the workspace commenting setting to "Members only" and reload: commenting should be refused.
6. Open a page the guest was not shared, directly by URL: expect a 404, not the content.
7. Confirm the guest cannot reach Settings, cannot invite, and cannot see the member list.
8. Open a page in the shared collection in two browser sessions (guest and admin) and type simultaneously to confirm realtime editing works for the guest. Guest access to document-level websocket rooms is the most likely failure point; if realtime is broken for guests, stop and report it rather than working around it.
9. Sign the guest out, then sign in again through the workspace SSO provider rather than the emailed link. The invited email is an outside domain, so this is where workspace domain rules could refuse a legitimate collaborator. Record the exact error before changing anything.

- [ ] **Step 5: Report the evidence**

Report the commands run and their outcomes. Commit nothing unless a fix was required.

---

## Task 8: Guests in the members list

**Files:**
- Modify: `app/scenes/Settings/components/UserRoleFilter.tsx`
- Modify: `app/scenes/Settings/Users.tsx` if its counts or empty states enumerate roles

- [ ] **Step 1: Add the filter entry**

```tsx
        {
          key: UserRole.Viewer,
          label: t("Viewers"),
        },
        {
          key: UserRole.Guest,
          label: t("Guests"),
        },
```

- [ ] **Step 2: Verify by hand**

Open Settings → Members, filter by Guests, and confirm the invited guest appears with the Guest label and can be revoked, suspended, or promoted from that view.

- [ ] **Step 3: Type-check and commit**

```bash
./node_modules/.bin/tsc --noEmit
git add app/scenes/Settings
git commit -m "feat: show guests in the workspace member filters"
```

---

## Task 9: Offer to remove a guest when their last grant is dropped

**Files:**
- Create: `app/scenes/Settings/components/RemoveGuestDialog.tsx`
- Modify: `app/components/Sharing/Collection/AccessControlList.tsx`, `app/components/Sharing/Document/AccessControlList.tsx`

- [ ] **Step 1: Create the dialog**

Read `app/scenes/Settings/components/ApiKeyRevokeDialog.tsx` first; it is the canonical small confirmation dialog in this codebase and the shape below follows it.

```tsx
import { useTranslation } from "react-i18next";
import ConfirmationDialog from "~/components/ConfirmationDialog";
import useStores from "~/hooks/useStores";
import type User from "~/models/User";

type Props = {
  user: User;
  onSubmit: () => void;
};

/**
 * Confirms removal of a guest account once it no longer holds access to any
 * collection or document in the workspace.
 */
export default function RemoveGuestDialog({ user, onSubmit }: Props) {
  const { t } = useTranslation();
  const { users } = useStores();

  const handleSubmit = async () => {
    await users.actionOnUser("delete", user);
    onSubmit();
  };

  return (
    <ConfirmationDialog
      onSubmit={handleSubmit}
      submitText={t("Remove")}
      savingText={`${t("Removing")}…`}
      danger
    >
      {t(
        "{{ userName }} no longer has access to anything in this workspace. Remove their account?",
        { userName: user.name }
      )}
    </ConfirmationDialog>
  );
}
```

Confirm `users.actionOnUser` accepts `"delete"` and that `User` exposes `isGuest` on the client model; both exist, but check before relying on them.

- [ ] **Step 2: Trigger it from the collection access list**

In `app/components/Sharing/Collection/AccessControlList.tsx`, add `import type User from "~/models/User";`, destructure `dialogs` and `userMemberships` from `useStores()` alongside the existing stores, then add:

```tsx
    const offerGuestRemoval = React.useCallback(
      (guest: User) => {
        if (!guest.isGuest) {
          return;
        }
        const stillHasAccess =
          memberships.all.some((m) => m.userId === guest.id) ||
          userMemberships.all.some((m) => m.userId === guest.id);
        if (stillHasAccess) {
          return;
        }
        dialogs.openModal({
          title: t("Remove guest"),
          content: (
            <RemoveGuestDialog
              user={guest}
              onSubmit={dialogs.closeAllModals}
            />
          ),
        });
      },
      [dialogs, memberships.all, t, userMemberships.all]
    );
```

Call `offerGuestRemoval(membership.user)` immediately after the `memberships.delete({ collectionId, userId })` call in the membership removal handler. The store removes the membership locally before the promise resolves, so `stillHasAccess` already excludes the grant that was just dropped.

- [ ] **Step 3: Trigger it from the document access list**

In `app/components/Sharing/Document/AccessControlList.tsx`, add the same callback but call it after `userMemberships.delete({ documentId, userId })`, excluding the document being removed from the check:

```tsx
        const stillHasAccess =
          memberships.all.some((m) => m.userId === guest.id) ||
          userMemberships.all.some(
            (m) => m.userId === guest.id && m.documentId !== document.id
          );
```

- [ ] **Step 4: Verify by hand**

Remove a guest's only grant, confirm the prompt appears, cancel it once to confirm nothing is deleted, then confirm and check Settings → Members no longer lists the guest.

- [ ] **Step 5: Type-check and commit**

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/oxfmt --check app server shared plugins
git add app/components/Sharing app/scenes/Settings/components/RemoveGuestDialog.tsx
git commit -m "feat: offer to remove a guest when their last grant is removed"
```

---

## Known follow-ups, deliberately out of this plan

- **Public link expiry** (own spec): per-link choice of 1 / 7 / 30 / 90 days or Never, defaulting to 30.
- **Visitor analytics** (own spec): sessions, minutes on page, and navigation path, with guest traffic distinguishable from member traffic.
- A per-person read-without-commenting level, if it is ever needed. Read-only, no-comments access is served today by a collection with commenting switched off, or by a public share link.
