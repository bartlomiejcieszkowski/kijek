/**
 * Kijek — LLM Loop Detector & Nudge Extension
 *
 * Monitors tool calls, reasoning blocks, and output messages for repetitive
 * patterns. When a loop is detected, applies the configured nudge strategy
 * (silent / alert / interrupt) and logs the event.
 *
 * Commands:
 *   /kijek            Show current configuration
 *   /kijek mode       Set nudge mode (silent | alert | interrupt)
 *   /kijek prompt     Set nudge prompt (simple | subtle | moderate | direct | technical | custom)
 *   /kijek sensitivity Set sensitivity (conservative | balanced | aggressive)
 *   /kijek thresholds Show current thresholds
 *   /kijek toggle     Toggle a detection type on/off (tool | chain | reasoning | output)
 *   /kijek status     Alias for showing current config
 *   /kijek-log        Toggle sidebar widget / show last 20 log entries
 */

import { LoopDetector, type DetectionResult } from "./detector.js";
import { getNudgePrompt, loadConfig, saveConfig, type KijekConfig, DEFAULT_CONFIG } from "./config.js";
import { applyNudge, type KijekNudgeEntry } from "./nudge.js";
import { LogManager, type LogEntry } from "./log.js";

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
  };
  isIdle(): boolean;
}

/** Minimal extension command context. */
interface MinimalExtensionCommandContext {
  ui: {
    notify(message: string, type?: "info" | "warning" | "error"): void;
    setWidget(key: string, content: string[] | undefined): void;
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
  lines.push("┌─ Kijek Configuration ─────────────────────┐");
  lines.push(`│ Nudge mode:       ${cfg.nudgeMode.padEnd(30)}│`);
  lines.push(`│ Nudge prompt:     ${cfg.nudgePrompt.padEnd(30)}│`);
  if (cfg.nudgePrompt === "custom" && cfg.nudgePromptCustom) {
    lines.push(`│ Custom prompt:    ${(cfg.nudgePromptCustom.length > 28 ? cfg.nudgePromptCustom.slice(0, 28) + "…" : cfg.nudgePromptCustom).padEnd(30)}│`);
  }
  lines.push(`│ Sensitivity:      ${cfg.sensitivity.padEnd(30)}│`);
  lines.push("│                                            │");
  lines.push("│ Detection thresholds:                     │");
  lines.push(`│   Tool loop:      ${cfg.detection.toolLoopThreshold.toString().padEnd(26)}│`);
  lines.push(`│   Chain loop:     ${cfg.detection.chainLoopThreshold.toString().padEnd(26)}│`);
  lines.push(`│   Reasoning loop: ${cfg.detection.reasoningLoopThreshold.toString().padEnd(26)}│`);
  lines.push(`│   Output similar.: ${(cfg.detection.outputSimilarityThreshold.toFixed(2)).padEnd(26)}│`);
  lines.push("│                                            │");
  lines.push("│ Enabled:                                  │");
  const enabled = cfg.enabled;
  lines.push(`│   Tool loop:    ${(enabled.toolLoop ? "✓ yes" : "✗ no").padEnd(30)}│`);
  lines.push(`│   Chain loop:   ${(enabled.chainLoop ? "✓ yes" : "✗ no").padEnd(30)}│`);
  lines.push(`│   Reasoning:    ${(enabled.reasoningLoop ? "✓ yes" : "✗ no").padEnd(30)}│`);
  lines.push(`│   Output loop:  ${(enabled.outputLoop ? "✓ yes" : "✗ no").padEnd(30)}│`);
  lines.push("└────────────────────────────────────────────┘");
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
  pi.on("turn_start", () => {
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
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Register all /kijek commands. */
function registerCommands(api: MinimalExtensionAPI): void {
  // ── /kijek-log ─────────────────────────────────────────────────────────
  api.registerCommand("kijek-log", {
    description: "Toggle Kijek log sidebar widget",
    handler: async (_args: string, ctx: MinimalExtensionCommandContext) => {
      if (!logManager) {
        ctx.ui.notify("Kijek not initialised. Start a new session.", "warning");
        return;
      }

      const visible = logManager.toggleWidget();

      if (visible) {
        // Show widget
        ctx.ui.setWidget("kijek-log", logManager.renderWidgetLines());
        ctx.ui.notify("Kijek log widget enabled", "info");
      } else {
        // Hide widget
        ctx.ui.setWidget("kijek-log", undefined);
        ctx.ui.notify("Kijek log widget disabled", "info");
      }
    },
  });

  // ── /kijek ─────────────────────────────────────────────────────────────
  api.registerCommand("kijek", {
    description: "Kijek loop detector configuration",
    handler: async (args: string, ctx: MinimalExtensionCommandContext) => {
      if (!detector) {
        ctx.ui.notify("Kijek not initialised. Start a new session.", "warning");
        return;
      }

      const trimmed = args.trim();

      // ── Show config (no args or "status") ────────────────────────────
      if (trimmed === "" || trimmed === "status") {
        ctx.ui.notify(formatConfig(config), "info");
        return;
      }

      const parts = trimmed.split(/\s+/);
      const subcommand = parts[0].toLowerCase();
      const subArgs = parts.slice(1).join(" ");

      // ── mode ─────────────────────────────────────────────────────────
      if (subcommand === "mode") {
        if (!subArgs) {
          ctx.ui.notify(`Current nudge mode: ${config.nudgeMode}\nUsage: /kijek mode <silent|alert|interrupt>`, "info");
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
          ctx.ui.notify(`Current nudge prompt: ${config.nudgePrompt}\nUsage: /kijek prompt <simple|subtle|moderate|direct|technical|custom>`, "info");
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
          ctx.ui.notify(`Current sensitivity: ${config.sensitivity}\nUsage: /kijek sensitivity <conservative|balanced|aggressive>`, "info");
          return;
        }
        const sensitivity = subArgs.toLowerCase() as KijekConfig["sensitivity"];
        if (sensitivity !== "conservative" && sensitivity !== "balanced" && sensitivity !== "aggressive") {
          ctx.ui.notify(`Invalid sensitivity: ${sensitivity}. Use: conservative, balanced, or aggressive`, "warning");
          return;
        }
        config.sensitivity = sensitivity;
        // Apply sensitivity preset
        const preset = DEFAULT_CONFIG.detection;
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
          ctx.ui.notify(`Usage: /kijek thresholds <tool|chain|reasoning|output> <value>`, "warning");
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
            `Current detection state:\n  Tool loop: ${config.enabled.toolLoop ? "on" : "off"}\n  Chain loop: ${config.enabled.chainLoop ? "on" : "off"}\n  Reasoning loop: ${config.enabled.reasoningLoop ? "on" : "off"}\n  Output loop: ${config.enabled.outputLoop ? "on" : "off"}\n\nUsage: /kijek toggle <tool|chain|reasoning|output>`,
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
        `Unknown subcommand: ${subcommand}\n\nUsage:\n  /kijek                          Show config\n  /kijek mode <silent|alert|interrupt>\n  /kijek prompt <simple|...|custom>\n  /kijek sensitivity <conservative|balanced|aggressive>\n  /kijek thresholds [type <value>]\n  /kijek toggle <tool|chain|reasoning|output>\n  /kijek status                   Show config`,
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
