/**
 * Loop detection engine — n-gram similarity, loop detection, debug dumps.
 *
 * This module re-exports the composed LoopDetector from the sub-detector
 * modules, plus the standalone n-gram utilities.
 */

// ── Types (re-exported for convenience) ─────────────────────────────────

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

// ── N-gram helpers ──────────────────────────────────────────────────────

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

/**
 * Compute n-gram similarity between two text strings.
 * Uses 5-gram Jaccard similarity over tokenised text.
 */
export function computeSimilarityFn(a: string, b: string): number {
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

// ── Re-export composed LoopDetector and replay ──────────────────────────

export { LoopDetector, replay } from "./detectors/index.js";
