import ApiKey from "./ApiKey";
import stores from "~/stores";

describe("ApiKey model", () => {
  describe("isFullAccess", () => {
    const make = (scope?: string[] | null) =>
      new ApiKey({ id: "1", name: "key", scope }, stores.apiKeys);

    test("true when scope is null or undefined", () => {
      expect(make(null).isFullAccess).toBe(true);
      expect(make(undefined).isFullAccess).toBe(true);
    });

    test("true for the wildcard scope", () => {
      expect(make(["*"]).isFullAccess).toBe(true);
    });

    test("false for restricted and empty scopes", () => {
      expect(make(["documents:read"]).isFullAccess).toBe(false);
      expect(make([]).isFullAccess).toBe(false);
    });
  });
});
