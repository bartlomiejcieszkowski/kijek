/**
 * Integration tests for the main extension entry point.
 *
 * Tests the full flow: config → detector → nudge → log → commands.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { DEFAULT_CONFIG, type KijekConfig } from "../src/config.js";
import { LoopDetector, type DetectionResult } from "../src/detector.js";
import { applyNudge, type KijekNudgeEntry } from "../src/nudge.js";
import { LogManager, type LogEntry } from "../src/log.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a mock command context. */
function createMockCtx() {
  const calls: Array<{ type: string; args: unknown[] }> = [];

  return {
    calls,
    ui: {
      notify: vi.fn((message: string, type?: "info" | "warning" | "error") => {
        calls.push({ type: "notify", args: [message, type] });
      }),
      setWidget: vi.fn((key: string, content: string[] | undefined) => {
        calls.push({ type: "setWidget", args: [key, content] });
      }),
    },
    isIdle: vi.fn(() => true),
  };
}

/** Create a mock Pi API. */
function createMockPi() {
  const appendEntries: Array<{ type: string; data: unknown }> = [];
  const userMessages: Array<{ message: string; options?: { deliverAs: "steer" | "followUp" } }> = [];

  return {
    appendEntries,
    userMessages,
    appendEntry<T>(type: string, data: T) {
      appendEntries.push({ type, data });
    },
    sendUserMessage(message: string, options?: { deliverAs: "steer" | "followUp" }) {
      userMessages.push({ message, options });
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Kijek extension integration", () => {
  describe("full detection flow", () => {
    it("tool loop → nudge (silent) → log entry", async () => {
      const config: KijekConfig = { ...DEFAULT_CONFIG, nudgeMode: "silent" as const, detection: { ...DEFAULT_CONFIG.detection, toolLoopThreshold: 3 } };
      const detector = new LoopDetector(config);
      const logManager = new LogManager();
      logManager.setWidgetVisible(true);

      const pi = createMockPi();
      const ctx = createMockCtx();

      detector.startMessage();

      // Record 3 calls to the same tool (threshold is 3)
      const result1 = detector.recordToolCall("read");
      expect(result1).toBeNull();

      const result2 = detector.recordToolCall("read");
      expect(result2).toBeNull();

      const result3 = detector.recordToolCall("read");
      expect(result3).not.toBeNull();
      expect(result3!.type).toBe("toolLoop");
      expect(result3!.count).toBe(3);

      // Apply nudge (silent mode)
      await applyNudge(config, result3!, {
        pi,
        ui: ctx.ui,
        isIdle: ctx.isIdle,
      });

      // Log the entry
      logManager.addEntry(result3!, "silent");

      // Verify appendEntry was called for silent nudge
      expect(pi.appendEntries.length).toBe(1);
      expect(pi.appendEntries[0].type).toBe("kijek-nudge");
      const entry = pi.appendEntries[0].data as KijekNudgeEntry;
      expect(entry.detectionType).toBe("toolLoop");
      expect(entry.count).toBe(3);

      // Verify log entry was created
      expect(logManager.getCount()).toBe(1);
      const entries = logManager.getEntries();
      expect(entries[0].detectionType).toBe("toolLoop");
      expect(entries[0].action).toBe("silent");

      // Verify widget renders
      const widgetLines = logManager.renderWidgetLines();
      expect(widgetLines.length).toBeGreaterThan(0);
      expect(widgetLines[0]).toContain("Kijek Log");
    });

    it("chain loop → nudge → log entry", async () => {
      const config: KijekConfig = {
        ...DEFAULT_CONFIG,
        detection: {
          ...DEFAULT_CONFIG.detection,
          chainLoopThreshold: 3,
          toolLoopThreshold: 100, // disable single-tool loop
        },
      };
      const detector = new LoopDetector(config);

      // Simulate a chain: read → write → read → write → read → write
      detector.startMessage();
      detector.recordToolCall("read");
      detector.recordToolCall("write");
      detector.recordToolCall("read");
      detector.recordToolCall("write");
      detector.recordToolCall("read");
      const result = detector.recordToolCall("write");

      expect(result).not.toBeNull();
      expect(result!.type).toBe("chainLoop");
      expect(result!.count).toBe(3);
    });

    it("reasoning loop → nudge → log entry", async () => {
      const config: KijekConfig = { ...DEFAULT_CONFIG, detection: { ...DEFAULT_CONFIG.detection, outputSimilarityThreshold: 0.85 } };
      const detector = new LoopDetector(config);

      const reasoning = "I need to read the file first to understand the structure.";

      // First call: no previous text, just stores it
      const r1 = detector.recordReasoning(reasoning);
      expect(r1).toBeNull();

      // Second call: identical text → similarity 100% ≥ 85% → LOOP
      const r2 = detector.recordReasoning(reasoning);
      expect(r2).not.toBeNull();
      expect(r2!.type).toBe("reasoningLoop");
      expect(r2!.count).toBe(2);
    });

    it("output loop → nudge → log entry", async () => {
      const config: KijekConfig = { ...DEFAULT_CONFIG, detection: { ...DEFAULT_CONFIG.detection, outputSimilarityThreshold: 0.85 } };
      const detector = new LoopDetector(config);

      const output = "The file has been read successfully.";

      const o1 = detector.recordOutput(output);
      expect(o1).toBeNull();

      const o2 = detector.recordOutput(output);
      expect(o2).not.toBeNull();
      expect(o2!.type).toBe("outputLoop");
    });
  });

  describe("nudge modes", () => {
    it("silent mode calls appendEntry", async () => {
      const pi = createMockPi();
      const ctx = createMockCtx();
      const config: KijekConfig = { ...DEFAULT_CONFIG, nudgeMode: "silent" as const };
      const result: DetectionResult = { type: "toolLoop", details: "read × 3", count: 3 };

      await applyNudge(config, result, {
        pi,
        ui: ctx.ui,
        isIdle: ctx.isIdle,
      });

      expect(pi.appendEntries.length).toBe(1);
      const entry = pi.appendEntries[0].data as KijekNudgeEntry;
      expect(entry.detectionType).toBe("toolLoop");
      expect(entry.count).toBe(3);
    });

    it("alert mode calls ui.notify", async () => {
      const pi = createMockPi();
      const ctx = createMockCtx();
      const config: KijekConfig = { ...DEFAULT_CONFIG, nudgeMode: "alert" as const };
      const result: DetectionResult = { type: "toolLoop", details: "read × 3", count: 3 };

      await applyNudge(config, result, {
        pi,
        ui: ctx.ui,
        isIdle: ctx.isIdle,
      });

      const notifyCalls = ctx.calls.filter(c => c.type === "notify");
      expect(notifyCalls.length).toBeGreaterThan(0);
    });

    it("interrupt mode calls sendUserMessage with steer when not idle", async () => {
      const pi = createMockPi();
      const ctx = createMockCtx();
      const config: KijekConfig = { ...DEFAULT_CONFIG, nudgeMode: "interrupt" as const };
      const result: DetectionResult = { type: "toolLoop", details: "read × 3", count: 3 };

      // Mock as not idle (streaming)
      ctx.isIdle.mockReturnValue(false);

      await applyNudge(config, result, {
        pi,
        ui: ctx.ui,
        isIdle: ctx.isIdle,
      });

      expect(pi.userMessages.length).toBe(1);
      expect(pi.userMessages[0].options?.deliverAs).toBe("steer");
    });

    it("interrupt mode sends normal message when idle", async () => {
      const pi = createMockPi();
      const ctx = createMockCtx();
      const config: KijekConfig = { ...DEFAULT_CONFIG, nudgeMode: "interrupt" as const };
      const result: DetectionResult = { type: "toolLoop", details: "read × 3", count: 3 };

      // Mock as idle (not streaming)
      ctx.isIdle.mockReturnValue(true);

      await applyNudge(config, result, {
        pi,
        ui: ctx.ui,
        isIdle: ctx.isIdle,
      });

      expect(pi.userMessages.length).toBe(1);
      expect(pi.userMessages[0].options).toBeUndefined();
    });
  });

  describe("log widget", () => {
    it("renders header and footer", () => {
      const logManager = new LogManager();
      logManager.setWidgetVisible(true);

      const lines = logManager.renderWidgetLines();
      expect(lines[0]).toContain("Kijek Log");
      expect(lines[lines.length - 1]).toContain("└");
    });

    it("shows 'no detections' when empty", () => {
      const logManager = new LogManager();
      logManager.setWidgetVisible(true);

      const lines = logManager.renderWidgetLines();
      expect(lines.some(l => l.includes("No detections"))).toBe(true);
    });

    it("returns empty array when hidden", () => {
      const logManager = new LogManager();
      logManager.setWidgetVisible(false);

      const lines = logManager.renderWidgetLines();
      expect(lines).toEqual([]);
    });

    it("toggles visibility", () => {
      const logManager = new LogManager();
      expect(logManager.isWidgetVisible()).toBe(false);

      const visible = logManager.toggleWidget();
      expect(visible).toBe(true);
      expect(logManager.isWidgetVisible()).toBe(true);

      const hidden = logManager.toggleWidget();
      expect(hidden).toBe(false);
      expect(logManager.isWidgetVisible()).toBe(false);
    });
  });

  describe("session reconstruction", () => {
    it("loads entries from session custom entries", () => {
      const logManager = new LogManager();

      const sessionManager = {
        getEntries: () => [
          {
            type: "custom",
            customType: "kijek-log",
            data: {
              id: "kijek-123",
              timestamp: "2025-01-01T12:00:00.000Z",
              detectionType: "toolLoop",
              details: "read × 3",
              action: "silent",
            },
            id: "entry-1",
            parentId: null,
            timestamp: "2025-01-01T12:00:00.000Z",
          },
        ],
      };

      logManager.loadFromSession(sessionManager);
      expect(logManager.getCount()).toBe(1);
      expect(logManager.getEntries()[0].detectionType).toBe("toolLoop");
    });

    it("ignores non-kijek entries", () => {
      const logManager = new LogManager();

      const sessionManager = {
        getEntries: () => [
          {
            type: "custom",
            customType: "other-type",
            data: { foo: "bar" },
            id: "entry-1",
            parentId: null,
            timestamp: "2025-01-01T12:00:00.000Z",
          },
        ],
      };

      logManager.loadFromSession(sessionManager);
      expect(logManager.getCount()).toBe(0);
    });
  });

  describe("detector reset on branch change", () => {
    it("resets tool counts on startMessage", () => {
      const detector = new LoopDetector(DEFAULT_CONFIG);
      detector.startMessage();
      detector.recordToolCall("read");
      detector.recordToolCall("read");

      // Reset for new message
      detector.startMessage();
      const result = detector.recordToolCall("read");

      // Should not trigger loop — fresh count
      expect(result).toBeNull();
    });

    it("resets all state on reset()", () => {
      const detector = new LoopDetector(DEFAULT_CONFIG);
      detector.startMessage();
      detector.recordToolCall("read");
      detector.recordToolCall("write");
      detector.recordReasoning("some reasoning");
      detector.recordOutput("some output");

      detector.reset();

      // All state should be cleared
      expect(detector.getToolCallHistory()).toEqual([]);
    });
  });
});
