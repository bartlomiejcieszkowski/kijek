import { describe, expect, it, vi } from "vitest";
import { LogManager, type LogEntry } from "../src/log.js";
import type { DetectionResult } from "../src/detector.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock detection result. */
function makeDetection(
  type: DetectionResult["type"] = "toolLoop",
  details = "Tool 'read' called 5 times in this message",
  count = 5,
): DetectionResult {
  return { type, details, count };
}

/** Create a minimal mock session manager. */
function makeMockSessionManager(
  customEntries: Array<{ customType: string; data?: unknown }>,
) {
  return {
    getEntries: () =>
      customEntries.map((e, i) => ({
        type: "custom" as const,
        id: `entry-${i}`,
        parentId: null,
        timestamp: new Date().toISOString(),
        customType: e.customType,
        data: e.data,
      })),
  };
}

/** Create a minimal mock appendEntry function. */
function makeMockAppendEntry() {
  const entries: Array<{ customType: string; data?: unknown }> = [];
  const fn = vi.fn((customType: string, data?: unknown) => {
    entries.push({ customType, data });
  });
  return { fn, entries };
}

// ---------------------------------------------------------------------------
// Tests — addEntry
// ---------------------------------------------------------------------------

describe("addEntry", () => {
  it("creates a log entry with all fields", () => {
    const mgr = new LogManager();
    const { fn } = makeMockAppendEntry();
    mgr.setAppendEntry(fn);

    mgr.addEntry(makeDetection(), "alert");

    const entries = mgr.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].detectionType).toBe("toolLoop");
    expect(entries[0].details).toBe("Tool 'read' called 5 times in this message");
    expect(entries[0].action).toBe("alert");
    expect(entries[0].timestamp).toBeDefined();
    expect(entries[0].id).toBeDefined();
  });

  it("persists to session via appendEntry", () => {
    const mgr = new LogManager();
    const { fn, entries } = makeMockAppendEntry();
    mgr.setAppendEntry(fn);

    mgr.addEntry(makeDetection("chainLoop", "Chain repeated 3 times", 3), "silent");

    expect(fn).toHaveBeenCalledWith("kijek-log", expect.objectContaining({
      detectionType: "chainLoop",
      action: "silent",
    }));
    expect(entries).toHaveLength(1);
    expect(entries[0].customType).toBe("kijek-log");
  });

  it("handles all detection types", () => {
    const mgr = new LogManager();
    const { fn } = makeMockAppendEntry();
    mgr.setAppendEntry(fn);

    const types: DetectionResult["type"][] = [
      "toolLoop", "chainLoop", "reasoningLoop", "outputLoop",
    ];

    for (const type of types) {
      mgr.addEntry(makeDetection(type), "alert");
    }

    expect(mgr.getEntries()).toHaveLength(4);
  });

  it("handles all action types", () => {
    const mgr = new LogManager();
    const { fn } = makeMockAppendEntry();
    mgr.setAppendEntry(fn);

    const actions = ["silent", "alert", "interrupt"];

    for (const action of actions) {
      mgr.addEntry(makeDetection(), action);
    }

    expect(mgr.getEntries()).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Tests — getEntries (order and limit)
// ---------------------------------------------------------------------------

describe("getEntries", () => {
  it("returns entries newest first", () => {
    const mgr = new LogManager();
    const { fn } = makeMockAppendEntry();
    mgr.setAppendEntry(fn);

    mgr.addEntry(makeDetection("toolLoop", "first", 1), "alert");
    mgr.addEntry(makeDetection("chainLoop", "second", 2), "alert");
    mgr.addEntry(makeDetection("outputLoop", "third", 3), "alert");

    const entries = mgr.getEntries();
    expect(entries[0].details).toBe("third");
    expect(entries[1].details).toBe("second");
    expect(entries[2].details).toBe("first");
  });

  it("limits to last 20 entries", () => {
    const mgr = new LogManager();
    const { fn } = makeMockAppendEntry();
    mgr.setAppendEntry(fn);

    for (let i = 0; i < 25; i++) {
      mgr.addEntry(makeDetection("toolLoop", `entry ${i}`, i + 1), "alert");
    }

    expect(mgr.getEntries()).toHaveLength(20);
    // Should be the last 20 (entries 5-24)
    expect(mgr.getEntries()[0].details).toBe("entry 24");
    expect(mgr.getEntries()[19].details).toBe("entry 5");
  });
});

// ---------------------------------------------------------------------------
// Tests — widget rendering
// ---------------------------------------------------------------------------

describe("renderWidgetLines", () => {
  it("returns empty array when widget is hidden", () => {
    const mgr = new LogManager();
    expect(mgr.renderWidgetLines()).toEqual([]);
  });

  it("shows 'No detections yet' when empty", () => {
    const mgr = new LogManager();
    mgr.setWidgetVisible(true);

    const lines = mgr.renderWidgetLines();

    expect(lines).toContain("┌─ Kijek Log ───────────────────────────────┐");
    expect(lines).toContain("│ No detections yet.                        │");
    expect(lines).toContain("└──────────────────────── ╰( ･~･)つ── 🤖💬 ─┘");
  });

  it("renders entries with timestamps and labels", () => {
    const mgr = new LogManager();
    mgr.setWidgetVisible(true);
    mgr.setAppendEntry(vi.fn());

    mgr.addEntry(makeDetection("toolLoop", "Tool 'read' called 5 times", 5), "alert");

    const lines = mgr.renderWidgetLines();

    // Check header
    expect(lines[0]).toContain("Kijek Log");
    // Check entry line contains expected parts
    const entryLine = lines.find((l) => l.includes("Tool loop"));
    expect(entryLine).toBeDefined();
    expect(entryLine).toContain("read");
    expect(entryLine).toContain("Alert");
    // Check footer
    expect(lines[lines.length - 1]).toContain("└");
  });

  it("truncates long details", () => {
    const mgr = new LogManager();
    mgr.setWidgetVisible(true);
    mgr.setAppendEntry(vi.fn());

    const longDetail = "This is a very long detail that should be truncated because it exceeds the widget width limit";
    mgr.addEntry(makeDetection("reasoningLoop", longDetail, 5), "interrupt");

    const lines = mgr.renderWidgetLines();
    const entryLine = lines.find((l) => l.includes("Reasoning loop"));
    expect(entryLine).toBeDefined();
    expect(entryLine).toContain("…");
  });

  it("maps detection types correctly", () => {
    const mgr = new LogManager();
    mgr.setWidgetVisible(true);
    mgr.setAppendEntry(vi.fn());

    mgr.addEntry(makeDetection("chainLoop", "Chain repeated", 3), "silent");
    mgr.addEntry(makeDetection("outputLoop", "Output repeated", 3), "interrupt");

    const lines = mgr.renderWidgetLines();
    const text = lines.join("\n");

    expect(text).toContain("Chain loop");
    expect(text).toContain("Output loop");
  });

  it("maps actions correctly", () => {
    const mgr = new LogManager();
    mgr.setWidgetVisible(true);
    mgr.setAppendEntry(vi.fn());

    mgr.addEntry(makeDetection("toolLoop", "x", 1), "silent");
    mgr.addEntry(makeDetection("chainLoop", "x", 1), "alert");
    mgr.addEntry(makeDetection("outputLoop", "x", 1), "interrupt");

    const lines = mgr.renderWidgetLines();
    const text = lines.join("\n");

    expect(text).toContain("Silent redirect");
    expect(text).toContain("Alert");
    expect(text).toContain("Auto-interrupt");
  });
});

// ---------------------------------------------------------------------------
// Tests — widget toggle
// ---------------------------------------------------------------------------

describe("widget toggle", () => {
  it("starts hidden", () => {
    const mgr = new LogManager();
    expect(mgr.isWidgetVisible()).toBe(false);
  });

  it("toggles on", () => {
    const mgr = new LogManager();
    expect(mgr.toggleWidget()).toBe(true);
    expect(mgr.isWidgetVisible()).toBe(true);
  });

  it("toggles off", () => {
    const mgr = new LogManager();
    mgr.setWidgetVisible(true);
    expect(mgr.toggleWidget()).toBe(false);
    expect(mgr.isWidgetVisible()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — session reconstruction
// ---------------------------------------------------------------------------

describe("loadFromSession", () => {
  it("loads kijek-log entries from session", () => {
    const mgr = new LogManager();
    const sessionEntries = [
      {
        customType: "kijek-log",
        data: {
          id: "kijek-1",
          timestamp: "2025-01-01T10:00:00.000Z",
          detectionType: "toolLoop",
          details: "Tool 'read' called 5 times",
          action: "alert",
        },
      },
      {
        customType: "kijek-log",
        data: {
          id: "kijek-2",
          timestamp: "2025-01-01T11:00:00.000Z",
          detectionType: "chainLoop",
          details: "Chain repeated 3 times",
          action: "silent",
        },
      },
    ];

    mgr.loadFromSession(makeMockSessionManager(sessionEntries));

    expect(mgr.getCount()).toBe(2);
    const entries = mgr.getEntries();
    expect(entries[0].detectionType).toBe("chainLoop"); // newest first
    expect(entries[1].detectionType).toBe("toolLoop");
  });

  it("ignores non-kijek-log entries", () => {
    const mgr = new LogManager();
    const sessionEntries = [
      {
        customType: "some-other-type",
        data: { foo: "bar" },
      },
      {
        customType: "kijek-log",
        data: {
          id: "kijek-1",
          timestamp: "2025-01-01T10:00:00.000Z",
          detectionType: "toolLoop",
          details: "Tool 'read' called 5 times",
          action: "alert",
        },
      },
    ];

    mgr.loadFromSession(makeMockSessionManager(sessionEntries));

    expect(mgr.getCount()).toBe(1);
  });

  it("ignores malformed kijek-log entries", () => {
    const mgr = new LogManager();
    const sessionEntries = [
      {
        customType: "kijek-log",
        data: { id: "kijek-1" }, // missing required fields
      },
      {
        customType: "kijek-log",
        data: {
          id: "kijek-2",
          timestamp: "2025-01-01T10:00:00.000Z",
          detectionType: "toolLoop",
          details: "Tool 'read' called 5 times",
          action: "alert",
        },
      },
    ];

    mgr.loadFromSession(makeMockSessionManager(sessionEntries));

    expect(mgr.getCount()).toBe(1);
  });

  it("sorts entries by timestamp", () => {
    const mgr = new LogManager();
    const sessionEntries = [
      {
        customType: "kijek-log",
        data: {
          id: "kijek-3",
          timestamp: "2025-01-01T12:00:00.000Z",
          detectionType: "outputLoop",
          details: "x",
          action: "alert",
        },
      },
      {
        customType: "kijek-log",
        data: {
          id: "kijek-1",
          timestamp: "2025-01-01T10:00:00.000Z",
          detectionType: "toolLoop",
          details: "x",
          action: "alert",
        },
      },
      {
        customType: "kijek-log",
        data: {
          id: "kijek-2",
          timestamp: "2025-01-01T11:00:00.000Z",
          detectionType: "chainLoop",
          details: "x",
          action: "alert",
        },
      },
    ];

    mgr.loadFromSession(makeMockSessionManager(sessionEntries));

    // In-memory store is sorted ascending
    const stored = mgr["entries"] as LogEntry[];
    expect(stored[0].id).toBe("kijek-1");
    expect(stored[1].id).toBe("kijek-2");
    expect(stored[2].id).toBe("kijek-3");
    // getEntries() reverses, so newest first
    const entries = mgr.getEntries();
    expect(entries[0].id).toBe("kijek-3");
  });
});

// ---------------------------------------------------------------------------
// Tests — clear
// ---------------------------------------------------------------------------

describe("clear", () => {
  it("removes all log entries", () => {
    const mgr = new LogManager();
    mgr.setAppendEntry(vi.fn());

    mgr.addEntry(makeDetection(), "alert");
    mgr.addEntry(makeDetection("chainLoop"), "silent");

    expect(mgr.getCount()).toBe(2);

    mgr.clear();

    expect(mgr.getCount()).toBe(0);
    expect(mgr.getEntries()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — getCount
// ---------------------------------------------------------------------------

describe("getCount", () => {
  it("returns the total number of entries", () => {
    const mgr = new LogManager();
    mgr.setAppendEntry(vi.fn());

    expect(mgr.getCount()).toBe(0);

    mgr.addEntry(makeDetection(), "alert");
    expect(mgr.getCount()).toBe(1);

    mgr.addEntry(makeDetection("chainLoop"), "silent");
    expect(mgr.getCount()).toBe(2);
  });
});
