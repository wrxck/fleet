import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";

import { FuzzySelect } from "../src/fuzzy-select.js";

const items = [
  { label: "Apple", value: "apple" },
  { label: "Banana", value: "banana" },
  { label: "Cherry", value: "cherry" },
  { label: "Date", value: "date" },
  { label: "Elderberry", value: "elderberry" },
];

describe("FuzzySelect", () => {
  it("renders items", () => {
    const onSelect = vi.fn();
    const { lastFrame } = render(
      <FuzzySelect items={items} onSelect={onSelect} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Apple");
    expect(frame).toContain("Banana");
    expect(frame).toContain("Cherry");
  });

  it("filters items when typing", async () => {
    const onSelect = vi.fn();
    const { lastFrame, stdin } = render(
      <FuzzySelect items={items} onSelect={onSelect} />
    );

    // allow useEffect to attach the readable listener
    await new Promise((r) => setTimeout(r, 50));

    stdin.write("c");
    await new Promise((r) => setTimeout(r, 50));
    stdin.write("h");
    await new Promise((r) => setTimeout(r, 50));

    const frame = lastFrame()!;
    expect(frame).toContain("Cherry");
    expect(frame).not.toContain("Banana");
  });

  it("shows empty state when no matches", async () => {
    const onSelect = vi.fn();
    const { lastFrame, stdin } = render(
      <FuzzySelect items={items} onSelect={onSelect} />
    );

    // allow useEffect to attach the readable listener
    await new Promise((r) => setTimeout(r, 50));

    stdin.write("z");
    await new Promise((r) => setTimeout(r, 50));
    stdin.write("z");
    await new Promise((r) => setTimeout(r, 50));
    stdin.write("z");
    await new Promise((r) => setTimeout(r, 50));

    const frame = lastFrame()!;
    expect(frame).toContain("No matches");
  });
});
