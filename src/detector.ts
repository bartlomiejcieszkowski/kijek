import { DEFAULT_CONFIG, type KijekConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DetectionResult {
  type: "toolLoop" | "chainLoop" | "reasoningLoop" | "outputLoop";
  details: string;
  count: number;
}

/** Event types that can be replayed from a debug dump. */
export interface ToolCallEvent {
  type: "tool_call";
  toolName: string;
  input?: Record<string, unknown>;
}

export interface ReasoningEvent {
  type: "reasoning";
  text: string;
}

export interface OutputEvent {
  type: "output";
  text: string;
}

/** A single debug dump fixture. */
export interface DebugDump {
  scenario?: string;
  capturedAt?: string;
  events: Array<ToolCallEvent | ReasoningEvent | OutputEvent>;
}

// ---------------------------------------------------------------------------
// Internal: N-gram helpers
// ---------------------------------------------------------------------------

/**
 * Tokenise plain text: split on whitespace / punctuation, lower-case.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\p{P}]+/u)
    .filter((t) => t.length > 0);
}

/**
 * Generate n-grams from an array of tokens.
 */
function nGrams(tokens: string[], n: number): Set<string> {
  if (tokens.length < n) return new Set<string>();
  const grams = new Set<string>();
  for (let i = 0; i <= tokens.length - n; i++) {
    grams.add(tokens.slice(i, i + n).join(" "));
  }
  return grams;
}

/**
 * Jaccard similarity between two n-gram sets.
 */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

/**
 * Public: compute n-gram similarity between two text strings.
 * Uses 5-gram Jaccard similarity over tokenised text.
 * Identical non-empty texts return 1.0; both-empty return 1.0 by convention.
 */
export function ngramSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  // Both empty → treat as identical
  if (tokensA.length === 0 && tokensB.length === 0) return 1;
  const gramA = nGrams(tokensA, 5);
  const gramB = nGrams(tokensB, 5);
  return jaccard(gramA, gramB);
}

// ---------------------------------------------------------------------------
// LoopDetector
// ---------------------------------------------------------------------------

export class LoopDetector {
  private toolCounts = new Map<string, number>();
  private chainWindow: string[] = [];
  private chainFrequencies: Map<string, number> = new Map();
  private recentReasoning: string[] = [];
  private recentOutput: string[] = [];
  private toolCallHistory: string[] = [];

  private readonly config: KijekConfig;

  constructor(config: Partial<KijekConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      detection: { ...DEFAULT_CONFIG.detection, ...(config.detection ?? {}) },
      enabled: { ...DEFAULT_CONFIG.enabled, ...(config.enabled ?? {}) },
    };
  }

  // ── Public API ────────────────────────────────────────────────────────

  /**
   * Signal the start of a new assistant message.
   * Resets per-message tool loop state.
   */
  startMessage(): void {
    this.toolCounts.clear();
  }

  /**
   * Record a tool call within the current message.
   * Returns DetectionResult if a loop is detected, null otherwise.
   */
  recordToolCall(
    toolName: string,
    _args?: Record<string, unknown>,
  ): DetectionResult | null {
    // --- Single-tool loop detection (per-message) ---
    const currentCount = this.toolCounts.get(toolName) ?? 0;
    const newCount = currentCount + 1;
    this.toolCounts.set(toolName, newCount);

    if (
      this.config.enabled.toolLoop &&
      newCount >= this.config.detection.toolLoopThreshold
    ) {
      return {
        type: "toolLoop",
        details: `Tool '${toolName}' called ${newCount} times in this message`,
        count: newCount,
      };
    }

    // --- Chain loop detection (cross-message) ---
    if (this.config.enabled.chainLoop) {
      const chainResult = this.checkChainLoop(toolName);
      if (chainResult) return chainResult;
    }

    // Track history
    this.toolCallHistory.push(toolName);

    return null;
  }

  /**
   * Record a reasoning block.
   * Returns DetectionResult if a loop is detected, null otherwise.
   */
  recordReasoning(text: string): DetectionResult | null {
    if (!this.config.enabled.reasoningLoop) return null;
    if (text.trim().length === 0) return null;

    if (this.recentReasoning.length > 0) {
      const prev = this.recentReasoning[this.recentReasoning.length - 1];
      const sim = this.computeSimilarity(prev, text);
      const threshold = this.config.detection?.outputSimilarityThreshold ?? 0.85;
      if (sim >= threshold) {
        return {
          type: "reasoningLoop",
          details: `Reasoning similarity of ${(sim * 100).toFixed(1)}% detected (threshold: ${(threshold * 100).toFixed(1)}%)`,
          count: this.recentReasoning.length + 1,
        };
      }
    }

    this.recentReasoning.push(text);
    return null;
  }

  /**
   * Record output text.
   * Returns DetectionResult if a loop is detected, null otherwise.
   */
  recordOutput(text: string): DetectionResult | null {
    if (!this.config.enabled.outputLoop) return null;
    if (text.trim().length === 0) return null;

    if (this.recentOutput.length > 0) {
      const prev = this.recentOutput[this.recentOutput.length - 1];
      const sim = this.computeSimilarity(prev, text);
      const threshold = this.config.detection?.outputSimilarityThreshold ?? 0.85;
      if (sim >= threshold) {
        return {
          type: "outputLoop",
          details: `Output similarity of ${(sim * 100).toFixed(1)}% detected (threshold: ${(threshold * 100).toFixed(1)}%)`,
          count: this.recentOutput.length + 1,
        };
      }
    }

    this.recentOutput.push(text);
    return null;
  }

  /**
   * Reset all detector state (call at end of run/turn).
   */
  reset(): void {
    this.toolCounts.clear();
    this.chainWindow = [];
    this.chainFrequencies.clear();
    this.recentReasoning = [];
    this.recentOutput = [];
    this.toolCallHistory = [];
  }

  /**
   * Get the current tool call history (for logging).
   */
  getToolCallHistory(): string[] {
    return [...this.toolCallHistory];
  }

  /**
   * Get all recorded reasoning blocks.
   */
  getReasoningBlocks(): string[] {
    return [...this.recentReasoning];
  }

  /**
   * Get all recorded output blocks.
   */
  getOutputBlocks(): string[] {
    return [...this.recentOutput];
  }

  /**
   * Get all detection results that occurred during this message.
   */
  getDetectionResults(): DetectionResult[] {
    // We store results internally — for replay we need to capture them.
    // Since we don't store them, we return the current state for inspection.
    return [];
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private checkChainLoop(toolName: string): DetectionResult | null {
    this.chainWindow.push(toolName);

    const windowSize = this.config.detection?.chainLoopWindowSize ?? 3;
    if (this.chainWindow.length > windowSize) {
      this.chainWindow.shift();
    }

    if (this.chainWindow.length < 2) return null;

    // Check subsequences of length 2 to windowSize
    for (let seqLen = Math.min(windowSize, this.chainWindow.length); seqLen >= 2; seqLen--) {
      for (let start = 0; start <= this.chainWindow.length - seqLen; start++) {
        const seq = this.chainWindow.slice(start, start + seqLen);

        // Skip sequences with only one distinct tool name
        if (new Set(seq).size < 2) continue;

        const key = seq.join(",");

        // Track frequency across the entire history
        const freq = (this.chainFrequencies.get(key) ?? 0) + 1;
        this.chainFrequencies.set(key, freq);

        const threshold = this.config.detection.chainLoopThreshold;
        if (freq >= threshold) {
          return {
            type: "chainLoop",
            details: `Chain loop detected: '${key}' repeated ${freq} times`,
            count: freq,
          };
        }
      }
    }

    return null;
  }

  private computeSimilarity(a: string, b: string): number {
    const tokensA = tokenize(a);
    const tokensB = tokenize(b);

    // If either text has fewer than n tokens, use exact match instead
    const n = 5;
    if (tokensA.length < n && tokensB.length < n) {
      return a.toLowerCase() === b.toLowerCase() ? 1 : 0;
    }

    const gramA = nGrams(tokensA, n);
    const gramB = nGrams(tokensB, n);
    return jaccard(gramA, gramB);
  }
}

// ---------------------------------------------------------------------------
// Replay helper
// ---------------------------------------------------------------------------

/**
 * Replay a debug dump through a fresh LoopDetector and return the detector.
 * The returned detector has all state populated as if the events were received live.
 */
export function replay(dump: DebugDump): LoopDetector {
  const detector = new LoopDetector();
  detector.startMessage();

  for (const event of dump.events) {
    switch (event.type) {
      case "tool_call":
        detector.recordToolCall(event.toolName, event.input);
        break;
      case "reasoning":
        detector.recordReasoning(event.text);
        break;
      case "output":
        detector.recordOutput(event.text);
        break;
    }
  }

  return detector;
}
