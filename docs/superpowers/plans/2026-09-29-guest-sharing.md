# Guest Sharing and Access Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin, or anyone with Manage on a specific collection or page, invite an outside email address to that item alone, at one of three levels (view only, can comment, can edit), with no workspace-wide access and no ability to invite others.

**Architecture:** Outside people become real `User` rows with `role: Guest`, which the policy layer already scopes to explicit memberships. A fourth access level `comment` is added to the two permission enums; the storage column is a plain string, so no migration is required. A new transactional endpoint, `POST /api/users.inviteGuest`, creates the account, the membership, and the invite email in one request, replacing the current two-call sequence in the share dialogs that silently created full workspace members.

**Tech Stack:** TypeScript, Koa, Sequelize (PostgreSQL), Zod validation, MobX + React, Vitest, styled-components.

**Spec:** `docs/superpowers/specs/2026-09-29-guest-sharing-design.md`

**Test setup:** every task that runs tests needs the test database pinned first:

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" NODE_ENV=test TZ=UTC
```

---

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `server/emails/templates/GuestInviteEmail.tsx` | Invite email for outside collaborators: names the shared item instead of asking them to join the workspace |
| `server/commands/guestInviter.ts` | The whole guest invite transaction: find-or-create the guest account, attach the membership, send the email |
| `server/commands/guestInviter.test.ts` | Command-level tests, independent of HTTP |
| `app/utils/permissionOptions.ts` | One source of truth for the four access levels across the five pickers that currently duplicate them |

**Modified**

| File | Change |
| --- | --- |
| `shared/types.ts` | `Comment` added to `CollectionPermission` and `DocumentPermission` |
| `server/models/UserMembership.ts` | Validator accepts `comment`; guest cap hook |
| `server/models/GroupMembership.ts` | Validator accepts `comment`; guest cap hook for groups holding guests |
| `server/models/UserMembership.test.ts` | Comment level, guest cap |
| `server/models/GroupMembership.test.ts` | Guest cap |
| `server/policies/collection.ts` | Shared permission level constants; `inviteGuest` ability |
| `server/policies/document.ts` | Comment-aware `read` and `comment` rules; `inviteGuest` ability |
| `server/policies/collection.test.ts`, `server/policies/document.test.ts` | New level and guest cap coverage |
| `server/commands/userInviter.ts` | Refuses the guest role defensively |
| `server/routes/api/users/schema.ts` | `users.invite` rejects guest; new `UsersInviteGuestSchema` |
| `server/routes/api/users/users.ts` | New `users.inviteGuest` route |
| `server/routes/api/users/users.test.ts` | Guest invite route and role rejection tests |
| `shared/utils/EventHelper.ts`, `server/types.ts`, `plugins/webhooks/server/tasks/DeliverWebhookTask.ts` | `users.invite_guest` audit event registration |
| `app/stores/UsersStore.ts` | `inviteGuest` action |
| `app/components/Sharing/components/Suggestions.tsx` | Email suggestion reads "Invite as guest" |
| `app/components/Sharing/Collection/SharePopover.tsx`, `app/components/Sharing/Document/SharePopover.tsx` | Emails become guests; Manage hidden when a guest is pending |
| `app/components/InputSelectPermission.tsx`, both `AccessControlList.tsx`, `DocumentMemberList.tsx`, `DocumentMemberListItem.tsx` | Use the shared option list, gaining "Can comment" |
| `app/scenes/Settings/components/UserRoleFilter.tsx` | Guests filter |

---

## Phase 1: Can comment, and guest invites

### Task 1: Add the `comment` access level

**Files:**
- Modify: `shared/types.ts` (`CollectionPermission` at line 236, `DocumentPermission` just below it)
- Modify: `server/models/UserMembership.ts` (`@IsIn` validator)
- Modify: `server/models/GroupMembership.ts` (`@IsIn` validator)
- Test: `server/models/UserMembership.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `server/models/UserMembership.test.ts`, inside the top-level `describe("UserMembership", ...)` block:

```ts
  describe("comment permission", () => {
    it("should persist a comment level membership on a collection", async () => {
      const collection = await buildCollection();
      const user = await buildUser({ teamId: collection.teamId });

      const membership = await UserMembership.create({
        createdById: user.id,
        userId: user.id,
        collectionId: collection.id,
        permission: CollectionPermission.Comment,
      });

      const reloaded = await UserMembership.findByPk(membership.id);
      expect(reloaded?.permission).toEqual(CollectionPermission.Comment);
    });
  });
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" NODE_ENV=test TZ=UTC
yarn test server/models/UserMembership.test.ts -t "comment permission"
```

Expected: FAIL. `CollectionPermission.Comment` is `undefined`, and the `@IsIn` validator rejects the write, so the create throws or the assertion of `undefined` fails.

- [ ] **Step 3: Add the value to both enums**

In `shared/types.ts`:

```ts
export enum CollectionPermission {
  Read = "read",
  Comment = "comment",
  ReadWrite = "read_write",
  Admin = "admin",
}

export enum DocumentPermission {
  Read = "read",
  Comment = "comment",
  ReadWrite = "read_write",
  Admin = "admin",
}
```

- [ ] **Step 4: Run the test again**

```bash
yarn test server/models/UserMembership.test.ts -t "comment permission"
```

Expected: PASS. The `@IsIn([Object.values(CollectionPermission)])` validators on both models already read from the enum, so they accept the new value without further edits. Confirm that by checking the two validator lines rather than assuming:

```bash
rg -n "IsIn\(\[Object.values\(CollectionPermission\)\]\)" server/models
```

Expected: one hit in `UserMembership.ts` and one in `GroupMembership.ts`. If either validator lists literal permission strings instead, add `CollectionPermission.Comment` to it now.

- [ ] **Step 5: Find every exhaustive permission switch**

```bash
rg -n "CollectionPermission.Admin|DocumentPermission.Admin" app server --glob '!**/*.test.ts' --glob '!**/__snapshots__/**'
```

Expected: the policy files, the share dialog components, `UserMembership`/`GroupMembership` hooks, and `routes/api/collections/collections.ts`. Any `switch` or map keyed on the enum that would fall through for an unknown value must gain a `Comment` case. Record what you change in the commit message.

- [ ] **Step 6: Verify types and lint still pass**

```bash
yarn tsc && yarn lint
```

Expected: both pass. `yarn tsc` will surface any switch that is not exhaustive.

- [ ] **Step 7: Commit**

```bash
git add shared/types.ts server/models/UserMembership.ts server/models/GroupMembership.ts server/models/UserMembership.test.ts
git commit -m "feat: add a comment access level to collection and document permissions"
```

---

### Task 2: Policies honour the comment level

**Files:**
- Modify: `server/policies/collection.ts`
- Modify: `server/policies/document.ts`
- Test: `server/policies/collection.test.ts`, `server/policies/document.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `server/policies/document.test.ts`, in the existing `describe("guest", ...)` block. Note the workspace commenting preference: a guest can only comment at all when the workspace allows guests, so the test must set it.

```ts
    it("should allow a guest with a comment membership to read and comment", async () => {
      const team = await buildTeam();
      team.setPreference(TeamPreference.Commenting, CommentingAccess.Everyone);
      await team.save();
      const user = await buildUser({ teamId: team.id, role: UserRole.Guest });
      const collection = await buildCollection({
        teamId: team.id,
        permission: null,
      });
      const document = await buildDocument({
        teamId: team.id,
        collectionId: collection.id,
      });
      await UserMembership.create({
        createdById: user.id,
        documentId: document.id,
        userId: user.id,
        permission: DocumentPermission.Comment,
      });

      const reloaded = await Document.findByPk(document.id, {
        userId: user.id,
      });
      const abilities = serialize(user, reloaded);
      expect(abilities.read).toBeTruthy();
      expect(abilities.comment).toBeTruthy();
      expect(abilities.update).toEqual(false);
    });

    it("should not allow a view-only member of a private collection to comment", async () => {
      const team = await buildTeam();
      const user = await buildUser({ teamId: team.id });
      const collection = await buildCollection({
        teamId: team.id,
        permission: null,
      });
      const document = await buildDocument({
        teamId: team.id,
        collectionId: collection.id,
      });
      await UserMembership.create({
        createdById: user.id,
        collectionId: collection.id,
        userId: user.id,
        permission: CollectionPermission.Read,
      });

      const reloaded = await Document.findByPk(document.id, {
        userId: user.id,
      });
      const abilities = serialize(user, reloaded);
      expect(abilities.read).toBeTruthy();
      expect(abilities.comment).toEqual(false);
    });
```

The same file already contains a `describe("commenting access", ...)` block whose helper `buildGuestWithRead` grants `DocumentPermission.Read` and then asserts that such a guest *can* comment. Under the new model "View only" must mean no commenting, so that helper and its assertions change in this task:

```ts
  const buildGuestWithMembership = async (
    commenting: CommentingAccess,
    permission: DocumentPermission = DocumentPermission.Comment
  ) => {
    const team = await buildTeam();
    team.setPreference(TeamPreference.Commenting, commenting);
    await team.save();
    const user = await buildUser({ teamId: team.id, role: UserRole.Guest });
    const collection = await buildCollection({
      teamId: team.id,
      permission: null,
    });
    const doc = await buildDocument({
      teamId: team.id,
      collectionId: collection.id,
    });
    await UserMembership.create({
      userId: user.id,
      documentId: doc.id,
      permission,
      createdById: user.id,
    });
    const document = await Document.findByPk(doc.id, { userId: user.id });
    return { user, document };
  };
```

Then rewrite the block's cases:

- "should allow guest with read access to comment when members and guests" becomes "should allow a guest with comment access to comment when members and guests", using the default `DocumentPermission.Comment`, and keeps the existing assertion that `update` is false.
- "should not allow guest with read access to comment when members only" and the disabled case keep `DocumentPermission.Comment` and assert `comment` is false, proving the workspace gate still wins.
- "should not allow guest without document access to comment when members and guests" is unchanged.
- Add one case for the new distinction:

```ts
  it("should not allow a guest with view-only access to comment", async () => {
    const { user, document } = await buildGuestWithMembership(
      CommentingAccess.Everyone,
      DocumentPermission.Read
    );
    const abilities = serialize(user, document);
    expect(abilities.read).toBeTruthy();
    expect(abilities.comment).toEqual(false);
  });
```

Add to `server/policies/collection.test.ts`, in the same guest block:

```ts
    it("should allow a guest with a comment membership to read and comment on the collection", async () => {
      const team = await buildTeam();
      const user = await buildUser({ teamId: team.id, role: UserRole.Guest });
      const collection = await buildCollection({
        teamId: team.id,
        permission: null,
      });
      await UserMembership.create({
        createdById: user.id,
        collectionId: collection.id,
        userId: user.id,
        permission: CollectionPermission.Comment,
      });

      const reloaded = await Collection.findByPk(collection.id, {
        userId: user.id,
      });
      const abilities = serialize(user, reloaded);
      expect(abilities.read).toBeTruthy();
      expect(abilities.readDocument).toBeTruthy();
      expect(abilities.updateDocument).toEqual(false);
      expect(abilities.createDocument).toEqual(false);
    });
```

Make sure `UserMembership`, `DocumentPermission`, and `UserRole` are imported in each test file; they are already imported in `collection.test.ts` for `UserRole` and `CollectionPermission`, and `document.test.ts` already imports the models it uses for guest cases.

- [ ] **Step 2: Run them and watch them fail**

```bash
yarn test server/policies/document.test.ts server/policies/collection.test.ts
```

Expected: FAIL on the new cases. Reading with a `comment` membership returns false because the read policy's membership arrays do not include the new value.

- [ ] **Step 3: Introduce shared level constants in the collection policies**

In `server/policies/collection.ts`, below the imports:

```ts
/** Membership levels that grant visibility. */
const readLevels = [
  CollectionPermission.Read,
  CollectionPermission.Comment,
  CollectionPermission.ReadWrite,
  CollectionPermission.Admin,
];

/** Membership levels that grant content editing. */
const writeLevels = [
  CollectionPermission.ReadWrite,
  CollectionPermission.Admin,
];
```

A `commentLevels` constant belongs only in `server/policies/document.ts`, where the `comment` rule uses it; collections have no comment ability of their own, so adding it here would be an unused variable.

Replace the inline arrays in this file with the constants:

- `read` Collection: `includesMembership(collection, readLevels)`
- `readDocument` / `star` / `subscribe` group: `includesMembership(collection, readLevels)`
- `updateDocument`, `createDocument`, `deleteDocument`, `share`, `createTemplate`: `writeLevels`
- `update`, `archive`, `export`, `delete`, `restore`: `[CollectionPermission.Admin]`

Add the new ability at the end of the file:

```ts
allow(User, "inviteGuest", Collection, (actor, collection) =>
  and(
    !!collection,
    !!collection?.isActive,
    !actor.isGuest,
    isTeamModel(actor, collection),
    isTeamMutable(actor),
    or(
      isTeamAdmin(actor, collection),
      includesMembership(collection, [CollectionPermission.Admin])
    )
  )
);
```

- [ ] **Step 4: Make the document policies comment-aware**

In `server/policies/document.ts`, just below the imports:

```ts
/** Membership levels that grant visibility. */
const readLevels = [
  DocumentPermission.Read,
  DocumentPermission.Comment,
  DocumentPermission.ReadWrite,
  DocumentPermission.Admin,
];

/** Membership levels that grant commenting but not editing. */
const commentLevels = [
  DocumentPermission.Comment,
  DocumentPermission.ReadWrite,
  DocumentPermission.Admin,
];

/** Membership levels that grant content editing. */
const writeLevels = [
  DocumentPermission.ReadWrite,
  DocumentPermission.Admin,
];
```

Use `readLevels` in the `read` rule and `writeLevels` in `update`, `updateDocument`, and `share`. Then replace the body of the `comment` rule with:

```ts
allow(User, "comment", Document, (actor, document) => {
  const commenting = actor.team.getPreference(TeamPreference.Commenting);
  const collection = document?.collection;
  return and(
    !!document?.isActive,
    isTeamMutable(actor),
    can(actor, "read", document),
    // A legacy boolean `false` (team not yet migrated) means disabled.
    commenting !== CommentingAccess.None && commenting !== false,
    or(!actor.isGuest, commenting === CommentingAccess.Everyone),
    or(!collection, collection?.commenting !== false),
    or(
      // Ambient access: an open collection, or a page with no collection.
      // Guests never have ambient access, so they always need a membership.
      and(!collection?.isPrivate, !actor.isGuest),
      // An explicit membership at comment level or above.
      includesMembership(document, commentLevels),
      can(actor, "update", document)
    )
  );
});
```

Add the document-side guest invite ability after the `share` rule:

```ts
allow(User, "inviteGuest", Document, (actor, document) =>
  and(
    !!document?.isActive,
    !actor.isGuest,
    isTeamModel(actor, document),
    isTeamMutable(actor),
    or(
      isTeamAdmin(actor, document),
      includesMembership(document, [DocumentPermission.Admin])
    )
  )
);
```

- [ ] **Step 5: Run the tests**

```bash
yarn test server/policies/document.test.ts server/policies/collection.test.ts
```

Expected: PASS, including the pre-existing cases. The `comment` rule now distinguishes ambient access (staff on an open collection, unchanged) from explicit memberships (a view-only member of a private collection can no longer comment). That behaviour change is intentional and is what makes "View only" mean what it says.

- [ ] **Step 6: Run the wider server suites that touch permissions**

```bash
yarn test server/routes/api/documents/documents.test.ts server/routes/api/collections/collections.test.ts
```

Expected: PASS. These suites exercise commenting and membership heavily; any failure here is a real behaviour change, not a test artifact, and should be understood before continuing.

- [ ] **Step 7: Commit**

```bash
git add server/policies/collection.ts server/policies/document.ts server/policies/collection.test.ts server/policies/document.test.ts
git commit -m "feat: honour the comment access level in collection and document policies"
```

---

### Task 3: Cap guests below Manage

**Files:**
- Modify: `server/models/UserMembership.ts`
- Modify: `server/models/GroupMembership.ts`
- Test: `server/models/UserMembership.test.ts`, `server/models/GroupMembership.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `server/models/UserMembership.test.ts`:

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

`buildGuestUser` is already exported from `@server/test/factories` and is already imported in `collection.test.ts`; add it to the import list in `UserMembership.test.ts`.

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

Import `GroupUser`, `buildAdmin`, `buildGuestUser`, and `GroupMembership` as needed in that file.

- [ ] **Step 2: Run them and watch them fail**

```bash
yarn test server/models/UserMembership.test.ts server/models/GroupMembership.test.ts
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

`ValidationError` is already imported in this file, and `BeforeCreate` needs adding to the `sequelize-typescript` import list.

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

    const guestCount = await GroupUser.count({
      include: [
        {
          model: User,
          as: "user",
          required: true,
          where: { role: UserRole.Guest },
        },
      ],
      where: { groupId: model.groupId },
      transaction: options.transaction,
    });

    if (guestCount > 0) {
      throw ValidationError("Guests cannot be granted manage permissions");
    }
  }
```

Add `BeforeCreate`, `SaveOptions`, `GroupUser`, `User`, `UserRole`, and `ValidationError` to that file's imports as needed. If `GroupUser` does not declare a `user` association, load the member ids instead:

```ts
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
```

- [ ] **Step 5: Run the tests**

```bash
yarn test server/models/UserMembership.test.ts server/models/GroupMembership.test.ts server/models/User.test.ts
```

Expected: PASS, including `User.test.ts`, which changes roles to and from `guest` and exercises membership cascades.

- [ ] **Step 6: Commit**

```bash
git add server/models/UserMembership.ts server/models/GroupMembership.ts server/models/UserMembership.test.ts server/models/GroupMembership.test.ts
git commit -m "feat: prevent guests from being granted manage permissions"
```

---

### Task 4: Stop `users.invite` from accepting the guest role

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
yarn test server/routes/api/users/users.test.ts -t "should reject the guest role"
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

Add `ValidationError` to the `@server/errors` import (currently only `DomainNotAllowedError` is imported).

- [ ] **Step 5: Run the tests**

```bash
yarn test server/routes/api/users/users.test.ts server/commands/userInviter.test.ts
```

Expected: PASS, including the existing invite tests that use `member`, `viewer`, and `admin`.

- [ ] **Step 6: Commit**

```bash
git add server/routes/api/users/schema.ts server/commands/userInviter.ts server/routes/api/users/users.test.ts
git commit -m "fix: refuse the guest role on users.invite instead of silently creating a member"
```

---

### Task 5: Guest invite email

**Files:**
- Create: `server/emails/templates/GuestInviteEmail.tsx`

- [ ] **Step 1: Create the template**

Model it on `server/emails/templates/InviteEmail.tsx`, which is the closest sibling:

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

  protected preview() {
    return this.t(
      "You have been given access to a shared {{ itemType }} in {{ appName }}.",
      {
        itemType: this.props.isCollection ? "collection" : "document",
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
${this.t("{{ actorName }} shared “{{ itemName }}” with you", { actorName, itemName })}

${this.t("You have been given access to this {{ itemType }} in the {{ teamName }} workspace.", { itemType: isCollection ? "collection" : "document", teamName })}

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
      <EmailTemplate previewText={this.preview()}>
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

If `EmailTemplate`, `Header`, `Body`, `Heading`, `Button`, `EmptySpace`, or `Footer` differ in name in `InviteEmail.tsx` at the time you implement this, follow `InviteEmail.tsx` exactly rather than this snippet — it is the canonical sibling.

- [ ] **Step 2: Verify it compiles**

```bash
yarn tsc
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/emails/templates/GuestInviteEmail.tsx
git commit -m "feat: add a guest invite email that names the shared item"
```

---

### Task 6: The `guestInviter` command

**Files:**
- Create: `server/commands/guestInviter.ts`
- Test: `server/commands/guestInviter.test.ts`

- [ ] **Step 1: Write the failing tests**

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
          permission: CollectionPermission.Comment,
        },
      })
    );

    expect(user.email).toEqual("outsider@example.com");
    expect(user.role).toEqual(UserRole.Guest);
    expect(membership.collectionId).toEqual(collection.id);
    expect(membership.permission).toEqual(CollectionPermission.Comment);
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
          permission: CollectionPermission.Comment,
        },
      })
    );

    expect(membership.documentId).toEqual(document.id);
    expect(membership.collectionId).toBeNull();
  });
});
```

Check the exact signature of `withAPIContext` in `server/test/support.ts` before writing these; if it takes the user as the first argument and a callback as the second, the calls above are correct. Adapt the calls, not the assertions, if the signature differs.

- [ ] **Step 2: Run the tests and watch them fail**

```bash
yarn test server/commands/guestInviter.test.ts
```

Expected: FAIL with a module-not-found error for `./guestInviter`.

- [ ] **Step 3: Write the command**

Create `server/commands/guestInviter.ts`:

```ts
import { CollectionPermission, UserRole } from "@shared/types";
import GuestInviteEmail from "@server/emails/templates/GuestInviteEmail";
import { ValidationError } from "@server/errors";
import { Collection, Document, User, UserMembership } from "@server/models";
import { UserFlag } from "@server/models/User";
import type { APIContext } from "@server/types";
import { authorize } from "@server/policies";

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
 * a staff member who is shared a item receives only the membership.
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
    itemName: (collection ?? document)!.name,
    isCollection: !!collection,
    token: target.getInviteToken(),
  }).schedule();

  return { user: target, membership };
}
```

Notes for the implementer:

- `Collection.findByPk(id, { userId })` and `Document.findByPk(id, { userId })` are used this way across the test suite and preload memberships for the policy checks.
- `User.createWithCtx` and `UserMembership.createWithCtx` exist on the models' base class. Do not pass an event `name` to the membership call: `UserMembership` already publishes `documents.add_user` / `collections.add_user` events from its own `@AfterCreate` hook.
- `actor.team` is populated on the authenticated user in real requests; in tests `withAPIContext` sets it. If it is missing, load the team explicitly with `Team.findByPk(actor.teamId, { rejectOnEmpty: true, transaction })` and use that.
- The domain allowlist is deliberately not consulted here. Do not copy that block from `userInviter`.

- [ ] **Step 4: Run the tests**

```bash
yarn test server/commands/guestInviter.test.ts
```

Expected: PASS on all eight cases.

- [ ] **Step 5: Commit**

```bash
git add server/commands/guestInviter.ts server/commands/guestInviter.test.ts
git commit -m "feat: invite outside collaborators to a single collection or document"
```

---

### Task 7: The `users.inviteGuest` route

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
        permission: "comment",
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.user.role).toEqual(UserRole.Guest);
    expect(body.data.membership.collectionId).toEqual(collection.id);
    expect(body.data.membership.permission).toEqual("comment");
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

  it("should not allow a guest to invite anyone", async () => {
    const team = await buildTeam();
    const guest = await buildGuestUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      createdById: guest.id,
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

- [ ] **Step 2: Run the tests and watch them fail**

```bash
yarn test server/routes/api/users/users.test.ts -t "#users.inviteGuest"
```

Expected: FAIL — the route does not exist, so the authenticated cases return 404.

- [ ] **Step 3: Add the request schema**

In `server/routes/api/users/schema.ts`:

```ts
export const UsersInviteGuestSchema = z.object({
  body: z.object({
    email: z.email().transform((email) => email.toLowerCase()),
    name: z.string().optional(),
    collectionId: z.uuid().optional(),
    documentId: z.uuid().optional(),
    permission: z.enum([CollectionPermission.Read, CollectionPermission.Comment, CollectionPermission.ReadWrite]),
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

Add the imports: `guestInviter` from `@server/commands/guestInviter`, and `presentMembership` from `@server/presenters`.

- [ ] **Step 5: Register the audit event**

Add `"users.invite_guest"` to the `users` event name union in `server/types.ts`, mirroring the `users.invite` member that already exists:

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

The event itself is produced by the third argument to `User.createWithCtx` in `guestInviter`, which is `{ name: "invite_guest" }`; the model base class fills `data` from the changeset, exactly as `userInviter` does with `{ name: "invite" }`. No extra event is needed for the membership, because `UserMembership`'s own `@AfterCreate` hook publishes `documents.add_user` / `collections.add_user`.

If `yarn tsc` objects to the declared `data` shape because the changeset carries more fields than `email` and `name`, widen that member's `data` to `Record<string, unknown>` rather than casting at the call site, and note the reason in the commit message.

Add `"users.invite_guest"` to the `AUDIT_EVENTS` list in `shared/utils/EventHelper.ts`, next to `"users.invite"`.

Add `case "users.invite_guest":` to the `users.*` group in the switch in `plugins/webhooks/server/tasks/DeliverWebhookTask.ts`, next to `case "users.invite":`. That switch has an `assertUnreachable` default, so `yarn tsc` will fail until this is done, which is the intended guard.

- [ ] **Step 6: Run the tests**

```bash
yarn tsc
yarn test server/routes/api/users/users.test.ts
```

Expected: `yarn tsc` passes and all tests pass, including the six new ones.

- [ ] **Step 7: Commit**

```bash
git add server/routes/api/users/schema.ts server/routes/api/users/users.ts server/routes/api/users/users.test.ts shared/utils/EventHelper.ts server/types.ts plugins/webhooks/server/tasks/DeliverWebhookTask.ts
git commit -m "feat: add users.inviteGuest for sharing items with outside collaborators"
```

---

### Task 8: One shared list of access levels

**Files:**
- Create: `app/utils/permissionOptions.ts`
- Modify: `app/components/InputSelectPermission.tsx`, `app/components/Sharing/Collection/AccessControlList.tsx`, `app/components/Sharing/Collection/SharePopover.tsx`, `app/components/Sharing/Document/AccessControlList.tsx`, `app/components/Sharing/Document/SharePopover.tsx`, `app/components/Sharing/Document/DocumentMemberList.tsx`, `app/components/Sharing/Document/DocumentMemberListItem.tsx`

- [ ] **Step 1: Create the shared options helper**

Create `app/utils/permissionOptions.ts`:

```ts
import type { TFunction } from "i18next";
import { CollectionPermission } from "@shared/types";
import type { Permission } from "~/types";

type OptionsArgs = {
  /** Include the manage level. Guests may never hold it, so it is hidden when a guest is being invited. */
  includeManage?: boolean;
  /** Append a divider and a remove option. */
  includeRemove?: boolean;
  /** Label for the remove option; defaults to "Remove". */
  removeLabel?: string;
};

/**
 * Builds the access level options shown wherever a collection or document
 * permission is chosen, so every picker offers the same four levels.
 *
 * @param t The translation function.
 * @param args.includeManage Whether to include the manage level, defaults to true.
 * @param args.includeRemove Whether to include the remove option, defaults to false.
 * @param args.removeLabel The label for the remove option, defaults to "Remove".
 * @returns The permission options.
 */
export function permissionOptions(
  t: TFunction,
  {
    includeManage = true,
    includeRemove = false,
    removeLabel,
  }: OptionsArgs = {}
): Permission[] {
  const options: Permission[] = [
    {
      label: t("View only"),
      value: CollectionPermission.Read,
    },
    {
      label: t("Can comment"),
      value: CollectionPermission.Comment,
    },
    {
      label: t("Can edit"),
      value: CollectionPermission.ReadWrite,
    },
  ];

  if (includeManage) {
    options.push({
      label: t("Manage"),
      value: CollectionPermission.Admin,
    });
  }

  if (includeRemove) {
    options.push({
      divider: true,
      label: removeLabel ?? t("Remove"),
      value: EmptySelectValue,
    });
  }

  return options;
}
```

Import `EmptySelectValue` from `~/types` rather than inventing a string.

- [ ] **Step 2: Replace the duplicated lists**

`app/components/InputSelectPermission.tsx` uses `InputSelect` directly with `Option[]` rather than `Permission[]`, so it maps the shared list:

```tsx
    const options = React.useMemo<Option[]>(
      () =>
        permissionOptions(t, {
          includeRemove: true,
          removeLabel: t("No access"),
        }).reduce<Option[]>((acc, permission) => {
          if (permission.divider) {
            acc.push({ type: "separator" });
          }
          acc.push({ ...permission, type: "item" });
          return acc;
        }, []),
      [t]
    );
```

That mirrors the mapping already present in `InputMemberPermissionSelect.tsx`.

Then replace the inline option arrays with `permissionOptions(t, ...)` in the remaining components:

- both `SharePopover.tsx` files — `permissionOptions(t, { includeManage: !hasGuestPending })` (`hasGuestPending` arrives in Task 9; until then use `permissionOptions(t)`)
- both `AccessControlList.tsx` files — `permissionOptions(t, { includeRemove: true })`
- `DocumentMemberList.tsx` and `DocumentMemberListItem.tsx` — `permissionOptions(t, { includeRemove: true })`, or the subset each already used

- [ ] **Step 3: Check the app compiles and passes its own suite**

```bash
yarn tsc
yarn test:app
```

Expected: PASS. Every picker now offers View only / Can comment / Can edit / Manage.

- [ ] **Step 4: Commit**

```bash
git add app/utils/permissionOptions.ts app/components
git commit -m "refactor: share one permission option list and add the comment level to every picker"
```

---

### Task 9: Share dialogs invite outside emails as guests

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

Import `CollectionPermission` and `DocumentPermission` from `@shared/types`.

- [ ] **Step 2: Fix the suggestion label**

In `app/components/Sharing/components/Suggestions.tsx`, `getSuggestionForEmail` currently labels the row `email: t("Invite to workspace")`, which is now wrong for the share dialog: an email typed there becomes a guest, not a workspace member.

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

- [ ] **Step 3: Route emails through the guest invite**

In `app/components/Sharing/Collection/SharePopover.tsx`, replace the `inviteAction.perform` body so that emails call `users.inviteGuest` and everything else keeps its current path:

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

Add, above `permissions`:

```tsx
  const hasGuestPending = React.useMemo(
    () => pendingIds.some((id) => isEmail(id)),
    [pendingIds]
  );
```

and change the permission list to:

```tsx
  const permissions = React.useMemo(
    () => permissionOptions(t, { includeManage: !hasGuestPending }),
    [t, hasGuestPending]
  );
```

- [ ] **Step 4: Repeat for documents**

In `app/components/Sharing/Document/SharePopover.tsx`, make the same change, passing `documentId: document.id` to `users.inviteGuest` and using `userMemberships.create` for the non-email branch, which is what that file already calls.

- [ ] **Step 5: Verify by hand**

Start the app (`yarn dev`), open a collection, and:

- type an outside email, confirm the suggestion reads "Invite as guest"
- confirm the permission picker shows View only / Can comment / Can edit, and no Manage
- add the email, and confirm the row appears in the access list with the chosen level
- add an existing staff member in the same session and confirm Manage comes back and that person is added as before

- [ ] **Step 6: Type-check and lint**

```bash
yarn tsc && yarn lint && yarn format:check
```

Expected: PASS. Then run `yarn format` and re-check if it disagrees.

- [ ] **Step 7: Commit**

```bash
git add app/stores/UsersStore.ts app/components/Sharing
git commit -m "feat: invite outside emails as guests from the share dialog"
```

---

### Task 10: End-to-end verification of phase 1

**Files:** none created; this task is evidence gathering.

- [ ] **Step 1: Full type, lint, and format check**

```bash
yarn tsc && yarn lint && yarn format:check
```

- [ ] **Step 2: Targeted server suites**

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" NODE_ENV=test TZ=UTC
yarn test server/commands/guestInviter.test.ts server/commands/userInviter.test.ts server/models/UserMembership.test.ts server/models/GroupMembership.test.ts server/policies/collection.test.ts server/policies/document.test.ts server/routes/api/users/users.test.ts server/routes/api/documents/documents.test.ts server/routes/api/collections/collections.test.ts
```

- [ ] **Step 3: Build**

```bash
yarn build
git diff --stat shared/i18n/locales/en_US/translation.json
```

Expected: the build succeeds and the extracted strings include the new labels ("Can comment", "Invite as guest", and the guest email copy).

- [ ] **Step 4: Manual guest session — the highest-risk verification**

1. As an admin, share a private collection with an outside address at Can comment.
2. Open the invite email's link in a private browser window and sign in as the guest.
3. Confirm the sidebar shows only that collection and its pages, and that search returns nothing else.
4. Open a page and confirm the comment box is present, post a comment, and confirm it renders with the guest's name and initial.
5. Set the workspace commenting setting to "Members only" and reload: the comment box should disappear and posting should be refused.
6. Open a page the guest was not shared, directly by URL: expect a 404, not the content.
7. Confirm the guest cannot reach Settings, cannot invite, and cannot see the member list.
8. Open a page in the shared collection in two browser sessions (guest and admin) and type simultaneously to confirm realtime editing works for the guest. Guest access to document-level websocket rooms is the most likely failure point; if realtime is broken for guests, stop and report it rather than working around it.
9. Sign the guest out, then sign in again through the workspace SSO provider rather than the emailed link. The invited email is an outside domain, so this is where the workspace domain rules could refuse a legitimate collaborator. If SSO refuses, record the exact error before changing anything.

- [ ] **Step 5: Record the evidence and commit any documentation needed**

Commit nothing unless a fix was required. Report the commands run and their outcomes.

---

## Phase 2: Review and lifecycle polish

### Task 11: Guests in the members list

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
yarn tsc && yarn lint
git add app/scenes/Settings
git commit -m "feat: show guests in the workspace member filters"
```

---

### Task 12: Offer to remove a guest when their last grant is dropped

**Files:**
- Modify: `app/components/Sharing/Collection/AccessControlList.tsx`, `app/components/Sharing/Document/AccessControlList.tsx`
- Create: `app/scenes/Settings/components/RemoveGuestDialog.tsx`

- [ ] **Step 1: Create the dialog**

Create `app/scenes/Settings/components/RemoveGuestDialog.tsx`, modelled on the existing revoke dialog at `app/scenes/Settings/components/ApiKeyRevokeDialog.tsx`:

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

In `app/components/Sharing/Document/AccessControlList.tsx`, add the same callback but call it after `userMemberships.delete({ documentId, userId })`, and exclude the document being removed from the check:

```tsx
        const stillHasAccess =
          memberships.all.some((m) => m.userId === guest.id) ||
          userMemberships.all.some(
            (m) => m.userId === guest.id && m.documentId !== document.id
          );
```

- [ ] **Step 4: Verify by hand**

Remove a guest's only grant, confirm the prompt appears, cancel it once (the membership removal should still have happened or not happened, consistently), then confirm and check Settings → Members no longer lists the guest.

- [ ] **Step 5: Type-check and commit**

```bash
yarn tsc && yarn lint && yarn format:check
git add app/components/Sharing app/scenes/Settings/components/RemoveGuestDialog.tsx
git commit -m "feat: offer to remove a guest when their last grant is removed"
```

---

## Known follow-ups, deliberately out of this plan

- **Public link expiry** (own spec): per-link choice of 1 / 7 / 30 / 90 days or Never, defaulting to 30.
- **Visitor analytics** (own spec): sessions, minutes on page, and navigation path, with guest traffic distinguishable from member traffic.
