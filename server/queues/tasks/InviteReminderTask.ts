import { subDays } from "date-fns";
import { Op, type Transaction } from "sequelize";
import { InviteLifecycle } from "@shared/constants";
import { NotificationEventType, UserRole } from "@shared/types";
import { Day } from "@shared/utils/time";
import GuestInviteReminderEmail from "@server/emails/templates/GuestInviteReminderEmail";
import InviteReminderEmail from "@server/emails/templates/InviteReminderEmail";
import { Notification, User } from "@server/models";
import {
  getGuestInviteItem,
  managerIdsFor,
} from "@server/models/helpers/InviteHelper";
import { UserFlag } from "@server/models/User";
import { sequelize } from "@server/storage/database";
import { TaskPriority } from "./base/BaseTask";
import { CronTask, TaskInterval } from "./base/CronTask";

export default class InviteReminderTask extends CronTask {
  public async perform() {
    // An invite younger than two days cannot be due a reminder, since two is
    // the earliest offset for any role.
    const users = await User.scope("invited").findAll({
      attributes: ["id"],
      where: {
        inviteLastSentAt: {
          // Two days is the earliest reminder offset for any role, so a
          // younger invite cannot be due. The 30 day bound matches the longest
          // window, so expired invites are not re-scanned forever.
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
          if (user.getFlag(UserFlag.InviteExpiryNotified) === 0) {
            await this.notifyExpiry(user, transaction);
            user.incrementFlag(UserFlag.InviteExpiryNotified);
            await user.save({ transaction });
          }
          return;
        }

        const schedule = InviteLifecycle[user.role]?.reminderDays ?? [];
        const sent = user.getFlag(UserFlag.InviteReminderSent);
        const dueOnDay = schedule[sent];

        if (dueOnDay === undefined) {
          return;
        }

        const ageDays = (Date.now() - user.inviteLastSentAt.getTime()) / Day.ms;

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
   * Tells the inviter, and anyone who manages an item the invitee holds, that
   * the invitation expired. Fires once per invite.
   *
   * @param user the invitee whose window has closed.
   * @param transaction the transaction the flag update is committed in.
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
          teamId: user.teamId,
          data: { inviteeName: user.name },
          // The inviter is the actor where known. An invitee is never named as
          // the actor of their own expiry, so the actor is left null otherwise.
          ...(user.invitedById ? { actorId: user.invitedById } : {}),
        },
        { transaction }
      );
    }
  }

  /**
   * The inviter, plus every user who manages a collection or document the
   * invitee holds. Group-derived access is not considered.
   *
   * @param user the invitee whose window has closed.
   * @returns the deduplicated recipients.
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

  /**
   * Enqueues the reminder for this user's role.
   *
   * @returns true when a reminder was enqueued, false when there is nothing to send.
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
