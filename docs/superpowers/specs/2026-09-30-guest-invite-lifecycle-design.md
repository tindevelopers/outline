# Guest and Member Invite Lifecycle

**Status:** approved for planning
**Date:** 2026-09-30
**Supersedes:** nothing. Extends `2026-09-29-guest-sharing-design.md`.

## Goal

A pending invitation should not sit in the workspace forever. Today an invite
is either accepted or forgotten, with no nudge to the invitee and no signal to
whoever sent it. This adds a bounded lifecycle: reminders while the invite is
live, a hard end to the link, and a notification to the person who can act.

Applies to guest invites (outside collaborators on a single collection or
document) and to workspace member invites.

## Decisions and evidence

Checked against Notion and Slack help documentation on 2026-09-30.

| Decision | Value | Why |
| --- | --- | --- |
| Guest window | 7 days | An invite to one page is a small ask; a week is a fair shelf life. |
| Member window | 30 days | Matches Slack's documented invitation lifetime. A colleague invited before a holiday must not find a dead link. |
| Guest reminders | Day 2, 4, 6 | Fits three nudges inside a 7-day window. |
| Member reminders | Day 3, 10, 20 | Evenly spread across 30 days. Reminding every 2 days for 30 days would send 15 emails and damage sender reputation. |
| Expiry effect | Link only | The account and the item grant survive; a resend restores access. Chosen over revoking the grant or deleting the account, both of which punish a guest who was simply slow. |
| Resend cooldown | 24 hours per invite | The actual anti-abuse control. A spammer's only tool is repetition. |
| Resend ceiling | 10 total sends | Abuse backstop only, far above legitimate use. |
| Resend authority | Team admin, or Manage on an item the guest holds | Mirrors the `inviteGuest` rule already shipped. Without this an item manager cannot act on the reminder they receive. |
| Manager notice | In-app notification plus summary email, on expiry | Requested. Both channels come from one code path. |

Neither Notion nor Slack sends reminders on a timer. Slack pairs a 30-day
window with manual resend, extend, and delete. The reminder cadence here is a
deliberate departure, justified because a guest invite is one small item
rather than a workspace migration.

## Explicitly out of scope

Each of these is its own spec. Do not build them here.

- Public share link expiry (per-link 1 / 7 / 30 / 90 days or Never, default 30).
- Visitor analytics (sessions, minutes, navigation path).
- A separate "extend invitation" action. A resend re-anchors the window, which
  is the same outcome with one button instead of two.
- A configurable window or cadence. These are constants until someone needs
  them to vary, at which point they can become settings.
- Re-anchoring expiry without a resend, or a background job that silently
  extends invites. An expired invite stays expired until a human resends it.
- Retroactively notifying anyone about invites that expired before this ships.

## Data model

One new nullable column, one migration, no new tables.

```text
users.inviteLastSentAt   timestamp with time zone, null, indexed
```

Set to now by `userInviter` and `guestInviter`, and reset by resend. It is the
single source of truth for the invite's clock. Everything else is derived:

```text
window ends   = inviteLastSentAt + window(role)
cooldown ends = inviteLastSentAt + 24h
last send     = inviteLastSentAt
```

An earlier draft stored both `inviteExpiresAt` and a last-send time. That is
two representations of one fact and they can disagree; the derived form cannot.

The window is a pure function of role, so changing a window length in future
applies to in-flight invites automatically. That is the desired behaviour.

Counters reuse the existing `User.flags` JSON map, which already holds numbers
and supports `incrementFlag`. No new column for counting.

| Flag | Meaning |
| --- | --- |
| `InviteSent` | Total manual sends: the original invite plus every resend. Already exists. |
| `InviteReminderSent` | Count of automatic reminders. Already exists. |
| `InviteExpiryNotified` | New. Set once the manager notice has fired, so it fires once. |

### Migration and backfill

Backfill `inviteLastSentAt = createdAt` for existing invited users, and set
`InviteExpiryNotified = 1` on those same rows in the same migration.

The second half matters. Without it, every invite that expired before deploy
becomes eligible at once and the expiry notice mails a batch of notifications
and emails to real people on the first cron run. Those long-pending invites are
genuinely expired, but they are not worth a notification storm, and they were
sent under a regime that never promised a deadline. Only invites created after
this ships get lifecycle notifications.

## Lifecycle

```text
invite sent ──► inviteLastSentAt = now
                 │
                 ├─ reminder due when ageDays >= schedule[remindersSent]
                 │    guest: day 2, 4, 6      member: day 3, 10, 20
                 │
                 ├─ accepted (lastActiveAt set) ──► nothing further, ever
                 │
                 └─ now > window end ──► link is dead, invite reads as Expired
                                          └─► notify recipients, once
                                               └─► Resend ──► new clock, reminders reset
```

Expiry is a property of the link, not the account. The guest keeps their
account and their grant, so a resend needs no new membership and the guest's
history, comments, and notifications stay intact.

## Components

| File | Change |
| --- | --- |
| `server/migrations/<ts>-add-invite-last-sent-at.js` | New column, index, backfill as above. |
| `server/models/User.ts` | Add `inviteLastSentAt`. Add `getInviteWindow()`, `getInviteExpiresAt()`, `isInviteExpired()` as pure helpers. `getInviteToken()` signs a TTL from the window end instead of the hardcoded `expiresIn: "30d"`, falling back to 30 days when `inviteLastSentAt` is null. |
| `shared/constants.ts` | New `InviteLifecycle` map: per-role window in days and reminder day offsets. One place to read the numbers. |
| `server/commands/userInviter.ts`, `server/commands/guestInviter.ts` | Set `inviteLastSentAt` alongside the existing `InviteSent: 1`. |
| `server/queues/tasks/InviteReminderTask.ts` | Reworked into the single cadence engine. See below. |
| `server/emails/templates/GuestInviteReminderEmail.tsx` | New. Names the shared item, links to the item, carries a live token. |
| `server/emails/templates/InviteExpiredEmail.tsx` | New. Sent to whoever can act, with a Resend call to action. |
| `shared/types.ts` | Add `NotificationEventType.InviteExpired` and its entry in `NotificationEventDefaults`. |
| `server/queues/processors/EmailsProcessor.ts` | One new case dispatching `InviteExpiredEmail`. This is what makes the in-app notification and the email come from one event. |
| `server/routes/api/users/users.ts` | `users.resendInvite` gains the rate limiter, the cooldown check, the raised ceiling, the correct per-role email, and the re-anchor. |
| `server/policies/user.ts` | `resendInvite` also allows a Manage holder on an item the guest holds. |
| `server/presenters/user.ts` | Present the derived `inviteExpiresAt` so the client need not know the window rule. |
| `app/components/Sharing/**` | Pending guests listed with a Pending or Expired status and a Resend action, shown only to those who can invite. |

### The cadence engine

`InviteReminderTask` stays a daily cron and grows a branch, rather than gaining
a sibling task. It already selects invited users; the only query change is the
age range, which must widen from "2 to 3 days" to "not yet expired", since a
member reminder is due at day 20.

Per user, in order:

1. Skip if accepted, suspended, or deleted.
2. If the window has ended and `InviteExpiryNotified` is unset, notify and set
   the flag.
3. Otherwise, if `ageDays >= schedule[remindersSent]`, send the reminder for
   that role and increment `InviteReminderSent`.

Both steps are pure functions of `(role, inviteLastSentAt, flags)`, so they are
unit-testable without a database.

Reminders use the same live token as the original invite. Because the token TTL
is derived from the window, a reminder sent on day 6 carries a link that
expires at day 7, and no reminder can outlive its invite. This is why the
window is anchored to the invite rather than to each send.

### Expiry notice recipients

The inviter (`invitedById`), plus, for guests, every user holding the
`inviteGuest` ability on a collection or document the guest holds, deduplicated.
For members, the inviter is sufficient; there is no item manager to tell.

Gated by `subscribedToEventType` like every other notification, so a manager who
does not want these can turn them off through the existing preference UI.

### Resend

`users.resendInvite` becomes, in order: rate limit, authorize, reject if within
the cooldown, reject past the ceiling, send, re-anchor, reset reminders.

- Rate limiter: `TenPerHour` per IP, matching `users.delete`. The route has none
  today, which is a larger gap than the count cap ever was.
- Cooldown: reject when `now < inviteLastSentAt + 24h`, with a message naming
  when it can be retried.
- Ceiling: reject when `InviteSent >= 10`. Replaces the current `> 2`, which is
  arbitrary and not industry practice.
- Email: guests get `GuestInviteEmail`; members keep `InviteEmail`. Today the
  route always sends the workspace email, so a guest resend would tell an
  outside collaborator to join the workspace, which is the exact confusion the
  guest sharing work set out to remove.
- Re-anchor: `inviteLastSentAt = now`, `InviteReminderSent = 0`,
  `InviteSent += 1`, `InviteExpiryNotified = 0`. Resetting the reminder counter
  is what makes the guest see the day 2, 4, 6 cadence again on the new window.

## Edge cases

- **Resend after expiry.** The normal path. Re-anchors, and the guest's existing
  account and grant mean no duplicate membership is created.
- **Accept on the last day.** Acceptance is checked first, so a reminder and an
  expiry notice can never follow it.
- **Reminder due and expired in the same run.** Step 2 wins; the invite is over
  and no reminder is sent for a dead link.
- **Guest holds several items.** One reminder per person, not per item. The
  email names the item from the guest's most recently created membership and
  links to it. The expiry notice tells the
  inviter and every manager of every item the guest holds, so no one is left
  thinking the guest still has access.
- **Guest with a group-derived grant.** Unchanged from the guest sharing spec:
  groups are not considered by the removal prompt, and the expiry notice
  recipients are computed from direct memberships only.
- **The clock is per person, not per grant.** `inviteLastSentAt` lives on the
  user, so inviting a guest who already holds one item to a second item resets
  their window and reminder count for both. That is intended: the guest has just
  been emailed, so the lifecycle restarts. A per-grant clock would need a column
  on the membership tables and a separate cadence per person, which is not worth
  it for this behaviour.
- **Expired invite and the token.** Once the window ends, a token signed from it
  would be already-expired. Reminders stop at expiry and resend re-anchors
  before issuing a token, so this is only reachable through the accept path with
  a stale token, which correctly fails as it does today.
- **A guest who never receives mail.** The invite still expires on schedule. The
  manager is told, which is the point of the notice.
- **Clock skew and cron restarts.** Both steps are idempotent and flag-guarded,
  so a missed or doubled run cannot double-send.

## Testing

Unit tests, collocated:

- Cadence boundaries per role: day 1, 2, 3, 4, 6, 7, 8 for guests; day 2, 3, 9,
  10, 19, 20, 21 for members. Assert exactly the due reminders fire.
- Token TTL: guest token expires at the window end, not 30 days; member token
  at 30; a user with no `inviteLastSentAt` still gets 30 days.
- Expiry notice: fires once, sets the flag, does not fire for accepted users,
  reaches the inviter and every manager of every item the guest holds, and
  dedupes a manager who is also the inviter.
- Resend: refused inside the cooldown, allowed after; refused at the ceiling;
  allowed for a Manage holder; refused for an unrelated member; refused for a
  guest; re-anchors the window, resets reminders, and keeps the send count.
- Migration backfill: an invite that expired pre-deploy is not notified.

Existing test that must change: `server/queues/tasks/InviteReminderTask.test.ts`
asserts exactly one reminder and builds invites aged 84 and 60 hours. Widening
the query to the full window makes the 84-hour invite eligible at day 3, so the
expectation changes. The test's intent (send once, do not repeat on a second
run) is preserved; the count and fixtures are updated.

The existing single-reminder copy in `InviteReminderEmail` also has to go. It
currently ends with "We only send a reminder once", which becomes untrue for
members under the day 3 / 10 / 20 schedule.

## Rollout

The migration is additive and safe to run ahead of the code. The backfill flag
is the only irreversible part, and it only suppresses notifications nobody was
promised. No feature flag; the behaviour is behind the invite path that already
exists.

## Deliberate simplifications

- Windows and cadences are constants in code, not settings. Add configurability
  when a second real value is needed.
- The expiry notice is a single event type covering guests and members. If their
  copy needs to diverge substantially, split it then.
- Group-derived guest access is still ignored by the lifecycle, matching the
  existing guest removal prompt.
