import { shortRevision } from "./buildVersion";

describe("shortRevision", () => {
  it("shortens a full git sha to seven characters", () => {
    expect(shortRevision("666c0fe41cc5ec5ab75f4e95cdfcd403bca20187")).toEqual(
      "666c0fe"
    );
  });

  it("shortens an abbreviated sha without changing it", () => {
    expect(shortRevision("666c0fe")).toEqual("666c0fe");
  });

  it("leaves a non-hex version string unchanged", () => {
    expect(shortRevision("v123")).toEqual("v123");
  });

  it("returns undefined when no revision is reported", () => {
    expect(shortRevision(undefined)).toBeUndefined();
    expect(shortRevision("")).toBeUndefined();
  });
});
