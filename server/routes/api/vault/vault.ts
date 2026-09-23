import Router from "koa-router";
import { AuthorizationError } from "@server/errors";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import validate from "@server/middlewares/validate";
import { Team, User } from "@server/models";
import type { APIContext } from "@server/types";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import {
  clearVaultSessionCookie,
  verifyVaultSession,
} from "@server/utils/vault";
import * as T from "./schema";

const router = new Router();

/**
 * Resolve the verified identity for vault endpoints: the apex vault session
 * cookie first, then any regular authenticated session.
 *
 * @param ctx The API context.
 * @returns The verified email address, or undefined when unauthenticated.
 */
async function resolveVaultEmail(
  ctx: APIContext
): Promise<string | undefined> {
  const vault = verifyVaultSession(ctx);

  if (vault) {
    return vault.email;
  }

  const user = ctx.state.auth?.user;

  if (!user || user.isSuspended || !user.email) {
    return undefined;
  }

  return user.email;
}

router.post(
  "vault.workspaces",
  rateLimiter(RateLimiterStrategy.TenPerMinute),
  auth({ optional: true }),
  validate(T.VaultsWorkspacesSchema),
  async (ctx: APIContext<T.VaultsWorkspacesReq>) => {
    const email = await resolveVaultEmail(ctx);

    if (!email) {
      throw AuthorizationError();
    }

    const accounts = await User.findAll({
      where: { email },
      include: [{ association: "team", required: true }],
    });

    ctx.body = {
      data: {
        email,
        workspaces: accounts.flatMap((account) => {
          const { subdomain } = account.team;

          if (!subdomain || account.isSuspended || account.team.isSuspended) {
            return [];
          }

          return [
            {
              id: account.teamId,
              name: account.team.name,
              avatarUrl: account.team.avatarUrl,
              url: account.team.url,
              slug: subdomain,
            },
          ];
        }),
      },
    };
  }
);

router.post(
  "vault.transfer",
  rateLimiter(RateLimiterStrategy.TenPerMinute),
  auth({ optional: true }),
  validate(T.VaultsTransferSchema),
  async (ctx: APIContext<T.VaultsTransferReq>) => {
    const { teamId } = ctx.input.body;
    const email = await resolveVaultEmail(ctx);

    if (!email) {
      throw AuthorizationError();
    }

    const team = await Team.findByPk(teamId);

    // Only tenant subdomains of this installation may be handed off to; the
    // URL is built from the team record so it can never be an open redirect.
    if (!team || !team.subdomain || team.domain || team.isSuspended) {
      throw AuthorizationError();
    }

    const target = await User.findOne({ where: { email, teamId } });

    if (!target || target.isSuspended) {
      throw AuthorizationError();
    }

    const token = encodeURIComponent(target.getTransferToken("vault"));
    ctx.body = {
      data: {
        url: `${team.url}/auth/redirect?token=${token}`,
      },
    };
  }
);

router.post(
  "vault.logout",
  auth({ optional: true }),
  validate(T.VaultsLogoutSchema),
  async (ctx: APIContext<T.VaultsLogoutReq>) => {
    clearVaultSessionCookie(ctx);
    ctx.body = {
      success: true,
    };
  }
);

export default router;
