import { AuthorizationError, ServiceUnavailableError } from "~/utils/errors";
import { isSignedOutError } from "./useVaultWorkspaces";

describe("isSignedOutError", () => {
  it("treats ApiClient AuthorizationError as signed out", () => {
    // ApiClient collapses 401 and 403 responses into this class without a
    // status field, which is what anonymous vault probes receive.
    expect(isSignedOutError(new AuthorizationError())).toBe(true);
  });

  it("treats raw 401 and 403 statuses as signed out", () => {
    expect(isSignedOutError(Object.assign(new Error("nope"), { status: 403 }))).toBe(true);
    expect(isSignedOutError(Object.assign(new Error("nope"), { status: 401 }))).toBe(true);
  });

  it("treats server faults as real errors", () => {
    expect(isSignedOutError(new ServiceUnavailableError())).toBe(false);
    expect(isSignedOutError(new Error("boom"))).toBe(false);
    expect(isSignedOutError(new TypeError("Failed to fetch"))).toBe(false);
  });
});
