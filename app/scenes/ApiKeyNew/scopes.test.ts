import AuthenticationHelper from "@shared/helpers/AuthenticationHelper";
import {
  ACCESS_AREAS,
  SCOPE_PRESETS,
  emptySelection,
  selectionToScopes,
} from "./scopes";

describe("selectionToScopes", () => {
  it("returns nothing for an empty selection", () => {
    expect(selectionToScopes(emptySelection())).toEqual([]);
  });

  it("returns the wildcard for full access", () => {
    expect(selectionToScopes({ full: true, levels: {} })).toEqual(["*"]);
  });

  it("ignores the area levels when full access is on", () => {
    const selection = emptySelection();
    selection.full = true;
    selection.levels.documents = "read";
    expect(selectionToScopes(selection)).toEqual(["*"]);
  });

  it("maps read, create and write levels to scopes in catalog order", () => {
    const selection = emptySelection();
    selection.levels.collections = "write";
    selection.levels.documents = "create";
    selection.levels.comments = "read";

    expect(selectionToScopes(selection)).toEqual([
      "documents:read",
      "documents:create",
      "collections:write",
      "comments:read",
    ]);
  });

  it("only ever produces well-formed scopes", () => {
    const selection = emptySelection();
    for (const area of ACCESS_AREAS) {
      selection.levels[area.id] = area.canCreate ? "create" : "read";
    }
    for (const scope of selectionToScopes(selection)) {
      expect(AuthenticationHelper.isValidScope(scope)).toBe(true);
    }
  });

  it("never offers create on an area that cannot create", () => {
    const selection = emptySelection();
    selection.levels.revisions = "create";
    // revisions has no create method, so a create level degrades to read
    expect(selectionToScopes(selection)).toEqual(["revisions:read"]);
  });
});

describe("scopes grant exactly what the picker promises", () => {
  it("read lets a key list and fetch but not create or delete", () => {
    const scopes = selectionToScopes({
      full: false,
      levels: { documents: "read" },
    });
    expect(AuthenticationHelper.canAccess("/api/documents.list", scopes)).toBe(
      true
    );
    expect(AuthenticationHelper.canAccess("/api/documents.info", scopes)).toBe(
      true
    );
    expect(
      AuthenticationHelper.canAccess("/api/documents.create", scopes)
    ).toBe(false);
    expect(
      AuthenticationHelper.canAccess("/api/documents.delete", scopes)
    ).toBe(false);
  });

  it("create lets a key read and create but not update or delete", () => {
    const scopes = selectionToScopes({
      full: false,
      levels: { documents: "create" },
    });
    expect(AuthenticationHelper.canAccess("/api/documents.info", scopes)).toBe(
      true
    );
    expect(
      AuthenticationHelper.canAccess("/api/documents.create", scopes)
    ).toBe(true);
    expect(
      AuthenticationHelper.canAccess("/api/documents.update", scopes)
    ).toBe(false);
    expect(
      AuthenticationHelper.canAccess("/api/documents.delete", scopes)
    ).toBe(false);
  });

  it("write covers the whole area but nothing outside it", () => {
    const scopes = selectionToScopes({
      full: false,
      levels: { documents: "write" },
    });
    expect(
      AuthenticationHelper.canAccess("/api/documents.delete", scopes)
    ).toBe(true);
    expect(AuthenticationHelper.canAccess("/api/users.delete", scopes)).toBe(
      false
    );
    expect(AuthenticationHelper.canAccess("/api/users.list", scopes)).toBe(
      false
    );
  });

  it("an area that was not selected stays out of reach", () => {
    const scopes = selectionToScopes({
      full: false,
      levels: { documents: "write" },
    });
    expect(
      AuthenticationHelper.canAccess("/api/collections.list", scopes)
    ).toBe(false);
    expect(AuthenticationHelper.canAccess("/api/apiKeys.list", scopes)).toBe(
      false
    );
  });
});

describe("catalog", () => {
  it("offers only the ten content areas", () => {
    expect(ACCESS_AREAS.map((a) => a.id)).toEqual([
      "documents",
      "collections",
      "comments",
      "attachments",
      "templates",
      "revisions",
      "shares",
      "pins",
      "stars",
      "subscriptions",
    ]);
  });

  it("never offers an admin or identity area", () => {
    const ids = new Set(ACCESS_AREAS.map((a) => a.id));
    for (const sensitive of [
      "users",
      "groups",
      "apiKeys",
      "oauthClients",
      "webhookSubscriptions",
      "fileOperations",
      "teams",
      "integrations",
      "authenticationProviders",
    ]) {
      expect(ids.has(sensitive)).toBe(false);
    }
  });
});

describe("presets", () => {
  const byId = (id: string) => {
    const preset = SCOPE_PRESETS.find((p) => p.id === id);
    if (!preset) {
      throw new Error(`missing preset ${id}`);
    }
    return preset;
  };

  it("read-only reads every catalog area and grants no create or write", () => {
    const scopes = selectionToScopes(byId("read-only").selection());
    expect(scopes).toEqual(ACCESS_AREAS.map((a) => `${a.id}:read`));
  });

  it("read and create documents adds create on documents only", () => {
    const scopes = selectionToScopes(byId("read-create-documents").selection());
    expect(scopes).toContain("documents:create");
    expect(scopes.filter((s) => s.endsWith(":create"))).toEqual([
      "documents:create",
    ]);
    expect(scopes.filter((s) => s.endsWith(":write"))).toEqual([]);
  });

  it("full access is the wildcard", () => {
    expect(selectionToScopes(byId("full").selection())).toEqual(["*"]);
  });

  it("each preset returns a fresh object", () => {
    const preset = byId("read-only");
    expect(preset.selection()).not.toBe(preset.selection());
  });
});
