/**
 * Kijek — LLM Loop Detector & Nudge Extension
 *
 * Monitors tool calls, reasoning blocks, and output messages for repetitive
 * patterns. When a loop is detected, applies the configured nudge strategy
 * (silent / alert / interrupt) and logs the event.
 *
 * Commands:
 *   /kijek            Manually nudge the LLM (hit it with a stick)
 *   /kijek [message]  Same with custom message
 *   /kijek-config     Show current configuration
 *   /kijek-config mode       Set nudge mode (silent | alert | interrupt)
 *   /kijek-config prompt     Set nudge prompt (simple | subtle | moderate | direct | technical | custom)
 *   /kijek-config sensitivity Set sensitivity (conservative | balanced | aggressive)
 *   /kijek-config thresholds Show current thresholds
 *   /kijek-config toggle     Toggle a detection type on/off (tool | chain | reasoning | output)
 *   /kijek-config status     Alias for showing current config
 *   /kijek-log        Toggle sidebar widget / show last 20 log entries
 *   /kijek-dump       Dump current message state as a debug fixture
 */

import { LoopDetector, type DetectionResult, type DebugDump } from "./detector.js";
import { getNudgePrompt, loadConfig, saveConfig, type KijekConfig, DEFAULT_CONFIG } from "./config.js";
import { applyNudge, type KijekNudgeEntry } from "./nudge.js";
import { LogManager } from "./log.js";

// ---------------------------------------------------------------------------
// Minimal Pi/TUI types (provided at runtime by @earendil-works/pi-coding-agent)
// ---------------------------------------------------------------------------

/** Minimal TUI interface for overlay components. */
interface TUI {
  requestRender(): void;
  showOverlay(component: unknown, options: { nonCapturing?: boolean; anchor?: string; width?: number }): OverlayHandle;
}

/** Minimal overlay handle for visibility control. */
interface OverlayHandle {
  setHidden(hidden: boolean): void;
}

/** Minimal Theme interface. */
interface Theme {
  fg(color: string, text: string): string;
}

// ---------------------------------------------------------------------------
// Version — read from package.json at runtime
// ---------------------------------------------------------------------------

/** Dynamic version string from package.json. */
let version = "unknown";
try {
  const pkg = JSON.parse(require("fs").readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
  version = pkg.version ?? "unknown";
} catch {
  // package.json not found — keep default
}

// ---------------------------------------------------------------------------
// File system helpers
// ---------------------------------------------------------------------------

/** Get the debug dump directory path (next to kijek.json). */
function getDebugDir(): string {
  const base = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return `${base}/.pi/agent/extensions/kijek/debug`;
}

/** Ensure the debug directory exists. */
function ensureDebugDir(): void {
  const fs = require("fs");
  const dir = getDebugDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Minimal Pi types (provided at runtime by @earendil-works/pi-coding-agent)
// ---------------------------------------------------------------------------

/** Minimal extension API — the only methods we need from Pi. */
interface MinimalExtensionAPI {
  on(event: string, handler: (...args: unknown[]) => void): void;
  registerCommand(name: string, def: {
    description: string;
    handler: (args: string, ctx: MinimalExtensionCommandContext) => Promise<void>;
  }): void;
  appendEntry<T>(type: string, data: T): void;
  sendUserMessage(message: string, options?: { deliverAs: "steer" | "followUp" }): void;
  registerEntryRenderer<T>(type: string, renderer: (entry: { data?: T }, options: { expanded: boolean }) => unknown): void;
  sessionManager?: { getEntries(): Array<{ type: string; customType?: string; data?: unknown; id: string; parentId: string | null; timestamp: string }> };
}

/** Minimal extension context. */
interface MinimalExtensionContext {
  ui: {
    notify(message: string, type?: "info" | "warning" | "error"): void;
    setWidget(key: string, content: string[] | undefined): void;
    custom<T>(component: (tui: TUI, theme: Theme, kb: unknown, done: () => void) => T, options?: { overlay?: boolean; overlayOptions?: { anchor?: string; width?: number }; nonCapturing?: boolean }): Promise<T>;
  };
  isIdle(): boolean;
}

/** Minimal extension command context. */
interface MinimalExtensionCommandContext {
  ui: {
    notify(message: string, type?: "info" | "warning" | "error"): void;
    setWidget(key: string, content: string[] | undefined): void;
    custom<T>(component: (tui: TUI, theme: Theme, kb: unknown, done: () => void) => T, options?: { overlay?: boolean; overlayOptions?: { anchor?: string; width?: number }; nonCapturing?: boolean }): Promise<T>;
  };
  isIdle(): boolean;
}

/** Minimal tool call event. */
interface MinimalToolCallEvent {
  toolName: string;
  input: Record<string, unknown>;
}

/** Minimal assistant message event. */
interface MinimalMessageEvent {
  message: { role: string; content: string };
}

/** Minimal session start event. */
interface MinimalSessionStartEvent {
  reason: string;
}

/** Global pi reference — set by the extension factory. */
let pi: MinimalExtensionAPI;

/** Deferred detection result — processed when we have context. */
let deferredDetection: DetectionResult | null = null;

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let config: KijekConfig = DEFAULT_CONFIG;
let detector: LoopDetector | null = null;
let logManager: LogManager | null = null;
let currentMessage = false;
let logOverlayHandle: OverlayHandle | null = null;
let debugOverlayHandle: OverlayHandle | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Initialise the detector and log manager with the current config. */
function initDetector(cfg: KijekConfig): void {
  detector = new LoopDetector(cfg);
  logManager = new LogManager();
  if (pi) {
    logManager.setAppendEntry((customType, data) => {
      pi.appendEntry(customType, data);
    });
  }
}

/** Format the current config as a readable string. */
function formatConfig(cfg: KijekConfig): string {
  const lines: string[] = [];
  lines.push(`┌─ Kijek v${version.padEnd(8)} ──────────────────────────┐`);
  const padEnd = lines[0].length - 21 - 1;
  lines.push(`│ Nudge mode:        ${cfg.nudgeMode.padEnd(padEnd)}│`);
  lines.push(`│ Nudge prompt:      ${cfg.nudgePrompt.padEnd(padEnd)}│`);
  if (cfg.nudgePrompt === "custom" && cfg.nudgePromptCustom) {
    lines.push(`│ Custom prompt:     ${(cfg.nudgePromptCustom.length > padEnd ? cfg.nudgePromptCustom.slice(0, padEnd-3) + "…" : cfg.nudgePromptCustom).padEnd(padEnd)}│`);
  }
  lines.push(`│ Sensitivity:       ${cfg.sensitivity.padEnd(padEnd)}│`);
  lines.push("│                                            │");
  lines.push("│ Detection thresholds:                      │");
  lines.push(`│   Tool loop:       ${cfg.detection.toolLoopThreshold.toString().padEnd(padEnd)}│`);
  lines.push(`│   Chain loop:      ${cfg.detection.chainLoopThreshold.toString().padEnd(padEnd)}│`);
  lines.push(`│   Reasoning loop:  ${cfg.detection.reasoningLoopThreshold.toString().padEnd(padEnd)}│`);
  lines.push(`│   Output similar.: ${(cfg.detection.outputSimilarityThreshold.toFixed(2)).padEnd(padEnd)}│`);
  lines.push("│                                            │");
  lines.push("│ Enabled:                                   │");
  const enabled = cfg.enabled;
  lines.push(`│   Tool loop:       ${(enabled.toolLoop ? "✓ yes" : "✗ no").padEnd(padEnd)}│`);
  lines.push(`│   Chain loop:      ${(enabled.chainLoop ? "✓ yes" : "✗ no").padEnd(padEnd)}│`);
  lines.push(`│   Reasoning:       ${(enabled.reasoningLoop ? "✓ yes" : "✗ no").padEnd(padEnd)}│`);
  lines.push(`│   Output loop:     ${(enabled.outputLoop ? "✓ yes" : "✗ no").padEnd(padEnd)}│`);
  lines.push("└────────────────────────── │ヽ༼ ͠ ͡° ͜ʖ ͡° ༽ﾉ┃ ─┘");
  return lines.join("\n");
}

/** Parse a detection type name to its config key. */
function detectionTypeToKey(type: string): keyof KijekConfig["enabled"] {
  switch (type) {
    case "tool": return "toolLoop";
    case "chain": return "chainLoop";
    case "reasoning": return "reasoningLoop";
    case "output": return "outputLoop";
    default: throw new Error(`Unknown detection type: ${type}`);
  }
}

// ---------------------------------------------------------------------------
// Nudge dispatcher
// ---------------------------------------------------------------------------

/**
 * When a loop is detected, apply the nudge and log the event.
 * Returns true if a nudge was applied.
 */
async function handleDetection(
  result: DetectionResult,
  ctx: MinimalExtensionContext,
): Promise<boolean> {
  if (!logManager) return false;

  // Apply the configured nudge
  await applyNudge(config, result, {
    pi: pi,
    ui: ctx.ui,
    isIdle: ctx.isIdle,
  });

  // Log the event
  logManager.addEntry(result, config.nudgeMode);

  return true;
}

// ---------------------------------------------------------------------------
// Event hooks
// ---------------------------------------------------------------------------

/** Register all event hooks on the Pi instance. */
function registerEventHooks(api: MinimalExtensionAPI): void {
  // ── session_start ──────────────────────────────────────────────────────
  api.on("session_start", (event: unknown) => {
    const e = event as MinimalSessionStartEvent;
    if (e.reason === "startup" || e.reason === "resume" || e.reason === "new") {
      // Load config and initialise detector
      config = loadConfig();
      initDetector(config);
    }
    // On branch change, reconstruct log entries from session
    if (logManager && api.sessionManager) {
      logManager.loadFromSession(api.sessionManager);
    }
  });

  // ── turn_start ─────────────────────────────────────────────────────────
  api.on("turn_start", () => {
    if (detector) {
      detector.startMessage();
      currentMessage = true;
    }
  });

  // ── tool_call ──────────────────────────────────────────────────────────
  api.on("tool_call", (event: unknown) => {
    if (!detector || !currentMessage) return;

    const e = event as MinimalToolCallEvent;
    const toolName = e.toolName;
    const input = e.input as Record<string, unknown>;

    const result = detector.recordToolCall(toolName, input);
    if (result) {
      // Store the result for deferred processing (see below)
      deferredDetection = result;
    }
  });

  // ── message_end ────────────────────────────────────────────────────────
  api.on("message_end", (event: unknown) => {
    if (!detector) return;

    const e = event as MinimalMessageEvent;
    if (e.message.role === "assistant") {
      const content = e.message.content;
      if (content && typeof content === "string") {
        const result = detector.recordOutput(content);
        if (result) {
          deferredDetection = result;
        }
      }
    }
  });

  // ── agent_end ──────────────────────────────────────────────────────────
  api.on("agent_end", () => {
    currentMessage = false;
    if (detector) {
      detector.reset();
    }
  });

  // ── session_tree (branch change) ───────────────────────────────────────
  api.on("session_tree", () => {
    // Reset detection state on branch change — abandoned branches' state
    // must not leak into the new branch.
    currentMessage = false;
    if (detector) {
      detector.reset();
    }
    // Reconstruct log entries from the new branch
    if (logManager && api.sessionManager) {
      logManager.loadFromSession(api.sessionManager);
    }
  });

  // ── session_shutdown ───────────────────────────────────────────────────
  api.on("session_shutdown", () => {
    currentMessage = false;
    if (detector) {
      detector.reset();
    }
  });

  // ── tool_result ────────────────────────────────────────────────────────
  // We don't need tool_result for detection (tool_call is sufficient),
  // but we register it for potential future use.
  api.on("tool_result", () => {
    // Reserved for future enhancements (e.g., detecting tool-result-based loops)
  });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Register all /kijek commands. */
function registerCommands(api: MinimalExtensionAPI): void {
  // ── /kijek-log ─────────────────────────────────────────────────────────
  api.registerCommand("kijek-log", {
    description: "Toggle Kijek log overlay (top-right)",
    handler: async (_args: string, ctx: MinimalExtensionCommandContext) => {
      if (!logManager) {
        ctx.ui.notify("Kijek not initialised. Start a new session.", "warning");
        return;
      }

      if (logOverlayHandle) {
        // Hide existing overlay
        logOverlayHandle.setHidden(true);
        logOverlayHandle = null;
        logManager.setOverlayVisible(false);
        ctx.ui.notify("╰( ･~･)つ── 🤖💬\nKijek log overlay disabled", "info");
      } else {
        // Show overlay
        logManager.setOverlayVisible(true);
        ctx.ui.notify("╰( ･~･)つ── 🤖💬\nKijek log overlay enabled", "info");
        await ctx.ui.custom<void>(
          (tui, theme, _kb, done) => new LogOverlayShell(tui, theme, done),
          { overlay: true, overlayOptions: { anchor: "top-right", width: 45 } },
        );
      }
    },
  });

  // ── Log overlay shell ──────────────────────────────────────────────────
  /**
   * Shell component — calls done() immediately so input isn't blocked,
   * then creates the actual non-capturing overlay via tui.showOverlay().
   */
  class LogOverlayShell {
    focused = false;
    private tui: TUI;
    private done: () => void;

    constructor(tui: TUI, _theme: Theme, done: () => void) {
      this.tui = tui;
      this.done = done;
      // Create the non-capturing overlay
      logOverlayHandle = this.tui.showOverlay(new LogOverlayComponent(), {
        nonCapturing: true,
        anchor: "top-right",
        width: 45,
      });
      // Done immediately — input is not blocked
      this.done();
    }

    render(_width: number): string[] {
      return [];
    }

    invalidate(): void {}

    dispose(): void {
      logOverlayHandle = null;
    }
  }

  // ── Log overlay component ──────────────────────────────────────────────
  /**
   * Log overlay component — renders the log entries in an overlay at top-right.
   */
  class LogOverlayComponent {
    focused = false;

    render(width: number): string[] {
      if (!logManager) return [];
      return logManager.renderOverlayLines();
    }

    invalidate(): void {}

    dispose(): void {}
  }

  // ── /kijek-debug ───────────────────────────────────────────────────────
  api.registerCommand("kijek-debug", {
    description: "Toggle Kijek debug overlay (top-right)",
    handler: async (_args: string, ctx: MinimalExtensionCommandContext) => {
      if (!detector) {
        ctx.ui.notify("Kijek not initialised. Start a new session.", "warning");
        return;
      }

      if (debugOverlayHandle) {
        // Hide existing overlay
        debugOverlayHandle.setHidden(true);
        debugOverlayHandle = null;
        ctx.ui.notify("╰( ･~･)つ── 🤖💬\nKijek debug overlay disabled", "info");
      } else {
        // Show overlay
        ctx.ui.notify("╰( ･~･)つ── 🤖💬\nKijek debug overlay enabled", "info");
        await ctx.ui.custom<void>(
          (tui, theme, _kb, done) => new DebugOverlayShell(tui, theme, done),
          { overlay: true, overlayOptions: { anchor: "top-right", width: 45 } },
        );
      }
    },
  });

  // ── Debug overlay shell ────────────────────────────────────────────────
  /**
   * Shell component — calls done() immediately so input isn't blocked,
   * then creates the actual non-capturing overlay via tui.showOverlay().
   */
  class DebugOverlayShell {
    focused = false;
    private tui: TUI;
    private done: () => void;

    constructor(tui: TUI, _theme: Theme, done: () => void) {
      this.tui = tui;
      this.done = done;
      // Create the non-capturing overlay
      debugOverlayHandle = this.tui.showOverlay(new DebugOverlayComponent(), {
        nonCapturing: true,
        anchor: "top-right",
        width: 45,
      });
      // Done immediately — input is not blocked
      this.done();
    }

    render(_width: number): string[] {
      return [];
    }

    invalidate(): void {}

    dispose(): void {
      debugOverlayHandle = null;
    }
  }

  // ── Debug overlay component ────────────────────────────────────────────
  /**
   * Debug overlay component — renders the current detector state.
   */
  class DebugOverlayComponent {
    focused = false;

    render(width: number): string[] {
      if (!detector) return [];

      const state = detector.getDebugState();
      const toolCalls = detector.getToolCallHistory();
      const reasoning = detector.getReasoningBlocks();
      const output = detector.getOutputBlocks();

      const innerW = Math.max(1, width - 2);
      const border = (c: string) => `│${c.padEnd(innerW)}│`;
      const padLine = (s: string) => s.padEnd(innerW);
      const lines: string[] = [];

      lines.push(`┌${"─".repeat(innerW)}┐`);
      lines.push(border(" Kijek Debug"));
      lines.push(`├${"─".repeat(innerW)}┤`);
      lines.push(border(`Tool calls: ${toolCalls.length}`));
      lines.push(border(`Reasoning:  ${reasoning.length}`));
      lines.push(border(`Output:     ${output.length}`));
      lines.push(`├${"─".repeat(innerW)}┤`);

      // Tool loop state
      if (state.toolCounts.length > 0) {
        lines.push(border("Tool loops:"));
        for (const t of state.toolCounts) {
          const prefix = t.approaching ? "⚠" : "·";
          lines.push(border(`  ${prefix} ${t.name}: ${t.count}/${t.threshold}`));
        }
      }

      // Chain loop state
      if (state.chainFrequencies.length > 0) {
        lines.push(border("Chain loops:"));
        const maxChains = 3;
        const recent = state.chainFrequencies.slice(0, maxChains);
        for (const c of recent) {
          const prefix = c.approaching ? "⚠" : "·";
          const shortSeq = c.sequence.length > innerW - 8 ? c.sequence.slice(0, innerW - 11) + "…" : c.sequence;
          lines.push(border(`  ${prefix} ${shortSeq}: ${c.count}/${c.threshold}`));
        }
      }

      // Reasoning loop state
      if (state.reasoningLast) {
        const r = state.reasoningLast;
        const prefix = r.approaching ? "⚠" : "·";
        const shortText = r.text.length > innerW - 10 ? r.text.slice(0, innerW - 13) + "…" : r.text;
        lines.push(border(`  ${prefix} Reasoning: ${shortText}`));
        lines.push(border(`      similarity: ${r.similarity.toFixed(2)} / ${r.threshold}`));
      }

      // Output loop state
      if (state.outputLast) {
        const o = state.outputLast;
        const prefix = o.approaching ? "⚠" : "·";
        const shortText = o.text.length > innerW - 10 ? o.text.slice(0, innerW - 13) + "…" : o.text;
        lines.push(border(`  ${prefix} Output: ${shortText}`));
        lines.push(border(`      similarity: ${o.similarity.toFixed(2)} / ${o.threshold}`));
      }

      if (toolCalls.length === 0 && reasoning.length === 0 && output.length === 0) {
        lines.push(border("No events yet."));
      }

      lines.push(`└${"─".repeat(innerW)}┘`);

      return lines;
    }

    invalidate(): void {}

    dispose(): void {}
  }

  // ── /kijek-dump ────────────────────────────────────────────────────────
  api.registerCommand("kijek-dump", {
    description: "Dump current message state as a debug fixture",
    handler: async (_args: string, ctx: MinimalExtensionCommandContext) => {
      if (!detector) {
        ctx.ui.notify("Kijek not initialised. Start a new session.", "warning");
        return;
      }

      ensureDebugDir();

      const dump: DebugDump = {
        scenario: "captured-from-pi",
        capturedAt: new Date().toISOString(),
        events: [
          ...detector.getToolCallHistory().map((t) => ({
            type: "tool_call" as const,
            toolName: t.name,
            input: t.input,
          })),
          ...detector.getReasoningBlocks().map((r) => ({
            type: "reasoning" as const,
            text: r.text,
          })),
          ...detector.getOutputBlocks().map((o) => ({
            type: "output" as const,
            text: o.text,
          })),
        ],
      };

      const fs = require("fs");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `dump-${timestamp}.json`;
      const filepath = `${getDebugDir()}/${filename}`;

      fs.writeFileSync(filepath, JSON.stringify(dump, null, 2));

      ctx.ui.notify(`(╯°□°)╯︵ ┻━┻ 🤖💬\nKijek dump saved to ${filepath}\nEvents: ${dump.events.length}`, "info");
    },
  });

  // ── /kijek ─────────────────────────────────────────────────────────────
  // Manual nudge — "hit the LLM with a stick" regardless of detection
  api.registerCommand("kijek", {
    description: "Manually nudge the LLM (hit it with a stick)",
    handler: async (args: string, ctx: MinimalExtensionCommandContext) => {
      if (!logManager) {
        ctx.ui.notify("Kijek not initialised. Start a new session.", "warning");
        return;
      }

      const customMessage = args.trim() || undefined;

      // Build a manual detection result
      const result: DetectionResult = {
        type: "toolLoop",
        details: customMessage || "Manual nudge — user hit the LLM with a stick",
        count: 1,
      };

      // Apply the configured nudge
      await applyNudge(config, result, {
        pi,
        ui: ctx.ui,
        isIdle: ctx.isIdle,
      });

      // Log the manual nudge
      logManager.addEntry(result, config.nudgeMode);

      ctx.ui.notify(`╰( °□°)つ───🤖💬\nStick applied!`, "info");
    },
  });

  // ── /kijek-config ──────────────────────────────────────────────────────
  api.registerCommand("kijek-config", {
    description: "Kijek loop detector configuration",
    handler: async (args: string, ctx: MinimalExtensionCommandContext) => {
      if (!detector) {
        ctx.ui.notify("Kijek not initialised. Start a new session.", "warning");
        return;
      }

      const trimmed = args.trim();

      // ── Show config (no args or "status") ────────────────────────────
      if (trimmed === "" || trimmed === "status") {
        ctx.ui.notify(`╰( ･~･)つ── 🤖💬\n${formatConfig(config)}`, "info");
        return;
      }

      const parts = trimmed.split(/\s+/);
      const subcommand = parts[0].toLowerCase();
      const subArgs = parts.slice(1).join(" ");

      // ── mode ─────────────────────────────────────────────────────────
      if (subcommand === "mode") {
        if (!subArgs) {
          ctx.ui.notify(`Current nudge mode: ${config.nudgeMode}\nUsage: /kijek-config mode <silent|alert|interrupt>`, "info");
          return;
        }
        const mode = subArgs.toLowerCase() as KijekConfig["nudgeMode"];
        if (mode !== "silent" && mode !== "alert" && mode !== "interrupt") {
          ctx.ui.notify(`Invalid mode: ${mode}. Use: silent, alert, or interrupt`, "warning");
          return;
        }
        config.nudgeMode = mode;
        saveConfig(config);
        ctx.ui.notify(`Nudge mode set to: ${mode}`, "info");
        return;
      }

      // ── prompt ───────────────────────────────────────────────────────
      if (subcommand === "prompt") {
        if (!subArgs) {
          ctx.ui.notify(`Current nudge prompt: ${config.nudgePrompt}\nUsage: /kijek-config prompt <simple|subtle|moderate|direct|technical|custom>`, "info");
          return;
        }
        const prompt = subArgs.toLowerCase() as KijekConfig["nudgePrompt"];
        if (prompt !== "simple" && prompt !== "subtle" && prompt !== "moderate" && prompt !== "direct" && prompt !== "technical" && prompt !== "custom") {
          ctx.ui.notify(`Invalid prompt: ${prompt}. Use: simple, subtle, moderate, direct, technical, or custom`, "warning");
          return;
        }
        config.nudgePrompt = prompt;
        saveConfig(config);
        ctx.ui.notify(`Nudge prompt set to: ${prompt}`, "info");
        return;
      }

      // ── sensitivity ──────────────────────────────────────────────────
      if (subcommand === "sensitivity") {
        if (!subArgs) {
          ctx.ui.notify(`Current sensitivity: ${config.sensitivity}\nUsage: /kijek-config sensitivity <conservative|balanced|aggressive>`, "info");
          return;
        }
        const sensitivity = subArgs.toLowerCase() as KijekConfig["sensitivity"];
        if (sensitivity !== "conservative" && sensitivity !== "balanced" && sensitivity !== "aggressive") {
          ctx.ui.notify(`Invalid sensitivity: ${sensitivity}. Use: conservative, balanced, or aggressive`, "warning");
          return;
        }
        config.sensitivity = sensitivity;
        // Apply sensitivity preset
        const presetMap: Record<string, { toolLoopThreshold: number; reasoningLoopThreshold: number; outputSimilarityThreshold: number }> = {
          conservative: { toolLoopThreshold: 10, reasoningLoopThreshold: 10, outputSimilarityThreshold: 0.95 },
          balanced: { toolLoopThreshold: 5, reasoningLoopThreshold: 5, outputSimilarityThreshold: 0.85 },
          aggressive: { toolLoopThreshold: 3, reasoningLoopThreshold: 3, outputSimilarityThreshold: 0.70 },
        };
        const values = presetMap[sensitivity];
        if (values) {
          config.detection = { ...config.detection, ...values };
        }
        saveConfig(config);
        ctx.ui.notify(`Sensitivity set to: ${sensitivity}`, "info");
        return;
      }

      // ── thresholds ───────────────────────────────────────────────────
      if (subcommand === "thresholds") {
        if (!subArgs) {
          ctx.ui.notify(
            `Current thresholds:\n  Tool loop: ${config.detection.toolLoopThreshold}\n  Chain loop: ${config.detection.chainLoopThreshold}\n  Reasoning loop: ${config.detection.reasoningLoopThreshold}\n  Output similarity: ${config.detection.outputSimilarityThreshold}`,
            "info",
          );
          return;
        }
        // /kijek thresholds tool <N>
        const threshParts = subArgs.split(/\s+/);
        if (threshParts.length < 2) {
          ctx.ui.notify(`Usage: /kijek-config thresholds <tool|chain|reasoning|output> <value>`, "warning");
          return;
        }
        const threshType = threshParts[0].toLowerCase();
        const value = parseInt(threshParts[1], 10);
        if (isNaN(value) || value < 1) {
          ctx.ui.notify(`Invalid threshold value: ${threshParts[1]}. Must be a positive integer.`, "warning");
          return;
        }
        switch (threshType) {
          case "tool":
            config.detection.toolLoopThreshold = value;
            break;
          case "chain":
            config.detection.chainLoopThreshold = value;
            break;
          case "reasoning":
            config.detection.reasoningLoopThreshold = value;
            break;
          case "output":
            config.detection.outputSimilarityThreshold = Math.min(1, Math.max(0, value / 100));
            break;
          default:
            ctx.ui.notify(`Unknown threshold type: ${threshType}. Use: tool, chain, reasoning, output`, "warning");
            return;
        }
        saveConfig(config);
        ctx.ui.notify(`Threshold set: ${threshType} = ${threshType === "output" ? (value / 100).toFixed(2) : value}`, "info");
        return;
      }

      // ── toggle ───────────────────────────────────────────────────────
      if (subcommand === "toggle") {
        if (!subArgs) {
          ctx.ui.notify(
            `Current detection state:\n  Tool loop: ${config.enabled.toolLoop ? "on" : "off"}\n  Chain loop: ${config.enabled.chainLoop ? "on" : "off"}\n  Reasoning loop: ${config.enabled.reasoningLoop ? "on" : "off"}\n  Output loop: ${config.enabled.outputLoop ? "on" : "off"}\n\nUsage: /kijek-config toggle <tool|chain|reasoning|output>`,
            "info",
          );
          return;
        }
        const key = detectionTypeToKey(subArgs.toLowerCase());
        config.enabled[key] = !config.enabled[key];
        saveConfig(config);
        const label = { toolLoop: "Tool loop", chainLoop: "Chain loop", reasoningLoop: "Reasoning loop", outputLoop: "Output loop" }[key];
        ctx.ui.notify(`${label} detection ${config.enabled[key] ? "enabled" : "disabled"}`, "info");
        return;
      }

      // ── Unknown subcommand ───────────────────────────────────────────
      ctx.ui.notify(
        `Unknown subcommand: ${subcommand}\n\nUsage:\n  /kijek                          Manual nudge (hit with a stick)\n  /kijek [message]                Same with custom message\n  /kijek-config                   Show config\n  /kijek-config mode <silent|alert|interrupt>\n  /kijek-config prompt <simple|...|custom>\n  /kijek-config sensitivity <conservative|balanced|aggressive>\n  /kijek-config thresholds [type <value>]\n  /kijek-config toggle <tool|chain|reasoning|output>\n  /kijek-config status            Show config\n  /kijek-config mode              Show current mode\n  /kijek-config prompt            Show current prompt\n  /kijek-config sensitivity       Show current sensitivity\n  /kijek-config thresholds        Show current thresholds\n  /kijek-config toggle            Show detection state\n  /kijek-log                      Toggle log widget\n  /kijek-dump                     Dump debug fixture`,
        "warning",
      );
    },
  });
}

// ---------------------------------------------------------------------------
// Entry renderer
// ---------------------------------------------------------------------------

/** Register custom entry renderers for Kijek entries. */
function registerEntryRenderers(api: MinimalExtensionAPI): void {
  // Render nudge entries (silent mode)
  api.registerEntryRenderer<KijekNudgeEntry>("kijek-nudge", (entry, { expanded }) => {
    const { Box, Text } = require("@earendil-works/pi-tui");
    const data = entry.data as KijekNudgeEntry ?? { nudgeText: "Nudge", timestamp: Date.now(), detectionType: "toolLoop" as const, details: "", count: 0 };
    const box = new Box(1, 1, (text: string) => require("@earendil-works/pi-tui").fg("dim", text));
    box.addChild(new Text(`[Kijek] ${data.nudgeText}`, 0, 0));
    if (expanded) {
      box.addChild(new Text(`Type: ${data.detectionType} | Count: ${data.count}`, 0, 0));
    }
    return box;
  });
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

/**
 * Kijek extension factory.
 *
 * @param api — The Pi extension API instance.
 */
export default function kijekExtension(api: MinimalExtensionAPI): void {
  // Assign to global for use in helpers
  pi = api;

  // Load config immediately (defaults if file doesn't exist yet)
  config = loadConfig();
  initDetector(config);

  // Register event hooks
  registerEventHooks(api);

  // Register commands
  registerCommands(api);

  // Register entry renderers
  registerEntryRenderers(api);
}
