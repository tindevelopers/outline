import { subHours } from "date-fns";
import type { MockInstance } from "vitest";
import {
  CollectionPermission,
  NotificationEventType,
  UserRole,
} from "@shared/types";
import InviteReminderEmail from "@server/emails/templates/InviteReminderEmail";
import GuestInviteReminderEmail from "@server/emails/templates/GuestInviteReminderEmail";
import {
  buildAdmin,
  buildCollection,
  buildInvite,
} from "@server/test/factories";
import { Notification, User } from "@server/models";
import UserMembership from "@server/models/UserMembership";
import { UserFlag } from "@server/models/User";
import InviteReminderTask from "./InviteReminderTask";

/** How many emails this spy sent to a specific address. */
const sentTo = (spy: MockInstance, email: string | null) =>
  spy.mock.contexts.filter(
    (context: { props: { to?: string | null } }) => context.props.to === email
  ).length;

/** Notifications this spy created that name a specific invitee. */
const notifiedFor = (spy: MockInstance, inviteeName: string) =>
  spy.mock.calls.filter(([args]) => args?.data?.inviteeName === inviteeName)
    .length;

const hoursAgo = (hours: number) => subHours(new Date(), hours);
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

  it("notifies the inviter once when a guest invite expires", async () => {
    const guest = await buildInvite({
      role: UserRole.Guest,
      inviteLastSentAt: hoursAgo(200),
    });
    const inviter = (await User.findByPk(guest.invitedById!))!;
    const spy = vi.spyOn(Notification, "create");

    await new InviteReminderTask().perform();
    expect(notifiedFor(spy, guest.name)).toBe(1);

    const callsForInvitee = spy.mock.calls.filter(
      ([args]) => args?.data?.inviteeName === guest.name
    );
    expect(callsForInvitee).toHaveLength(1);
    expect(callsForInvitee[0][0]).toMatchObject({
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

  it("notifies the inviter and a manager of an item the guest holds", async () => {
    const guest = await buildPendingGuest(200);
    const inviter = (await User.findByPk(guest.invitedById!))!;
    const membership = (await UserMembership.findOne({
      where: { userId: guest.id },
    }))!;
    // A second person who manages the collection the guest holds. The
    // collection's creator also holds admin, so this test asserts on the
    // specific recipients rather than the total.
    const manager = await buildAdmin({ teamId: guest.teamId });
    await UserMembership.create({
      userId: manager.id,
      collectionId: membership.collectionId!,
      permission: CollectionPermission.Admin,
      createdById: manager.id,
    });
    const spy = vi.spyOn(Notification, "create");

    await new InviteReminderTask().perform();

    const notifiedUserIds = spy.mock.calls
      .filter(([args]) => args?.data?.inviteeName === guest.name)
      .map(([args]) => args?.userId);
    expect(notifiedUserIds).toContain(inviter.id);
    expect(notifiedUserIds).toContain(manager.id);
    expect(notifiedUserIds.filter((id) => id === inviter.id)).toHaveLength(1);
    expect(notifiedUserIds.filter((id) => id === manager.id)).toHaveLength(1);
    spy.mockRestore();
  });

  it("notifies a manager who is also the inviter exactly once", async () => {
    const guest = await buildInvite({
      role: UserRole.Guest,
      inviteLastSentAt: hoursAgo(200),
    });
    const inviter = (await User.findByPk(guest.invitedById!))!;
    // The inviter is the collection's creator, so they are both the inviter
    // and a manager of the item the guest holds.
    const collection = await buildCollection({
      teamId: guest.teamId,
      createdById: inviter.id,
    });
    await UserMembership.create({
      userId: guest.id,
      collectionId: collection.id,
      permission: CollectionPermission.Read,
      createdById: inviter.id,
    });
    const spy = vi.spyOn(Notification, "create");

    await new InviteReminderTask().perform();

    expect(notifiedFor(spy, guest.name)).toBe(1);
    const notifiedUserIds = spy.mock.calls
      .filter(([args]) => args?.data?.inviteeName === guest.name)
      .map(([args]) => args?.userId);
    expect(notifiedUserIds).toEqual([inviter.id]);
    spy.mockRestore();
  });
});
