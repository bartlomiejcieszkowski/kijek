/**
 * Chain loop detector — detects when the same sequence of tool calls is
 * repeated N+ times across messages.
 */

import type { DetectionResult } from "../detector.js";
import type { KijekConfig } from "../config.js";

export class ChainLoopDetector {
  private chainWindow: string[] = [];
  private chainFrequencies: Map<string, number> = new Map();
  private readonly config: KijekConfig;

  constructor(config: KijekConfig) {
    this.config = config;
  }

  record(toolName: string): DetectionResult | null {
    if (!this.config.enabled.chainLoop) return null;

    this.chainWindow.push(toolName);

    const windowSize = this.config.detection.chainLoopWindowSize;
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

        if (freq >= this.config.detection.chainLoopThreshold) {
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

  getWindow(): string[] {
    return [...this.chainWindow];
  }

  getFrequencies(): Map<string, number> {
    return new Map(this.chainFrequencies);
  }

  getThreshold(): number {
    return this.config.detection.chainLoopThreshold;
  }

  reset(): void {
    this.chainWindow = [];
    this.chainFrequencies.clear();
  }
}
