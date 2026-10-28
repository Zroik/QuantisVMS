import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseVmafJson, type VmafParsedResult } from "./parser.js";

export interface VmafRunOptions {
  ffmpegBin?: string;
  sampleDurationSec?: number;
  watchdogTimeoutMs?: number;
  cudaEnabled?: boolean;
  referenceFrames?: number;
  tempDir?: string;
  // Dependency injection for testing execution / process behavior
  executor?: ProcessExecutor;
}

export interface VmafRunResult extends VmafParsedResult {
  backend: "cuda" | "cpu";
  durationMs: number;
}

export interface ProcessExecutionResult {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export type ProcessExecutor = (
  command: string,
  args: string[],
  timeoutMs: number
) => Promise<ProcessExecutionResult>;

/**
 * Cross-platform process group killer.
 * On Windows uses taskkill /T /F. On POSIX sends SIGKILL to the process group.
 */
export function killProcessTree(child: ChildProcess): void {
  if (!child.pid || child.killed) return;

  if (process.platform === "win32") {
    try {
      const killer = spawn("taskkill", ["/pid", child.pid.toString(), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.unref();
    } catch {
      child.kill("SIGKILL");
    }
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

/**
 * Default process executor with strict watchdog timer and process tree termination.
 */
export const defaultProcessExecutor: ProcessExecutor = (
  command: string,
  args: string[],
  timeoutMs: number
): Promise<ProcessExecutionResult> => {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timer: NodeJS.Timeout | null = null;

    const child = spawn(command, args, {
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killProcessTree(child);
      }, timeoutMs);
    }

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: code,
        timedOut,
        stdout,
        stderr,
      });
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      stderr += `\nSpawn error: ${err.message}`;
      resolve({
        exitCode: -1,
        timedOut,
        stdout,
        stderr,
      });
    });
  });
};

/**
 * Build FFmpeg command arguments for VMAF calculation.
 * Distorted is ALWAYS input 0 [dist], Reference is input 1 [ref] (Spec §2 E7).
 */
export function buildVmafArgs(
  distortedPath: string,
  referencePath: string,
  logJsonPath: string,
  backend: "cuda" | "cpu"
): string[] {
  const normDist = distortedPath.replace(/\\/g, "/");
  const normRef = referencePath.replace(/\\/g, "/");
  // On Windows, drive colons (e.g. D:) must be escaped as \: in FFmpeg filtergraphs
  const escapedLog = logJsonPath.replace(/\\/g, "/").replace(/:/g, "\\:");

  if (backend === "cuda") {
    // CUDA pipeline with format=yuv420p,hwupload_cuda (Spec §2 E7 & §9.4)
    return [
      "-hide_banner",
      "-loglevel", "warning",
      "-i", normDist,
      "-i", normRef,
      "-filter_complex",
      `[0:v]format=yuv420p,hwupload_cuda[dist];[1:v]format=yuv420p,hwupload_cuda[ref];[dist][ref]libvmaf_cuda=log_path='${escapedLog}':log_fmt=json:n_threads=8`,
      "-an",
      "-f", "null",
      "-",
    ];
  } else {
    // CPU fallback pipeline (Spec §9.4 & §8.4)
    return [
      "-hide_banner",
      "-loglevel", "warning",
      "-i", normDist,
      "-i", normRef,
      "-filter_complex",
      `[0:v][1:v]libvmaf=log_path='${escapedLog}':log_fmt=json:n_threads=16:n_subsample=2`,
      "-an",
      "-f", "null",
      "-",
    ];
  }
}

/**
 * Execute VMAF measurement with watchdog timeout, frame count check, and CUDA->CPU fallback.
 */
export async function runVmafWithFallback(
  distortedPath: string,
  referencePath: string,
  options: VmafRunOptions = {}
): Promise<VmafRunResult> {
  const ffmpegBin = options.ffmpegBin ?? "ffmpeg";
  const sampleDurationSec = options.sampleDurationSec ?? 20;
  const timeoutMs = options.watchdogTimeoutMs ?? Math.max(60000, 6 * sampleDurationSec * 1000);
  const cudaEnabled = options.cudaEnabled ?? true;
  const referenceFrames = options.referenceFrames;
  const executor = options.executor ?? defaultProcessExecutor;
  const tempDir = options.tempDir ?? os.tmpdir();

  const startMs = Date.now();
  const logJsonPath = path.join(tempDir, `vmaf_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.json`);

  const cleanupLog = async () => {
    try {
      await fs.unlink(logJsonPath);
    } catch {
      // ignore
    }
  };

  const attemptRun = async (backend: "cuda" | "cpu"): Promise<VmafParsedResult | null> => {
    await cleanupLog();
    const args = buildVmafArgs(distortedPath, referencePath, logJsonPath, backend);
    const execResult = await executor(ffmpegBin, args, timeoutMs);

    if (execResult.timedOut || execResult.exitCode !== 0) {
      return null;
    }

    try {
      const content = await fs.readFile(logJsonPath, "utf-8");
      const parsed = parseVmafJson(content);

      // Frame-count validation check (Spec §2 E6, Gate G1.4)
      if (referenceFrames !== undefined && parsed.framesScored !== referenceFrames) {
        return null; // Mismatched frame count is treated as probe failure
      }

      return parsed;
    } catch {
      return null;
    }
  };

  try {
    if (cudaEnabled) {
      // 1. First CUDA attempt
      let res = await attemptRun("cuda");
      if (res) {
        return {
          ...res,
          backend: "cuda",
          durationMs: Date.now() - startMs,
        };
      }

      // 2. Retry once on CUDA (Spec §2 E6 & §8.4)
      res = await attemptRun("cuda");
      if (res) {
        return {
          ...res,
          backend: "cuda",
          durationMs: Date.now() - startMs,
        };
      }
    }

    // 3. Fall back to CPU (Spec §2 E6 & §8.4)
    const cpuRes = await attemptRun("cpu");
    if (cpuRes) {
      return {
        ...cpuRes,
        backend: "cpu",
        durationMs: Date.now() - startMs,
      };
    }

    throw new Error(
      `VMAF calculation failed completely on both CUDA and CPU fallback (timeout: ${timeoutMs}ms, frames: ${referenceFrames ?? "unspecified"})`
    );
  } finally {
    await cleanupLog();
  }
}
