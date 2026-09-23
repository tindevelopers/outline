import { addMinutes } from "date-fns";
import JWT from "jsonwebtoken";
import type { Context } from "koa";
import { parseDomain } from "@shared/utils/domains";
import env from "@server/env";
import { Team, User } from "@server/models";

/** The name of the apex-scoped, privilege-free vault session cookie. */
const VAULT_COOKIE = "vaultSession";

/** How long a vault session cookie stays valid. */
const VAULT_TTL_MINUTES = 10;

/** Short-lived cache for the deployment-wide vault mode flag. */
let modeCache: { at: number; value: boolean } | undefined;

export type VaultOutcome =
  | { kind: "single"; user: User; team: Team }
  | { kind: "choice"; email: string }
  | { kind: "none"; email: string };

/**
 * Reports whether this deployment treats the apex host as a neutral vault
 * entry point. True when at least one team exists and no team owns the apex
 * (every team has a subdomain), which is the multi-tenant layout. Single
 * tenant installs, where a team without subdomain is served from the apex,
 * keep the legacy behavior.
 *
 * @returns true when vault mode is active.
 */
export async function isVaultMode(): Promise<boolean> {
  if (modeCache && Date.now() - modeCache.at < 30_000) {
    return modeCache.value;
  }

  const [total, withoutSubdomain] = await Promise.all([
    Team.count(),
    Team.count({ where: { subdomain: null } }),
  ]);
  const value = total > 0 && withoutSubdomain === 0;
  modeCache = { at: Date.now(), value };
  return value;
}

/**
 * Drops the cached vault mode flag so tests and team changes are picked up
 * without waiting for the cache to expire.
 *
 * @returns nothing.
 */
export function resetVaultModeCache(): void {
  modeCache = undefined;
}

/**
 * Reports whether the request arrived on the apex host of a vault mode
 * deployment, where no team may be inferred from the hostname.
 *
 * @param ctx The Koa context.
 * @returns true when the request must be handled by the vault router.
 */
export async function isVaultRequest(ctx: Context): Promise<boolean> {
  const domain = parseDomain(ctx.hostname);

  if (domain.custom || domain.teamSubdomain) {
    return false;
  }

  return domain.host === parseDomain(env.URL).host && (await isVaultMode());
}

/**
 * Creates a signed vault session token carrying only the verified identity.
 * It grants no team access; the vault API endpoints re-check membership.
 *
 * @param email The verified email address of the signer.
 * @param service The authentication service used to verify the email.
 * @returns The signed token string.
 */
export function issueVaultSession(email: string, service: string): string {
  return JWT.sign(
    {
      email,
      service,
      type: "vault",
      createdAt: new Date().toISOString(),
      expiresAt: addMinutes(new Date(), VAULT_TTL_MINUTES).toISOString(),
    },
    env.SECRET_KEY
  );
}

/**
 * Sets the apex-scoped vault session cookie on the response.
 *
 * @param ctx The Koa context.
 * @param email The verified email address of the signer.
 * @param service The authentication service used to verify the email.
 * @returns nothing.
 */
export function setVaultSessionCookie(
  ctx: Context,
  email: string,
  service: string
): void {
  ctx.cookies.set(VAULT_COOKIE, issueVaultSession(email, service), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProduction,
    expires: addMinutes(new Date(), VAULT_TTL_MINUTES),
    domain: parseDomain(env.URL).host,
  });
}

/**
 * Expires the vault session cookie on the response.
 *
 * @param ctx The Koa context.
 * @returns nothing.
 */
export function clearVaultSessionCookie(ctx: Context): void {
  ctx.cookies.set(VAULT_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProduction,
    expires: addMinutes(new Date(), -1),
    domain: parseDomain(env.URL).host,
  });
}

/**
 * Reads and validates the vault session cookie, if present.
 *
 * @param ctx The Koa context.
 * @returns The verified identity, or undefined when absent or invalid.
 */
export function verifyVaultSession(
  ctx: Context
): { email: string; service: string } | undefined {
  const token = ctx.cookies.get(VAULT_COOKIE);

  if (!token) {
    return undefined;
  }

  try {
    const payload = JWT.verify(token, env.SECRET_KEY);

    if (
      typeof payload !== "object" ||
      payload.type !== "vault" ||
      typeof payload.email !== "string" ||
      typeof payload.service !== "string" ||
      typeof payload.expiresAt !== "string" ||
      new Date(payload.expiresAt) < new Date()
    ) {
      return undefined;
    }

    return { email: payload.email, service: payload.service };
  } catch (_err) {
    return undefined;
  }
}

/**
 * Routes an authenticated apex sign-in by membership without provisioning
 * anything. One live membership resolves to that team's user row so the
 * caller can hand off through the existing transfer-token flow; zero or
 * several memberships set a vault session cookie so the client can render
 * the no-access or selector state.
 *
 * @param ctx The Koa context.
 * @param service The authentication service used to sign in.
 * @param email The verified, lowercased email address of the signer.
 * @returns The routing outcome for this identity.
 */
export async function routeVaultSignIn(
  ctx: Context,
  service: string,
  email: string
): Promise<VaultOutcome> {
  const accounts = await User.findAll({
    where: { email },
    include: [{ association: "team", required: true }],
  });
  const live = accounts.filter(
    (account) => !account.isSuspended && !account.team.isSuspended
  );

  if (live.length === 1) {
    return { kind: "single", user: live[0], team: live[0].team };
  }

  setVaultSessionCookie(ctx, email, service);
  return live.length > 1
    ? { kind: "choice", email }
    : { kind: "none", email };
}
