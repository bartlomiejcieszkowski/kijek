/**
 * Output loop detector — detects when similar output text is repeated N+ times.
 * Uses n-gram Jaccard similarity.
 */

import type { DetectionResult } from "../detector.js";
import type { KijekConfig } from "../config.js";
import { computeSimilarityFn } from "../detector.js";

export class OutputLoopDetector {
  private recentOutput: { text: string }[] = [];
  private readonly config: KijekConfig;

  constructor(config: KijekConfig) {
    this.config = config;
  }

  record(text: string): DetectionResult | null {
    if (!this.config.enabled.outputLoop) return null;
    if (text.trim().length === 0) return null;

    if (this.recentOutput.length > 0) {
      const prev = this.recentOutput[this.recentOutput.length - 1];
      const sim = computeSimilarityFn(prev.text, text);
      const threshold = this.config.detection.outputSimilarityThreshold;
      if (sim >= threshold) {
        return {
          type: "outputLoop",
          details: `Output similarity of ${(sim * 100).toFixed(1)}% detected (threshold: ${(threshold * 100).toFixed(1)}%)`,
          count: this.recentOutput.length + 1,
        };
      }
    }

    this.recentOutput.push({ text });
    return null;
  }

  getBlocks(): { text: string }[] {
    return [...this.recentOutput];
  }

  getLast(): { text: string; similarity: number; threshold: number; approaching: boolean } | null {
    if (this.recentOutput.length < 2) return null;
    const prev = this.recentOutput[this.recentOutput.length - 2].text;
    const curr = this.recentOutput[this.recentOutput.length - 1].text;
    const sim = computeSimilarityFn(prev, curr);
    const threshold = this.config.detection.outputSimilarityThreshold;
    return {
      text: curr,
      similarity: Math.round(sim * 1000) / 1000,
      threshold,
      approaching: sim >= threshold - 0.05,
    };
  }

  reset(): void {
    this.recentOutput = [];
  }
}
