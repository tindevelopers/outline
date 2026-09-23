import * as React from "react";
import { client } from "~/utils/ApiClient";
import { AuthorizationError } from "~/utils/errors";

export type VaultWorkspace = {
  id: string;
  name: string;
  avatarUrl: string | null;
  url: string;
  slug: string;
};

export type VaultState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "error" }
  | { status: "ready"; email: string; workspaces: VaultWorkspace[] };

/**
 * Reads the HTTP status from an ApiClient error, if present.
 *
 * @param err The thrown value.
 * @returns The status code, or undefined when absent.
 */
function getStatus(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null && "status" in err) {
    const { status } = err as { status?: unknown };
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

/**
 * Reports whether a failed vault.workspaces call simply means "not signed
 * in". ApiClient collapses 401 and 403 responses into its AuthorizationError
 * class without a status field, so both the class and any raw status are
 * checked.
 *
 * @param err The thrown value.
 * @returns true when the visitor should be shown the sign-in card.
 */
export function isSignedOutError(err: unknown): boolean {
  if (err instanceof AuthorizationError) {
    return true;
  }
  const status = getStatus(err);
  return status === 401 || status === 403;
}

/**
 * Loads the workspaces the current vault identity is a member of.
 *
 * @returns The reactive vault state for the Launchpad.
 */
export function useVaultWorkspaces(): VaultState {
  const [state, setState] = React.useState<VaultState>({ status: "loading" });

  React.useEffect(() => {
    let mounted = true;

    client
      .post("/vault.workspaces", {})
      .then((res: { email: string; workspaces: VaultWorkspace[] }) => {
        if (mounted) {
          setState({
            status: "ready",
            email: res.email,
            workspaces: res.workspaces,
          });
        }
      })
      .catch((err: unknown) => {
        if (!mounted) {
          return;
        }
        setState(
          isSignedOutError(err)
            ? { status: "unauthenticated" }
            : { status: "error" }
        );
      });

    return () => {
      mounted = false;
    };
  }, []);

  return state;
}

/**
 * Mints a transfer handoff URL for one of the caller's workspaces.
 *
 * @param teamId The id of the workspace to enter.
 * @returns The tenant URL carrying a short-lived transfer token.
 */
export async function requestVaultTransfer(teamId: string): Promise<string> {
  const res = await client.post("/vault.transfer", { teamId });
  return res.url;
}

/**
 * Ends the vault session on this device and forgets sign-in hints.
 *
 * @returns A promise that settles once the server cookie is cleared.
 */
export async function signOutOfVault(): Promise<void> {
  await client.post("/vault.logout", {}).catch(() => undefined);
  const past = new Date(0).toUTCString();
  const domain = window.location.hostname;
  document.cookie = `sessions=; expires=${past}; path=/; domain=${domain}`;
  document.cookie = `lastSignedIn=; expires=${past}; path=/; domain=${domain}`;
}
