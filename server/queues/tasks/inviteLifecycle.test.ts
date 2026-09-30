import { subDays } from "date-fns";
import jwt from "jsonwebtoken";
import {
  CollectionPermission,
  NotificationEventType,
  UserRole,
} from "@shared/types";
import inviteResender from "@server/commands/inviteResender";
import GuestInviteEmail from "@server/emails/templates/GuestInviteEmail";
import GuestInviteReminderEmail from "@server/emails/templates/GuestInviteReminderEmail";
import { Notification } from "@server/models";
import { UserFlag } from "@server/models/User";
import UserMembership from "@server/models/UserMembership";
import {
  buildAdmin,
  buildCollection,
  buildInvite,
} from "@server/test/factories";
import { withAPIContext } from "@server/test/support";
import InviteReminderTask from "./InviteReminderTask";

const tokenLifetimeMs = (token: string): number => {
  const decoded = jwt.decode(token) as { iat: number; exp: number } | null;
  if (!decoded) {
    return Number.NaN;
  }
  return (decoded.exp - decoded.iat) * 1000;
};

const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

describe("invite lifecycle end to end", () => {
  it("reminds, expires, notifies the manager, and resends", async () => {
    // 1. A guest is invited to a collection.
    const guest = await buildInvite({
      role: UserRole.Guest,
      inviteLastSentAt: new Date(),
    });
    const manager = await buildAdmin({ teamId: guest.teamId });
    const collection = await buildCollection({
      teamId: guest.teamId,
      createdById: manager.id,
    });
    await UserMembership.create({
      userId: guest.id,
      collectionId: collection.id,
      permission: CollectionPermission.Read,
      createdById: manager.id,
    });

    // The link is alive for the full seven day window. The TTL is the window
    // remaining at signing time, floored to whole seconds.
    expect(tokenLifetimeMs(guest.getInviteToken())).toBeGreaterThan(
      sevenDaysMs - 2000
    );
    expect(tokenLifetimeMs(guest.getInviteToken())).toBeLessThanOrEqual(
      sevenDaysMs
    );
    expect(guest.isInviteExpired()).toBe(false);

    // 2. Two days later the guest is reminded, and the reminder names the item.
    guest.inviteLastSentAt = subDays(new Date(), 2);
    await guest.save();
    const reminderSpy = vi.spyOn(
      GuestInviteReminderEmail.prototype,
      "schedule"
    );
    await new InviteReminderTask().perform();
    expect(reminderSpy).toHaveBeenCalledTimes(1);
    expect(reminderSpy.mock.contexts[0].props.itemName).toBe(collection.name);
    reminderSpy.mockRestore();
    await guest.reload();
    expect(guest.getFlag(UserFlag.InviteReminderSent)).toBe(1);

    // 3. Eight days later the invite has expired. The link is genuinely dead,
    // no reminder is sent, and the manager is told.
    guest.inviteLastSentAt = subDays(new Date(), 8);
    await guest.save();
    const staleReminderSpy = vi.spyOn(
      GuestInviteReminderEmail.prototype,
      "schedule"
    );
    const notificationSpy = vi.spyOn(Notification, "create");
    await new InviteReminderTask().perform();
    expect(staleReminderSpy).not.toHaveBeenCalled();
    staleReminderSpy.mockRestore();
    await guest.reload();
    expect(guest.isInviteExpired()).toBe(true);
    expect(tokenLifetimeMs(guest.getInviteToken())).toBe(0);

    // The notice reaches the inviter and the manager of the item the guest
    // holds, exactly once each, and names the invitee.
    const expiryCalls = notificationSpy.mock.calls.filter(
      ([values]) => values.event === NotificationEventType.InviteExpired
    );
    const recipients = expiryCalls.map(([values]) => values.userId);
    expect(new Set(recipients)).toEqual(
      new Set([guest.invitedById, manager.id])
    );
    expect(recipients).toHaveLength(2);
    for (const [values] of expiryCalls) {
      expect(values.data).toEqual({ inviteeName: guest.name });
    }
    notificationSpy.mockRestore();

    // A second run must not notify again.
    const secondRunSpy = vi.spyOn(Notification, "create");
    await new InviteReminderTask().perform();
    expect(
      secondRunSpy.mock.calls.filter(
        ([values]) => values.event === NotificationEventType.InviteExpired
      )
    ).toHaveLength(0);
    secondRunSpy.mockRestore();

    // 4. The manager resends. The window reopens, the link works again, and
    // the reminder cadence restarts from zero.
    const sendsBefore = guest.getFlag(UserFlag.InviteSent);
    const resendSpy = vi.spyOn(GuestInviteEmail.prototype, "schedule");
    await withAPIContext(manager, (ctx) =>
      inviteResender(ctx, { user: guest })
    );
    expect(resendSpy).toHaveBeenCalledTimes(1);
    resendSpy.mockRestore();

    await guest.reload();
    expect(guest.isInviteExpired()).toBe(false);
    expect(tokenLifetimeMs(guest.getInviteToken())).toBeGreaterThan(
      sevenDaysMs - 2000
    );
    expect(guest.getFlag(UserFlag.InviteReminderSent)).toBe(0);
    expect(guest.getFlag(UserFlag.InviteExpiryNotified)).toBe(0);
    // The send count is an abuse backstop, so it advances rather than resets.
    expect(guest.getFlag(UserFlag.InviteSent)).toBe(sendsBefore + 1);

    // 5. An immediate second resend is refused by the cooldown.
    await expect(
      withAPIContext(manager, (ctx) => inviteResender(ctx, { user: guest }))
    ).rejects.toThrow(/recently/);
  });
});
