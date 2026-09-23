import { client } from "~/utils/ApiClient";
import { AuthorizationError, ServiceUnavailableError } from "~/utils/errors";
import {
  fetchVaultWorkspaces,
  isSignedOutError,
  requestVaultTransfer,
} from "./useVaultWorkspaces";

// ApiClient resolves with the whole response body, so payloads sit under
// `data` exactly as the vault endpoints send them.
describe("vault API responses", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads workspaces from the data envelope", async () => {
    const workspaces = [
      {
        id: "t1",
        name: "TIN",
        avatarUrl: null,
        url: "https://tin.docs.tin.info",
        slug: "tin",
      },
    ];
    vi.spyOn(client, "post").mockResolvedValue({
      data: { email: "mira@tin.info", workspaces },
    });

    await expect(fetchVaultWorkspaces()).resolves.toEqual({
      email: "mira@tin.info",
      workspaces,
    });
  });

  it("reads the handoff URL from the data envelope", async () => {
    vi.spyOn(client, "post").mockResolvedValue({
      data: { url: "https://tin.docs.tin.info/auth/redirect?token=abc" },
    });

    await expect(requestVaultTransfer("t1")).resolves.toBe(
      "https://tin.docs.tin.info/auth/redirect?token=abc"
    );
  });
});

describe("isSignedOutError", () => {
  it("treats ApiClient AuthorizationError as signed out", () => {
    // ApiClient collapses 401 and 403 responses into this class without a
    // status field, which is what anonymous vault probes receive.
    expect(isSignedOutError(new AuthorizationError())).toBe(true);
  });

  it("treats raw 401 and 403 statuses as signed out", () => {
    expect(
      isSignedOutError(Object.assign(new Error("nope"), { status: 403 }))
    ).toBe(true);
    expect(
      isSignedOutError(Object.assign(new Error("nope"), { status: 401 }))
    ).toBe(true);
  });

  it("treats server faults as real errors", () => {
    expect(isSignedOutError(new ServiceUnavailableError())).toBe(false);
    expect(isSignedOutError(new Error("boom"))).toBe(false);
    expect(isSignedOutError(new TypeError("Failed to fetch"))).toBe(false);
  });
});
