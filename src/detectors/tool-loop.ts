/**
 * Single-tool loop detector — detects when the same tool is called N+ times
 * within a single message.
 */

import type { DetectionResult } from "../detector.js";
import type { KijekConfig } from "../config.js";

export class ToolLoopDetector {
  private toolCounts = new Map<string, number>();
  private readonly config: KijekConfig;

  constructor(config: KijekConfig) {
    this.config = config;
  }

  startMessage(): void {
    this.toolCounts.clear();
  }

  record(toolName: string): DetectionResult | null {
    if (!this.config.enabled.toolLoop) return null;

    const newCount = (this.toolCounts.get(toolName) ?? 0) + 1;
    this.toolCounts.set(toolName, newCount);

    if (newCount >= this.config.detection.toolLoopThreshold) {
      return {
        type: "toolLoop",
        details: `Tool '${toolName}' called ${newCount} times in this message`,
        count: newCount,
      };
    }

    return null;
  }

  getCounts(): Map<string, number> {
    return new Map(this.toolCounts);
  }

  getThreshold(): number {
    return this.config.detection.toolLoopThreshold;
  }

  reset(): void {
    this.toolCounts.clear();
  }
}
