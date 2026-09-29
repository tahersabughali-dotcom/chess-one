import {
  type EdgeConfig,
  EdgeConfigError,
  resolveEdgeConfig,
  type TrustedSessionResolver,
} from "@chess-one/edge";
import { describe, expect, it } from "vitest";
import { DefectLog, RecordingFacts } from "./support/facts.ts";
import { runtimeHarness } from "./support/runtime.ts";
import { TestTrustedSessionResolver } from "./support/sessions.ts";
import { ManualClock } from "./support/time.ts";

const production: TrustedSessionResolver = {
  trust: "production",
  resolve: async () => null,
};

function config(overrides: Partial<EdgeConfig>): EdgeConfig {
  return {
    environment: "test",
    allowedOrigins: ["http://127.0.0.1:5173"],
    sessionResolver: new TestTrustedSessionResolver({}),
    writers: runtimeHarness().registry,
    clock: new ManualClock(0),
    facts: new RecordingFacts(),
    reportDefect: new DefectLog().report,
    ...overrides,
  };
}

describe("TST-EDGE-CONFIG the edge fails closed", () => {
  it("TST-EDGE-CONFIG-001 no endpoint without a resolver; no test-only resolver in production", () => {
    expect(() => resolveEdgeConfig(config({ sessionResolver: null }))).toThrow(EdgeConfigError);
    expect(() =>
      resolveEdgeConfig(
        config({ environment: "production", allowedOrigins: ["https://play.example"] }),
      ),
    ).toThrow(/production session resolver/);
  });

  it("TST-EDGE-CONFIG-002 origins are exact: no wildcard, no path, no empty list; https in production; loopback in tests", () => {
    const refused: readonly (readonly [EdgeConfig["environment"], readonly string[]])[] = [
      ["test", []],
      ["test", ["*"]],
      ["test", ["http://127.0.0.1:5173/"]],
      ["test", ["http://127.0.0.1:5173/app"]],
      ["test", ["http://example.com"]],
      ["test", ["127.0.0.1:5173"]],
      ["production", ["http://play.example"]],
      ["production", ["https://*.example"]],
      ["production", ["https://play.example", "*"]],
    ];
    for (const [environment, allowedOrigins] of refused) {
      const resolver =
        environment === "production" ? production : new TestTrustedSessionResolver({});
      expect(() =>
        resolveEdgeConfig(config({ environment, allowedOrigins, sessionResolver: resolver })),
      ).toThrow(EdgeConfigError);
    }
    const accepted = resolveEdgeConfig(
      config({
        environment: "production",
        allowedOrigins: ["https://play.example"],
        sessionResolver: production,
      }),
    );
    expect([...accepted.allowedOrigins]).toEqual(["https://play.example"]);
    expect(
      resolveEdgeConfig(config({ allowedOrigins: ["http://localhost:3000", "http://[::1]:3000"] })),
    ).toBeTruthy();
  });

  it("TST-EDGE-CONFIG-003 limits must be positive integers under their ceilings; the frame limit stays at or under 16 KiB", () => {
    for (const limits of [
      { maxMessageBytes: 16_385 },
      { maxMessageBytes: 0 },
      { maxOutboundBufferBytes: 1.5 },
      { inboundBurst: -1 },
      { maxConnections: Number.POSITIVE_INFINITY },
    ]) {
      expect(() => resolveEdgeConfig(config({ limits }))).toThrow(EdgeConfigError);
    }
    expect(
      resolveEdgeConfig(config({ limits: { maxMessageBytes: 16_384 } })).limits.maxMessageBytes,
    ).toBe(16_384);
  });
});
