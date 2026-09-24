import { describe, it, expect } from "vitest";
import { buildHealthReport, type EngineStatus } from "./localEngine";

describe("buildHealthReport", () => {
  it("defaults an unregistered camera to 'connecting', not 'offline'", () => {
    // The engine hasn't lost this camera — it just hasn't started yet
    // (registration still in flight). Reporting it as offline would be a
    // false negative on every camera for the few seconds after it's added.
    const status: EngineStatus = { cameras: {} };
    const report = buildHealthReport(["cam-1"], status);
    expect(report).toEqual([{
      camera_id: "cam-1",
      status: "connecting",
      is_online: false,
      fps: 0,
      resolution: "",
      recording: false,
      source_error: null,
      latency_ms: 0,
    }]);
  });

  it("carries every field the engine reports, including the failure reason", () => {
    const status: EngineStatus = {
      cameras: {
        "cam-1": {
          health_status: "auth_failed",
          health_reason: "The camera rejected the credentials in its address.",
          fps: 0,
          latency: 0,
          resolution: "",
          recording: false,
        },
      },
    };
    const report = buildHealthReport(["cam-1"], status);
    expect(report[0]).toMatchObject({
      status: "auth_failed",
      is_online: false,
      source_error: "The camera rejected the credentials in its address.",
    });
  });

  it("derives is_online strictly from health_status, not from fps/recording", () => {
    const status: EngineStatus = {
      cameras: { "cam-1": { health_status: "online", fps: 24, resolution: "1920x1080", recording: false } },
    };
    const report = buildHealthReport(["cam-1"], status);
    expect(report[0].is_online).toBe(true);
    expect(report[0].recording).toBe(false);
  });

  it("reports every requested camera independently, in one batch", () => {
    const status: EngineStatus = {
      cameras: {
        "cam-1": { health_status: "online", fps: 30, latency: 12 },
        "cam-2": { health_status: "network_error" },
        // cam-3 deliberately absent from the engine's map
      },
    };
    const report = buildHealthReport(["cam-1", "cam-2", "cam-3"], status);
    expect(report.map((r) => r.camera_id)).toEqual(["cam-1", "cam-2", "cam-3"]);
    expect(report[0]).toMatchObject({ status: "online", latency_ms: 12 });
    expect(report[1]).toMatchObject({ status: "network_error", is_online: false });
    expect(report[2]).toMatchObject({ status: "connecting", is_online: false });
  });

  it("returns an empty batch for an empty camera list", () => {
    expect(buildHealthReport([], { cameras: {} })).toEqual([]);
  });
});
