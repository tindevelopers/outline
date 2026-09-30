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
