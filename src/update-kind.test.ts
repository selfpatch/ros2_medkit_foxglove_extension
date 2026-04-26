// Copyright 2024-2026 Selfpatch GmbH. Apache-2.0 license.

import { describe, expect, it } from "vitest";
import { deriveKind } from "./update-kind";

describe("deriveKind", () => {
  it("returns Update from updated_components", () => {
    expect(deriveKind({ updated_components: ["a"] })).toBe("Update");
  });
  it("returns Install from added_components", () => {
    expect(deriveKind({ added_components: ["a"] })).toBe("Install");
  });
  it("returns Uninstall from removed_components", () => {
    expect(deriveKind({ removed_components: ["a"] })).toBe("Uninstall");
  });
  it("returns Unknown when none populated", () => {
    expect(deriveKind({})).toBe("Unknown");
  });
  it("returns Unknown when multiple populated", () => {
    expect(deriveKind({ added_components: ["a"], removed_components: ["b"] })).toBe("Unknown");
  });
  it("treats empty arrays as not-populated", () => {
    expect(deriveKind({ updated_components: [] })).toBe("Unknown");
  });
});
