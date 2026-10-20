/**
 * Detector composition — orchestrates all sub-detectors.
 *
 * This is the public API consumers should use. Each sub-detector handles
 * one detection type, making the codebase modular and testable.
 */

import { DEFAULT_CONFIG, type KijekConfig } from "../config.js";
import type {
  DetectionResult,
  DebugDump,
} from "../detector.js";
import { computeSimilarityFn } from "../detector.js";
import { ToolLoopDetector } from "./tool-loop.js";
import { ChainLoopDetector } from "./chain-loop.js";
import { ReasoningLoopDetector } from "./reasoning-loop.js";
import { OutputLoopDetector } from "./output-loop.js";

export class LoopDetector {
  private toolLoop: ToolLoopDetector;
  private chainLoop: ChainLoopDetector;
  private reasoningLoop: ReasoningLoopDetector;
  private outputLoop: OutputLoopDetector;
  private toolCallHistory: { name: string; input: Record<string, unknown> }[] = [];

  constructor(config: Partial<KijekConfig> = {}) {
    const fullConfig = {
      ...DEFAULT_CONFIG,
      ...config,
      detection: { ...DEFAULT_CONFIG.detection, ...(config.detection ?? {}) },
      enabled: { ...DEFAULT_CONFIG.enabled, ...(config.enabled ?? {}) },
    };

    this.toolLoop = new ToolLoopDetector(fullConfig);
    this.chainLoop = new ChainLoopDetector(fullConfig);
    this.reasoningLoop = new ReasoningLoopDetector(fullConfig);
    this.outputLoop = new OutputLoopDetector(fullConfig);
  }

  // ── Public API ────────────────────────────────────────────────────────

  startMessage(): void {
    this.toolLoop.startMessage();
  }

  recordToolCall(
    toolName: string,
    args?: Record<string, unknown>,
  ): DetectionResult | null {
    // Tool loop (per-message)
    const toolResult = this.toolLoop.record(toolName);
    if (toolResult) return toolResult;

    // Chain loop (cross-message)
    const chainResult = this.chainLoop.record(toolName);
    if (chainResult) return chainResult;

    // Track full event
    this.toolCallHistory.push({ name: toolName, input: args || {} });

    return null;
  }

  recordReasoning(text: string): DetectionResult | null {
    return this.reasoningLoop.record(text);
  }

  recordOutput(text: string): DetectionResult | null {
    return this.outputLoop.record(text);
  }

  reset(): void {
    this.toolLoop.reset();
    this.chainLoop.reset();
    this.reasoningLoop.reset();
    this.outputLoop.reset();
    this.toolCallHistory = [];
  }

  getToolCallHistory(): { name: string; input: Record<string, unknown> }[] {
    return [...this.toolCallHistory];
  }

  getReasoningBlocks(): { text: string }[] {
    return this.reasoningLoop.getBlocks();
  }

  getOutputBlocks(): { text: string }[] {
    return this.outputLoop.getBlocks();
  }

  getDetectionResults(): DetectionResult[] {
    return [];
  }

  getDebugState(): {
    toolCounts: Array<{ name: string; count: number; threshold: number; approaching: boolean }>;
    chainWindow: string[];
    chainFrequencies: Array<{ sequence: string; count: number; threshold: number; approaching: boolean }>;
    reasoningLast: { text: string; similarity: number; threshold: number; approaching: boolean } | null;
    outputLast: { text: string; similarity: number; threshold: number; approaching: boolean } | null;
  } {
    const toolCounts = Array.from(this.toolLoop.getCounts().entries())
      .map(([name, count]) => {
        const threshold = this.toolLoop.getThreshold();
        return {
          name,
          count,
          threshold,
          approaching: count > 0 && count >= threshold - 1,
        };
      })
      .sort((a, b) => b.count - a.count);

    const chainFrequencies = Array.from(this.chainLoop.getFrequencies().entries())
      .map(([sequence, count]) => {
        const threshold = this.chainLoop.getThreshold();
        return {
          sequence,
          count,
          threshold,
          approaching: count > 0 && count >= threshold - 1,
        };
      })
      .sort((a, b) => b.count - a.count);

    return {
      toolCounts,
      chainWindow: this.chainLoop.getWindow(),
      chainFrequencies,
      reasoningLast: this.reasoningLoop.getLast(),
      outputLast: this.outputLoop.getLast(),
    };
  }

  computeSimilarity(a: string, b: string): number {
    return computeSimilarityFn(a, b);
  }
}

/**
 * Replay a debug dump through a fresh LoopDetector.
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
