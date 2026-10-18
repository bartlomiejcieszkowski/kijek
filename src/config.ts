import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ── Types ──────────────────────────────────────────────────────────────────

export interface KijekConfig {
  nudgeMode: "silent" | "alert" | "interrupt";
  nudgePrompt:
    | "simple"
    | "subtle"
    | "moderate"
    | "direct"
    | "technical"
    | "custom";
  nudgePromptCustom?: string;
  sensitivity: "conservative" | "balanced" | "aggressive";
  detection: {
    toolLoopThreshold: number;
    chainLoopThreshold: number;
    chainLoopWindowSize: number;
    reasoningLoopThreshold: number;
    outputSimilarityThreshold: number;
  };
  enabled: {
    toolLoop: boolean;
    chainLoop: boolean;
    reasoningLoop: boolean;
    outputLoop: boolean;
  };
}

// ── Prompt presets ─────────────────────────────────────────────────────────

const PROMPT_PRESETS: Record<string, string> = {
  simple: "Are you stuck?",
  subtle:
    "You've been approaching this from the same angle. Consider a different strategy.",
  moderate:
    "You've repeated the same pattern multiple times without progress. Try a different approach.",
  direct: "You're in a loop. Stop what you're doing and start fresh.",
  technical:
    "You've executed the same tool/reasoning 5+ times. Pivot to a different approach.",
};

const VALID_PROMPTS = Object.keys(PROMPT_PRESETS);

// ── Sensitivity presets ────────────────────────────────────────────────────

interface SensitivityValues {
  toolLoopThreshold: number;
  chainLoopThreshold: number;
  chainLoopWindowSize: number;
  reasoningLoopThreshold: number;
  outputSimilarityThreshold: number;
}

const SENSITIVITY_PRESETS: Record<string, SensitivityValues> = {
  conservative: {
    toolLoopThreshold: 10,
    chainLoopThreshold: 10,
    chainLoopWindowSize: 3,
    reasoningLoopThreshold: 10,
    outputSimilarityThreshold: 0.95,
  },
  balanced: {
    toolLoopThreshold: 4,
    chainLoopThreshold: 4,
    chainLoopWindowSize: 3,
    reasoningLoopThreshold: 4,
    outputSimilarityThreshold: 0.85,
  },
  aggressive: {
    toolLoopThreshold: 3,
    chainLoopThreshold: 3,
    chainLoopWindowSize: 3,
    reasoningLoopThreshold: 3,
    outputSimilarityThreshold: 0.7,
  },
};

const VALID_SENSITIVITIES = Object.keys(SENSITIVITY_PRESETS);

// ── Defaults ───────────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: KijekConfig = {
  nudgeMode: "alert",
  nudgePrompt: "simple",
  sensitivity: "balanced",
  detection: {
    toolLoopThreshold: 4,
    chainLoopThreshold: 4,
    chainLoopWindowSize: 3,
    reasoningLoopThreshold: 4,
    outputSimilarityThreshold: 0.85,
  },
  enabled: {
    toolLoop: true,
    chainLoop: true,
    reasoningLoop: true,
    outputLoop: true,
  },
};

// ── Config file path ───────────────────────────────────────────────────────

function getConfigPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return join(home, ".pi", "agent", "extensions", "kijek.json");
}

function isValidConfig(config: unknown): config is KijekConfig {
  if (!config || typeof config !== "object") return false;
  const c = config as Record<string, unknown>;

  // Only validate fields that are present (partial configs are valid)
  if (c.nudgeMode !== undefined &&
      c.nudgeMode !== "silent" &&
      c.nudgeMode !== "alert" &&
      c.nudgeMode !== "interrupt")
    return false;
  if (c.nudgePrompt !== undefined &&
      c.nudgePrompt !== "custom" &&
      !VALID_PROMPTS.includes(c.nudgePrompt as string))
    return false;
  if (c.sensitivity !== undefined &&
      c.sensitivity !== "conservative" &&
      c.sensitivity !== "balanced" &&
      c.sensitivity !== "aggressive")
    return false;

  const det = c.detection;
  if (det && typeof det === "object") {
    const d = det as Record<string, unknown>;
    if (d.toolLoopThreshold !== undefined && typeof d.toolLoopThreshold !== "number") return false;
    if (d.chainLoopThreshold !== undefined && typeof d.chainLoopThreshold !== "number") return false;
    if (d.reasoningLoopThreshold !== undefined && typeof d.reasoningLoopThreshold !== "number") return false;
    if (d.outputSimilarityThreshold !== undefined && typeof d.outputSimilarityThreshold !== "number") return false;
  }

  const en = c.enabled;
  if (en && typeof en === "object") {
    const e = en as Record<string, unknown>;
    if (e.toolLoop !== undefined && typeof e.toolLoop !== "boolean") return false;
    if (e.chainLoop !== undefined && typeof e.chainLoop !== "boolean") return false;
    if (e.reasoningLoop !== undefined && typeof e.reasoningLoop !== "boolean") return false;
    if (e.outputLoop !== undefined && typeof e.outputLoop !== "boolean") return false;
  }

  return true;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Load configuration from the config file, falling back to defaults.
 */
export function loadConfig(): KijekConfig {
  const configPath = getConfigPath();

  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (isValidConfig(parsed)) {
        // Apply sensitivity preset if specified
        if (parsed.sensitivity && SENSITIVITY_PRESETS[parsed.sensitivity]) {
          const sensitivityValues =
            SENSITIVITY_PRESETS[parsed.sensitivity];
          // Only apply detection overrides if they differ from defaults
          const detOverride = parsed.detection as
            | Record<string, unknown>
            | undefined;
          const hasDetectionOverride =
            detOverride &&
            (detOverride.toolLoopThreshold !==
              DEFAULT_CONFIG.detection.toolLoopThreshold ||
              detOverride.chainLoopThreshold !==
                DEFAULT_CONFIG.detection.chainLoopThreshold ||
              detOverride.reasoningLoopThreshold !==
                DEFAULT_CONFIG.detection.reasoningLoopThreshold ||
              detOverride.outputSimilarityThreshold !==
                DEFAULT_CONFIG.detection.outputSimilarityThreshold);
          return {
            ...DEFAULT_CONFIG,
            ...parsed,
            detection: {
              ...DEFAULT_CONFIG.detection,
              ...sensitivityValues,
              ...(hasDetectionOverride ? (detOverride as Record<string, unknown>) : {}),
            },
          };
        }
        return { ...DEFAULT_CONFIG, ...parsed };
      }
      // Invalid config — fall through to defaults
    } catch {
      // Invalid JSON — fall through to defaults
    }
  }

  return { ...DEFAULT_CONFIG };
}

/**
 * Save configuration to the config file.
 */
export function saveConfig(config: KijekConfig): void {
  const configPath = getConfigPath();
  // Ensure directory exists
  const dir = configPath.slice(0, configPath.lastIndexOf("/"));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Get the nudge prompt text for the given config.
 */
export function getNudgePrompt(config: KijekConfig): string {
  if (config.nudgePrompt === "custom" && config.nudgePromptCustom) {
    return config.nudgePromptCustom;
  }
  return PROMPT_PRESETS[config.nudgePrompt] ?? PROMPT_PRESETS.simple;
}

/**
 * Apply a sensitivity preset to the config.
 */
export function applySensitivity(
  config: KijekConfig,
  sensitivity: "conservative" | "balanced" | "aggressive",
): KijekConfig {
  const values = SENSITIVITY_PRESETS[sensitivity];
  if (!values) return config;
  return {
    ...config,
    sensitivity,
    detection: {
      ...config.detection,
      ...values,
    },
  };
}

/**
 * Validate that a prompt name is known.
 */
export function isValidPrompt(prompt: string): boolean {
  return VALID_PROMPTS.includes(prompt);
}

/**
 * Validate that a sensitivity level is known.
 */
export function isValidSensitivity(sensitivity: string): boolean {
  return VALID_SENSITIVITIES.includes(sensitivity);
}
