import { subHours, subMinutes } from "date-fns";
import Router from "koa-router";
import { uniqBy } from "es-toolkit/compat";
import { TeamPreference } from "@shared/types";
import { parseDomain } from "@shared/utils/domains";
import env from "@server/env";
import auth from "@server/middlewares/authentication";
import { transaction } from "@server/middlewares/transaction";
import { Event, Team } from "@server/models";
import AuthenticationHelper from "@server/models/helpers/AuthenticationHelper";
import {
  presentUser,
  presentTeam,
  presentPolicies,
  presentProviderConfig,
  presentAvailableTeam,
  presentGroup,
  presentGroupUser,
} from "@server/presenters";
import ValidateSSOAccessTask from "@server/queues/tasks/ValidateSSOAccessTask";
import type { APIContext } from "@server/types";
import { AuthenticationType } from "@server/types";
import { getSessionsInCookie } from "@server/utils/authentication";
import { isVaultMode } from "@server/utils/vault";
import RateLimiter from "@server/utils/RateLimiter";
import type * as T from "./schema";

const router = new Router();

router.post("auth.config", async (ctx: APIContext<T.AuthConfigReq>) => {
  const domain = parseDomain(ctx.request.hostname);

  if (domain.custom) {
    const team = await Team.scope("withAuthenticationProviders").findOne({
      where: {
        domain: ctx.request.hostname.toLowerCase(),
      },
    });

    if (team) {
      ctx.body = {
        data: {
          name: team.getPreference(TeamPreference.PublicBranding)
            ? team.name
            : undefined,
          customTheme: team.getPreference(TeamPreference.CustomTheme),
          logo: team.getPreference(TeamPreference.PublicBranding)
            ? team.avatarUrl
            : undefined,
          hostname: ctx.request.hostname,
          providers: (await AuthenticationHelper.providersForTeam(team)).map(
            presentProviderConfig
          ),
        },
      };
      return;
    }
  }

  // If subdomain signin page then we return minimal team details to allow
  // for a custom screen showing only relevant signin options for that team.
  // Enabled for self-hosted installs so per-tenant subdomains work
  // (e.g. `tin.localhost:3000` locally).
  if (domain.teamSubdomain) {
    const team = await Team.scope("withAuthenticationProviders").findOne({
      where: {
        subdomain: domain.teamSubdomain,
      },
    });

    if (team) {
      ctx.body = {
        data: {
          name: team.getPreference(TeamPreference.PublicBranding)
            ? team.name
            : undefined,
          customTheme: team.getPreference(TeamPreference.CustomTheme),
          logo: team.getPreference(TeamPreference.PublicBranding)
            ? team.avatarUrl
            : undefined,
          hostname: ctx.request.hostname,
          providers: (await AuthenticationHelper.providersForTeam(team)).map(
            presentProviderConfig
          ),
        },
      };
      return;
    }

    // An unknown tenant subdomain in vault mode must be indistinguishable
    // from a workspace the visitor lacks access to: no team details at all.
    if (await isVaultMode()) {
      ctx.body = {
        data: {
          hostname: ctx.request.hostname,
          workspaceNotFound: true,
          providers: (await AuthenticationHelper.providersForTeam()).map(
            presentProviderConfig
          ),
        },
      };
      return;
    }
  }

  // Fallback for single-team / unsubdomained self-hosted installs: if the
  // request host is the apex and isn't a custom or tenant subdomain, the
  // latest (only) team becomes the brand for the root signin page.
  if (!env.isCloudHosted) {
    // In vault mode the apex is the neutral Launchpad: no team branding, and
    // the client learns it must render the vault experience.
    if (await isVaultMode()) {
      // Email sign-in has no passport provider and no single team at the
      // apex, so it is offered when any workspace enables it; the vault
      // email flow then routes by membership on callback.
      const includeEmail =
        env.EMAIL_ENABLED &&
        (await Team.count({ where: { guestSignin: true } })) > 0;

      ctx.body = {
        data: {
          vault: true,
          accessEmail: env.VAULT_ACCESS_EMAIL || undefined,
          providers: (
            await AuthenticationHelper.providersForTeam(undefined, {
              includeEmail,
            })
          ).map(presentProviderConfig),
        },
      };
      return;
    }

    const team = await Team.scope("withAuthenticationProviders").findOne({
      order: [["createdAt", "DESC"]],
    });

    if (team) {
      ctx.body = {
        data: {
          name: team.name,
          customTheme: team.getPreference(TeamPreference.CustomTheme),
          logo: team.getPreference(TeamPreference.PublicBranding)
            ? team.avatarUrl
            : undefined,
          providers: (await AuthenticationHelper.providersForTeam(team)).map(
            presentProviderConfig
          ),
        },
      };
      return;
    }
  }

  // Otherwise, we're requesting from the standard root signin page
  ctx.body = {
    data: {
      providers: (await AuthenticationHelper.providersForTeam()).map(
        presentProviderConfig
      ),
    },
  };
});

/** Authentication services that don't require SSO validation. */
const NON_SSO_SERVICES = ["email", "passkeys"];

router.post("auth.info", auth(), async (ctx: APIContext<T.AuthInfoReq>) => {
  const { user, service, type } = ctx.state.auth;
  const sessions = getSessionsInCookie(ctx);
  const signedInTeamIds = Object.keys(sessions);

  const [team, groups, signedInTeams, availableTeams] = await Promise.all([
    Team.scope("withDomains").findByPk(user.teamId, {
      rejectOnEmpty: true,
    }),
    user.groups(),
    Team.findAll({
      where: {
        id: signedInTeamIds,
      },
    }),
    user.availableTeams(),
  ]);

  // If the user did not _just_ sign in then we need to check if they continue
  // to have access to the workspace they are signed into. This only applies
  // to SSO sessions - email and passkey logins don't have associated
  // UserAuthentication records that need validation.
  const requiresSSOValidation = !service || !NON_SSO_SERVICES.includes(service);
  if (
    requiresSSOValidation &&
    user.lastSignedInAt &&
    user.lastSignedInAt < subHours(new Date(), 1)
  ) {
    await new ValidateSSOAccessTask()
      .schedule(
        {
          userId: user.id,
        },
        {
          jobId: `validate-sso:${user.id}`,
        }
      )
      .catch(() => {
        // Ignore errors from duplicate jobId when a validation is already queued
      });
  }

  ctx.body = {
    data: {
      user: presentUser(user, {
        includeDetails: true,
      }),
      team: presentTeam(team),
      groups: await Promise.all(groups.map(presentGroup)),
      groupUsers: groups.map((group) => presentGroupUser(group.groupUsers[0])),
      // The collaboration token is only for the client and should not be issued
      // to API or OAuth consumers
      collaborationToken:
        type === AuthenticationType.APP
          ? user.getCollaborationToken()
          : undefined,
      availableTeams: uniqBy([...signedInTeams, ...availableTeams], "id").map(
        (availableTeam) =>
          presentAvailableTeam(
            availableTeam,
            signedInTeamIds.includes(team.id) ||
              availableTeam.id === user.teamId
          )
      ),
    },
    policies: presentPolicies(user, [team, user, ...groups]),
  };
});

router.post(
  "auth.delete",
  auth(),
  transaction(),
  async (ctx: APIContext<T.AuthDeleteReq>) => {
    const { auth, transaction } = ctx.state;
    const { user, token } = auth;

    await user.rotateJwtSecret({ transaction });
    await Event.createFromContext(ctx, {
      name: "users.signout",
      userId: user.id,
      data: {
        name: user.name,
      },
    });

    void RateLimiter.clearCachedToken(token);

    ctx.cookies.set("accessToken", "", {
      sameSite: "lax",
      expires: subMinutes(new Date(), 1),
    });

    ctx.body = {
      success: true,
    };
  }
);

export default router;
