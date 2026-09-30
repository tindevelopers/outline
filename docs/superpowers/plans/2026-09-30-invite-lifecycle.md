# Invite Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every invitation a bounded life: remind the invitee while it is live, stop the link when it ends, tell whoever can act, and make resending one click.

**Architecture:** One nullable timestamp on `users`, `inviteLastSentAt`, is the single source of truth for an invite's clock. The window length and reminder offsets are pure functions of the invitee's role, read from one shared constant. The existing daily `InviteReminderTask` grows into the cadence engine rather than gaining a sibling, and a new `inviteResender` command owns the resend rules so the route stays thin and the logic is testable without HTTP. The expiry notice reuses the existing `Notification` to `EmailsProcessor` pipeline, which yields the in-app notification and the email from one event.

**Tech Stack:** TypeScript, Koa, Sequelize (PostgreSQL), Zod, Vitest, MobX, React, styled-components.

**Spec:** `docs/superpowers/specs/2026-09-30-guest-invite-lifecycle-design.md`

## Environment

The `yarn` on this machine is v1, but the repo expects v4, so any script that shells out to `yarn <bin>` fails. Invoke binaries from `./node_modules/.bin/` directly. The development database is not configured; only the test database is.

```bash
# tests
NODE_ENV=test TZ=UTC ./node_modules/.bin/vitest run <path>

# migrations (test database)
NODE_ENV=test ./node_modules/.bin/sequelize db:migrate
NODE_ENV=test ./node_modules/.bin/sequelize db:migrate:undo

# psql
u="$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)"; psql "$u" -c '<sql>'

# static checks
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/oxfmt <paths>
./node_modules/.bin/oxlint --type-aware app server shared plugins
```

Every commit message ends with:

```
Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>
```

### The test database is never reset

Nothing truncates between runs, and `globalTeardown.ts` only closes the connection. The database therefore accumulates rows from every previous run. This matters for `InviteReminderTask`, whose `perform()` scans **every** invited user in the database while its tests assert on global `Email.prototype.schedule` call counts. On a long-lived database, foreign invites are counted as sends and the per-row transactions can exceed the per-test timeout.

When a reminder test fails with unexpected call counts or a timeout, verify against a clean database before assuming the code is wrong:

```bash
createdb -h 127.0.0.1 -U user outline-test-fresh
NODE_ENV=test DATABASE_URL=postgres://user:pass@127.0.0.1:5432/outline-test-fresh ./node_modules/.bin/sequelize db:migrate
NODE_ENV=test TZ=UTC DATABASE_URL=postgres://user:pass@127.0.0.1:5432/outline-test-fresh ./node_modules/.bin/vitest run <paths>
dropdb -h 127.0.0.1 -U user outline-test-fresh
```

The password comes from `.env.test`. Drop the scratch database when finished; never drop or truncate the shared `outline-test`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `server/migrations/20260930120000-add-invite-last-sent-at.js` | Add and index the column, backfill, suppress notices for pre-existing invites. |
| `shared/constants.ts` | `InviteLifecycle`, `InviteMaxSends`, `InviteResendCooldownMs`. The only place the numbers live. |
| `server/models/User.ts` | `inviteLastSentAt`, the derived window helpers, and a token TTL that matches the window. |
| `server/models/helpers/InviteHelper.ts` | Resolve the item a guest was invited to, and whether an actor manages one of them. Shared by the task, the resender, and the expiry notice. |
| `server/commands/userInviter.ts`, `server/commands/guestInviter.ts` | Start the clock when an invite is sent. |
| `server/commands/inviteResender.ts` | Cooldown, ceiling, authority, role-aware email, re-anchor. |
| `server/queues/tasks/InviteReminderTask.ts` | The cadence engine: reminders while live, the expiry notice once. |
| `server/emails/templates/GuestInviteReminderEmail.tsx` | Reminder that names the shared item. |
| `server/emails/templates/InviteExpiredEmail.tsx` | Tells whoever can act, with a resend call to action. |
| `shared/types.ts` | `NotificationEventType.InviteExpired` and its default. |
| `server/queues/processors/EmailsProcessor.ts` | One case dispatching the expiry email. |
| `server/presenters/user.ts` | Present the derived expiry so the client need not know the window rule. |
| `app/models/User.ts` | Client-side pending and expired getters. |
| `app/components/Sharing/**` | Pending and expired status plus the resend action in both share dialogs. |

---

## Task 1: Add the invite clock column

**Files:**
- Create: `server/migrations/20260930120000-add-invite-last-sent-at.js`
- Modify: `server/models/User.ts:171` (near `lastActiveAt`)

- [ ] **Step 1: Write the migration**

```js
"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Schema changes commit first so the ACCESS EXCLUSIVE lock taken by
    // ADD COLUMN is released before the backfill touches every row.
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        "users",
        "inviteLastSentAt",
        {
          type: Sequelize.DATE,
          allowNull: true,
        },
        { transaction }
      );

      await queryInterface.addIndex("users", ["inviteLastSentAt"], {
        transaction,
      });
    });

    // Existing invites start their clock at creation, and are marked as
    // already notified. Without the flag, every invite that expired before
    // this shipped would mail a notice to a real person on the first run.
    // A failure here is safe: a null clock means no reminders and no expiry
    // notice, and getInviteToken falls back to its thirty day lifetime.
    await queryInterface.sequelize.query(
      `UPDATE users
          SET "inviteLastSentAt" = "createdAt",
              flags = jsonb_set(
                COALESCE(flags, '{}'::jsonb),
                '{inviteExpiryNotified}',
                '1'::jsonb,
                true
              )
        WHERE "lastActiveAt" IS NULL
          AND "deletedAt" IS NULL`
    );
  },

  async down(queryInterface, Sequelize) {
    // The inviteExpiryNotified flag is intentionally left behind: removing a
    // single key from a shared JSONB blob risks clobbering a value the
    // running application has set, and re-running up re-suppresses notices,
    // which is the safe direction.
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeIndex("users", ["inviteLastSentAt"], {
        transaction,
      });
      await queryInterface.removeColumn("users", "inviteLastSentAt", {
        transaction,
      });
    });
  },
};
```

The backfill is deliberately outside the schema transaction. Holding an `ACCESS EXCLUSIVE` lock across a bulk update of every invited row would block all reads and writes to `users` for the duration.

- [ ] **Step 2: Add the model attribute**

In `server/models/User.ts`, immediately after the `lastActiveAt` column declaration. Match the neighbouring date columns, which all carry both decorators; `lastSigninEmailSentAt` is the closest analogue. Without `@SkipChangeset` every later save that sets this field would add an audit event.

```ts
  /** When the outstanding invitation was last emailed, or null. */
  @IsDate
  @Column(DataType.DATE)
  @SkipChangeset
  inviteLastSentAt: Date | null;
```

- [ ] **Step 3: Run the migration and confirm the column**

Migrations target the test database, which is the only one configured here:

```bash
NODE_ENV=test ./node_modules/.bin/sequelize db:migrate
u="$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)"
psql "$u" -c '\d users' | grep inviteLastSentAt
```

Expected: the column is listed as `timestamp with time zone`.

Note the two-step variable assignment. `DATABASE_URL="$(...)" psql "$DATABASE_URL"` does not work: the shell expands the argument before the prefix assignment takes effect, so `psql` receives an empty URL.

- [ ] **Step 4: Commit**

```bash
git add server/migrations/20260930120000-add-invite-last-sent-at.js server/models/User.ts
git commit -m "feat: add an invite clock column to users"
```

---

## Task 2: Window constants and derived expiry

**Files:**
- Modify: `shared/constants.ts`
- Modify: `server/models/User.ts:709-718` (`getInviteToken`)
- Test: `server/models/User.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/models/User.test.ts` inside the existing top-level `describe`:

```ts
  describe("invite lifecycle", () => {
    it("expires a guest invite after seven days", async () => {
      const user = await buildInvite({
        role: UserRole.Guest,
        inviteLastSentAt: new Date("2018-01-01T00:00:00.000Z"),
      });

      // The suite pins the clock to 2018-01-02, so this is one day old.
      expect(user.isInviteExpired()).toBe(false);

      vi.setSystemTime(new Date("2018-01-09T00:00:00.000Z"));
      expect(user.isInviteExpired()).toBe(true);
      vi.setSystemTime(new Date("2018-01-02T00:00:00.000Z"));
    });

    it("keeps a member invite live for thirty days", async () => {
      const user = await buildInvite({
        role: UserRole.Member,
        inviteLastSentAt: new Date("2018-01-01T00:00:00.000Z"),
      });

      vi.setSystemTime(new Date("2018-01-20T00:00:00.000Z"));
      expect(user.isInviteExpired()).toBe(false);
      vi.setSystemTime(new Date("2018-02-05T00:00:00.000Z"));
      expect(user.isInviteExpired()).toBe(true);
      vi.setSystemTime(new Date("2018-01-02T00:00:00.000Z"));
    });

    it("never expires an invite once it has been accepted", async () => {
      const user = await buildInvite({
        role: UserRole.Guest,
        inviteLastSentAt: new Date("2018-01-01T00:00:00.000Z"),
      });
      user.lastActiveAt = new Date("2018-01-03T00:00:00.000Z");

      vi.setSystemTime(new Date("2018-03-01T00:00:00.000Z"));
      expect(user.isInviteExpired()).toBe(false);
      vi.setSystemTime(new Date("2018-01-02T00:00:00.000Z"));
    });

    it("signs a guest token that dies with the window, not at thirty days", async () => {
      const user = await buildInvite({
        role: UserRole.Guest,
        inviteLastSentAt: new Date("2018-01-02T00:00:00.000Z"),
      });

      const payload = getJWTPayload(user.getInviteToken());
      const expiresAt = new Date((payload.exp as number) * 1000);

      expect(expiresAt.toISOString()).toBe("2018-01-09T00:00:00.000Z");
    });

    it("keeps the thirty day token for a user with no clock", async () => {
      const user = await buildInvite({
        role: UserRole.Member,
        inviteLastSentAt: null,
      });

      const payload = getJWTPayload(user.getInviteToken());
      const expiresAt = new Date((payload.exp as number) * 1000);

      expect(expiresAt.toISOString()).toBe("2018-02-01T00:00:00.000Z");
    });
  });
```

Add these imports to the top of the file:

```ts
import { getJWTPayload } from "@server/utils/jwt";
```

and add `buildInvite` to the existing `@server/test/factories` import list.

`buildInvite` is the right fixture here rather than `buildGuestUser`: it always sets `lastActiveAt: null`, so the user counts as invited, and it sets `invitedById`, which the expiry notice needs. `buildGuestUser` does neither.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
NODE_ENV=test TZ=UTC ./node_modules/.bin/vitest run server/models/User.test.ts -t "invite lifecycle"
```

Expected: FAIL. `user.isInviteExpired is not a function`.

- [ ] **Step 3: Add the constants**

In `shared/constants.ts`, add the import at the top:

```ts
import { Hour } from "./utils/time";
```

and add `UserRole` to the existing value import from `./types`:

```ts
import {
  TOCPosition,
  DocumentPreference,
  HeadingPrefixStyle,
  TeamPreference,
  UserPreference,
  EmailDisplay,
  CommentingAccess,
  NotificationBadgeType,
  UserRole,
} from "./types";
```

Then append:

```ts
/**
 * How long an invitation stays live, and the day offsets on which to remind.
 * Guests get a short window because the ask is a single page; members get
 * Slack's documented thirty days.
 */
export const InviteLifecycle: Record<
  UserRole,
  { windowDays: number; reminderDays: number[] }
> = {
  [UserRole.Admin]: { windowDays: 30, reminderDays: [3, 10, 20] },
  [UserRole.Member]: { windowDays: 30, reminderDays: [3, 10, 20] },
  [UserRole.Viewer]: { windowDays: 30, reminderDays: [3, 10, 20] },
  [UserRole.Guest]: { windowDays: 7, reminderDays: [2, 4, 6] },
};

/** Total manual sends allowed per invite. An abuse backstop, not a policy. */
export const InviteMaxSends = 10;

/** Minimum time between manual resends of the same invite. */
export const InviteResendCooldownMs = Hour.ms;
```

- [ ] **Step 4: Add the derived helpers and fix the token**

In `server/models/User.ts`, add to the imports:

```ts
import { InviteLifecycle } from "@shared/constants";
import { Day } from "@shared/utils/time";
```

Replace the existing `getInviteToken` with:

```ts
  /**
   * Days an invitation stays live for this user's role.
   *
   * @returns the window length in days.
   */
  getInviteWindowDays = (): number =>
    // InviteLifecycle covers every role, so this only guards a row whose role
    // predates the enum.
    InviteLifecycle[this.role]?.windowDays ?? 30;

  /**
   * The moment this user's invitation link stops working.
   *
   * @returns the expiry, or null when no invite has been sent.
   */
  getInviteExpiresAt = (): Date | null =>
    this.inviteLastSentAt
      ? new Date(
          this.inviteLastSentAt.getTime() + this.getInviteWindowDays() * Day.ms
        )
      : null;

  /**
   * Whether the invitation has outlived its window without being accepted.
   *
   * @returns true when the invite is expired.
   */
  isInviteExpired = (): boolean => {
    const expiresAt = this.getInviteExpiresAt();
    return !!expiresAt && this.isInvited && expiresAt.getTime() < Date.now();
  };

  /**
   * Returns a token that accepts an email invitation with a single click.
   * Unlike the email signin token it is not IP-bound, and it is only honored
   * while the invite has not yet been accepted. Its lifetime matches the
   * invite window, so a reminder can never outlive the invite it belongs to.
   *
   * @returns The invite acceptance token
   */
  getInviteToken = () => {
    const expiresAt = this.getInviteExpiresAt();
    const expiresIn = expiresAt
      ? Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
      : Day.seconds * this.getInviteWindowDays();

    return JWT.sign(
      {
        id: this.id,
        createdAt: new Date().toISOString(),
        type: "invite-accept",
      },
      this.jwtSecret,
      { expiresIn }
    );
  };
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
NODE_ENV=test TZ=UTC ./node_modules/.bin/vitest run server/models/User.test.ts
```

Expected: PASS, including the pre-existing cases in the file.

- [ ] **Step 6: Commit**

```bash
git add shared/constants.ts server/models/User.ts server/models/User.test.ts
git commit -m "feat: derive invite expiry from the role and match the token to it"
```

---

## Task 3: Start the clock when an invite is sent

**Files:**
- Modify: `server/commands/userInviter.ts:92-105`
- Modify: `server/commands/guestInviter.ts:88-104`
- Modify: `server/test/factories.ts:249-266`
- Test: `server/commands/userInviter.test.ts`, `server/commands/guestInviter.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/commands/guestInviter.test.ts`:

```ts
  it("starts the invite clock", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const collection = await buildCollection({ teamId: team.id });

    const { user } = await guestInviter(createContext({ user: admin }), {
      invite: {
        email: "clock@example.com",
        collectionId: collection.id,
        permission: CollectionPermission.Read,
      },
    });

    expect(user.inviteLastSentAt).toBeInstanceOf(Date);
    expect(user.getInviteExpiresAt()?.getTime()).toBeGreaterThan(Date.now());
  });
```

Append to `server/commands/userInviter.test.ts`:

```ts
  it("starts the invite clock", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });

    const { users } = await userInviter(createContext({ user: admin }), {
      invites: [
        { email: "clock@example.com", name: "Clock", role: UserRole.Member },
      ],
    });

    expect(users[0].inviteLastSentAt).toBeInstanceOf(Date);
  });

  it("leaves the clock unset when the email is suppressed", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });

    const { users } = await userInviter(createContext({ user: admin }), {
      invites: [
        { email: "silent@example.com", name: "Silent", role: UserRole.Member },
      ],
      suppressEmail: true,
    });

    expect(users[0].inviteLastSentAt).toBeNull();
  });
```

Match the imports already present in those files (`createContext`, `buildTeam`, `buildAdmin`, `buildCollection`, `CollectionPermission`, `UserRole`).

- [ ] **Step 2: Run the tests to verify they fail**

```bash
NODE_ENV=test TZ=UTC ./node_modules/.bin/vitest run server/commands/guestInviter.test.ts server/commands/userInviter.test.ts
```

Expected: FAIL, `expected null to be an instance of Date`.

- [ ] **Step 3: Set the clock in both inviters**

In `server/commands/guestInviter.ts`, inside `User.createWithCtx`, add to the data object:

```ts
        invitedById: actor.id,
        inviteLastSentAt: new Date(),
        flags: {
          [UserFlag.InviteSent]: 1,
        },
```

In `server/commands/userInviter.ts`, inside `User.createWithCtx`, add to the data object:

```ts
        invitedById: user.id,
        // A suppressed invite sends no email, so it has no lifecycle.
        inviteLastSentAt: suppressEmail ? null : new Date(),
        flags: suppressEmail
          ? undefined
          : {
              [UserFlag.InviteSent]: 1,
            },
```

- [ ] **Step 4: Default the factory clock from `createdAt`**

In `server/test/factories.ts`, in `buildInvite`, add after the `createdAt` line so that overriding `createdAt` also ages the clock:

```ts
    createdAt: new Date("2018-01-01T00:00:00.000Z"),
    inviteLastSentAt: overrides.createdAt ?? new Date("2018-01-01T00:00:00.000Z"),
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
NODE_ENV=test TZ=UTC ./node_modules/.bin/vitest run server/commands/guestInviter.test.ts server/commands/userInviter.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/commands/userInviter.ts server/commands/guestInviter.ts server/test/factories.ts server/commands/userInviter.test.ts server/commands/guestInviter.test.ts
git commit -m "feat: start the invite clock when an invitation is sent"
```

---

## Task 4: The cadence engine

**Files:**
- Create: `server/models/helpers/InviteHelper.ts`
- Modify: `server/queues/tasks/InviteReminderTask.ts`
- Test: `server/models/helpers/InviteHelper.test.ts`, `server/queues/tasks/InviteReminderTask.test.ts`

- [ ] **Step 1: Write the failing test for the item lookup**

Create `server/models/helpers/InviteHelper.test.ts`:

```ts
import { CollectionPermission, DocumentPermission, UserRole } from "@shared/types";
import {
  buildCollection,
  buildDocument,
  buildInvite,
} from "@server/test/factories";
import { getGuestInviteItem } from "./InviteHelper";
import UserMembership from "@server/models/UserMembership";

const buildGuest = () => buildInvite({ role: UserRole.Guest });

describe("getGuestInviteItem", () => {
  it("names the collection a guest was invited to", async () => {
    const guest = await buildGuest();
    const collection = await buildCollection({ teamId: guest.teamId });
    await UserMembership.create({
      userId: guest.id,
      collectionId: collection.id,
      permission: CollectionPermission.Read,
      createdById: guest.invitedById!,
    });

    const item = await getGuestInviteItem(guest.id);

    expect(item).toEqual({
      itemName: collection.name,
      isCollection: true,
      collectionId: collection.id,
    });
  });

  it("names the document a guest was invited to", async () => {
    const guest = await buildGuest();
    const document = await buildDocument({ teamId: guest.teamId });
    await UserMembership.create({
      userId: guest.id,
      documentId: document.id,
      permission: DocumentPermission.Read,
      createdById: guest.invitedById!,
    });

    const item = await getGuestInviteItem(guest.id);

    expect(item).toEqual({
      itemName: document.title,
      isCollection: false,
      documentId: document.id,
    });
  });

  it("returns null when the guest holds nothing", async () => {
    const guest = await buildGuest();

    expect(await getGuestInviteItem(guest.id)).toBeNull();
  });

  it("falls back past a membership whose item is gone", async () => {
    const guest = await buildGuest();
    const document = await buildDocument({ teamId: guest.teamId });
    await UserMembership.create({
      userId: guest.id,
      documentId: document.id,
      permission: DocumentPermission.Read,
      createdById: guest.invitedById!,
    });

    // A newer membership whose collection has been deleted. The foreign key is
    // ON DELETE SET NULL, so the row survives with a null collectionId.
    const stale = await UserMembership.create({
      userId: guest.id,
      collectionId: (await buildCollection({ teamId: guest.teamId })).id,
      permission: CollectionPermission.Read,
      createdById: guest.invitedById!,
    });
    await stale.update({ collectionId: null });

    const item = await getGuestInviteItem(guest.id);

    expect(item).toEqual({
      itemName: document.title,
      isCollection: false,
      documentId: document.id,
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
NODE_ENV=test TZ=UTC ./node_modules/.bin/vitest run server/models/helpers/InviteHelper.test.ts
```

Expected: FAIL, cannot resolve `./InviteHelper`.

- [ ] **Step 3: Write the helper**

Create `server/models/helpers/InviteHelper.ts`:

```ts
import { Op } from "sequelize";
import { CollectionPermission } from "@shared/types";
import { Collection, Document, UserMembership } from "@server/models";

export interface InviteItem {
  /** Display name of the shared collection or document. */
  itemName: string;
  /** Whether the shared item is a collection rather than a document. */
  isCollection: boolean;
  collectionId?: string;
  documentId?: string;
}

/**
 * Returns the collection or document a guest was most recently invited to,
 * skipping memberships whose item no longer exists. A deleted collection or
 * document leaves its membership row behind with a null foreign key, so
 * stopping at the newest row would lose the reminder even when the guest still
 * holds a live item.
 *
 * @param userId the guest's id.
 * @returns the item, or null when the guest holds no memberships or none of
 * them resolves to a live collection or document.
 */
export async function getGuestInviteItem(
  userId: string
): Promise<InviteItem | null> {
  const memberships = await UserMembership.findAll({
    where: { userId },
    order: [["createdAt", "DESC"]],
  });

  for (const membership of memberships) {
    if (membership.collectionId) {
      const collection = await Collection.findByPk(membership.collectionId);
      if (collection) {
        return {
          itemName: collection.name,
          isCollection: true,
          collectionId: collection.id,
        };
      }
    }

    if (membership.documentId) {
      const document = await Document.findByPk(membership.documentId);
      if (document) {
        return {
          itemName: document.title,
          isCollection: false,
          documentId: document.id,
        };
      }
    }
  }

  return null;
}

/**
 * Whether the actor holds manage permission on any collection or document the
 * given user has access to. Group-derived access is not considered.
 *
 * @param actorId the acting user's id.
 * @param userId the invited user's id.
 * @returns true when the actor manages at least one shared item.
 */
export async function actorManagesAnyItemOf(
  actorId: string,
  userId: string
): Promise<boolean> {
  const memberships = await UserMembership.findAll({ where: { userId } });
  const collectionIds = memberships
    .map((membership) => membership.collectionId)
    .filter((id): id is string => !!id);
  const documentIds = memberships
    .map((membership) => membership.documentId)
    .filter((id): id is string => !!id);

  if (!collectionIds.length && !documentIds.length) {
    return false;
  }

  const managed = await UserMembership.findOne({
    where: {
      userId: actorId,
      permission: CollectionPermission.Admin,
      [Op.or]: [
        ...(collectionIds.length
          ? [{ collectionId: { [Op.in]: collectionIds } }]
          : []),
        ...(documentIds.length ? [{ documentId: { [Op.in]: documentIds } }] : []),
      ],
    },
  });

  return !!managed;
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
NODE_ENV=test TZ=UTC ./node_modules/.bin/vitest run server/models/helpers/InviteHelper.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write the failing cadence tests**

Replace the contents of `server/queues/tasks/InviteReminderTask.test.ts` with:

```ts
import { subHours } from "date-fns";
import type { MockInstance } from "vitest";
import { CollectionPermission, UserRole } from "@shared/types";
import InviteReminderEmail from "@server/emails/templates/InviteReminderEmail";
import GuestInviteReminderEmail from "@server/emails/templates/GuestInviteReminderEmail";
import { UserFlag } from "@server/models/User";
import UserMembership from "@server/models/UserMembership";
import { buildCollection, buildInvite } from "@server/test/factories";
import InviteReminderTask from "./InviteReminderTask";

const hoursAgo = (hours: number) => subHours(new Date(), hours);

/**
 * How many emails this spy sent to a specific address. `perform` scans every
 * invited user in the database, so counting all calls would make these tests
 * fail against any database holding an unrelated pending invite.
 */
const sentTo = (spy: MockInstance, email: string | null) =>
  spy.mock.contexts.filter(
    (context: { props: { to?: string | null } }) => context.props.to === email
  ).length;

/**
 * A guest with an outstanding invite, holding one collection so the reminder
 * has an item to name. A guest with no memberships cannot be reminded, so the
 * fixture must create one.
 */
const buildPendingGuest = async (hours: number) => {
  const guest = await buildInvite({
    role: UserRole.Guest,
    inviteLastSentAt: hoursAgo(hours),
  });
  const collection = await buildCollection({ teamId: guest.teamId });
  await UserMembership.create({
    userId: guest.id,
    collectionId: collection.id,
    permission: CollectionPermission.Read,
    createdById: guest.invitedById!,
  });
  return guest;
};

describe("InviteReminderTask", () => {
  it("reminds a guest on day two, four and six, and then stops", async () => {
    const spy = vi.spyOn(GuestInviteReminderEmail.prototype, "schedule");
    const guest = await buildPendingGuest(50);

    await new InviteReminderTask().perform();
    expect(sentTo(spy, guest.email)).toBe(1);

    guest.inviteLastSentAt = hoursAgo(98);
    await guest.save();
    await new InviteReminderTask().perform();
    expect(sentTo(spy, guest.email)).toBe(2);

    guest.inviteLastSentAt = hoursAgo(146);
    await guest.save();
    await new InviteReminderTask().perform();
    expect(sentTo(spy, guest.email)).toBe(3);

    // Day seven: the window has closed, so no fourth reminder.
    guest.inviteLastSentAt = hoursAgo(170);
    await guest.save();
    await new InviteReminderTask().perform();
    expect(sentTo(spy, guest.email)).toBe(3);

    spy.mockRestore();
  });

  it("does not remind before the first offset", async () => {
    const spy = vi.spyOn(GuestInviteReminderEmail.prototype, "schedule");
    const guest = await buildPendingGuest(30);

    await new InviteReminderTask().perform();

    expect(sentTo(spy, guest.email)).toBe(0);
    spy.mockRestore();
  });

  it("sends a member reminder on day three", async () => {
    const spy = vi.spyOn(InviteReminderEmail.prototype, "schedule");
    const member = await buildInvite({
      role: UserRole.Member,
      inviteLastSentAt: hoursAgo(74),
    });

    await new InviteReminderTask().perform();

    expect(sentTo(spy, member.email)).toBe(1);
    spy.mockRestore();
  });

  it("never reminds an accepted user", async () => {
    const spy = vi.spyOn(GuestInviteReminderEmail.prototype, "schedule");
    const guest = await buildPendingGuest(50);
    guest.lastActiveAt = new Date();
    await guest.save();

    await new InviteReminderTask().perform();

    expect(sentTo(spy, guest.email)).toBe(0);
    spy.mockRestore();
  });

  it("does not send the same reminder twice on a repeated run", async () => {
    const spy = vi.spyOn(GuestInviteReminderEmail.prototype, "schedule");
    const guest = await buildPendingGuest(50);

    await new InviteReminderTask().perform();
    await new InviteReminderTask().perform();

    expect(sentTo(spy, guest.email)).toBe(1);
    spy.mockRestore();
  });

  it("does not burn a reminder slot when there is nothing to name", async () => {
    const spy = vi.spyOn(GuestInviteReminderEmail.prototype, "schedule");
    // A pending guest who holds no item at all.
    const guest = await buildInvite({
      role: UserRole.Guest,
      inviteLastSentAt: hoursAgo(50),
    });

    await new InviteReminderTask().perform();

    await guest.reload();
    expect(sentTo(spy, guest.email)).toBe(0);
    expect(guest.getFlag(UserFlag.InviteReminderSent)).toBe(0);
    spy.mockRestore();
  });
});
```

Two things carry the weight here. `sendReminder` must report whether it enqueued: without that guard, `perform` increments `InviteReminderSent` for a guest it never emailed, and after three such runs the guest receives no reminders at all. And every assertion must be scoped to the fixture's own address via `sentTo`, because `perform` scans the whole table.

Prove the scoping works before moving on. The shared `outline-test` database holds hundreds of eligible invited rows, so the unscoped form of these assertions fails there while passing on a clean database:

```bash
NODE_ENV=test TZ=UTC ./node_modules/.bin/vitest run server/queues/tasks/InviteReminderTask.test.ts
```

- [ ] **Step 6: Run them to verify they fail**

```bash
NODE_ENV=test TZ=UTC ./node_modules/.bin/vitest run server/queues/tasks/InviteReminderTask.test.ts
```

Expected: FAIL. The guest reminder template does not exist yet, and the task still uses the two-to-three-day query.

- [ ] **Step 7: Write the guest reminder email**

Create `server/emails/templates/GuestInviteReminderEmail.tsx`:

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
 * Reminder sent to an outside collaborator who has not yet accepted access to
 * a shared collection or document. It names the shared item, and never implies
 * access to the workspace as a whole.
 */
export default class GuestInviteReminderEmail extends BaseEmail<Props, void> {
  protected get category() {
    return EmailMessageCategory.Invitation;
  }

  protected subject({ actorName, itemName }: Props) {
    return this.t("Reminder: {{ actorName }} shared “{{ itemName }}” with you", {
      actorName,
      itemName,
    });
  }

  protected preview({ isCollection }: Props) {
    return this.t("The {{ itemType }} shared with you is still waiting.", {
      itemType: isCollection ? "collection" : "document",
    });
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
      : `${teamUrl}?ref=guest-invite-reminder-email`;

    return `
${this.t("Reminder: {{ actorName }} shared “{{ itemName }}” with you", {
  actorName,
  itemName,
})}

${this.t(
  "This {{ itemType }} in the {{ teamName }} workspace is still waiting for you.",
  { itemType: isCollection ? "collection" : "document", teamName }
)}

${this.t("Open now")}: ${link}
`;
  }

  protected render(props: Props) {
    const { teamName, actorName, teamUrl, itemName, isCollection, token } =
      props;

    const link = token
      ? `${teamUrl}/auth/email.callback?token=${token}`
      : `${teamUrl}?ref=guest-invite-reminder-email`;

    return (
      <EmailTemplate previewText={this.preview(props)}>
        <Header />

        <Body>
          <Heading>
            {this.t("Reminder: {{ actorName }} shared “{{ itemName }}” with you", {
              actorName,
              itemName,
            })}
          </Heading>
          <p>
            {this.t(
              "This {{ itemType }} in the {{ teamName }} workspace is still waiting for you.",
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

- [ ] **Step 8: Rewrite the task as the cadence engine**

Replace `server/queues/tasks/InviteReminderTask.ts` with:

```ts
import { subDays } from "date-fns";
import { Op } from "sequelize";
import { InviteLifecycle } from "@shared/constants";
import { UserRole } from "@shared/types";
import { Day } from "@shared/utils/time";
import GuestInviteReminderEmail from "@server/emails/templates/GuestInviteReminderEmail";
import InviteReminderEmail from "@server/emails/templates/InviteReminderEmail";
import { User } from "@server/models";
import { getGuestInviteItem } from "@server/models/helpers/InviteHelper";
import { UserFlag } from "@server/models/User";
import { sequelize } from "@server/storage/database";
import { TaskPriority } from "./base/BaseTask";
import { CronTask, TaskInterval } from "./base/CronTask";

export default class InviteReminderTask extends CronTask {
  public async perform() {
    // An invite younger than two days cannot be due a reminder, since two is
    // the earliest offset for any role. The 30 day bound matches the longest
    // window, so expired invites are not re-scanned forever.
    const users = await User.scope("invited").findAll({
      attributes: ["id"],
      where: {
        inviteLastSentAt: {
          [Op.lt]: subDays(new Date(), 2),
          [Op.gt]: subDays(new Date(), 30),
        },
      },
    });

    for (const { id } of users) {
      await sequelize.transaction(async (transaction) => {
        const user = await User.scope("withTeam").findByPk(id, {
          lock: { level: transaction.LOCK.UPDATE, of: User },
          transaction,
        });

        if (!user || !user.inviteLastSentAt || !user.isInvited) {
          return;
        }

        if (user.isInviteExpired()) {
          return;
        }

        const schedule = InviteLifecycle[user.role]?.reminderDays ?? [];
        const sent = user.getFlag(UserFlag.InviteReminderSent);
        const dueOnDay = schedule[sent];

        if (dueOnDay === undefined) {
          return;
        }

        const ageDays =
          (Date.now() - user.inviteLastSentAt.getTime()) / Day.ms;

        if (ageDays < dueOnDay) {
          return;
        }

        // At-least-once: the email is enqueued before the flag is saved, so a
        // failure between the two re-sends on the next run rather than losing
        // the reminder.
        const didSend = await this.sendReminder(user);
        if (!didSend) {
          return;
        }

        user.incrementFlag(UserFlag.InviteReminderSent);
        await user.save({ transaction });
      });
    }
  }

  /**
   * Enqueues the reminder for this user's role.
   *
   * @returns true when a reminder was enqueued, false when there is nothing to
   * send.
   */
  private async sendReminder(user: User): Promise<boolean> {
    const invitedBy = user.invitedById
      ? await User.findByPk(user.invitedById)
      : undefined;

    if (user.role === UserRole.Guest) {
      const item = await getGuestInviteItem(user.id);
      if (!item) {
        return false;
      }

      await new GuestInviteReminderEmail({
        to: user.email,
        language: user.language,
        name: user.name,
        actorName: invitedBy?.name ?? user.team.name,
        teamName: user.team.name,
        teamUrl: user.team.url,
        itemName: item.itemName,
        isCollection: item.isCollection,
        token: user.getInviteToken(),
      }).schedule();
      return true;
    }

    await new InviteReminderEmail({
      to: user.email,
      language: user.language,
      name: user.name,
      actorName: invitedBy?.name ?? user.team.name,
      actorEmail: invitedBy?.email ?? null,
      teamName: user.team.name,
      teamUrl: user.team.url,
    }).schedule();
    return true;
  }

  public get cron() {
    return {
      interval: TaskInterval.Day,
    };
  }

  public get options() {
    return {
      attempts: 1,
      priority: TaskPriority.Background,
    };
  }
}
```

The expiry branch is intentionally a bare `return` for now; Task 6 fills it in.

- [ ] **Step 9: Run the tests to verify they pass**

```bash
NODE_ENV=test TZ=UTC ./node_modules/.bin/vitest run server/queues/tasks/InviteReminderTask.test.ts server/models/helpers/InviteHelper.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add server/queues/tasks/InviteReminderTask.ts server/queues/tasks/InviteReminderTask.test.ts server/emails/templates/GuestInviteReminderEmail.tsx server/models/helpers/InviteHelper.ts server/models/helpers/InviteHelper.test.ts
git commit -m "feat: remind invitees on a per-role cadence"
```

---

## Task 5: Stop promising a single reminder

**Files:**
- Modify: `server/emails/templates/InviteReminderEmail.tsx:57,79`

- [ ] **Step 1: Remove the now-untrue copy**

In `server/emails/templates/InviteReminderEmail.tsx`, delete the line:

```ts
${this.t("We only send a reminder once.")}
```

The member schedule now sends three reminders, so this sentence is false. Change nothing else in the template.

- [ ] **Step 2: Verify nothing else claims a single reminder**

```bash
rg -n "only send a reminder" server shared app
```

Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add server/emails/templates/InviteReminderEmail.tsx
git commit -m "fix: drop the claim that only one reminder is sent"
```

---

## Task 6: Tell whoever can act when an invite expires

**Files:**
- Modify: `shared/types.ts:559-578` and `:598-617`
- Create: `server/emails/templates/InviteExpiredEmail.tsx`
- Modify: `server/queues/processors/EmailsProcessor.ts`
- Modify: `server/queues/tasks/InviteReminderTask.ts`
- Modify: `server/models/User.ts` (`UserFlag`)
- Test: `server/queues/tasks/InviteReminderTask.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/queues/tasks/InviteReminderTask.test.ts`. Scope every email assertion through the `sentTo` helper added in Task 4 rather than counting all `schedule` calls:

```ts
  it("notifies the inviter once when a guest invite expires", async () => {
    const guest = await buildInvite({
      role: UserRole.Guest,
      inviteLastSentAt: hoursAgo(200),
    });
    const inviter = (await User.findByPk(guest.invitedById!))!;
    const spy = vi.spyOn(Notification, "create");

    await new InviteReminderTask().perform();
    expect(notifiedFor(spy, guest.name)).toBe(1);
    expect(spy.mock.calls[0][0]).toMatchObject({
      event: NotificationEventType.InviteExpired,
      userId: inviter.id,
      data: { inviteeName: guest.name },
    });

    // A second run must not notify again.
    await new InviteReminderTask().perform();
    expect(notifiedFor(spy, guest.name)).toBe(1);

    spy.mockRestore();
  });

  it("does not notify for an invite that is still live", async () => {
    const guest = await buildPendingGuest(50);
    const spy = vi.spyOn(Notification, "create");

    await new InviteReminderTask().perform();

    expect(notifiedFor(spy, guest.name)).toBe(0);
    spy.mockRestore();
  });

  it("does not notify for an invite that was accepted", async () => {
    const guest = await buildInvite({
      role: UserRole.Guest,
      inviteLastSentAt: hoursAgo(200),
    });
    guest.lastActiveAt = new Date();
    await guest.save();
    const spy = vi.spyOn(Notification, "create");

    await new InviteReminderTask().perform();

    expect(notifiedFor(spy, guest.name)).toBe(0);
    spy.mockRestore();
  });
```

Add to that file's imports, merging into the existing `@shared/types` and `@server/models` statements rather than adding duplicates:

```ts
import { CollectionPermission, NotificationEventType, UserRole } from "@shared/types";
import { Notification, User } from "@server/models";
```

Add this helper beside `sentTo`, for the same reason: `perform` scans every invited user, so counting all notifications would break against any database holding an unrelated expired invite. Scoping on the invitee's name ties the assertion to this fixture rather than to a derived recipient list.

```ts
/** Notifications this spy created that name a specific invitee. */
const notifiedFor = (spy: MockInstance, inviteeName: string) =>
  spy.mock.calls.filter(([args]) => args.data?.inviteeName === inviteeName)
    .length;
```

`buildInvite` and the `buildPendingGuest` helper are already in the file from Task 4.

- [ ] **Step 2: Run them to verify they fail**

```bash
NODE_ENV=test TZ=UTC ./node_modules/.bin/vitest run server/queues/tasks/InviteReminderTask.test.ts
```

Expected: FAIL, `NotificationEventType.InviteExpired` is undefined.

- [ ] **Step 3: Add the event type**

In `shared/types.ts`, add to `NotificationEventType`. `RequestDocumentAccess` is already the last member today; insert `InviteExpired` after it and leave the existing member untouched:

```ts
  RequestDocumentAccess = "access_requests.create",
  InviteExpired = "emails.invite_expired",
```

and to `NotificationEventDefaults`, where `RequestDocumentAccess` is likewise already present:

```ts
    [NotificationEventType.RequestDocumentAccess]: true,
    [NotificationEventType.InviteExpired]: true,
```

Also widen `NotificationData` so the notice can carry the invitee's name:

```ts
export type NotificationData = {
  emoji?: string;
  /** Name of the person an invitation expired for. */
  inviteeName?: string;
};
```

- [ ] **Step 4: Add the flag**

In `server/models/User.ts`, add to `UserFlag`:

```ts
  InviteReminderSent = "inviteReminderSent",
  InviteExpiryNotified = "inviteExpiryNotified",
```

- [ ] **Step 5: Write the expiry email**

Create `server/emails/templates/InviteExpiredEmail.tsx`:

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
  /** Name of the person who never accepted. */
  inviteeName: string;
  teamName: string;
  teamUrl: string;
};

/**
 * Email sent to the person who sent an invitation once it has expired without
 * being accepted, so they know to resend it if they still want the person to
 * have access.
 */
export default class InviteExpiredEmail extends BaseEmail<Props, void> {
  protected get category() {
    return EmailMessageCategory.Notification;
  }

  protected subject({ inviteeName }: Props) {
    return this.t("{{ inviteeName }}’s invite expired", { inviteeName });
  }

  protected preview() {
    return this.t(
      "You can resend the invitation from the member list if they still need access."
    );
  }

  protected renderAsText({ inviteeName, teamName, teamUrl }: Props): string {
    const membersLink = `${teamUrl}/settings/members`;

    return `
${this.t("{{ inviteeName }}’s invite expired", { inviteeName })}

${this.t(
  "The invitation you sent to {{ inviteeName }} for the {{ teamName }} workspace was not accepted in time, so the link no longer works.",
  { inviteeName, teamName }
)}

${this.t("You can resend the invitation from the member list if they still need access")}: ${membersLink}
`;
  }

  protected render({ inviteeName, teamName, teamUrl }: Props) {
    const membersLink = `${teamUrl}/settings/members`;

    return (
      <EmailTemplate previewText={this.preview()}>
        <Header />

        <Body>
          <Heading>
            {this.t("{{ inviteeName }}’s invite expired", { inviteeName })}
          </Heading>
          <p>
            {this.t(
              "The invitation you sent to {{ inviteeName }} for the {{ teamName }} workspace was not accepted in time, so the link no longer works.",
              { inviteeName, teamName }
            )}
          </p>
          <p>
            {this.t(
              "You can resend the invitation from the member list if they still need access."
            )}
          </p>
          <EmptySpace height={10} />
          <p>
            <Button href={membersLink}>{this.t("Go to members")}</Button>
          </p>
        </Body>

        <Footer />
      </EmailTemplate>
    );
  }
}
```

- [ ] **Step 6: Dispatch it from the processor**

In `server/queues/processors/EmailsProcessor.ts`, add the import:

```ts
import InviteExpiredEmail from "@server/emails/templates/InviteExpiredEmail";
```

and add this case to the `switch`, before the closing brace:

```ts
      case NotificationEventType.InviteExpired: {
        await new InviteExpiredEmail(
          {
            to: notification.user.email,
            language: notification.user.language,
            userId: notification.userId,
            inviteeName: notification.data?.inviteeName ?? "Someone",
            teamName: notification.team.name,
            teamUrl: notification.team.url,
          },
          { notificationId: notification.id }
        ).schedule({
          delay: Minute.ms,
        });
        return;
      }
```

- [ ] **Step 7: Fill in the expiry branch of the task**

In `server/queues/tasks/InviteReminderTask.ts`, replace:

```ts
        if (user.isInviteExpired()) {
          return;
        }
```

with:

```ts
        if (user.isInviteExpired()) {
          if (user.getFlag(UserFlag.InviteExpiryNotified) === 0) {
            await this.notifyExpiry(user, transaction);
            user.incrementFlag(UserFlag.InviteExpiryNotified);
            await user.save({ transaction });
          }
          return;
        }
```

Add the imports, merging with the ones already in the file rather than adding duplicate import statements. `Op`, `subDays`, `UserFlag` and `UserRole` are already imported from Task 4; `NotificationEventType` joins `UserRole` on the `@shared/types` statement, and `Notification` joins `User` on the `@server/models` statement:

```ts
import { NotificationEventType, UserRole } from "@shared/types";
import { Notification, User } from "@server/models";
import { managerIdsFor } from "@server/models/helpers/InviteHelper";
import type { Transaction } from "sequelize";
```

Add these two private methods to the class, before `sendReminder`:

```ts
  /**
   * Tells the inviter, and anyone who manages an item the invitee holds, that
   * the invitation expired. Fires once per invite.
   */
  private async notifyExpiry(
    user: User,
    transaction: Transaction
  ): Promise<void> {
    for (const recipient of await this.expiryRecipients(user)) {
      if (
        recipient.isSuspended ||
        !recipient.subscribedToEventType(NotificationEventType.InviteExpired)
      ) {
        continue;
      }

      await Notification.create(
        {
          event: NotificationEventType.InviteExpired,
          userId: recipient.id,
          actorId: user.invitedById ?? user.id,
          teamId: user.teamId,
          data: { inviteeName: user.name },
        },
        { transaction }
      );
    }
  }

  /**
   * The inviter, plus every user who manages a collection or document the
   * invitee holds. Group-derived access is not considered.
   */
  private async expiryRecipients(user: User): Promise<User[]> {
    const ids = new Set<string>();

    if (user.invitedById) {
      ids.add(user.invitedById);
    }

    for (const id of await managerIdsFor(user.id)) {
      ids.add(id);
    }

    return User.findAll({ where: { id: { [Op.in]: [...ids] } } });
  }
```

Add `managerIdsFor` to `server/models/helpers/InviteHelper.ts`:

```ts
/**
 * Ids of every user who holds manage permission on a collection or document
 * the given user has access to.
 *
 * @param userId the invited user's id.
 * @returns the manager ids, possibly empty.
 */
export async function managerIdsFor(userId: string): Promise<string[]> {
  const memberships = await UserMembership.findAll({ where: { userId } });
  const collectionIds = memberships
    .map((membership) => membership.collectionId)
    .filter((id): id is string => !!id);
  const documentIds = memberships
    .map((membership) => membership.documentId)
    .filter((id): id is string => !!id);

  if (!collectionIds.length && !documentIds.length) {
    return [];
  }

  const managers = await UserMembership.findAll({
    where: {
      permission: CollectionPermission.Admin,
      [Op.or]: [
        ...(collectionIds.length
          ? [{ collectionId: { [Op.in]: collectionIds } }]
          : []),
        ...(documentIds.length ? [{ documentId: { [Op.in]: documentIds } }] : []),
      ],
    },
  });

  return [...new Set(managers.map((membership) => membership.userId))];
}
```

Add the `Transaction` type import to the task:

```ts
import type { Transaction } from "sequelize";
```

`actorManagesAnyItemOf` is not used by the task; it belongs to the resend command in Task 7. Do not import it here.

- [ ] **Step 8: Run the tests to verify they pass**

```bash
NODE_ENV=test TZ=UTC ./node_modules/.bin/vitest run server/queues/tasks/InviteReminderTask.test.ts server/models/helpers/InviteHelper.test.ts server/models/Notification.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add shared/types.ts server/models/User.ts server/emails/templates/InviteExpiredEmail.tsx server/queues/processors/EmailsProcessor.ts server/queues/tasks/InviteReminderTask.ts server/queues/tasks/InviteReminderTask.test.ts server/models/helpers/InviteHelper.ts
git commit -m "feat: notify whoever can act when an invite expires"
```

---

## Task 6b: Close the remaining invite-clock gaps

Two defects found in review, both the same class: a path that sends an invite but never starts or restarts the clock.

**Gap 1 — re-inviting an existing guest.** The spec's edge case "the clock is per person, not per grant" says inviting a guest who already holds an item to a second item restarts their window and reminder count. `guestInviter` only sets the clock on the create path, so a reused guest keeps the old clock. Without this, a guest invited to a second item the day before their first window closes receives an expiry notice for an invite they were just sent.

**Gap 2 — ops team provisioning.** `ops.teams.create` creates an admin and immediately sends an `InviteEmail`, but never sets `inviteLastSentAt`, `invitedById`, or the `InviteSent` flag. That invite therefore never reminds and never expires. The token is still bounded, because `getInviteToken()` falls back to the full window for a null clock, so the blast radius is "silently no lifecycle" rather than "link never dies".

This task comes after Task 6 because the helper it adds touches `UserFlag.InviteExpiryNotified`, which Task 6 defines.

**Files:**
- Modify: `server/models/User.ts`
- Modify: `server/commands/guestInviter.ts`
- Modify: `server/routes/api/ops/ops.ts`
- Test: `server/models/User.test.ts`, `server/commands/guestInviter.test.ts`, `server/commands/userInviter.test.ts`

- [ ] **Step 1: Write the failing model test**

Append to the `describe("invite lifecycle")` block in `server/models/User.test.ts`:

```ts
    it("restarts the lifecycle, keeping the send count", async () => {
      const user = await buildInvite({
        role: UserRole.Guest,
        inviteLastSentAt: new Date("2018-01-01T00:00:00.000Z"),
      });
      user.incrementFlag(UserFlag.InviteReminderSent, 3);
      user.setFlag(UserFlag.InviteExpiryNotified, true);
      const sends = user.getFlag(UserFlag.InviteSent);

      user.restartInviteLifecycle();

      // The suite pins the clock to 2018-01-02.
      expect(user.inviteLastSentAt).toEqual(new Date("2018-01-02T00:00:00.000Z"));
      expect(user.getFlag(UserFlag.InviteReminderSent)).toBe(0);
      expect(user.getFlag(UserFlag.InviteExpiryNotified)).toBe(0);
      expect(user.getFlag(UserFlag.InviteSent)).toBe(sends + 1);
    });
```

Add `import { UserFlag } from "./User";` if the file does not already import it.

- [ ] **Step 2: Write the failing command tests**

Append to `server/commands/guestInviter.test.ts`, following that file's existing `withAPIContext` pattern:

```ts
  it("restarts the lifecycle when an existing guest is invited again", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const first = await buildCollection({
      teamId: team.id,
      createdById: admin.id,
    });

    const { user: guest } = await withAPIContext(admin, (ctx) =>
      guestInviter(ctx, {
        invite: {
          email: "repeat@example.com",
          collectionId: first.id,
          permission: CollectionPermission.Read,
        },
      })
    );

    // Age the invite and pretend the reminders and notice already fired.
    guest.inviteLastSentAt = subDays(new Date(), 6);
    guest.incrementFlag(UserFlag.InviteReminderSent, 3);
    guest.setFlag(UserFlag.InviteExpiryNotified, true);
    await guest.save();

    const second = await buildCollection({
      teamId: team.id,
      createdById: admin.id,
    });

    const { user: again } = await withAPIContext(admin, (ctx) =>
      guestInviter(ctx, {
        invite: {
          email: "repeat@example.com",
          collectionId: second.id,
          permission: CollectionPermission.Read,
        },
      })
    );

    expect(again.getFlag(UserFlag.InviteReminderSent)).toBe(0);
    expect(again.getFlag(UserFlag.InviteExpiryNotified)).toBe(0);
    expect(again.isInviteExpired()).toBe(false);
  });

  it("leaves an existing active member's clock alone", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const member = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      createdById: admin.id,
    });

    await withAPIContext(admin, (ctx) =>
      guestInviter(ctx, {
        invite: {
          email: member.email,
          collectionId: collection.id,
          permission: CollectionPermission.Read,
        },
      })
    );

    await member.reload();
    expect(member.inviteLastSentAt).toBeNull();
  });
```

Add `subDays` from `date-fns` and `UserFlag` from `@server/models/User` to that file's imports if absent.

Then strengthen the existing "starts the invite clock" test in `server/commands/userInviter.test.ts` so it verifies the clock is roughly now, not merely a Date. Replace its final assertion:

```ts
    expect(users[0].inviteLastSentAt).toBeInstanceOf(Date);
```

with:

```ts
    expect(users[0].inviteLastSentAt).toBeInstanceOf(Date);
    expect(users[0].getInviteExpiresAt()?.getTime()).toBeGreaterThan(
      Date.now()
    );
```

Without this, a stale clock (for example the factory's 2018 default) would pass the test.

- [ ] **Step 3: Run the tests to verify they fail**

```bash
NODE_ENV=test TZ=UTC ./node_modules/.bin/vitest run server/models/User.test.ts server/commands/guestInviter.test.ts
```
Expected: FAIL, `user.restartInviteLifecycle is not a function`.

- [ ] **Step 4: Add the helper to the model**

In `server/models/User.ts`, next to the other invite helpers:

```ts
  /**
   * Restarts the invitation lifecycle: reopens the window, resets the reminder
   * count, and re-arms the expiry notice. The send count is not reset, since it
   * is an abuse backstop rather than a per-window allowance.
   */
  restartInviteLifecycle = () => {
    this.inviteLastSentAt = new Date();
    this.setFlag(UserFlag.InviteReminderSent, false);
    this.setFlag(UserFlag.InviteExpiryNotified, false);
    this.incrementFlag(UserFlag.InviteSent);
  };
```

- [ ] **Step 5: Call it from the guest reuse path**

In `server/commands/guestInviter.ts`, the existing-user branch currently does nothing. Replace the create-only `if` with:

```ts
  if (!target) {
    target = await User.createWithCtx(
      ctx,
      {
        teamId: actor.teamId,
        name: invite.name?.trim() || email,
        email,
        role: UserRole.Guest,
        invitedById: actor.id,
        inviteLastSentAt: new Date(),
        flags: {
          [UserFlag.InviteSent]: 1,
        },
      },
      { name: "invite_guest" }
    );
  } else if (target.isInvited) {
    // The guest is being emailed again, so their lifecycle restarts. An
    // existing active member is not invited and has no clock to restart.
    target.restartInviteLifecycle();
    await target.saveWithCtx(ctx);
  }
```

- [ ] **Step 6: Start the clock in ops team provisioning**

In `server/routes/api/ops/ops.ts`, the `User.createWithCtx` call for the first admin currently passes `role` and `isViewer` only, yet the handler then sends an `InviteEmail`. Give that invite the same fields `userInviter` sets, so the lifecycle applies:

```ts
      const adminUser = await User.createWithCtx(
        ctx,
        {
          teamId: team.id,
          name: adminEmail.split("@")[0],
          email: adminEmail.toLowerCase(),
          role: UserRole.Admin,
          isViewer: false,
          invitedById: user.id,
          inviteLastSentAt: new Date(),
          flags: {
            [UserFlag.InviteSent]: 1,
          },
        },
        undefined
      );
```

`invitedById` matters beyond tidiness: the reminder email names the inviter, and the expiry notice uses `invitedById` as a recipient. Add the `UserFlag` import from `@server/models/User` if the file does not already have it.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
NODE_ENV=test TZ=UTC ./node_modules/.bin/vitest run server/models/User.test.ts server/commands/guestInviter.test.ts server/commands/userInviter.test.ts server/routes/api/users/users.test.ts server/routes/api/ops/ops.test.ts
```
Expected: PASS. If `server/routes/api/ops/ops.test.ts` does not exist, say so in the report and run the rest.

- [ ] **Step 8: Static checks and commit**

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/oxfmt --check server/models/User.ts server/commands/guestInviter.ts server/routes/api/ops/ops.ts server/models/User.test.ts server/commands/guestInviter.test.ts server/commands/userInviter.test.ts
./node_modules/.bin/oxlint --type-aware server/models/User.ts server/commands server/routes/api/ops
git add server/models/User.ts server/commands/guestInviter.ts server/routes/api/ops/ops.ts server/models/User.test.ts server/commands/guestInviter.test.ts server/commands/userInviter.test.ts
git commit -m "fix: start or restart the invite clock on every invite path"
```

---

## Task 7: Resend with a cooldown, a ceiling, and the right email

**Files:**
- Create: `server/commands/inviteResender.ts`
- Modify: `server/routes/api/users/users.ts:552-597`
- Test: `server/commands/inviteResender.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/commands/inviteResender.test.ts`:

```ts
import { InviteMaxSends } from "@shared/constants";
import { CollectionPermission, UserRole } from "@shared/types";
import GuestInviteEmail from "@server/emails/templates/GuestInviteEmail";
import InviteEmail from "@server/emails/templates/InviteEmail";
import { createContext } from "@server/context";
import { User, UserMembership } from "@server/models";
import { UserFlag } from "@server/models/User";
import {
  buildAdmin,
  buildCollection,
  buildGuestUser,
  buildInvite,
  buildUser,
  buildViewer,
} from "@server/test/factories";
import inviteResender from "./inviteResender";

/** A guest with an outstanding invite, aged by the given hours. */
const buildPendingGuest = (hours: number) =>
  buildInvite({ role: UserRole.Guest, inviteLastSentAt: hoursAgo(hours) });

describe("inviteResender", () => {
  it("resends a guest invite as a guest email and reopens the window", async () => {
    const guest = await buildPendingGuest(200);
    const admin = await buildAdmin({ teamId: guest.teamId });
    const collection = await buildCollection({ teamId: guest.teamId });
    await UserMembership.create({
      userId: guest.id,
      collectionId: collection.id,
      permission: CollectionPermission.Read,
      createdById: admin.id,
    });
    const spy = vi.spyOn(GuestInviteEmail.prototype, "schedule");

    await inviteResender(createContext({ user: admin }), { user: guest });
    await guest.reload();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(guest.isInviteExpired()).toBe(false);
    expect(guest.getFlag(UserFlag.InviteReminderSent)).toBe(0);
    expect(guest.getFlag(UserFlag.InviteExpiryNotified)).toBe(0);
    spy.mockRestore();
  });

  it("resends a member invite as the workspace email", async () => {
    const member = await buildInvite({
      role: UserRole.Member,
      inviteLastSentAt: hoursAgo(200),
    });
    const admin = await buildAdmin({ teamId: member.teamId });
    const spy = vi.spyOn(InviteEmail.prototype, "schedule");

    await inviteResender(createContext({ user: admin }), { user: member });

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("refuses a second resend inside the cooldown", async () => {
    const guest = await buildPendingGuest(1);
    const admin = await buildAdmin({ teamId: guest.teamId });
    const collection = await buildCollection({ teamId: guest.teamId });
    await UserMembership.create({
      userId: guest.id,
      collectionId: collection.id,
      permission: CollectionPermission.Read,
      createdById: admin.id,
    });

    await expect(
      inviteResender(createContext({ user: admin }), { user: guest })
    ).rejects.toThrow(/recently/);
  });

  it("refuses once the send ceiling is reached", async () => {
    const guest = await buildPendingGuest(200);
    guest.setFlag(UserFlag.InviteSent, false);
    for (let i = 0; i < InviteMaxSends; i++) {
      guest.incrementFlag(UserFlag.InviteSent);
    }
    await guest.save();
    const admin = await buildAdmin({ teamId: guest.teamId });
    const collection = await buildCollection({ teamId: guest.teamId });
    await UserMembership.create({
      userId: guest.id,
      collectionId: collection.id,
      permission: CollectionPermission.Read,
      createdById: admin.id,
    });

    await expect(
      inviteResender(createContext({ user: admin }), { user: guest })
    ).rejects.toThrow(/too many times/);
  });

  it("allows a manager of a shared item to resend", async () => {
    const guest = await buildPendingGuest(200);
    const manager = await buildUser({ teamId: guest.teamId });
    const collection = await buildCollection({ teamId: guest.teamId });
    await UserMembership.create({
      userId: guest.id,
      collectionId: collection.id,
      permission: CollectionPermission.Read,
      createdById: manager.id,
    });
    await UserMembership.create({
      userId: manager.id,
      collectionId: collection.id,
      permission: CollectionPermission.Admin,
      createdById: manager.id,
    });
    const spy = vi.spyOn(GuestInviteEmail.prototype, "schedule");

    await inviteResender(createContext({ user: manager }), { user: guest });

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("refuses an unrelated member", async () => {
    const guest = await buildPendingGuest(200);
    const stranger = await buildViewer({ teamId: guest.teamId });
    const collection = await buildCollection({ teamId: guest.teamId });
    await UserMembership.create({
      userId: guest.id,
      collectionId: collection.id,
      permission: CollectionPermission.Read,
      createdById: stranger.id,
    });

    await expect(
      inviteResender(createContext({ user: stranger }), { user: guest })
    ).rejects.toThrow(/Authorization/);
  });

  it("refuses a guest trying to resend", async () => {
    const guest = await buildPendingGuest(200);
    const other = await buildGuestUser({ teamId: guest.teamId });

    await expect(
      inviteResender(createContext({ user: other }), { user: guest })
    ).rejects.toThrow(/Authorization/);
  });

  it("counts the resend against the send total", async () => {
    const guest = await buildPendingGuest(200);
    const admin = await buildAdmin({ teamId: guest.teamId });
    const collection = await buildCollection({ teamId: guest.teamId });
    await UserMembership.create({
      userId: guest.id,
      collectionId: collection.id,
      permission: CollectionPermission.Read,
      createdById: admin.id,
    });
    const before = guest.getFlag(UserFlag.InviteSent);

    await inviteResender(createContext({ user: admin }), { user: guest });
    await guest.reload();

    expect(guest.getFlag(UserFlag.InviteSent)).toBe(before + 1);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
NODE_ENV=test TZ=UTC ./node_modules/.bin/vitest run server/commands/inviteResender.test.ts
```

Expected: FAIL, cannot resolve `./inviteResender`.

- [ ] **Step 3: Write the command**

Create `server/commands/inviteResender.ts`:

```ts
import {
  InviteMaxSends,
  InviteResendCooldownMs,
} from "@shared/constants";
import { UserRole } from "@shared/types";
import GuestInviteEmail from "@server/emails/templates/GuestInviteEmail";
import InviteEmail from "@server/emails/templates/InviteEmail";
import { AuthorizationError, ValidationError } from "@server/errors";
import type { User } from "@server/models";
import {
  actorManagesAnyItemOf,
  getGuestInviteItem,
} from "@server/models/helpers/InviteHelper";
import { UserFlag } from "@server/models/User";
import { can } from "@server/policies";
import type { APIContext } from "@server/types";

type Props = {
  /** The invited user to resend to. */
  user: User;
};

/**
 * Resends an outstanding invitation and restarts its lifecycle: the window
 * reopens, the reminder count resets, and the expiry notice is re-armed.
 * A guest receives the guest invite email naming their item; everyone else
 * receives the workspace invite.
 *
 * @param ctx The request context, carrying the actor and the transaction.
 * @param props.user The invited user to resend to.
 * @throws AuthorizationError when the actor may neither administer the team nor manage a shared item.
 * @throws ValidationError when the cooldown has not elapsed, the send ceiling is reached, or a guest holds nothing.
 */
export default async function inviteResender(
  ctx: APIContext,
  { user }: Props
): Promise<void> {
  const { user: actor } = ctx.state.auth;
  const { transaction } = ctx.state;

  const isAdmin = can(actor, "resendInvite", user);
  if (!isAdmin && !(await actorManagesAnyItemOf(actor.id, user.id))) {
    throw AuthorizationError();
  }

  const now = new Date();
  const lastSentAt = user.inviteLastSentAt ?? user.createdAt;

  if (now.getTime() < lastSentAt.getTime() + InviteResendCooldownMs) {
    throw ValidationError(
      "This invite was sent recently, try again tomorrow"
    );
  }

  if (user.getFlag(UserFlag.InviteSent) >= InviteMaxSends) {
    throw ValidationError("This invite has been sent too many times");
  }

  // Re-anchor before signing, otherwise the new token would inherit the
  // expired window it is replacing.
  user.restartInviteLifecycle();
  const token = user.getInviteToken();

  if (user.role === UserRole.Guest) {
    const item = await getGuestInviteItem(user.id);
    if (!item) {
      throw ValidationError("This guest no longer has access to anything");
    }

    await new GuestInviteEmail({
      to: user.email,
      language: user.language,
      name: user.name,
      actorName: actor.name,
      teamName: actor.team.name,
      teamUrl: actor.team.url,
      itemName: item.itemName,
      isCollection: item.isCollection,
      token,
    }).schedule();
  } else {
    await new InviteEmail({
      to: user.email,
      language: user.language,
      name: user.name,
      actorName: actor.name,
      actorEmail: actor.email,
      teamName: actor.team.name,
      teamUrl: actor.team.url,
      token,
    }).schedule();
  }

  await user.save({ transaction });
}
```

`restartInviteLifecycle()` already resets the reminder count, re-arms the expiry notice, and increments the send count, so no separate flag handling is needed here. The `now` variable is still used by the cooldown check above.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
NODE_ENV=test TZ=UTC ./node_modules/.bin/vitest run server/commands/inviteResender.test.ts
```

Expected: PASS.

- [ ] **Step 5: Make the route thin**

In `server/routes/api/users/users.ts`, replace the body of the `users.resendInvite` handler so the whole route reads:

```ts
router.post(
  "users.resendInvite",
  rateLimiter(RateLimiterStrategy.TenPerHour),
  auth(),
  validate(T.UsersResendInviteSchema),
  transaction(),
  async (ctx: APIContext<T.UsersResendInviteReq>) => {
    const { id } = ctx.input.body;
    const { auth, transaction } = ctx.state;

    const user = await User.findByPk(id, {
      lock: transaction.LOCK.UPDATE,
      transaction,
      rejectOnEmpty: true,
    });

    await inviteResender(ctx, { user });

    if (env.isDevelopment) {
      logger.info(
        "email",
        `Sign in immediately: ${
          env.URL
        }/auth/email.callback?token=${user.getEmailSigninToken(ctx)}`
      );
    }

    ctx.body = {
      success: true,
    };
  }
);
```

Add the import:

```ts
import inviteResender from "@server/commands/inviteResender";
```

Remove any imports the old body used that are now unused, such as `InviteEmail` if nothing else in the file uses it. Confirm with:

```bash
rg -n "InviteEmail" server/routes/api/users/users.ts
```

- [ ] **Step 6: Run the route tests**

```bash
NODE_ENV=test TZ=UTC ./node_modules/.bin/vitest run server/routes/api/users/users.test.ts
```

Expected: PASS. If a test asserted the old "sent too many times" threshold at three sends, update it to the new `InviteMaxSends` constant rather than a literal.

- [ ] **Step 7: Commit**

```bash
git add server/commands/inviteResender.ts server/commands/inviteResender.test.ts server/routes/api/users/users.ts server/routes/api/users/users.test.ts
git commit -m "feat: resend invites with a cooldown, a ceiling, and the right email"
```

---

## Task 8: Let the item manager see the resend control

**Files:**
- Modify: `server/presenters/user.ts:16-30,32-56`
- Modify: `app/models/User.ts:131-133`
- Modify: `app/components/Sharing/Collection/AccessControlList.tsx`
- Modify: `app/components/Sharing/Document/DocumentMemberList.tsx`
- Test: `server/presenters/user.test.ts`

- [ ] **Step 1: Write the failing presenter test**

Append to `server/presenters/user.test.ts`:

```ts
it("presents the invite expiry for a pending invite", () => {
  const user = User.build({
    id: "123",
    name: "Guest",
    role: UserRole.Guest,
    inviteLastSentAt: new Date("2018-01-01T00:00:00.000Z"),
  });

  expect(presentUser(user).inviteExpiresAt).toEqual(
    new Date("2018-01-08T00:00:00.000Z")
  );
});

it("presents a null expiry for a user with no invite", () => {
  const user = User.build({ id: "123", name: "Member" });

  expect(presentUser(user).inviteExpiresAt).toBeNull();
});
```

This file builds users with `User.build` rather than the factories, so no database is involved. Add `UserRole` to the existing `@shared/types` import.

- [ ] **Step 2: Run it to verify it fails**

```bash
NODE_ENV=test TZ=UTC ./node_modules/.bin/vitest run server/presenters/user.test.ts
```

Expected: FAIL, `inviteExpiresAt` is undefined.

- [ ] **Step 3: Present the derived expiry**

In `server/presenters/user.ts`, add to `UserPresentation`:

```ts
  /** When the outstanding invitation stops working, or null. */
  inviteExpiresAt?: Date | null;
```

and add to the returned object in `presentUser`:

```ts
    lastActiveAt: user.lastActiveAt,
    inviteExpiresAt: user.getInviteExpiresAt(),
```

- [ ] **Step 4: Run it to verify it passes**

```bash
NODE_ENV=test TZ=UTC ./node_modules/.bin/vitest run server/presenters/user.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add the client getters**

In `app/models/User.ts`, after the `isInvited` getter, add the field and the getter. Do not use `@Field`: this value is derived on the server and must never be sent back on save.

```ts
  @observable
  inviteExpiresAt: string | null;

  /**
   * Whether the invitation has outlived its window without being accepted.
   */
  get isInviteExpired(): boolean {
    return (
      this.isInvited &&
      !!this.inviteExpiresAt &&
      new Date(this.inviteExpiresAt) < new Date()
    );
  }
```

- [ ] **Step 6: Show status and a resend action in the collection dialog**

In `app/components/Sharing/Collection/AccessControlList.tsx`, the memberships list renders one `ListItem` per membership. Give each member row a status subtitle and, for a pending guest, a resend button.

Add the imports:

```tsx
import Button from "~/components/Button";
```

Replace the member `ListItem`'s `subtitle` with:

```tsx
                      subtitle={
                        membership.user.isInvited ? (
                          membership.user.isInviteExpired ? (
                            t("Invite expired")
                          ) : (
                            t("Invite pending")
                          )
                        ) : (
                          membership.user.email
                        )
                      }
```

Replace the member row's `actions` with a fragment that adds the resend control when the actor can invite guests to this collection:

```tsx
                      actions={
                        <div style={{ marginRight: -8 }}>
                          {membership.user.isInvited &&
                            can.inviteGuest && (
                              <Button
                                onClick={() =>
                                  void users.resendInvite(membership.user)
                                }
                                neutral
                                small
                              >
                                {t("Resend")}
                              </Button>
                            )}
                          <InputMemberPermissionSelect
                            permissions={permissions}
                            onChange={async (
                              permission:
                                | CollectionPermission
                                | typeof EmptySelectValue
                            ) => {
                              try {
                                if (permission === EmptySelectValue) {
                                  await memberships.delete({
                                    collectionId: collection.id,
                                    userId: membership.userId,
                                  });
                                  offerGuestRemoval(membership.user);
                                } else {
                                  await memberships.create({
                                    collectionId: collection.id,
                                    userId: membership.userId,
                                    permission,
                                  });
                                }
                              } catch (err) {
                                toast.error(errToString(err));
                                return false;
                              }
                              return true;
                            }}
                            disabled={!can.update}
                            value={membership.permission}
                          />
                        </div>
                      }
```

Add `users` to the destructured stores at the top of the component:

```tsx
    const {
      memberships,
      groupMemberships,
      userMemberships,
      dialogs,
      users,
    } = useStores();
```

- [ ] **Step 7: Do the same in the document dialog**

In `app/components/Sharing/Document/DocumentMemberList.tsx`, the per-user row is rendered by `DocumentMemberListItem`. Pass the status and resend handler through:

```tsx
      {members.map((item) => (
        <DocumentMemberListItem
          key={item.id}
          user={item}
          membership={item.getMembership(document)}
          onRemove={() => handleRemoveUser(item)}
          onResend={
            item.isInvited && can.inviteGuest
              ? () => void users.resendInvite(item)
              : undefined
          }
          onUpdate={
            can.manageUsers
              ? (permission) => handleUpdateUser(item, permission)
              : undefined
          }
          onLeave={
            item.id === user.id ? () => handleRemoveUser(item) : undefined
          }
        />
      ))}
```

Add `users` to that component's destructured stores:

```tsx
  const {
    userMemberships,
    groupMemberships,
    memberships,
    dialogs,
    users,
  } = useStores();
```

- [ ] **Step 8: Render the status and button in the document row**

In `app/components/Sharing/Document/DocumentMemberListItem.tsx`, add the import:

```tsx
import Button from "~/components/Button";
```

add `onResend` to the props type:

```tsx
type Props = {
  user: User;
  membership?: UserMembership | undefined;
  onAdd?: () => void;
  onRemove?: () => void;
  onLeave?: () => void;
  onUpdate?: (permission: DocumentPermission) => void;
  onResend?: () => void;
};
```

accept it in the destructured signature, so the function begins:

```tsx
const DocumentMemberListItem = ({
  user,
  membership,
  onRemove,
  onLeave,
  onUpdate,
  onResend,
}: Props) => {
```

replace the pending-invite branch of the `subtitle` so expiry is distinguishable from a live invite:

```tsx
        ) : user.isInviteExpired ? (
          t("Invite expired")
        ) : user.isInvited ? (
          t("Invite pending")
        ) : user.lastActiveAt ? (
```

and add the resend button inside the actions wrapper, before the permission select:

```tsx
      actions={
        <div style={{ marginRight: -8 }}>
          {onResend && (
            <Button onClick={onResend} neutral small>
              {t("Resend")}
            </Button>
          )}
          <InputMemberPermissionSelect
```

- [ ] **Step 9: Type-check and run the frontend tests**

```bash
./node_modules/.bin/tsc --noEmit
NODE_ENV=test TZ=UTC ./node_modules/.bin/vitest run app
```

Expected: tsc clean, tests pass.

- [ ] **Step 10: Commit**

```bash
git add server/presenters/user.ts server/presenters/user.test.ts app/models/User.ts app/components/Sharing/Collection/AccessControlList.tsx app/components/Sharing/Document/DocumentMemberList.tsx app/components/Sharing/Document/DocumentMemberListItem.tsx
git commit -m "feat: show pending and expired invites with a resend action"
```

---

## Task 9: Verify the whole lifecycle

**Files:** none created; this task is evidence gathering.

- [ ] **Step 1: Type-check, format, and lint**

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/oxfmt --check app server shared
./node_modules/.bin/oxlint --type-aware app server shared plugins
```

Expected: tsc clean, no format issues in files this plan touched, zero lint errors in them.

- [ ] **Step 2: Run every suite this plan touches**

```bash
NODE_ENV=test TZ=UTC ./node_modules/.bin/vitest run server/models/User.test.ts server/models/helpers/InviteHelper.test.ts server/queues/tasks/InviteReminderTask.test.ts server/commands/inviteResender.test.ts server/commands/guestInviter.test.ts server/commands/userInviter.test.ts server/presenters/user.test.ts server/routes/api/users/users.test.ts
```

Expected: all pass.

- [ ] **Step 3: Confirm the migration is reversible**

```bash
NODE_ENV=test ./node_modules/.bin/sequelize db:migrate:undo
psql "$DATABASE_URL" -c '\d users' | grep -c inviteLastSentAt
NODE_ENV=test ./node_modules/.bin/sequelize db:migrate
```

Expected: the count is 0 after the undo, and the column is present again after re-running.

- [ ] **Step 4: Walk the lifecycle by hand**

Against a local server, invite an outside email to a collection, then:

1. Confirm the invite email arrives and its link works.
2. Set `inviteLastSentAt` back two days in the database, run the reminder task, and confirm the reminder names the collection.
3. Set it back eight days, run the task, and confirm the manager receives the in-app notification and the expiry email, and that the invite link no longer works.
4. Press Resend in the share dialog and confirm a fresh email arrives, the link works again, and a second immediate Resend is refused by the cooldown.

- [ ] **Step 5: Report the evidence**

Report the commands run, their results, and anything that could not be verified locally.

- [ ] **Step 6: Commit any fixes found**

```bash
git add -A
git commit -m "fix: address issues found verifying the invite lifecycle"
```

---

## Known follow-ups, deliberately out of this plan

- Public share link expiry (per-link 1 / 7 / 30 / 90 days or Never, default 30).
- Visitor analytics (sessions, minutes, navigation path).
- A separate "extend invitation" action. A resend re-anchors the window, which is the same outcome with one button.
- Configurable windows and cadences. They are constants until a second real value is needed.
- Group-derived access in the manager lookup and the expiry notice recipients.
