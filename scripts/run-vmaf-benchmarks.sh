#!/usr/bin/env bash
set -euo pipefail

echo "=========================================================="
echo "Starting VMS Phase 1 VMAF-CUDA Hardware Benchmarks (RTX 4060)"
echo "=========================================================="

WORKSPACE="/workspace"
REF="$WORKSPACE/tests/fixtures/fixture_20s.mp4"
TMP_DIR="/tmp/vms_bench"
mkdir -p "$TMP_DIR"

run_vmaf_cuda() {
  local dist="$1"
  local ref="$2"
  local log="$3"
  ffmpeg -hide_banner -loglevel warning -y \
    -i "$dist" -i "$ref" \
    -filter_complex "[0:v]format=yuv420p,hwupload_cuda[dist];[1:v]format=yuv420p,hwupload_cuda[ref];[dist][ref]libvmaf_cuda=log_path='${log}':log_fmt=json" \
    -an -f null -
}

run_vmaf_cpu() {
  local dist="$1"
  local ref="$2"
  local log="$3"
  ffmpeg -hide_banner -loglevel warning -y \
    -i "$dist" -i "$ref" \
    -filter_complex "[0:v][1:v]libvmaf=log_path='${log}':log_fmt=json:n_threads=16:n_subsample=2" \
    -an -f null -
}

echo ""
echo "--- [G1.2] Self-Compare VMAF on Reference (Target >= 99.5) ---"
SELF_LOG="$TMP_DIR/self_compare.json"
START_TS=$(date +%s%N)
run_vmaf_cuda "$REF" "$REF" "$SELF_LOG"
END_TS=$(date +%s%N)
SELF_MS=$(( (END_TS - START_TS) / 1000000 ))

python3 -c "
import json
data = json.load(open('$SELF_LOG'))
scores = [f['metrics']['vmaf'] for f in data['frames']]
mean = data.get('pooled_metrics', {}).get('vmaf', {}).get('mean', sum(scores)/len(scores))
s = sorted(scores)
q = 0.25 * (len(s) - 1)
i = int(q)
p25 = s[i] + (q - i) * (s[i+1] - s[i])
frames = len(scores)
print(f'G1.2 RESULT: Mean={mean:.4f}, p25={p25:.4f}, frames={frames}, time=${SELF_MS}ms')
assert mean >= 99.5, f'Self-compare mean {mean} < 99.5'
print('G1.2: PASS')
"

echo ""
echo "--- [G1.3] CQ Sweep {20, 28, 36, 44} (Target: non-increasing VMAF) ---"
for CQ in 20 28 36 44; do
  DIST="$TMP_DIR/dist_cq${CQ}.mp4"
  LOG="$TMP_DIR/vmaf_cq${CQ}.json"
  
  ffmpeg -hide_banner -loglevel warning -y \
    -hwaccel cuda -hwaccel_output_format cuda \
    -i "$REF" -an -c:v av1_nvenc -preset p5 -cq "$CQ" -b:v 0 -fps_mode passthrough \
    "$DIST"
  
  START_TS=$(date +%s%N)
  run_vmaf_cuda "$DIST" "$REF" "$LOG"
  END_TS=$(date +%s%N)
  DURATION_MS=$(( (END_TS - START_TS) / 1000000 ))
  
  python3 -c "
import json
data = json.load(open('$LOG'))
scores = [f['metrics']['vmaf'] for f in data['frames']]
mean = data.get('pooled_metrics', {}).get('vmaf', {}).get('mean', sum(scores)/len(scores))
s = sorted(scores)
q = 0.25 * (len(s) - 1)
i = int(q)
p25 = s[i] + (q - i) * (s[i+1] - s[i])
hmean = data.get('pooled_metrics', {}).get('vmaf', {}).get('harmonic_mean', 0.0)
min_val = data.get('pooled_metrics', {}).get('vmaf', {}).get('min', min(scores))
print(f'CQ=$CQ | Mean={mean:.2f} | p25={p25:.2f} | hmean={hmean:.2f} | min={min_val:.2f} | frames={len(scores)} | duration=${DURATION_MS}ms')
open('$TMP_DIR/cq_${CQ}.txt', 'w').write(f'{mean},{p25},${DURATION_MS}')
"
done

python3 -c "
m20 = float(open('$TMP_DIR/cq_20.txt').read().split(',')[0])
m28 = float(open('$TMP_DIR/cq_28.txt').read().split(',')[0])
m36 = float(open('$TMP_DIR/cq_36.txt').read().split(',')[0])
m44 = float(open('$TMP_DIR/cq_44.txt').read().split(',')[0])
print(f'CQ Means: 20->{m20:.2f}, 28->{m28:.2f}, 36->{m36:.2f}, 44->{m44:.2f}')
assert m20 >= m28 >= m36 >= m44, 'Mean VMAF is NOT non-increasing!'
print('G1.3: PASS (Mean VMAF strictly non-increasing across CQ 20, 28, 36, 44)')
"

echo ""
echo "--- [G1.6] CUDA vs CPU VMAF Comparison on CQ 28 (Target: delta <= 2.0) ---"
CPU_LOG="$TMP_DIR/vmaf_cq28_cpu.json"
run_vmaf_cpu "$TMP_DIR/dist_cq28.mp4" "$REF" "$CPU_LOG"

python3 -c "
import json
data_cuda = json.load(open('$TMP_DIR/vmaf_cq28.json'))
data_cpu = json.load(open('$CPU_LOG'))
scores_cuda = [f['metrics']['vmaf'] for f in data_cuda['frames']]
scores_cpu = [f['metrics']['vmaf'] for f in data_cpu['frames']]
mean_cuda = data_cuda.get('pooled_metrics', {}).get('vmaf', {}).get('mean', sum(scores_cuda)/len(scores_cuda))
mean_cpu = data_cpu.get('pooled_metrics', {}).get('vmaf', {}).get('mean', sum(scores_cpu)/len(scores_cpu))
delta = abs(mean_cuda - mean_cpu)
print(f'CUDA Mean={mean_cuda:.4f}, CPU Mean={mean_cpu:.4f}, Delta={delta:.4f}')
assert delta <= 2.0, f'Delta {delta} exceeds 2.0 limit'
print('G1.6: PASS (Delta <= 2.0)')
"

echo ""
echo "--- [G1.9] Full CQ Bisection Search on 20s Sample (Target: <= 5 iterations) ---"
python3 -c "
import json, os, subprocess, time

REF = '$REF'
TMP = '$TMP_DIR'

def probe(cq):
    dist = f'{TMP}/search_cq{cq}.mp4'
    log = f'{TMP}/search_cq{cq}.json'
    t0 = time.time()
    subprocess.run([
        'ffmpeg', '-hide_banner', '-loglevel', 'warning', '-y',
        '-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda',
        '-i', REF, '-an', '-c:v', 'av1_nvenc', '-preset', 'p5', '-cq', str(cq), '-b:v', '0', '-fps_mode', 'passthrough',
        dist
    ], check=True)
    subprocess.run([
        'ffmpeg', '-hide_banner', '-loglevel', 'warning', '-y',
        '-i', dist, '-i', REF,
        '-filter_complex', f'[0:v]format=yuv420p,hwupload_cuda[dist];[1:v]format=yuv420p,hwupload_cuda[ref];[dist][ref]libvmaf_cuda=log_path=\'{log}\':log_fmt=json',
        '-an', '-f', 'null', '-'
    ], check=True)
    t1 = time.time()
    data = json.load(open(log))
    scores = [f['metrics']['vmaf'] for f in data['frames']]
    mean = data.get('pooled_metrics', {}).get('vmaf', {}).get('mean', sum(scores)/len(scores))
    s = sorted(scores)
    q = 0.25 * (len(s) - 1)
    i = int(q)
    p25 = s[i] + (q - i) * (s[i+1] - s[i])
    return mean, p25, round((t1 - t0) * 1000)

cq_min = 18
cq_max = 48
lo = cq_min
hi = cq_max
best = None
iterations = 0
wall_start = time.time()

while lo <= hi:
    mid = (lo + hi) // 2
    iterations += 1
    mean, p25, dur = probe(mid)
    passed = (mean >= 85.0 and p25 >= 81.0)
    print(f'Iteration {iterations}: Tested CQ={mid} -> Mean={mean:.2f}, p25={p25:.2f} ({dur}ms) => {\"PASS\" if passed else \"FAIL\"}')
    if passed:
        best = (mid, mean, p25)
        lo = mid + 1
    else:
        hi = mid - 1

total_wall_sec = round(time.time() - wall_start, 2)
print(f'G1.9 RESULT: Converged in {iterations} iterations (Total wall time: {total_wall_sec}s). Optimal CQ={best[0]} (Mean={best[1]:.2f}, p25={best[2]:.2f})')
assert iterations <= 5, f'Iterations {iterations} > 5'
print('G1.9: PASS')
"

echo ""
echo "=== All Hardware VMAF benchmarks completed successfully ==="
