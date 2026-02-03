import { describe, it, expect } from "vitest";
import { uuidv7 } from "./uuid";

describe("uuidv7", () => {
  it("generates valid UUID format", () => {
    const uuid = uuidv7();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(uuid).toMatch(uuidRegex);
  });

  it("generates unique UUIDs", () => {
    const uuids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      uuids.add(uuidv7());
    }
    expect(uuids.size).toBe(1000);
  });

  it("has version 7 in the correct position", () => {
    const uuid = uuidv7();
    // Version is the 13th character (index 14 after the second dash)
    expect(uuid[14]).toBe("7");
  });

  it("has correct variant bits", () => {
    const uuid = uuidv7();
    // Variant is the 17th character (index 19 after the third dash)
    // Should be 8, 9, a, or b
    expect(["8", "9", "a", "b"]).toContain(uuid[19]);
  });

  it("is time-sortable (UUIDs generated later sort after earlier ones)", () => {
    const uuid1 = uuidv7();
    // Small delay to ensure different timestamp
    const start = Date.now();
    while (Date.now() === start) {
      // Wait for next millisecond
    }
    const uuid2 = uuidv7();

    // When sorted as strings, uuid2 should come after uuid1
    expect(uuid1 < uuid2).toBe(true);
  });

  it("embeds timestamp in first 48 bits", () => {
    const before = Date.now();
    const uuid = uuidv7();
    const after = Date.now();

    // Extract timestamp from UUID
    const hex = uuid.replace(/-/g, "").slice(0, 12);
    const timestamp = parseInt(hex, 16);

    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });
});
