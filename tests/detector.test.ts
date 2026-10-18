import { describe, it, expect } from "vitest";
import { LoopDetector, replay, type DebugDump } from "../src/detector.js";

// ── Helper: create a detector with custom thresholds ──────────────────────

function makeDetector(overrides: {
  toolLoopThreshold?: number;
  chainLoopThreshold?: number;
  chainLoopWindowSize?: number;
  reasoningLoopThreshold?: number;
  outputSimilarityThreshold?: number;
  enabled?: Record<string, boolean>;
}): LoopDetector {
  return new LoopDetector({
    enabled: {
      toolLoop: overrides.enabled?.toolLoop ?? true,
      chainLoop: overrides.enabled?.chainLoop ?? true,
      reasoningLoop: overrides.enabled?.reasoningLoop ?? true,
      outputLoop: overrides.enabled?.outputLoop ?? true,
    },
    detection: {
      toolLoopThreshold: overrides.toolLoopThreshold ?? 5,
      chainLoopThreshold: overrides.chainLoopThreshold ?? 5,
      chainLoopWindowSize: overrides.chainLoopWindowSize ?? 3,
      reasoningLoopThreshold: overrides.reasoningLoopThreshold ?? 5,
      outputSimilarityThreshold: overrides.outputSimilarityThreshold ?? 0.85,
    },
  });
}

// ── LoopDetector — single tool loop ────────────────────────────────────────

describe("LoopDetector — single tool loop", () => {
  it("returns null for first tool call", () => {
    const detector = makeDetector({ toolLoopThreshold: 3 });
    expect(detector.recordToolCall("read_file")).toBeNull();
  });

  it("returns null for second tool call (below threshold)", () => {
    const detector = makeDetector({ toolLoopThreshold: 3 });
    detector.recordToolCall("read_file");
    expect(detector.recordToolCall("read_file")).toBeNull();
  });

  it("returns DetectionResult when threshold is reached", () => {
    const detector = makeDetector({ toolLoopThreshold: 3 });
    detector.recordToolCall("read_file");
    detector.recordToolCall("read_file");
    const result = detector.recordToolCall("read_file");
    expect(result).not.toBeNull();
    expect(result?.type).toBe("toolLoop");
    expect(result?.count).toBe(3);
    expect(result?.details).toContain("read_file");
    expect(result?.details).toContain("3 times");
  });

  it("resets counts after startMessage()", () => {
    const detector = makeDetector({ toolLoopThreshold: 3 });
    detector.recordToolCall("read_file");
    detector.recordToolCall("read_file");
    detector.recordToolCall("read_file"); // triggers loop
    detector.startMessage();
    // After startMessage, same tool can be called again without triggering
    expect(detector.recordToolCall("read_file")).toBeNull();
    expect(detector.recordToolCall("read_file")).toBeNull();
  });

  it("tracks different tools independently", () => {
    const detector = makeDetector({ toolLoopThreshold: 5, chainLoopThreshold: 10 });
    detector.recordToolCall("read_file");
    detector.recordToolCall("write_file");
    detector.recordToolCall("read_file");
    detector.recordToolCall("write_file");
    // Neither should have triggered yet
    expect(detector.recordToolCall("read_file")).toBeNull();
    expect(detector.recordToolCall("write_file")).toBeNull();
  });

  it("returns correct count for each tool", () => {
    const detector = makeDetector({ toolLoopThreshold: 3 });
    detector.recordToolCall("read_file");
    detector.recordToolCall("read_file");
    const result = detector.recordToolCall("read_file");
    expect(result?.count).toBe(3);
    expect(result?.details).toContain("read_file");
  });
});

// ── LoopDetector — chain loop ─────────────────────────────────────────────

describe("LoopDetector — chain loop", () => {
  it("does not trigger chain loop for single-tool sequences", () => {
    const detector = makeDetector({ chainLoopThreshold: 3, toolLoopThreshold: 10 });
    detector.recordToolCall("read_file");
    detector.recordToolCall("read_file");
    detector.recordToolCall("read_file");
    detector.recordToolCall("read_file");
    detector.recordToolCall("read_file");
    // Should NOT trigger chain loop (only one distinct tool)
    expect(detector.recordToolCall("read_file")).toBeNull();
  });

  it("triggers chain loop for repeated sequences of 2+ tools", () => {
    const detector = makeDetector({ chainLoopThreshold: 2, toolLoopThreshold: 10 });
    // First chain: read_file → write_file
    detector.recordToolCall("read_file");
    detector.recordToolCall("write_file");
    // Second chain: read_file → write_file
    detector.recordToolCall("read_file");
    detector.recordToolCall("write_file");
    // Third chain: read_file → write_file (should trigger)
    const result = detector.recordToolCall("read_file");
    expect(result).not.toBeNull();
    expect(result?.type).toBe("chainLoop");
  });

  it("tracks chain window correctly", () => {
    const detector = makeDetector({ chainLoopThreshold: 2, toolLoopThreshold: 10 });
    // Build up a chain: read → write → read
    detector.recordToolCall("read_file");
    detector.recordToolCall("write_file");
    detector.recordToolCall("read_file");
    // Second chain: read → write → read
    detector.recordToolCall("read_file");
    detector.recordToolCall("write_file");
    detector.recordToolCall("read_file");
    // Third chain: read → write → read (should trigger)
    const result = detector.recordToolCall("read_file");
    expect(result).not.toBeNull();
    expect(result?.type).toBe("chainLoop");
    expect(result?.details).toContain("read_file");
  });

  it("does not trigger for single tool in window", () => {
    const detector = makeDetector({ chainLoopThreshold: 2, toolLoopThreshold: 10 });
    detector.recordToolCall("read_file");
    detector.recordToolCall("read_file");
    detector.recordToolCall("read_file");
    // Should NOT trigger chain loop
    expect(detector.recordToolCall("read_file")).toBeNull();
  });
});

// ── LoopDetector — reasoning loop ──────────────────────────────────────────

describe("LoopDetector — reasoning loop", () => {
  it("returns null for first reasoning block", () => {
    const detector = makeDetector({ outputSimilarityThreshold: 0.85 });
    expect(detector.recordReasoning("First reasoning block")).toBeNull();
  });

  it("returns null when below threshold", () => {
    const detector = makeDetector({ outputSimilarityThreshold: 0.85 });
    detector.recordReasoning("First reasoning block");
    detector.recordReasoning("Second reasoning block");
    expect(detector.recordReasoning("Third reasoning block")).toBeNull();
  });

  it("detects repeated reasoning blocks", () => {
    const detector = makeDetector({ outputSimilarityThreshold: 0.85 });
    detector.recordReasoning("I should use read_file to get the data");
    const result = detector.recordReasoning(
      "I should use read_file to get the data",
    );
    expect(result).not.toBeNull();
    expect(result?.type).toBe("reasoningLoop");
    expect(result?.count).toBe(2);
  });

  it("returns null for different reasoning blocks", () => {
    const detector = makeDetector({ outputSimilarityThreshold: 0.85 });
    detector.recordReasoning("First approach: use read_file");
    detector.recordReasoning("Second approach: use write_file");
    detector.recordReasoning("Third approach: use delete_file");
    expect(detector.recordReasoning("Fourth approach: use copy_file")).toBeNull();
  });

  it("ignores empty reasoning blocks", () => {
    const detector = makeDetector({ outputSimilarityThreshold: 0.85 });
    expect(detector.recordReasoning("")).toBeNull();
    expect(detector.recordReasoning("   ")).toBeNull();
    expect(detector.recordReasoning("Valid reasoning")).toBeNull();
  });
});

// ── LoopDetector — output loop ────────────────────────────────────────────

describe("LoopDetector — output loop", () => {
  it("returns null for first output message", () => {
    const detector = makeDetector({ outputSimilarityThreshold: 0.85 });
    expect(detector.recordOutput("First output")).toBeNull();
  });

  it("detects repeated output messages", () => {
    const detector = makeDetector({ outputSimilarityThreshold: 0.85 });
    detector.recordOutput("Here is the result");
    const result = detector.recordOutput("Here is the result");
    expect(result).not.toBeNull();
    expect(result?.type).toBe("outputLoop");
    expect(result?.count).toBe(2);
  });

  it("returns null for different output messages", () => {
    const detector = makeDetector({ outputSimilarityThreshold: 0.85 });
    detector.recordOutput("First message");
    detector.recordOutput("Second message");
    detector.recordOutput("Third message");
    expect(detector.recordOutput("Fourth message")).toBeNull();
  });

  it("ignores empty output messages", () => {
    const detector = makeDetector({ outputSimilarityThreshold: 0.85 });
    expect(detector.recordOutput("")).toBeNull();
    expect(detector.recordOutput("   ")).toBeNull();
  });
});

// ── LoopDetector — reset ──────────────────────────────────────────────────

describe("LoopDetector — reset", () => {
  it("clears all state", () => {
    const detector = makeDetector({ toolLoopThreshold: 2 });
    detector.recordToolCall("read_file");
    detector.recordToolCall("read_file"); // triggers loop
    detector.recordReasoning("reasoning");
    detector.recordOutput("output");
    detector.reset();
    expect(detector.getToolCallHistory()).toEqual([]);
  });

  it("allows fresh detection after reset", () => {
    const detector = makeDetector({ toolLoopThreshold: 2 });
    detector.recordToolCall("read_file");
    detector.recordToolCall("read_file"); // triggers loop
    detector.reset();
    // Can start fresh
    expect(detector.recordToolCall("read_file")).toBeNull();
  });
});

// ── LoopDetector — getToolCallHistory ─────────────────────────────────────

describe("LoopDetector — getToolCallHistory", () => {
  it("returns empty array initially", () => {
    const detector = new LoopDetector();
    expect(detector.getToolCallHistory()).toEqual([]);
  });

  it("returns tool call history", () => {
    const detector = new LoopDetector();
    detector.recordToolCall("read_file");
    detector.recordToolCall("write_file");
    detector.recordToolCall("read_file");
    expect(detector.getToolCallHistory()).toEqual([
      "read_file",
      "write_file",
      "read_file",
    ]);
  });

  it("returns a copy (not mutable reference)", () => {
    const detector = new LoopDetector();
    detector.recordToolCall("read_file");
    const history = detector.getToolCallHistory();
    history.push("fake_tool");
    expect(detector.getToolCallHistory()).not.toContain("fake_tool");
  });
});

// ── LoopDetector — disabled detection ─────────────────────────────────────

describe("LoopDetector — disabled detection", () => {
  it("does not detect tool loops when disabled", () => {
    const detector = makeDetector({ enabled: { toolLoop: false } });
    detector.recordToolCall("read_file");
    detector.recordToolCall("read_file");
    detector.recordToolCall("read_file");
    expect(detector.recordToolCall("read_file")).toBeNull();
  });

  it("does not detect chain loops when disabled", () => {
    const detector = makeDetector({ enabled: { chainLoop: false } });
    detector.recordToolCall("read_file");
    detector.recordToolCall("write_file");
    detector.recordToolCall("read_file");
    detector.recordToolCall("write_file");
    expect(detector.recordToolCall("read_file")).toBeNull();
  });

  it("does not detect reasoning loops when disabled", () => {
    const detector = makeDetector({ enabled: { reasoningLoop: false } });
    detector.recordReasoning("I should use read_file");
    detector.recordReasoning("I should use read_file");
    detector.recordReasoning("I should use read_file");
    expect(detector.recordReasoning("I should use read_file")).toBeNull();
  });

  it("does not detect output loops when disabled", () => {
    const detector = makeDetector({ enabled: { outputLoop: false } });
    detector.recordOutput("Here is the result");
    detector.recordOutput("Here is the result");
    detector.recordOutput("Here is the result");
    expect(detector.recordOutput("Here is the result")).toBeNull();
  });
});

// ── LoopDetector — edge cases ─────────────────────────────────────────────

describe("LoopDetector — edge cases", () => {
  it("handles tool names with special characters", () => {
    const detector = makeDetector({ toolLoopThreshold: 2 });
    detector.recordToolCall("api.call:read_file");
    expect(detector.recordToolCall("api.call:read_file")).not.toBeNull();
  });

  it("handles very long tool names", () => {
    const detector = makeDetector({ toolLoopThreshold: 2 });
    const longName = "a".repeat(1000);
    detector.recordToolCall(longName);
    expect(detector.recordToolCall(longName)).not.toBeNull();
  });

  it("handles reasoning with punctuation", () => {
    const detector = makeDetector({ outputSimilarityThreshold: 0.5 });
    detector.recordReasoning("Hello, world! How are you?");
    const result = detector.recordReasoning("Hello, world! How are you?");
    expect(result).not.toBeNull();
    expect(result?.type).toBe("reasoningLoop");
  });

  it("handles startMessage for per-message reset", () => {
    const detector = makeDetector({ toolLoopThreshold: 2 });
    detector.recordToolCall("read_file");
    detector.recordToolCall("read_file"); // triggers loop
    detector.startMessage();
    // After startMessage, same tool can be called again without triggering
    expect(detector.recordToolCall("read_file")).toBeNull();
  });

  // ── Replay tests ──────────────────────────────────────────────────────

  describe("replay", () => {
    it("replays a tool loop from a debug dump", () => {
      const dump: DebugDump = {
        scenario: "tool-loop",
        events: [
          { type: "tool_call", toolName: "read" },
          { type: "tool_call", toolName: "read" },
          { type: "tool_call", toolName: "read" },
          { type: "tool_call", toolName: "read" },
          { type: "tool_call", toolName: "read" },
        ],
      };

      const detector = replay(dump);
      const history = detector.getToolCallHistory();
      // 5th call triggers loop and returns early (not added to history)
      expect(history).toEqual(["read", "read", "read", "read"]);
    });

    it("replays mixed events (tool, reasoning, output)", () => {
      const dump: DebugDump = {
        scenario: "mixed",
        events: [
          { type: "reasoning", text: "Let me read the file" },
          { type: "tool_call", toolName: "read" },
          { type: "output", text: "Reading file..." },
          { type: "reasoning", text: "Let me read the file" },
        ],
      };

      const detector = replay(dump);
      // 2nd identical reasoning triggers loop, not added to blocks
      expect(detector.getReasoningBlocks()).toEqual(["Let me read the file"]);
      expect(detector.getOutputBlocks()).toEqual(["Reading file..."]);
      expect(detector.getToolCallHistory()).toEqual(["read"]);
    });

    it("replays an output loop", () => {
      const output = "The file has been read successfully.";
      const dump: DebugDump = {
        scenario: "output-loop",
        events: [
          { type: "output", text: output },
          { type: "output", text: output },
        ],
      };

      const detector = replay(dump);
      // 2nd identical output triggers loop, not added to blocks
      expect(detector.getOutputBlocks()).toEqual([output]);
    });
  });
});
