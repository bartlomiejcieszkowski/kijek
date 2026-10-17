/**
 * Nudge Strategies — apply a configured nudge when a loop is detected.
 *
 * Three modes:
 * - silent: appendEntry("kijek-nudge", data) — transparent, no UI
 * - alert:  ctx.ui.notify() — visible notification
 * - interrupt: pi.sendUserMessage(text, { deliverAs: "steer" }) — mid-stream interrupt
 */

import { getNudgePrompt } from "./config.js";
import type { KijekConfig } from "./config.js";
import type { DetectionResult } from "./detector.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Data stored in a silent nudge entry. */
export interface KijekNudgeEntry {
  nudgeText: string;
  detectionType: DetectionResult["type"];
  details: DetectionResult["details"];
  count: DetectionResult["count"];
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the nudge text from config and detection result. */
function buildNudgeText(
  config: KijekConfig,
  result: DetectionResult,
): string {
  const base = getNudgePrompt(config);
  return `${base} (${result.details})`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Apply the configured nudge strategy for a detection result.
 *
 * @param config — Current Kijek configuration.
 * @param result — The detection result that triggered the nudge.
 * @param ctx    — Extension context (pi, ui, etc.).
 */
export async function applyNudge(
  config: KijekConfig,
  result: DetectionResult,
  ctx: {
    pi: {
      appendEntry: <T>(type: string, data: T) => void;
      sendUserMessage: (
        message: string,
        options?: { deliverAs: "steer" | "followUp" },
      ) => void;
    };
    ui: {
      notify: (message: string, level?: "info" | "warning" | "error") => void;
    };
    isIdle: () => boolean;
  },
): Promise<void> {
  const nudgeText = buildNudgeText(config, result);

  switch (config.nudgeMode) {
    case "silent": {
      // Append a custom entry that is NOT sent to the LLM.
      // The entry renderer (registered by the main extension) displays it
      // in the sidebar log but keeps it out of the conversation context.
      const entry: KijekNudgeEntry = {
        nudgeText,
        detectionType: result.type,
        details: result.details,
        count: result.count,
        timestamp: Date.now(),
      };
      ctx.pi.appendEntry("kijek-nudge", entry);
      break;
    }

    case "alert": {
      // Show a visible notification to the user.
      ctx.ui.notify(nudgeText, "warning");
      break;
    }

    case "interrupt": {
      // Send a steering message to interrupt the LLM mid-stream.
      // If the agent is idle, send as a normal user message.
      if (ctx.isIdle()) {
        ctx.pi.sendUserMessage(nudgeText);
      } else {
        ctx.pi.sendUserMessage(nudgeText, { deliverAs: "steer" });
      }
      break;
    }

    default: {
      // Exhaustive check — nudgeMode is a string literal union,
      // so this branch is unreachable at runtime.
      const _exhaustive: never = config.nudgeMode;
      throw new Error(`Unknown nudge mode: ${_exhaustive}`);
    }
  }
}
