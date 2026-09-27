import { addHours, subHours } from "date-fns";
import { randomString } from "@shared/random";
import { Scope } from "@shared/types";
import { buildApiKey, buildUser } from "@server/test/factories";
import { withAPIContext } from "@server/test/support";
import { hash } from "@server/utils/crypto";
import ApiKey from "./ApiKey";

describe("#ApiKey", () => {
  describe("match", () => {
    it("should match an API secret", async () => {
      const apiKey = await buildApiKey();
      expect(ApiKey.match(apiKey.value!)).toBe(true);
      expect(ApiKey.match(`${randomString(38)}`)).toBe(true);
    });

    it("should not match non secrets", async () => {
      expect(ApiKey.match("123")).toBe(false);
      expect(ApiKey.match("1234567890")).toBe(false);
    });
  });

  describe("lastActiveAt", () => {
    it("should update lastActiveAt", async () => {
      const apiKey = await buildApiKey();
      await apiKey.updateActiveAt();
      expect(apiKey.lastActiveAt).toBeTruthy();
    });

    it("should not update lastActiveAt within 5 minutes", async () => {
      const apiKey = await buildApiKey();
      await apiKey.updateActiveAt();
      expect(apiKey.lastActiveAt).toBeTruthy();

      const lastActiveAt = apiKey.lastActiveAt;
      await apiKey.updateActiveAt();
      expect(apiKey.lastActiveAt).toEqual(lastActiveAt);
    });
  });

  describe("findByToken", () => {
    it("should find by hash", async () => {
      const apiKey = await buildApiKey({
        name: "Dev",
      });
      const found = await ApiKey.findByToken(apiKey.value!);
      expect(found?.id).toEqual(apiKey.id);
      expect(found?.last4).toEqual(apiKey.value!.slice(-4));
    });
  });

  describe("canAccess", () => {
    it("should account for query string", async () => {
      const apiKey = await buildApiKey({
        name: "Dev",
        scope: ["/api/documents.info"],
      });

      expect(apiKey.canAccess("/api/documents.info?foo=bar")).toBe(true);
    });

    it("should return true for all resources if no scope", async () => {
      const apiKey = await buildApiKey({
        name: "Dev",
      });

      expect(apiKey.canAccess("/api/documents.info")).toBe(true);
      expect(apiKey.canAccess("/api/collections.create")).toBe(true);
      expect(apiKey.canAccess("/api/apiKeys.list")).toBe(true);
    });

    it("should return false if no matching scope", async () => {
      const apiKey = await buildApiKey({
        name: "Dev",
        scope: ["/api/documents.info"],
      });

      expect(apiKey.canAccess("/api/documents.info")).toBe(true);
      expect(apiKey.canAccess("/api/collections.create")).toBe(false);
      expect(apiKey.canAccess("/api/apiKeys.list")).toBe(false);
    });

    it("should allow wildcard methods", async () => {
      const apiKey = await buildApiKey({
        name: "Dev",
        scope: ["/api/documents.*"],
      });

      expect(apiKey.canAccess("/api/documents.info")).toBe(true);
      expect(apiKey.canAccess("/api/documents.create")).toBe(true);
      expect(apiKey.canAccess("/api/collections.create")).toBe(false);
    });

    it("should allow wildcard namespaces", async () => {
      const apiKey = await buildApiKey({
        name: "Dev",
        scope: ["/api/*.info"],
      });

      expect(apiKey.canAccess("/api/documents.info")).toBe(true);
      expect(apiKey.canAccess("/api/documents.create")).toBe(false);
      expect(apiKey.canAccess("/api/collections.create")).toBe(false);
    });

    it("should allow multiple scopes", async () => {
      const apiKey = await buildApiKey({
        name: "Dev",
        scope: ["/api/*.info", "/api/collections.list"],
      });

      expect(apiKey.canAccess("/api/shares.info")).toBe(true);
      expect(apiKey.canAccess("/api/documents.info")).toBe(true);
      expect(apiKey.canAccess("/api/collections.list")).toBe(true);
      expect(apiKey.canAccess("/api/documents.create")).toBe(false);
      expect(apiKey.canAccess("/api/collections.create")).toBe(false);
    });

    it("should allow MCP access for scoped API keys", async () => {
      const apiKey = await buildApiKey({
        name: "Dev",
        scope: [Scope.Read],
      });

      expect(apiKey.canAccess("/mcp")).toBe(true);
      expect(apiKey.canAccess("/mcp/")).toBe(true);
    });

    it("should allow MCP access for unscoped API keys", async () => {
      const apiKey = await buildApiKey({
        name: "Dev",
      });

      expect(apiKey.canAccess("/mcp")).toBe(true);
    });

    it("should not allow MCP access when no scope is well-formed", async () => {
      const apiKey = await buildApiKey({
        name: "Dev",
        scope: [Scope.Read],
      });
      apiKey.scope = ["documents:read,documents:write"];

      expect(apiKey.canAccess("/mcp")).toBe(false);
      expect(apiKey.canAccess("/api/documents.info")).toBe(false);
    });
  });

  describe("scope", () => {
    it("should reject malformed scopes", async () => {
      await expect(
        buildApiKey({
          name: "Dev",
          scope: ["documents:read,documents:write"],
        })
      ).rejects.toThrow("Scope must be a valid API scope");
    });

    it("should accept well-formed scopes", async () => {
      const apiKey = await buildApiKey({
        name: "Dev",
        scope: ["documents:read", "/api/users.info", Scope.Write],
      });

      expect(apiKey.scope).toEqual([
        "documents:read",
        "/api/users.info",
        Scope.Write,
      ]);
    });
  });

  describe("findByToken with a previous secret", () => {
    it("should find by the previous hash within the grace period", async () => {
      const apiKey = await buildApiKey();
      const previous = `${ApiKey.prefix}${randomString(38)}`;
      apiKey.previousHash = hash(previous);
      apiKey.previousHashExpiresAt = addHours(new Date(), 1);
      await apiKey.save();

      const found = await ApiKey.findByToken(previous);
      expect(found?.id).toEqual(apiKey.id);
    });

    it("should not find by the previous hash after the grace period", async () => {
      const apiKey = await buildApiKey();
      const previous = `${ApiKey.prefix}${randomString(38)}`;
      apiKey.previousHash = hash(previous);
      apiKey.previousHashExpiresAt = subHours(new Date(), 1);
      await apiKey.save();

      expect(await ApiKey.findByToken(previous)).toBeFalsy();
    });

    it("should not find by the previous hash when no expiry is set", async () => {
      const apiKey = await buildApiKey();
      const previous = `${ApiKey.prefix}${randomString(38)}`;
      apiKey.previousHash = hash(previous);
      apiKey.previousHashExpiresAt = null;
      await apiKey.save();

      expect(await ApiKey.findByToken(previous)).toBeFalsy();
    });
  });

  describe("rotate", () => {
    it("should replace the secret and discard the previous one immediately", async () => {
      const user = await buildUser();
      const apiKey = await buildApiKey({ userId: user.id });
      const previous = apiKey.value!;

      await withAPIContext(user, (ctx) => apiKey.rotate(ctx, 0));

      expect(apiKey.value).not.toEqual(previous);
      expect(apiKey.previousHash).toBeNull();
      expect(apiKey.previousHashExpiresAt).toBeNull();
      expect(await ApiKey.findByToken(previous)).toBeFalsy();
      expect(await ApiKey.findByToken(apiKey.value!)).toBeTruthy();
    });

    it("should retain the previous secret for the grace period", async () => {
      const user = await buildUser();
      const apiKey = await buildApiKey({ userId: user.id });
      const previous = apiKey.value!;

      await withAPIContext(user, (ctx) => apiKey.rotate(ctx, 48));

      expect(apiKey.value).not.toEqual(previous);
      expect(apiKey.previousHash).toBeTruthy();
      expect(apiKey.previousHashExpiresAt).toBeInstanceOf(Date);
      expect(apiKey.previousHashExpiresAt!.getTime()).toBeGreaterThan(
        Date.now()
      );
      const found = await ApiKey.findByToken(previous);
      expect(found?.id).toEqual(apiKey.id);
    });

    it("should discard the first previous secret on a second rotation", async () => {
      const user = await buildUser();
      const apiKey = await buildApiKey({ userId: user.id });
      const first = apiKey.value!;

      await withAPIContext(user, (ctx) => apiKey.rotate(ctx, 48));
      const second = apiKey.value!;
      await withAPIContext(user, (ctx) => apiKey.rotate(ctx, 48));

      expect(await ApiKey.findByToken(first)).toBeFalsy();
      expect(await ApiKey.findByToken(second)).toBeTruthy();
      expect(await ApiKey.findByToken(apiKey.value!)).toBeTruthy();
    });
  });
});
