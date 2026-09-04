import { describe, expect, it } from "vitest";
import { binaryImpliedProbability, impliedProbability, normalCdf } from "./index.js";

describe("normalCdf", () => {
  it("0 -> 0.5", () => expect(normalCdf(0)).toBeCloseTo(0.5, 6));
  it("1.96 -> 0.975", () => expect(normalCdf(1.96)).toBeCloseTo(0.975, 3));
  it("-1.96 -> 0.025", () => expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3));
});

describe("impliedProbability", () => {
  it("target = spot, long -> 0.5", () => {
    expect(impliedProbability({ spot: 10, target: 10, impliedMovePct: 0.1, direction: "long" })).toBeCloseTo(0.5, 6);
  });
  it("target una sigma arriba, long -> ~0.16", () => {
    const target = 10 * Math.exp(0.1);
    expect(impliedProbability({ spot: 10, target, impliedMovePct: 0.1, direction: "long" })).toBeCloseTo(0.1587, 3);
  });
  it("short es el espejo", () => {
    const target = 10 * Math.exp(-0.1);
    expect(impliedProbability({ spot: 10, target, impliedMovePct: 0.1, direction: "short" })).toBeCloseTo(0.1587, 3);
  });
  it("inputs inválidos -> NaN", () => {
    expect(impliedProbability({ spot: 0, target: 1, impliedMovePct: 0.1, direction: "long" })).toBeNaN();
  });
});

describe("binaryImpliedProbability", () => {
  it("spot a mitad de camino -> 0.5", () => expect(binaryImpliedProbability(15, 20, 10)).toBe(0.5));
  it("clamp a [0,1]", () => expect(binaryImpliedProbability(25, 20, 10)).toBe(1));
});
