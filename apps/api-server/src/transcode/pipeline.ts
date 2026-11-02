import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { Pool } from "mysql2/promise";
import type { Redis } from "ioredis";
import { searchCq, type VmafScore } from "../cq-search/index.js";
import { runVmafWithFallback, defaultProcessExecutor } from "../vmaf/index.js";
import { selectProbeWindow, type ActivityWindow } from "./window-selection.js";
import { transitionRecordingStatus } from "../db/transitions.js";

export interface TranscodeJobOptions {
  pool: Pool;
  redis?: Redis | null;
  io?: any;
  deleteRawAfterVerify?: boolean;
  rawDeleteGraceSec?: number;
  tmpDir?: string;
  compressedDir?: string;
  probeIntervalSec?: number;
  probeSampleSec?: number;
  cqMin?: number;
  cqMax?: number;
  cqSafetyMargin?: number;
  executor?: typeof defaultProcessExecutor;
}

export interface TranscodeResult {
  recordingId: number;
  status: "COMPLETED" | "SKIPPED" | "FAILED";
  rawSizeBytes: number;
  compressedSizeBytes?: number;
  savingsBytes?: number;
  savingsPct?: number;
  vmafMean?: number;
  vmafP25?: number;
  qualityGateMet: boolean;
  compressedPath?: string;
  failureReason?: string;
}

/**
 * Spawns an external command with argument array (never shell execution).
 */
async function runCmd(
  cmd: string,
  args: string[],
  timeoutMs: number = 120000,
  executor = defaultProcessExecutor
): Promise<string> {
  const result = await executor(cmd, args, timeoutMs);
  if (result.timedOut) {
    throw new Error(`Command timed out after ${timeoutMs}ms: ${cmd} ${args.join(" ")}`);
  }
  if (result.exitCode !== 0) {
    throw new Error(`Command failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

/**
 * Probes video duration, frame count, width, and height with ffprobe.
 */
async function probeMedia(filePath: string): Promise<{ duration: number; frames: number; width: number; height: number; size: number }> {
  const args = [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,nb_frames,nb_read_frames,r_frame_rate,duration",
    "-show_entries", "format=duration,size",
    "-of", "json",
    filePath,
  ];

  const stdout = await runCmd("ffprobe", args, 60000);
  const data = JSON.parse(stdout);
  const stream = data.streams?.[0];
  const format = data.format;

  const duration = parseFloat(format?.duration || stream?.duration || "0");
  const frames = stream?.nb_frames ? parseInt(stream.nb_frames, 10) : (stream?.nb_read_frames ? parseInt(stream.nb_read_frames, 10) : 0);
  const width = stream?.width ? parseInt(stream.width, 10) : 0;
  const height = stream?.height ? parseInt(stream.height, 10) : 0;
  const size = format?.size ? parseInt(format.size, 10) : 0;

  return { duration, frames, width, height, size };
}

/**
 * Resolves the appropriate preset based on encoder type and user configuration.
 */
export function resolveEncoderPreset(encoder: string, userPreset?: string): string {
  const p = userPreset?.trim() || "";
  if (encoder === "av1_nvenc" || encoder === "hevc_nvenc") {
    return /^p[1-7]$/.test(p) ? p : "p5";
  }
  if (encoder === "libx265") {
    const validX265 = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"];
    return validX265.includes(p) ? p : "medium";
  }
  if (encoder === "libsvtav1") {
    const n = parseInt(p, 10);
    return !isNaN(n) && n >= 0 && n <= 13 ? String(n) : "7";
  }
  return p || "p5";
}

/**
 * Builds FFmpeg command arguments for each encoder per system specifications:
 * - av1_nvenc: ffmpeg -y -hwaccel cuda -hwaccel_output_format cuda -i input.mp4 -vf "scale_cuda=format=p010le" -c:v av1_nvenc -preset <preset> -tune hq -rc vbr -cq <val> -b:v 0 -spatial-aq 1 -temporal-aq 0 -g 120 -fps_mode passthrough -c:a copy output.mp4
 * - hevc_nvenc: ffmpeg -y -hwaccel cuda -hwaccel_output_format cuda -i input.mp4 -vf "scale_cuda=format=p010le" -c:v hevc_nvenc -preset <preset> -tune hq -rc vbr -cq <val> -b:v 0 -spatial-aq 1 -temporal-aq 0 -g 120 -tag:v hvc1 -fps_mode passthrough -c:a copy output.mp4
 * - libx265: ffmpeg -y -i input.mp4 -c:v libx265 -preset <preset> -crf <val> -tag:v hvc1 -fps_mode passthrough -c:a copy output.mp4
 * - libsvtav1: ffmpeg -y -i input.mp4 -c:v libsvtav1 -preset <preset> -crf <val> -fps_mode passthrough -c:a copy output.mp4
 */
export function buildEncoderArgs(options: {
  encoder: string;
  preset: string;
  cqOrCrf: number;
  inputPath: string;
  outputPath: string;
  startOffsetSec?: number;
  durationSec?: number;
}): string[] {
  const { encoder, preset, cqOrCrf, inputPath, outputPath, startOffsetSec, durationSec } = options;
  const args: string[] = ["-hide_banner", "-y", "-loglevel", "warning"];

  if (encoder === "av1_nvenc") {
    args.push("-hwaccel", "cuda", "-hwaccel_output_format", "cuda");
    if (startOffsetSec !== undefined) args.push("-ss", String(startOffsetSec));
    if (durationSec !== undefined) args.push("-t", String(durationSec));
    args.push("-i", inputPath);
    args.push("-vf", "scale_cuda=format=p010le");
    args.push("-c:v", "av1_nvenc");
    args.push("-preset", preset);
    args.push("-tune", "hq");
    args.push("-rc", "vbr");
    args.push("-cq", String(cqOrCrf));
    args.push("-b:v", "0");
    args.push("-spatial-aq", "1");
    args.push("-temporal-aq", "0");
    args.push("-g", "120");
    args.push("-fps_mode", "passthrough");
    args.push("-c:a", "copy");
    args.push(outputPath);
  } else if (encoder === "hevc_nvenc") {
    args.push("-hwaccel", "cuda", "-hwaccel_output_format", "cuda");
    if (startOffsetSec !== undefined) args.push("-ss", String(startOffsetSec));
    if (durationSec !== undefined) args.push("-t", String(durationSec));
    args.push("-i", inputPath);
    args.push("-vf", "scale_cuda=format=p010le");
    args.push("-c:v", "hevc_nvenc");
    args.push("-preset", preset);
    args.push("-tune", "hq");
    args.push("-rc", "vbr");
    args.push("-cq", String(cqOrCrf));
    args.push("-b:v", "0");
    args.push("-spatial-aq", "1");
    args.push("-temporal-aq", "0");
    args.push("-g", "120");
    args.push("-tag:v", "hvc1");
    args.push("-fps_mode", "passthrough");
    args.push("-c:a", "copy");
    args.push(outputPath);
  } else if (encoder === "libx265") {
    if (startOffsetSec !== undefined) args.push("-ss", String(startOffsetSec));
    if (durationSec !== undefined) args.push("-t", String(durationSec));
    args.push("-i", inputPath);
    args.push("-c:v", "libx265");
    args.push("-preset", preset);
    args.push("-crf", String(cqOrCrf));
    args.push("-tag:v", "hvc1");
    args.push("-fps_mode", "passthrough");
    args.push("-c:a", "copy");
    args.push(outputPath);
  } else if (encoder === "libsvtav1") {
    if (startOffsetSec !== undefined) args.push("-ss", String(startOffsetSec));
    if (durationSec !== undefined) args.push("-t", String(durationSec));
    args.push("-i", inputPath);
    args.push("-c:v", "libsvtav1");
    args.push("-preset", preset);
    args.push("-crf", String(cqOrCrf));
    args.push("-fps_mode", "passthrough");
    args.push("-c:a", "copy");
    args.push(outputPath);
  } else {
    // Default fallback (hevc_nvenc)
    args.push("-hwaccel", "cuda", "-hwaccel_output_format", "cuda");
    if (startOffsetSec !== undefined) args.push("-ss", String(startOffsetSec));
    if (durationSec !== undefined) args.push("-t", String(durationSec));
    args.push("-i", inputPath);
    args.push("-vf", "scale_cuda=format=p010le");
    args.push("-c:v", encoder);
    args.push("-preset", preset);
    args.push("-tune", "hq");
    args.push("-rc", "vbr");
    args.push("-cq", String(cqOrCrf));
    args.push("-b:v", "0");
    args.push("-spatial-aq", "1");
    args.push("-temporal-aq", "0");
    args.push("-g", "120");
    args.push("-fps_mode", "passthrough");
    args.push("-c:a", "copy");
    args.push(outputPath);
  }

  return args;
}

/**
 * Full Transcoding & Smart Probing Pipeline Execution (Spec §8.3-§8.7).
 */
export async function processRecordingTranscode(
  recordingId: number,
  options: TranscodeJobOptions
): Promise<TranscodeResult> {
  const {
    pool,
    redis,
    io,
    deleteRawAfterVerify = process.env.DELETE_RAW_AFTER_VERIFY === "true",
    rawDeleteGraceSec = Number(process.env.RAW_DELETE_GRACE_SEC) || 3600,
    tmpDir = path.resolve(process.env.TEMP_DIR || process.env.TMP_DIR || "/data/tmp"),
    compressedDir = path.resolve(process.env.COMPRESSED_DIR || "/data/compressed"),
    probeIntervalSec = Number(process.env.PROBE_INTERVAL_SEC) || 600,
    probeSampleSec = Number(process.env.PROBE_SAMPLE_SEC) || 20,
    cqMin = Number(process.env.CQ_MIN) || 18,
    cqMax = Number(process.env.CQ_MAX) || 48,
    cqSafetyMargin = Number(process.env.CQ_SAFETY_MARGIN) || 0,
    executor = defaultProcessExecutor,
  } = options;

  const jobTmpDir = path.join(tmpDir, `rec_${recordingId}`);
  let partialFinalPath: string | null = null;

  try {
    // 1. Fetch recording and camera metadata
    const [recRows] = await pool.query<any[]>(
      `SELECT r.*, c.name as camera_name, c.target_vmaf, c.target_vmaf_p25,
              c.preferred_encoder, c.smart_ai_sampling, c.static_cq_cache, c.static_cq_cached_at
       FROM recordings r
       JOIN cameras c ON c.id = r.camera_id
       WHERE r.id = ?`,
      [recordingId]
    );

    if (recRows.length === 0) {
      throw new Error(`Recording ${recordingId} not found`);
    }

    const rec = recRows[0];
    const cameraId = rec.camera_id;
    const rawPath = path.resolve(rec.raw_path);
    const targetVmafMean = Number(rec.target_vmaf) || 85.0;
    const targetVmafP25 = Number(rec.target_vmaf_p25) || 81.0;
    const smartAiSampling = Boolean(rec.smart_ai_sampling);

    // Fetch system-configured compression settings if available
    let configuredEncoder = "";
    let configuredPreset = "";
    try {
      const [cfgRows] = await pool.query<any[]>(
        "SELECT config_value FROM system_config WHERE config_key = 'compression' LIMIT 1"
      );
      if (cfgRows.length > 0) {
        const val = typeof cfgRows[0].config_value === "string"
          ? JSON.parse(cfgRows[0].config_value)
          : cfgRows[0].config_value;
        if (val?.preferredEncoder) {
          configuredEncoder = String(val.preferredEncoder);
        }
        if (val?.encoderPreset) {
          configuredPreset = String(val.encoderPreset);
        }
      }
    } catch {
      // fallback
    }

    const encoder = rec.preferred_encoder || configuredEncoder || "av1_nvenc";
    const encoderPreset = resolveEncoderPreset(encoder, configuredPreset);

    // Verify raw file exists
    await fsp.access(rawPath);
    const rawStat = await fsp.stat(rawPath);
    const rawSizeBytes = rec.raw_size_bytes ? Number(rec.raw_size_bytes) : rawStat.size;

    // Transition to PROBING (via QUEUED if currently RAW, FAILED, etc.)
    if (rec.status !== "QUEUED" && rec.status !== "PROBING") {
      await transitionRecordingStatus(pool, recordingId, "QUEUED");
    }
    if (rec.status !== "PROBING") {
      await transitionRecordingStatus(pool, recordingId, "PROBING");
    }
    await fsp.mkdir(jobTmpDir, { recursive: true });

    // 2. Fetch activity windows for this recording
    const [winRows] = await pool.query<any[]>(
      `SELECT window_index, start_offset_sec, weighted_activity_score
       FROM recording_activity_windows
       WHERE recording_id = ?
       ORDER BY window_index ASC`,
      [recordingId]
    );

    // Probe raw media for duration & frame counts
    const rawProbe = await probeMedia(rawPath);
    const totalDurationSec = rawProbe.duration > 0 ? rawProbe.duration : (rec.duration_sec || 60);

    // Compute chunks
    const chunkCount = Math.max(1, Math.ceil(totalDurationSec / probeIntervalSec));
    const chunkResults: Array<{
      chunkIndex: number;
      startOffsetSec: number;
      durationSec: number;
      samplingMode: string;
      sampleStartSec: number;
      optimalCq: number;
      gateMet: boolean;
      vmafMean: number;
      vmafP25: number;
      chunkVideoPath: string;
      rawSamplePath: string;
    }> = [];

    // 3. Process each chunk (Probing Phase)
    for (let k = 0; k < chunkCount; k++) {
      const chunkStartSec = k * probeIntervalSec;
      const chunkDurationSec = Math.min(probeIntervalSec, totalDurationSec - chunkStartSec);
      if (chunkDurationSec <= 0) continue;

      const chunkTmpDir = path.join(jobTmpDir, `chunk_${k}`);
      await fsp.mkdir(chunkTmpDir, { recursive: true });

      // Window selection
      const winResult = selectProbeWindow({
        chunkIndex: k,
        chunkStartSec,
        chunkDurationSec,
        sampleDurationSec: probeSampleSec,
        smartAiSampling,
        windows: winRows as ActivityWindow[],
        staticCqCache: rec.static_cq_cache ? { cq: rec.static_cq_cache, cachedAt: rec.static_cq_cached_at } : null,
      });

      const sampleStart = winResult.sampleStartSec;
      const refSamplePath = path.join(chunkTmpDir, `ref_sample.mp4`);

      // Extract reference sample: -ss {sampleStart} -t {probeSampleSec} -c copy
      await runCmd("ffmpeg", [
        "-hide_banner", "-y", "-loglevel", "warning",
        "-ss", String(sampleStart),
        "-t", String(probeSampleSec),
        "-i", rawPath,
        "-map", "0:v:0",
        "-c", "copy",
        "-an",
        refSamplePath,
      ], 60000, executor);

      let refProbe = await probeMedia(refSamplePath);
      if (refProbe.frames <= 1 || refProbe.duration < 0.5) {
        // Fallback to extraction from start of file if sampleStart was in an unindexed region
        await runCmd("ffmpeg", [
          "-hide_banner", "-y", "-loglevel", "warning",
          "-ss", "0",
          "-t", String(probeSampleSec),
          "-i", rawPath,
          "-map", "0:v:0",
          "-c", "copy",
          "-an",
          refSamplePath,
        ], 60000, executor);
        refProbe = await probeMedia(refSamplePath);
      }

      let optimalCq = winResult.cachedCq || 28;
      let gateMet = true;
      let chunkVmafMean = targetVmafMean;
      let chunkVmafP25 = targetVmafP25;

      if (winResult.samplingMode === "static_cache" && winResult.cachedCq) {
        optimalCq = winResult.cachedCq;
      } else {
        // Run bisection CQ search
        let iteration = 0;
        const cqSearchRes = await searchCq(
          async (testedCq: number): Promise<VmafScore> => {
            iteration++;
            const distSamplePath = path.join(chunkTmpDir, `dist_cq${testedCq}.mp4`);
            const probeStartMs = Date.now();

            // Encode sample per encoder specifications and user configured preset
            const probeEncArgs = buildEncoderArgs({
              encoder,
              preset: encoderPreset,
              cqOrCrf: testedCq,
              inputPath: refSamplePath,
              outputPath: distSamplePath,
            });

            await runCmd("ffmpeg", probeEncArgs, 60000, executor);

            // Run VMAF with fallback
            const vmafRes = await runVmafWithFallback(distSamplePath, refSamplePath, {
              ffmpegBin: "ffmpeg",
              sampleDurationSec: probeSampleSec,
              tempDir: chunkTmpDir,
              executor,
            });

            const durationMs = Date.now() - probeStartMs;

            // Log to DB vmaf_probe_logs
            await pool.query(
              `INSERT INTO vmaf_probe_logs (
                recording_id, iteration_num, tested_cq, sample_vmaf_mean,
                sample_vmaf_p25, sample_vmaf_hmean, sample_vmaf_min, backend,
                frames_scored, duration_ms
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                recordingId,
                iteration,
                testedCq,
                vmafRes.mean,
                vmafRes.p25,
                vmafRes.hmean ?? null,
                vmafRes.min ?? null,
                vmafRes.backend,
                vmafRes.framesScored,
                durationMs,
              ]
            );

            // Gate G4.10: Emit transcode:probe_step per iteration
            const probeStepPayload = {
              recording_id: recordingId,
              chunk_index: k,
              iteration,
              cq: testedCq,
              vmaf_mean: vmafRes.mean,
              vmaf_p25: vmafRes.p25,
              backend: vmafRes.backend,
              duration_ms: durationMs,
            };

            if (redis) {
              await redis.publish("transcode:probe_step", JSON.stringify(probeStepPayload));
            }
            if (io) {
              io.to("system").emit("transcode:probe_step", probeStepPayload);
            }

            return {
              mean: vmafRes.mean,
              p25: vmafRes.p25,
              hmean: vmafRes.hmean,
              min: vmafRes.min,
              backend: vmafRes.backend,
              frames: vmafRes.framesScored,
            };
          },
          (score) => score.mean >= targetVmafMean && score.p25 >= targetVmafP25,
          { cqMin, cqMax, safetyMargin: cqSafetyMargin }
        );

        optimalCq = cqSearchRes.cq;
        gateMet = cqSearchRes.gateMet;
        chunkVmafMean = cqSearchRes.score.mean;
        chunkVmafP25 = cqSearchRes.score.p25;
      }

      chunkResults.push({
        chunkIndex: k,
        startOffsetSec: chunkStartSec,
        durationSec: chunkDurationSec,
        samplingMode: winResult.samplingMode,
        sampleStartSec: sampleStart,
        optimalCq,
        gateMet,
        vmafMean: chunkVmafMean,
        vmafP25: chunkVmafP25,
        chunkVideoPath: path.join(jobTmpDir, `chunk_${k}.mp4`),
        rawSamplePath: refSamplePath,
      });

      // Insert chunk row
      await pool.query(
        `INSERT INTO recording_chunks (
          recording_id, chunk_index, start_offset_sec, duration_sec,
          sampling_mode, sample_start_sec, optimal_cq, gate_met,
          vmaf_mean, vmaf_p25, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
        ON DUPLICATE KEY UPDATE
          sampling_mode = VALUES(sampling_mode),
          sample_start_sec = VALUES(sample_start_sec),
          optimal_cq = VALUES(optimal_cq),
          gate_met = VALUES(gate_met),
          vmaf_mean = VALUES(vmaf_mean),
          vmaf_p25 = VALUES(vmaf_p25)`,
        [
          recordingId,
          k,
          chunkStartSec,
          chunkDurationSec,
          winResult.samplingMode,
          sampleStart,
          optimalCq,
          gateMet ? 1 : 0,
          chunkVmafMean,
          chunkVmafP25,
        ]
      );
    }

    // 4. Encoding Phase
    await transitionRecordingStatus(pool, recordingId, "ENCODING");

    for (const chunk of chunkResults) {
      // Encode chunk per encoder specifications and user configured preset
      const chunkEncArgs = buildEncoderArgs({
        encoder,
        preset: encoderPreset,
        cqOrCrf: Number(chunk.optimalCq),
        inputPath: rawPath,
        outputPath: chunk.chunkVideoPath,
        startOffsetSec: chunk.startOffsetSec,
        durationSec: chunk.durationSec,
      });

      await runCmd("ffmpeg", chunkEncArgs, 120000, executor);

      await pool.query(
        "UPDATE recording_chunks SET status = 'ENCODED' WHERE recording_id = ? AND chunk_index = ?",
        [recordingId, chunk.chunkIndex]
      );
    }

    // Concat chunks into final.mp4.partial
    const concatListPath = path.join(jobTmpDir, "chunks.txt");
    const concatLines = chunkResults.map((c) => `file '${c.chunkVideoPath.replace(/\\/g, "/")}'`).join("\n");
    await fsp.writeFile(concatListPath, concatLines, "utf-8");

    const camOutDir = path.join(compressedDir, `cam${cameraId}`);
    await fsp.mkdir(camOutDir, { recursive: true });

    const rawBasename = path.basename(rawPath);
    const finalFilename = rawBasename.endsWith(".mp4") ? rawBasename : `${rawBasename}.mp4`;
    const finalFinalPath = path.join(camOutDir, finalFilename);
    partialFinalPath = `${finalFinalPath}.partial`;

    const concatArgs = [
      "-hide_banner", "-y", "-loglevel", "warning",
      "-f", "concat",
      "-safe", "0",
      "-i", concatListPath,
      "-c", "copy",
      "-movflags", "+faststart",
    ];
    if (encoder === "hevc_nvenc" || encoder === "libx265") {
      concatArgs.push("-tag:v", "hvc1");
    }
    concatArgs.push("-f", "mp4");
    concatArgs.push(partialFinalPath);

    await runCmd("ffmpeg", concatArgs, 60000, executor);

    // 5. Verification Phase (Spec §8.6)
    await transitionRecordingStatus(pool, recordingId, "VERIFYING", {
      compressed_path: partialFinalPath,
    });

    // Check 1: ffprobe readable & duration within ±1s (or ±0.5%)
    const compProbe = await probeMedia(partialFinalPath);
    const durationDelta = Math.abs(compProbe.duration - totalDurationSec);
    const maxAllowedDelta = Math.max(1.0, totalDurationSec * 0.005);

    if (durationDelta > maxAllowedDelta) {
      throw new Error(`Duration check failed: raw ${totalDurationSec}s vs compressed ${compProbe.duration}s (delta ${durationDelta}s > ${maxAllowedDelta}s)`);
    }

    // Check 2: Full decode test produces no errors
    await runCmd("ffmpeg", [
      "-v", "error",
      "-i", partialFinalPath,
      "-f", "null",
      "-",
    ], 60000, executor);

    const compStat = await fsp.stat(partialFinalPath);
    const compressedSizeBytes = compStat.size;

    // Check 3: Gate G4.8: If compressed >= raw -> SKIPPED (keep raw)
    if (compressedSizeBytes >= rawSizeBytes) {
      await fsp.unlink(partialFinalPath);
      partialFinalPath = null;

      await transitionRecordingStatus(pool, recordingId, "SKIPPED", {
        raw_size_bytes: rawSizeBytes,
        compressed_size_bytes: compressedSizeBytes,
        failure_reason: `No space gain: compressed (${compressedSizeBytes}) >= raw (${rawSizeBytes})`,
      });

      return {
        recordingId,
        status: "SKIPPED",
        rawSizeBytes,
        compressedSizeBytes,
        qualityGateMet: false,
        failureReason: "No space gain",
      };
    }

    // Check 4: Sample re-check for each chunk vs raw sample
    let allChunksGateMet = true;
    for (const chunk of chunkResults) {
      if (!chunk.gateMet) {
        allChunksGateMet = false;
      }
    }

    // Atomic rename .partial -> final path
    await fsp.rename(partialFinalPath, finalFinalPath);
    partialFinalPath = null;

    // Calculate aggregated metrics
    const minOptimalCq = Math.min(...chunkResults.map((c) => c.optimalCq));
    const avgVmafMean = Number(
      (chunkResults.reduce((acc, c) => acc + c.vmafMean, 0) / chunkResults.length).toFixed(2)
    );
    const minVmafP25 = Number(
      Math.min(...chunkResults.map((c) => c.vmafP25)).toFixed(2)
    );

    const savingsBytes = rawSizeBytes - compressedSizeBytes;
    const savingsPct = Number(((savingsBytes / rawSizeBytes) * 100).toFixed(2));
    const verifiedAt = new Date();

    // Update status to COMPLETED
    await transitionRecordingStatus(pool, recordingId, "COMPLETED", {
      compressed_path: finalFinalPath,
      compressed_size_bytes: compressedSizeBytes,
      raw_size_bytes: rawSizeBytes,
      optimal_cq: minOptimalCq,
      vmaf_mean: avgVmafMean,
      vmaf_p25: minVmafP25,
      quality_gate_met: allChunksGateMet ? 1 : 0,
      verified_at: verifiedAt,
    });

    // Gate G4.7: If gate was not met for any chunk, raise alert and KEEP raw
    if (!allChunksGateMet) {
      if (redis) {
        await redis.publish(
          "system:alert",
          JSON.stringify({
            level: "warning",
            type: "quality_gate_unmet",
            recording_id: recordingId,
            vmaf_mean: avgVmafMean,
            target_mean: targetVmafMean,
            timestamp: new Date().toISOString(),
          })
        );
      }
    } else if (deleteRawAfterVerify) {
      // Raw deletion grace period check (Gate G4.4)
      const nowMs = Date.now();
      const eligibleDeleteTime = verifiedAt.getTime() + rawDeleteGraceSec * 1000;
      if (nowMs >= eligibleDeleteTime) {
        try {
          await fsp.unlink(rawPath);
          await transitionRecordingStatus(pool, recordingId, "COMPLETED", {
            raw_deleted_at: new Date(),
          });
        } catch {
          // ignore if deletion fails
        }
      }
    }

    return {
      recordingId,
      status: "COMPLETED",
      rawSizeBytes,
      compressedSizeBytes,
      savingsBytes,
      savingsPct,
      vmafMean: avgVmafMean,
      vmafP25: minVmafP25,
      qualityGateMet: allChunksGateMet,
      compressedPath: finalFinalPath,
    };
  } catch (err: any) {
    // Crash recovery: cleanup any .partial file
    if (partialFinalPath) {
      try {
        await fsp.unlink(partialFinalPath);
      } catch { }
    }

    // Reset status to RAW on error so it can be re-run cleanly (idempotent, Gate G4.5)
    try {
      await pool.query("UPDATE recordings SET status = 'RAW' WHERE id = ?", [recordingId]);
    } catch { }

    throw err;
  } finally {
    // Clean up temporary workspace directory
    try {
      await fsp.rm(jobTmpDir, { recursive: true, force: true });
    } catch { }
  }
}