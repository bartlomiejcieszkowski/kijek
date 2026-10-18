/**
 * Fixture tests — replay debug dumps from tests/fixtures/*.json.
 *
 * Drop your captured dumps here (e.g., from /kijek-dump) and they'll be
 * automatically replayed through the detector.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { LoopDetector, replay, type DetectionResult } from "../src/detector.js";

// ── Discover all .json fixtures ──────────────────────────────────────────────

const fixtureDir = join(__dirname, "..", "fixtures");

function discoverFixtures(): string[] {
  try {
    return readdirSync(fixtureDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => join(fixtureDir, f));
  } catch {
    return [];
  }
}

const fixtures = discoverFixtures();

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Fixture tests", () => {
  if (fixtures.length === 0) {
    it("skips when no fixtures found", () => {
      // This test exists so the suite still passes when fixtures/ is empty.
    });
    return;
  }

  for (const filepath of fixtures) {
    const filename = filepath.split(/[/\\]/).pop()!;

    it(`replays ${filename}`, () => {
      const raw = readFileSync(filepath, "utf-8");
      const dump = JSON.parse(raw);

      // Replay through a fresh detector
      const detector = replay(dump);

      // Verify the detector captured the events
      const toolCalls = detector.getToolCallHistory();
      const reasoning = detector.getReasoningBlocks();
      const output = detector.getOutputBlocks();

      // Count expected events
      const expectedToolCalls = dump.events.filter((e: { type: string }) => e.type === "tool_call").length;
      const expectedReasoning = dump.events.filter((e: { type: string }) => e.type === "reasoning").length;
      const expectedOutput = dump.events.filter((e: { type: string }) => e.type === "output").length;

      expect(toolCalls.length).toBe(expectedToolCalls);
      expect(reasoning.length).toBe(expectedReasoning);
      expect(output.length).toBe(expectedOutput);

      // Log scenario name if present
      if (dump.scenario) {
        console.log(`  [fixture] ${filename}: scenario="${dump.scenario}", events=${dump.events.length}`);
      }
    });
  }
});
