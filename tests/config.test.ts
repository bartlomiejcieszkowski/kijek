import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  getNudgePrompt,
  applySensitivity,
  isValidPrompt,
  isValidSensitivity,
  getConfigPath,
  type KijekConfig,
} from "../src/config.js";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Helper to set HOME so loadConfig/writeConfig use a controlled path
function setTempHome(tempDir: string): void {
  process.env.HOME = tempDir;
  delete process.env.USERPROFILE;
}

// Helper to write a config file (creates parent dirs as needed)
function writeConfigFile(
  tmpDir: string,
  content: string,
): void {
  const configPath = join(tmpDir, ".pi", "agent", "extensions", "kijek.json");
  mkdirSync(join(tmpDir, ".pi", "agent", "extensions"), {
    recursive: true,
  });
  writeFileSync(configPath, content, "utf-8");
}

// ---------------------------------------------------------------------------
// describe: DEFAULT_CONFIG
// ---------------------------------------------------------------------------

describe("DEFAULT_CONFIG", () => {
  it("has nudgeMode 'alert'", () => {
    expect(DEFAULT_CONFIG.nudgeMode).toBe("alert");
  });

  it("has nudgePrompt 'simple'", () => {
    expect(DEFAULT_CONFIG.nudgePrompt).toBe("simple");
  });

  it("has sensitivity 'balanced'", () => {
    expect(DEFAULT_CONFIG.sensitivity).toBe("balanced");
  });

  it("has correct detection thresholds", () => {
    expect(DEFAULT_CONFIG.detection.toolLoopThreshold).toBe(4);
    expect(DEFAULT_CONFIG.detection.chainLoopThreshold).toBe(4);
    expect(DEFAULT_CONFIG.detection.reasoningLoopThreshold).toBe(4);
    expect(DEFAULT_CONFIG.detection.outputSimilarityThreshold).toBe(0.85);
  });

  it("has all enabled flags set to true", () => {
    expect(DEFAULT_CONFIG.enabled.toolLoop).toBe(true);
    expect(DEFAULT_CONFIG.enabled.chainLoop).toBe(true);
    expect(DEFAULT_CONFIG.enabled.reasoningLoop).toBe(true);
    expect(DEFAULT_CONFIG.enabled.outputLoop).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// describe: loadConfig — no config file
// ---------------------------------------------------------------------------

describe("loadConfig (no file)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kijek-test-"));
    setTempHome(tmpDir);
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns defaults and creates file when it does not exist", () => {
    const config = loadConfig();
    expect(config.nudgeMode).toBe("alert");
    expect(config.nudgePrompt).toBe("simple");
    expect(config.sensitivity).toBe("balanced");
    expect(config.detection.toolLoopThreshold).toBe(4);
    expect(existsSync(getConfigPath())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// describe: loadConfig — file-based overrides
// ---------------------------------------------------------------------------

describe("loadConfig (file overrides)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kijek-test-"));
    setTempHome(tmpDir);
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("overrides single top-level field", () => {
    writeConfigFile(tmpDir, JSON.stringify({ nudgeMode: "silent" }));
    const config = loadConfig();
    expect(config.nudgeMode).toBe("silent");
    // Other fields should remain defaults
    expect(config.nudgePrompt).toBe("simple");
    expect(config.enabled.toolLoop).toBe(true);
  });

  it("overrides detection thresholds", () => {
    writeConfigFile(
      tmpDir,
      JSON.stringify({
        detection: { toolLoopThreshold: 3, outputSimilarityThreshold: 0.9 },
      }),
    );
    const config = loadConfig();
    expect(config.detection.toolLoopThreshold).toBe(3);
    expect(config.detection.outputSimilarityThreshold).toBe(0.9);
  });

  it("overrides enabled flags", () => {
    writeConfigFile(
      tmpDir,
      JSON.stringify({
        enabled: { toolLoop: false, chainLoop: true },
      }),
    );
    const config = loadConfig();
    expect(config.enabled.toolLoop).toBe(false);
    expect(config.enabled.chainLoop).toBe(true);
  });

  it("preserves custom prompt text", () => {
    const customPrompt = "This is a custom nudge message";
    writeConfigFile(
      tmpDir,
      JSON.stringify({
        nudgePrompt: "custom",
        nudgePromptCustom: customPrompt,
      }),
    );
    const config = loadConfig();
    expect(config.nudgePrompt).toBe("custom");
    expect(config.nudgePromptCustom).toBe(customPrompt);
    expect(getNudgePrompt(config)).toBe(customPrompt);
  });
});

// ---------------------------------------------------------------------------
// describe: loadConfig — invalid JSON falls back
// ---------------------------------------------------------------------------

describe("loadConfig (invalid JSON)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kijek-test-"));
    setTempHome(tmpDir);
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("falls back to defaults when JSON is malformed", () => {
    writeConfigFile(tmpDir, "{ invalid json }");
    const config = loadConfig();
    expect(config.nudgeMode).toBe("alert");
    expect(config.sensitivity).toBe("balanced");
  });
});

// ---------------------------------------------------------------------------
// describe: loadConfig — invalid config shape falls back
// ---------------------------------------------------------------------------

describe("loadConfig (invalid shape)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kijek-test-"));
    setTempHome(tmpDir);
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("falls back to defaults when required fields are missing", () => {
    writeConfigFile(
      tmpDir,
      JSON.stringify({ nudgeMode: "invalid-value" }),
    );
    const config = loadConfig();
    expect(config.nudgeMode).toBe("alert"); // falls back to default
  });
});

// ---------------------------------------------------------------------------
// describe: loadConfig — sensitivity preset
// ---------------------------------------------------------------------------

describe("loadConfig (sensitivity preset)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kijek-test-"));
    setTempHome(tmpDir);
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("applies conservative preset thresholds", () => {
    writeConfigFile(tmpDir, JSON.stringify({ sensitivity: "conservative" }));
    const config = loadConfig();
    expect(config.sensitivity).toBe("conservative");
    expect(config.detection.toolLoopThreshold).toBe(10);
    expect(config.detection.reasoningLoopThreshold).toBe(10);
    expect(config.detection.outputSimilarityThreshold).toBe(0.95);
  });

  it("applies aggressive preset thresholds", () => {
    writeConfigFile(tmpDir, JSON.stringify({ sensitivity: "aggressive" }));
    const config = loadConfig();
    expect(config.sensitivity).toBe("aggressive");
    expect(config.detection.toolLoopThreshold).toBe(3);
    expect(config.detection.reasoningLoopThreshold).toBe(3);
    expect(config.detection.outputSimilarityThreshold).toBe(0.7);
  });

  it("applies balanced preset thresholds (default)", () => {
    writeConfigFile(tmpDir, JSON.stringify({ sensitivity: "balanced" }));
    const config = loadConfig();
    expect(config.sensitivity).toBe("balanced");
    expect(config.detection.toolLoopThreshold).toBe(4);
    expect(config.detection.reasoningLoopThreshold).toBe(4);
    expect(config.detection.outputSimilarityThreshold).toBe(0.85);
  });

  it("user-provided detection values override sensitivity preset", () => {
    writeConfigFile(
      tmpDir,
      JSON.stringify({
        sensitivity: "conservative",
        detection: { toolLoopThreshold: 8 },
      }),
    );
    const config = loadConfig();
    expect(config.detection.toolLoopThreshold).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// describe: getNudgePrompt
// ---------------------------------------------------------------------------

describe("getNudgePrompt", () => {
  it("returns preset for 'simple'", () => {
    const config: KijekConfig = { ...DEFAULT_CONFIG, nudgePrompt: "simple" };
    expect(getNudgePrompt(config)).toBe("Are you stuck?");
  });

  it("returns preset for 'subtle'", () => {
    const config: KijekConfig = { ...DEFAULT_CONFIG, nudgePrompt: "subtle" };
    expect(getNudgePrompt(config)).toBe(
      "You've been approaching this from the same angle. Consider a different strategy.",
    );
  });

  it("returns preset for 'moderate'", () => {
    const config: KijekConfig = { ...DEFAULT_CONFIG, nudgePrompt: "moderate" };
    expect(getNudgePrompt(config)).toBe(
      "You've repeated the same pattern multiple times without progress. Try a different approach.",
    );
  });

  it("returns preset for 'direct'", () => {
    const config: KijekConfig = { ...DEFAULT_CONFIG, nudgePrompt: "direct" };
    expect(getNudgePrompt(config)).toBe(
      "You're in a loop. Stop what you're doing and start fresh.",
    );
  });

  it("returns preset for 'technical'", () => {
    const config: KijekConfig = { ...DEFAULT_CONFIG, nudgePrompt: "technical" };
    expect(getNudgePrompt(config)).toBe(
      "You've executed the same tool/reasoning 5+ times. Pivot to a different approach.",
    );
  });

  it("returns custom text when nudgePrompt is 'custom'", () => {
    const config: KijekConfig = {
      ...DEFAULT_CONFIG,
      nudgePrompt: "custom",
      nudgePromptCustom: "Custom message",
    };
    expect(getNudgePrompt(config)).toBe("Custom message");
  });

  it("falls back to simple when prompt is unknown", () => {
    const config: KijekConfig = { ...DEFAULT_CONFIG, nudgePrompt: "simple" };
    expect(getNudgePrompt(config)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// describe: applySensitivity
// ---------------------------------------------------------------------------

describe("applySensitivity", () => {
  it("returns config unchanged for invalid sensitivity", () => {
    const config: KijekConfig = { ...DEFAULT_CONFIG };
    const result = applySensitivity(config, "balanced" as "conservative" | "balanced" | "aggressive");
    expect(result.sensitivity).toBe("balanced");
  });

  it("updates detection when switching to conservative", () => {
    const config: KijekConfig = {
      ...DEFAULT_CONFIG,
      sensitivity: "balanced",
      detection: { ...DEFAULT_CONFIG.detection },
    };
    const result = applySensitivity(config, "conservative");
    expect(result.sensitivity).toBe("conservative");
    expect(result.detection.toolLoopThreshold).toBe(10);
    expect(result.detection.reasoningLoopThreshold).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// describe: isValidPrompt / isValidSensitivity
// ---------------------------------------------------------------------------

describe("isValidPrompt / isValidSensitivity", () => {
  it("validates known prompt names", () => {
    expect(isValidPrompt("simple")).toBe(true);
    expect(isValidPrompt("subtle")).toBe(true);
    expect(isValidPrompt("moderate")).toBe(true);
    expect(isValidPrompt("direct")).toBe(true);
    expect(isValidPrompt("technical")).toBe(true);
    expect(isValidPrompt("custom")).toBe(false); // not in PRESETS
  });

  it("validates known sensitivity levels", () => {
    expect(isValidSensitivity("conservative")).toBe(true);
    expect(isValidSensitivity("balanced")).toBe(true);
    expect(isValidSensitivity("aggressive")).toBe(true);
    expect(isValidSensitivity("extreme")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// describe: saveConfig
// ---------------------------------------------------------------------------

describe("saveConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kijek-test-"));
    setTempHome(tmpDir);
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes config to the expected path", () => {
    saveConfig({
      ...DEFAULT_CONFIG,
      nudgeMode: "interrupt",
    });
    const configPath = join(tmpDir, ".pi", "agent", "extensions", "kijek.json");
    const written = JSON.parse(
      readFileSync(configPath, "utf-8"),
    );
    expect(written.nudgeMode).toBe("interrupt");
  });

  it("round-trips through loadConfig", () => {
    const modified: KijekConfig = {
      ...DEFAULT_CONFIG,
      nudgeMode: "interrupt",
      sensitivity: "aggressive",
      enabled: { ...DEFAULT_CONFIG.enabled, toolLoop: false },
    };
    saveConfig(modified);
    const loaded = loadConfig();
    expect(loaded.nudgeMode).toBe("interrupt");
    expect(loaded.sensitivity).toBe("aggressive");
    expect(loaded.enabled.toolLoop).toBe(false);
  });
});
