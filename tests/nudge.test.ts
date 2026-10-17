import { describe, expect, it, vi } from "vitest";
import { applyNudge } from "../src/nudge.js";
import { loadConfig } from "../src/config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal mock context for applyNudge. */
function makeMockCtx() {
  const appendEntry = vi.fn();
  const sendUserMessage = vi.fn();
  const notify = vi.fn();
  const isIdle = vi.fn();

  return {
    ctx: {
      pi: { appendEntry, sendUserMessage },
      ui: { notify },
      isIdle,
    },
    appendEntry,
    sendUserMessage,
    notify,
    isIdle,
  };
}

/** Create a tool-loop detection result. */
function toolLoopResult(count = 5): import("../src/detector.js").DetectionResult {
  return { type: "toolLoop", details: `Tool 'read' called ${count} times in this message`, count };
}

/** Create a chain-loop detection result. */
function chainLoopResult(count = 3): import("../src/detector.js").DetectionResult {
  return { type: "chainLoop", details: `Chain loop detected: 'read,write' repeated ${count} times`, count };
}

/** Create a reasoning-loop detection result. */
function reasoningLoopResult(count = 5): import("../src/detector.js").DetectionResult {
  return { type: "reasoningLoop", details: `Reasoning similarity of 90.0% detected (threshold: 85.0%)`, count };
}

/** Create an output-loop detection result. */
function outputLoopResult(count = 5): import("../src/detector.js").DetectionResult {
  return { type: "outputLoop", details: `Output similarity of 85.0% detected (threshold: 85.0%)`, count };
}

// ---------------------------------------------------------------------------
// Tests — Silent mode
// ---------------------------------------------------------------------------

describe("silent mode", () => {
  it("appends a kijek-nudge entry", async () => {
    const config = loadConfig();
    config.nudgeMode = "silent";
    const { ctx, appendEntry } = makeMockCtx();

    await applyNudge(config, toolLoopResult(), ctx);

    expect(appendEntry).toHaveBeenCalledWith("kijek-nudge", expect.objectContaining({
      nudgeText: expect.stringContaining("Are you stuck?"),
      detectionType: "toolLoop",
      count: 5,
    }));
  });

  it("includes detection details in the entry", async () => {
    const config = loadConfig();
    config.nudgeMode = "silent";
    const { ctx, appendEntry } = makeMockCtx();

    await applyNudge(config, chainLoopResult(), ctx);

    expect(appendEntry).toHaveBeenCalledWith("kijek-nudge", expect.objectContaining({
      detectionType: "chainLoop",
      details: expect.stringContaining("Chain loop"),
    }));
  });

  it("works for reasoning loop", async () => {
    const config = loadConfig();
    config.nudgeMode = "silent";
    const { ctx, appendEntry } = makeMockCtx();

    await applyNudge(config, reasoningLoopResult(), ctx);

    expect(appendEntry).toHaveBeenCalledWith("kijek-nudge", expect.objectContaining({
      detectionType: "reasoningLoop",
    }));
  });

  it("works for output loop", async () => {
    const config = loadConfig();
    config.nudgeMode = "silent";
    const { ctx, appendEntry } = makeMockCtx();

    await applyNudge(config, outputLoopResult(), ctx);

    expect(appendEntry).toHaveBeenCalledWith("kijek-nudge", expect.objectContaining({
      detectionType: "outputLoop",
    }));
  });
});

// ---------------------------------------------------------------------------
// Tests — Alert mode
// ---------------------------------------------------------------------------

describe("alert mode", () => {
  it("shows a warning notification", async () => {
    const config = loadConfig();
    config.nudgeMode = "alert";
    const { ctx, notify } = makeMockCtx();

    await applyNudge(config, toolLoopResult(), ctx);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Are you stuck?"),
      "warning",
    );
  });

  it("includes detection details in notification", async () => {
    const config = loadConfig();
    config.nudgeMode = "alert";
    const { ctx, notify } = makeMockCtx();

    await applyNudge(config, chainLoopResult(), ctx);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Chain loop"),
      "warning",
    );
  });
});

// ---------------------------------------------------------------------------
// Tests — Interrupt mode (idle)
// ---------------------------------------------------------------------------

describe("interrupt mode (idle)", () => {
  it("sends a normal user message when idle", async () => {
    const config = loadConfig();
    config.nudgeMode = "interrupt";
    const { ctx, sendUserMessage, isIdle } = makeMockCtx();
    isIdle.mockReturnValue(true);

    await applyNudge(config, toolLoopResult(), ctx);

    expect(isIdle).toHaveBeenCalled();
    expect(sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("Are you stuck?"),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests — Interrupt mode (streaming)
// ---------------------------------------------------------------------------

describe("interrupt mode (streaming)", () => {
  it("sends a steer message when not idle", async () => {
    const config = loadConfig();
    config.nudgeMode = "interrupt";
    const { ctx, sendUserMessage, isIdle } = makeMockCtx();
    isIdle.mockReturnValue(false);

    await applyNudge(config, toolLoopResult(), ctx);

    expect(isIdle).toHaveBeenCalled();
    expect(sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("Are you stuck?"),
      { deliverAs: "steer" },
    );
  });
});

// ---------------------------------------------------------------------------
// Tests — Nudge prompt selection
// ---------------------------------------------------------------------------

describe("nudge prompt selection", () => {
  it("uses simple prompt (default)", async () => {
    const config = loadConfig();
    config.nudgeMode = "alert";
    const { ctx, notify } = makeMockCtx();

    await applyNudge(config, toolLoopResult(), ctx);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Are you stuck?"),
      "warning",
    );
  });

  it("uses subtle prompt", async () => {
    const config = loadConfig();
    config.nudgeMode = "alert";
    config.nudgePrompt = "subtle";
    const { ctx, notify } = makeMockCtx();

    await applyNudge(config, toolLoopResult(), ctx);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("different strategy"),
      "warning",
    );
  });

  it("uses direct prompt", async () => {
    const config = loadConfig();
    config.nudgeMode = "alert";
    config.nudgePrompt = "direct";
    const { ctx, notify } = makeMockCtx();

    await applyNudge(config, toolLoopResult(), ctx);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("You're in a loop"),
      "warning",
    );
  });

  it("uses technical prompt", async () => {
    const config = loadConfig();
    config.nudgeMode = "alert";
    config.nudgePrompt = "technical";
    const { ctx, notify } = makeMockCtx();

    await applyNudge(config, toolLoopResult(), ctx);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Pivot to a different approach"),
      "warning",
    );
  });

  it("uses custom prompt", async () => {
    const config = loadConfig();
    config.nudgeMode = "alert";
    config.nudgePrompt = "custom";
    config.nudgePromptCustom = "Take a breath.";
    const { ctx, notify } = makeMockCtx();

    await applyNudge(config, toolLoopResult(), ctx);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Take a breath"),
      "warning",
    );
  });
});

// ---------------------------------------------------------------------------
// Tests — Detection type details
// ---------------------------------------------------------------------------

describe("detection type details", () => {
  it("includes tool loop details", async () => {
    const config = loadConfig();
    config.nudgeMode = "alert";
    const { ctx, notify } = makeMockCtx();

    await applyNudge(config, toolLoopResult(), ctx);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("read"),
      "warning",
    );
  });

  it("includes chain loop details", async () => {
    const config = loadConfig();
    config.nudgeMode = "alert";
    const { ctx, notify } = makeMockCtx();

    await applyNudge(config, chainLoopResult(), ctx);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("read,write"),
      "warning",
    );
  });

  it("includes reasoning loop details", async () => {
    const config = loadConfig();
    config.nudgeMode = "alert";
    const { ctx, notify } = makeMockCtx();

    await applyNudge(config, reasoningLoopResult(), ctx);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("90.0%"),
      "warning",
    );
  });

  it("includes output loop details", async () => {
    const config = loadConfig();
    config.nudgeMode = "alert";
    const { ctx, notify } = makeMockCtx();

    await applyNudge(config, outputLoopResult(), ctx);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Output similarity"),
      "warning",
    );
  });
});

// ---------------------------------------------------------------------------
// Tests — Entry timestamp
// ---------------------------------------------------------------------------

describe("silent entry timestamp", () => {
  it("includes a timestamp", async () => {
    const config = loadConfig();
    config.nudgeMode = "silent";
    const { ctx, appendEntry } = makeMockCtx();
    const before = Date.now();

    await applyNudge(config, toolLoopResult(), ctx);

    const after = Date.now();
    const entry = appendEntry.mock.calls[0][1] as { timestamp: number };
    expect(entry.timestamp).toBeGreaterThanOrEqual(before);
    expect(entry.timestamp).toBeLessThanOrEqual(after);
  });
});
