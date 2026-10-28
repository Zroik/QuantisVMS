import { describe, it, expect, vi } from "vitest";
import { computeTranscodePriority, recomputeHourlyPriorities } from "./priority.js";

describe("Gate G4.2: Transcode Priority Ordering & Re-prioritization (Spec §8.7, Gate G4.2)", () => {
  it("item 1: assigns higher priority (lower number) to older files", () => {
    // 1-hour-old file vs 48-hour-old file, identical size and activity
    const young = computeTranscodePriority({
      ageHours: 1,
      rawSizeBytes: 1024 * 1024 * 1024, // 1 GB
      totalActivityScore: 100,
    });

    const old = computeTranscodePriority({
      ageHours: 48,
      rawSizeBytes: 1024 * 1024 * 1024, // 1 GB
      totalActivityScore: 100,
    });

    // In BullMQ: lower number = served first
    expect(old.priority).toBeLessThan(young.priority);
  });

  it("item 2: assigns higher priority (lower number) to smaller files (shortest-job-first)", () => {
    const small = computeTranscodePriority({
      ageHours: 10,
      rawSizeBytes: 200 * 1024 * 1024, // 200 MB
      totalActivityScore: 50,
    });

    const large = computeTranscodePriority({
      ageHours: 10,
      rawSizeBytes: 3.5 * 1024 * 1024 * 1024, // 3.5 GB
      totalActivityScore: 50,
    });

    expect(small.priority).toBeLessThan(large.priority);
  });

  it("item 3: assigns higher priority (lower number) to quiet/cheap files", () => {
    const quiet = computeTranscodePriority({
      ageHours: 10,
      rawSizeBytes: 1024 * 1024 * 1024,
      totalActivityScore: 0, // totally static
    });

    const busy = computeTranscodePriority({
      ageHours: 10,
      rawSizeBytes: 1024 * 1024 * 1024,
      totalActivityScore: 500, // heavily active
    });

    expect(quiet.priority).toBeLessThan(busy.priority);
  });

  it("item 4: clamped priority strictly stays within [1, 100]", () => {
    const bestCase = computeTranscodePriority({
      ageHours: 100,
      rawSizeBytes: 0,
      totalActivityScore: 0,
    });
    expect(bestCase.priority).toBe(1);

    const worstCase = computeTranscodePriority({
      ageHours: 0,
      rawSizeBytes: 10 * 1024 * 1024 * 1024,
      totalActivityScore: 2000,
    });
    expect(worstCase.priority).toBe(100);
  });

  it("item 5: hourly re-prioritization updates BullMQ waiting jobs", async () => {
    const changePriorityMock = vi.fn().mockResolvedValue(true);

    const mockJob1 = {
      data: { recordingId: 101 },
      opts: { priority: 50 },
      changePriority: changePriorityMock,
    };

    const mockQueue = {
      getWaiting: vi.fn().mockResolvedValue([mockJob1]),
    } as any;

    const mockPool = {
      query: vi.fn().mockResolvedValue([
        [
          {
            started_at: new Date(Date.now() - 40 * 3600 * 1000), // 40 hours old
            raw_size_bytes: 500 * 1024 * 1024,
            total_activity: 10,
          },
        ],
      ]),
    } as any;

    const res = await recomputeHourlyPriorities(mockQueue, mockPool);
    expect(res.recomputed).toBe(1);
    expect(changePriorityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        priority: expect.any(Number),
      })
    );
  });
});

