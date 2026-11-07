import { describe, it, expect, vi, beforeEach } from "vitest";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: any[]) => execFileMock(...args),
}));

import { probeVideo } from "./probe.js";
import { RecorderService } from "./recorder.js";

describe("Recorder probeVideo & Camera Lock Hardening ([REC-01], [REC-02], [REC-03])", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("[REC-02] prefers avg_frame_rate over 90000/1 r_frame_rate", async () => {
    execFileMock.mockImplementationOnce((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      cb(null, {
        stdout: JSON.stringify({
          streams: [
            {
              codec_name: "h264",
              width: 1920,
              height: 1080,
              avg_frame_rate: "25/1",
              r_frame_rate: "90000/1",
              duration: "60.0",
            },
          ],
          format: {
            duration: "60.0",
            size: "15000000",
          },
        }),
        stderr: "",
      });
    });

    const res = await probeVideo("/tmp/test_segment.mp4");
    expect(res.fps).toBe(25);
    expect(res.fpsSource).toBe("avg_frame_rate");
    expect(res.durationSec).toBe(60);
    expect(res.durationKnown).toBe(true);
  });

  it("[REC-01] recovers duration from nb_read_packets when fMP4 format/stream duration is 'N/A'", async () => {
    // First call: primary probe returns duration: "N/A"
    execFileMock.mockImplementationOnce((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      cb(null, {
        stdout: JSON.stringify({
          streams: [
            {
              codec_name: "hevc",
              width: 2560,
              height: 1440,
              avg_frame_rate: "20/1",
              r_frame_rate: "20/1",
              duration: "N/A",
            },
          ],
          format: {
            duration: "N/A",
            size: "8400000",
          },
        }),
        stderr: "",
      });
    });

    // Second call: fallback -count_packets probe returns 300 packets (15 seconds @ 20 fps)
    execFileMock.mockImplementationOnce((_cmd: string, args: string[], _opts: any, cb: Function) => {
      expect(args).toContain("-count_packets");
      cb(null, {
        stdout: JSON.stringify({
          streams: [{ nb_read_packets: "300" }],
        }),
        stderr: "",
      });
    });

    const res = await probeVideo("/tmp/crashed_fmp4.mp4");
    expect(res.durationKnown).toBe(true);
    expect(res.nbReadPackets).toBe(300);
    expect(res.durationSec).toBe(15);
    expect(res.sizeBytes).toBe(8400000);
  });

  it("[REC-03] cleans up cameraOps map entry after withCameraLock completes", async () => {
    const fakePool = { query: vi.fn().mockResolvedValue([[]]) } as any;
    const service = new RecorderService({ pool: fakePool });

    await service.unregisterCamera(42);
    expect((service as any).cameraOps.size).toBe(0);
  });
});

