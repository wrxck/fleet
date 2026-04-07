import { describe, it, expect } from "vitest";

import { fuzzyMatch } from "../src/fuzzy-match.js";

describe("fuzzyMatch", () => {
  it("matches exact string", () => {
    const result = fuzzyMatch("hello", "hello");
    expect(result.matches).toBeTruthy();
    expect(result.indices).toEqual([0, 1, 2, 3, 4]);
  });

  it("matches fuzzy (chars in order)", () => {
    const result = fuzzyMatch("hlo", "hello");
    expect(result.matches).toBeTruthy();
    expect(result.indices).toEqual([0, 2, 4]);
  });

  it("returns false for non-matching", () => {
    const result = fuzzyMatch("xyz", "hello");
    expect(result.matches).toBeFalsy();
    expect(result.score).toBe(0);
    expect(result.indices).toEqual([]);
  });

  it("scores consecutive matches higher", () => {
    const consecutive = fuzzyMatch("hel", "hello");
    const scattered = fuzzyMatch("hlo", "hello");
    expect(consecutive.score).toBeGreaterThan(scattered.score);
  });

  it("is case insensitive", () => {
    const result = fuzzyMatch("HEL", "hello");
    expect(result.matches).toBeTruthy();
    expect(result.indices).toEqual([0, 1, 2]);
  });
});
