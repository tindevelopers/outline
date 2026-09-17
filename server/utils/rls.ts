import type { Sequelize, Transaction } from "sequelize";
import type { TenantContext } from "@server/storage/requestContext";

/**
 * Re-points the tenant identity for the remainder of the given transaction,
 * overriding the tenant resolved for the request. Used when a request
 * legitimately creates rows for a different team than the actor's own, such as
 * when an existing user creates a brand-new team (the new team's user belongs
 * to that new team, whose id differs from the actor's `app.team_id`).
 *
 * The new value is scoped to the transaction (`SET LOCAL`), so it does not
 * leak to other consumers sharing the same pooled connection.
 *
 * This deliberately avoids importing the shared `sequelize` instance from
 * `@server/storage/database`, which would reintroduce a module-init cycle for
 * modules that are loaded during model registration; the transaction's owner
 * instance is used instead.
 *
 * @param transaction The transaction to apply the tenant context to.
 * @param tenant The tenant identity to enforce for the transaction.
 * @returns A promise that resolves when the context is set.
 */
export async function setTenantForTransaction(
  transaction: Transaction,
  tenant: TenantContext
): Promise<void> {
  const db = (transaction as Transaction & { sequelize: Sequelize }).sequelize;
  await db.query(
    `SET LOCAL app.team_id = '${tenant.teamId.replace(/'/g, "''")}'`,
    {
      transaction,
    }
  );
}
