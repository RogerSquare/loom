import { describe, it, expect } from "vitest";

import { formatCost, formatDurationMs } from "../format";

describe("formatCost", () => {
  it("shows 5 decimals for sub-cent amounts", () => {
    expect(formatCost(0.00123)).toBe("$0.00123");
    expect(formatCost(0.000001)).toBe("$0.00000");
  });

  it("shows 4 decimals for cent-to-dollar amounts", () => {
    expect(formatCost(0.0165)).toBe("$0.0165");
    expect(formatCost(0.5)).toBe("$0.5000");
  });

  it("shows 2 decimals for dollar amounts", () => {
    expect(formatCost(1.234)).toBe("$1.23");
    expect(formatCost(42.5)).toBe("$42.50");
  });

  it("handles zero", () => {
    expect(formatCost(0)).toBe("$0.00000");
  });

  it("handles negative values with a leading minus", () => {
    // Shouldn't happen in practice, but don't emit "$-0.00" garbage.
    expect(formatCost(-0.5)).toBe("-$0.5000");
  });

  it("returns empty string for non-finite input", () => {
    expect(formatCost(NaN)).toBe("");
    expect(formatCost(Infinity)).toBe("");
  });
});

describe("formatDurationMs", () => {
  it("converts ns to ms with no decimals", () => {
    expect(formatDurationMs(1_000_000)).toBe("1 ms");
    expect(formatDurationMs(1_500_000)).toBe("2 ms"); // rounds
    expect(formatDurationMs(0)).toBe("0 ms");
  });

  it("handles large durations", () => {
    expect(formatDurationMs(12_345_678_900)).toBe("12346 ms");
  });
});
