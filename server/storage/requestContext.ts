import { AsyncLocalStorage } from "node:async_hooks";
import type { IncomingMessage } from "node:http";
import type { Transaction } from "sequelize";

/**
 * Tenant context resolved by the authentication middleware for the current
 * request. When present, database transactions for the request enforce
 * row-level security keyed on `teamId`.
 */
export type TenantContext = {
  /** The id of the authenticated user's team. */
  teamId: string;
  /** Whether the authenticated user has platform-wide access. */
  isPlatformAdmin: boolean;
};

/**
 * Async local storage for the current HTTP request context. This allows
 * downstream code (e.g. Sequelize hooks and the transaction wrapper) to check
 * whether the originating request is still alive without explicitly threading
 * `ctx` through every call, and to read the tenant resolved for the request so
 * transactions can set `app.team_id` for row-level security.
 */
export const requestContext = new AsyncLocalStorage<{
  req: IncomingMessage;
  tenant?: TenantContext;
  transaction?: Transaction;
}>();
