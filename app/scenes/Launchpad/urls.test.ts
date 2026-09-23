import { isValidWorkspaceSlug, tenantOriginFor } from "./urls";

describe("isValidWorkspaceSlug", () => {
  it("accepts letters, digits and dashes", () => {
    expect(isValidWorkspaceSlug("programming")).toBe(true);
    expect(isValidWorkspaceSlug("client-42")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isValidWorkspaceSlug("Bad Slug!")).toBe(false);
    expect(isValidWorkspaceSlug("")).toBe(false);
    expect(isValidWorkspaceSlug("a".repeat(64))).toBe(false);
    expect(isValidWorkspaceSlug("under_score")).toBe(false);
  });
});

describe("tenantOriginFor", () => {
  it("prefixes the slug onto the current host and port", () => {
    const { protocol, hostname, port } = window.location;
    expect(tenantOriginFor("programming")).toEqual(
      `${protocol}//programming.${hostname}${port ? `:${port}` : ""}`
    );
  });
});
