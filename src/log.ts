/**
 * Log Management — sidebar widget, session entry storage, branch reconstruction.
 *
 * Log entries are stored as custom session entries (type: "kijek-log") so they
 * survive across turns and branches. On `session_start` and `session_tree`,
 * entries are reconstructed from the active branch.
 */

import type { DetectionResult } from "./detector.js";

// ---------------------------------------------------------------------------
// Minimal Pi types (provided at runtime by @earendil-works/pi-coding-agent)
// ---------------------------------------------------------------------------

/** Minimal session entry — custom type variant. */
interface SessionCustomEntry {
  type: string;
  customType?: string;
  data?: unknown;
  id: string;
  parentId: string | null;
  timestamp: string;
}

/** Minimal read-only session manager interface. */
interface ReadonlySessionManager {
  getEntries(): SessionCustomEntry[];
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single log entry recorded when a loop is detected. */
export interface LogEntry {
  id: string;
  timestamp: string; // ISO 8601
  detectionType: string;
  details: string;
  action: string; // "silent" | "alert" | "interrupt"
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KIJEK_LOG_TYPE = "kijek-log";

/** Format a timestamp for widget display: HH:MM from ISO string. */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso.slice(0, 5);
  }
}

/** Map detection type to a human-readable label. */
function detectionLabel(type: string): string {
  switch (type) {
    case "toolLoop":
      return "Tool loop";
    case "chainLoop":
      return "Chain loop";
    case "reasoningLoop":
      return "Reasoning loop";
    case "outputLoop":
      return "Output loop";
    default:
      return type;
  }
}

/** Map action to a human-readable label. */
function actionLabel(action: string): string {
  switch (action) {
    case "silent":
      return "Silent redirect";
    case "alert":
      return "Alert";
    case "interrupt":
      return "Auto-interrupt";
    default:
      return action;
  }
}

// ---------------------------------------------------------------------------
// LogManager
// ---------------------------------------------------------------------------

/**
 * Manages loop-detection log entries: in-memory storage, session persistence,
 * branch reconstruction, and sidebar widget rendering.
 */
export class LogManager {
  private entries: LogEntry[] = [];
  private widgetVisible = false;
  private appendEntryFn: ((customType: string, data?: unknown) => void) | null =
    null;

  /**
   * Register the session entry persistence function (provided by the main
   * extension from `pi.appendEntry`).
   */
  setAppendEntry(fn: (customType: string, data?: unknown) => void): void {
    this.appendEntryFn = fn;
  }

  /**
   * Add a log entry for a detection result. Stores in-memory and persists
   * to the session as a custom entry.
   */
  addEntry(result: DetectionResult, action: string): void {
    const entry: LogEntry = {
      id: `kijek-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      detectionType: result.type,
      details: result.details,
      action,
    };

    this.entries.push(entry);

    // Persist to session
    if (this.appendEntryFn) {
      this.appendEntryFn(KIJEK_LOG_TYPE, entry);
    }
  }

  /**
   * Get all log entries, newest first, limited to the last 20.
   */
  getEntries(): LogEntry[] {
    return [...this.entries].reverse().slice(0, 20);
  }

  /**
   * Check if the widget is currently visible.
   */
  isWidgetVisible(): boolean {
    return this.widgetVisible;
  }

  /**
   * Toggle widget visibility. Returns the new state.
   */
  toggleWidget(): boolean {
    this.widgetVisible = !this.widgetVisible;
    return this.widgetVisible;
  }

  /**
   * Set widget visibility.
   */
  setWidgetVisible(visible: boolean): void {
    this.widgetVisible = visible;
  }

  /**
   * Render the sidebar widget content as an array of display lines.
   * Returns an empty array if the widget is not visible.
   */
  renderWidgetLines(): string[] {
    if (!this.widgetVisible) return [];

    const entries = this.getEntries();

    if (entries.length === 0) {
      return [
        "┌─ Kijek Log ───────────────────────────────┐",
        "│ No detections yet.                        │",
        "└──────────────────────── ╰( ･~･)つ── 🤖💬 ─┘"];
    }

    const lines = [
        "┌─ Kijek Log ───────────────────────────────┐"];

    for (const entry of entries) {
      const time = formatTime(entry.timestamp);
      const label = detectionLabel(entry.detectionType);
      const aLabel = actionLabel(entry.action);
      // Truncate details to fit the widget width
      const maxDetailLen = 30;
      const detail =
        entry.details.length > maxDetailLen
          ? entry.details.slice(0, maxDetailLen) + "…"
          : entry.details;
      const line = `│ [${time}] ${label}: ${detail} → ${aLabel}`;
      lines.push(line.padEnd(43) + "│");
    }

    // Pad remaining lines
    const maxLines = 22; // header + footer + 20 entries
    const currentLines = lines.length;
    for (let i = currentLines; i < maxLines - 1; i++) {
      lines.push("│".padEnd(43) + "│");
    }
    lines.push("└──────────────────────── ╰( ･~･)つ── 🤖💬 ─┘");

    return lines;
  }

  /**
   * Reconstruct log entries from session custom entries on the current branch.
   * Called on session_start and session_tree (branch change).
   */
  loadFromSession(sessionManager: ReadonlySessionManager): void {
    const allEntries = sessionManager.getEntries();
    const logEntries: LogEntry[] = [];

    for (const entry of allEntries) {
      if (entry.type === "custom" && entry.customType === KIJEK_LOG_TYPE) {
        const data = entry.data;
        if (data && typeof data === "object" && "id" in data && "timestamp" in data && "detectionType" in data && "details" in data && "action" in data) {
          const d = data as Record<string, unknown>;
          logEntries.push({
            id: String(d.id),
            timestamp: String(d.timestamp),
            detectionType: String(d.detectionType),
            details: String(d.details),
            action: String(d.action),
          });
        }
      }
    }

    // Sort by timestamp ascending, then replace in-memory store
    logEntries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    this.entries = logEntries;
  }

  /**
   * Clear all log entries (used on session reset).
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Get the count of all log entries.
   */
  getCount(): number {
    return this.entries.length;
  }
}
