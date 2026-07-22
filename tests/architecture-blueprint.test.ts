// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  formatArchitectureBlueprintMarkdown,
  BLUEPRINT_DIMENSIONS,
  bunNativeHintsFor,
} from "../src/agent/architecture-blueprint.ts";

describe("architecture blueprint", () => {
  test("BLUEPRINT_DIMENSIONS includes price-data, wallet-track, and sports slices", () => {
    const ids = BLUEPRINT_DIMENSIONS.map((d) => d.dimension);
    expect(ids).toContain("price-data");
    expect(ids).toContain("wallet-track");
    expect(ids).toContain("tracking");
    expect(ids).toContain("sports-nba");
    expect(ids).toContain("sports-macro");
    expect(ids.length).toBeGreaterThanOrEqual(11);
  });

  test("bunNativeHintsFor maps recommended features to local files", () => {
    const hints = bunNativeHintsFor(["bun-sqlite", "bun-http"], {
      features: ["bun-sqlite", "bun-http"],
      sourceFiles: ["src/research/cache.ts"],
      featureFiles: { "bun-sqlite": ["src/research/cache.ts"], "bun-http": [] },
    });
    expect(hints[0]?.localFiles).toContain("src/research/cache.ts");
  });

  test("formatArchitectureBlueprintMarkdown renders badges, excerpts, and Bun native table", () => {
    const md = formatArchitectureBlueprintMarkdown({
      generatedAt: "2099-01-01T00:00:00.000Z",
      localBunStack: {
        features: ["bun-http", "bun-sqlite"],
        sourceFiles: ["src/research/cache.ts"],
        featureFiles: { "bun-sqlite": ["src/research/cache.ts"] },
      },
      sections: [
        {
          dimension: "price-data",
          title: "Price / market data feeds",
          runId: "2026-07-21T12-00-00-000Z",
          runGeneratedAt: "2026-07-21T12:00:00.000Z",
          recommendedBun: ["bun-websocket", "bun-sqlite"],
          referenceRepo: "owner/feed-bot",
          referenceScore: 72,
          referenceBadge: "⚠ watchlist",
          referenceFindingId: "finding-123",
          referenceDimension: "price-data",
          bunFeatures: ["bun-websocket"],
          bunFeatureFile: "src/server.ts",
          authPattern: "KALSHI-ACCESS-* headers",
          orderPattern: null,
          liftAuth: "owner/feed-bot",
          liftOrders: null,
          liftEntries: [
            {
              component: "authApi",
              repo: "owner/feed-bot",
              points: 20,
              maxPoints: 25,
              badge: "⚠ watchlist",
              verified: false,
              verification: "watchlist",
              findingId: "finding-123",
              rationale: "KALSHI access headers in code",
              pattern: {
                summary: "KALSHI-ACCESS-* headers",
                excerpt: "KALSHI-ACCESS-KEY signature",
                file: "src/auth.ts",
                source: "research/patterns/patterns-latest-price-data.json",
              },
            },
          ],
          shortlistSummary: [
            {
              fullName: "owner/feed-bot",
              total: 72,
              auditTier: "watchlist",
              license: "MIT",
              unlicensed: false,
              verified: false,
              verification: "watchlist",
              findingId: "finding-123",
            },
          ],
          liftNotes: ["Primary high-value audit export: owner/feed-bot."],
          bunNative: [
            { feature: "bun-sqlite", localFiles: ["src/research/cache.ts"] },
            { feature: "bun-websocket", localFiles: [] },
          ],
          notes: [],
        },
      ],
    });
    expect(md).toContain("Bun WebSocket");
    expect(md).toContain("Local Bun SSOT");
    expect(md).toContain("owner/feed-bot");
    expect(md).toContain("⚠ watchlist");
    expect(md).toContain("Lift recommendations");
    expect(md).toContain("↳ excerpt:");
    expect(md).toContain("Shortlist verification");
    expect(md).toContain("Lift notes");
    expect(md).toContain("src/research/cache.ts");
  });
});
