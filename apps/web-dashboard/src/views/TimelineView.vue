<template>
  <div class="timeline-view app">
    <!-- Breadcrumb Trail -->
    <p class="crumb">
      Quantis
      <svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg>
      <b>Garis Waktu Forensik</b>
    </p>

    <!-- Header Section with Realtime Status Chip -->
    <div class="hd">
      <h1>Garis waktu forensik</h1>
      <div class="chip" aria-live="off">
        <i class="dot pulse"></i>
        <b class="mono">{{ liveTimeWIB }}</b>
        <hr />
        <div>
          <b>Sinkronisasi Live</b>
          <small>Pita aktivitas &amp; segmentasi rekaman</small>
        </div>
      </div>
    </div>

    <!-- Camera Selection & Refresh Bar -->
    <div class="cam-bar card rv" style="--i:0; margin-bottom: 16px; padding: 12px 18px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
      <div style="display: flex; align-items: center; gap: 12px;">
        <span class="ico" style="width: 34px; height: 34px;">
          <svg viewBox="0 0 24 24"><path d="M23 7l-7 5 7 5zM1 5h15v14H1z" /></svg>
        </span>
        <div style="display: flex; flex-direction: column;">
          <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--mu);">Kamera Terpilih</span>
          <span style="font-size: 15px; font-weight: 700; color: var(--tx);">{{ currentCameraName }}</span>
        </div>
      </div>

      <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
        <select
          class="sel mono"
          aria-label="Pilih Kamera"
          v-model="selectedCamId"
          @change="onCameraChange"
        >
          <option v-for="cam in camerasStore.cameras" :key="cam.id" :value="cam.id">
            {{ cam.name }}
          </option>
        </select>

        <button
          class="btn o s"
          type="button"
          title="Segarkan data rekaman"
          @click="fetchRecordings"
        >
          <svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5" /></svg>
          <span>Segarkan</span>
        </button>
      </div>
    </div>

    <!-- Hero Summary Card with Stacked Disk Usage -->
    <article class="card hero rv" style="--i:1; margin-bottom: 16px;">
      <p class="eb">REKAMAN &amp; ANALISIS FORENSIK</p>
      <h2>Segmen #{{ activeRecording ? activeRecording.id : '-' }} · {{ currentCameraName }}</h2>
      <p>
        Diproduksi pada <b>{{ activeRecording ? formatWIBDateTime(activeRecording.started_at) : '-' }}</b>
        dengan durasi <b>{{ activeRecording ? formatDuration(activeRecording.duration_sec) : '-' }}</b>.
        Ukuran mentah <b>{{ formatBytes(activeRecording?.raw_size_bytes) }}</b>
        dikompresi menjadi <b>{{ activeRecording?.compressed_size_bytes ? formatBytes(activeRecording.compressed_size_bytes) : 'Belum selesai' }}</b>
        berbasis gerbang VMAF.
      </p>

      <!-- Quick Action Buttons -->
      <div class="acts">
        <button class="btn p" type="button" @click="captureSnapshot">
          <svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>
          <span>Tangkapan Bukti</span>
        </button>
        <button class="btn o" type="button" @click="downloadVideo">
          <svg viewBox="0 0 24 24"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>
          <span>Unduh MP4</span>
        </button>

        <div class="seg" role="group" aria-label="Mode Streaming" style="margin-left: auto;">
          <button
            type="button"
            :aria-pressed="streamMode === 'compressed'"
            :disabled="!isCurrentRecordingCompressed"
            :title="!isCurrentRecordingCompressed ? 'Kompresi belum selesai atau masih dalam masa penundaan 24 jam' : 'Tampilkan video terkompresi'"
            @click="setStreamMode('compressed')"
          >
            Mode Kompresi
          </button>
          <button
            type="button"
            :aria-pressed="streamMode === 'raw'"
            @click="setStreamMode('raw')"
          >
            Mode Mentah
          </button>
        </div>
      </div>

      <!-- Segment Storage Breakdown Stack -->
      <div class="ch" style="margin-bottom: 10px; margin-top: 10px;">
        <span class="ico"><svg viewBox="0 0 24 24"><path d="M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg></span>
        <div style="flex: 1;">
          <h2>Rasio Kompresi Segmen</h2>
          <p>Efisiensi penyimpanan arsip video</p>
        </div>
        <div style="text-align: right;">
          <b style="font-size: 20px; color: var(--iris); letter-spacing: -.02em;">
            {{ compressionRatioStr }}
          </b>
          <p class="mono">{{ formatBytes(currentFileSizeBytes) }} aktif</p>
        </div>
      </div>

      <div class="stack" role="img" aria-label="Rasio Kompresi Segmen">
        <span :style="{ flex: rawRatioFlex, background: 'var(--coral)' }"></span>
        <span :style="{ flex: compRatioFlex, background: 'var(--iris)' }"></span>
        <span :style="{ flex: 30, background: 'var(--well)' }"></span>
      </div>

      <div class="leg">
        <div>
          <span><i style="background: var(--coral);"></i>Berkas Mentah</span>
          <b>{{ formatBytes(activeRecording?.raw_size_bytes) }}</b>
        </div>
        <div>
          <span><i style="background: var(--iris);"></i>Hasil Kompresi</span>
          <b>{{ activeRecording?.compressed_size_bytes && isCurrentRecordingCompressed ? formatBytes(activeRecording.compressed_size_bytes) : '-' }}</b>
        </div>
        <div>
          <span><i style="background: var(--good);"></i>Kualitas VMAF</span>
          <b style="color: var(--good);">{{ (activeRecording?.vmaf_score || 94.2).toFixed(1) }}</b>
        </div>
        <div>
          <span><i style="background: var(--mu);"></i>Status Node</span>
          <b style="color: var(--iris);">{{ activeRecording?.status || 'RAW' }}</b>
        </div>
      </div>
    </article>

    <!-- Forensic Video Player & Jog Shuttle Card -->
    <article class="card rv" style="--i:2; margin-bottom: 16px;">
      <div class="ch">
        <span class="ico">
          <svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" stroke-width="1.8"/><path d="M8 21h8M12 17v4" stroke-width="1.8"/></svg>
        </span>
        <div style="flex: 1;">
          <h2>Pemutar Forensik</h2>
          <p class="mono">Stempel WIB presisi · playback multi-kecepatan</p>
        </div>

        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="pill" :class="{ warn: !isPlaying }">
            ● {{ isPlaying ? 'Memutar' : 'Jeda' }} ({{ playbackRate }}x)
          </span>
          <button class="btn o s" type="button" @click="toggleFullscreen" title="Layar Penuh (F)">
            <svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>
            <span>Penuh</span>
          </button>
        </div>
      </div>

      <!-- Player Frame -->
      <div class="player-wrapper" ref="playerContainerRef">
        <video
          ref="playbackVideoRef"
          class="video-el"
          :style="timelineVideoStyle"
          playsinline
          preload="auto"
          :src="videoPlaybackUrl"
          @timeupdate="onTimeUpdate"
          @loadedmetadata="onLoadedMetadata"
          @error="onVideoError"
          @ended="onVideoEnded"
          @play="isPlaying = true"
          @pause="isPlaying = false"
          @click="togglePlay"
        ></video>

        <!-- Top Chip Overlay -->
        <div class="player-chip mono" :class="{ on: isPlaying }">
          <i class="player-beacon"></i>
          <span>{{ isPlaying ? 'MEMUTAR' : 'JEDA' }}</span>
          <s>|</s>
          <span>{{ playbackRate }}x</span>
          <s>|</s>
          <span>SEGMEN #{{ activeRecording ? activeRecording.id : '-' }}</span>
          <s>|</s>
          <span>{{ formatSeconds(currentTimeSec) }} / {{ formatSeconds(videoDurationSec) }}</span>
        </div>

        <!-- Big Center Play Button Overlay -->
        <button
          v-if="!isPlaying && activeRecording && !videoError"
          class="big-play-btn"
          type="button"
          @click="togglePlay"
          aria-label="Putar Video"
        >
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
        </button>

        <!-- Video Error Overlay -->
        <div v-if="videoError" class="video-error-overlay">
          <svg viewBox="0 0 24 24" style="width: 32px; height: 32px; color: var(--crit); margin-bottom: 8px;">
            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
          <p style="font-weight: 700; font-size: 14px; color: var(--tx);">Gagal Memuat Berkas Rekaman</p>
          <p style="font-size: 12px; color: var(--mu); margin-top: 4px;">{{ videoError }}</p>
          <button class="btn o s" style="margin-top: 12px;" @click="retryPlayback">
            Coba Muat Ulang
          </button>
        </div>

        <!-- Interactive Bottom Scrub Bar -->
        <div class="player-scrub" @click="onTimelineClick">
          <div
            class="scrub-fill"
            :style="{ width: `${videoDurationSec > 0 ? (currentTimeSec / videoDurationSec) * 100 : 0}%` }"
          ></div>
        </div>
      </div>

      <!-- Realtime Audio / Activity Equalizer Bars -->
      <div class="bars-container" style="display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 16px 0 10px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--mu);">
            Aktivitas Aliran
          </span>
          <span class="pill mono" style="font-size: 11px; padding: 1px 8px;">
            {{ isPlaying ? '● 25 fps stream' : '○ Diam' }}
          </span>
        </div>

        <!-- Animated Bars Component -->
        <div class="bars" :class="{ active: isPlaying }" aria-hidden="true" style="height: 32px; width: 240px;">
          <i
            v-for="idx in 24"
            :key="idx"
            :style="{
              height: isPlaying ? `${20 + ((idx * 17) % 80)}%` : '15%',
              animationDelay: `${idx * 28}ms`,
              animationDuration: `${0.4 + ((idx % 4) * 0.15)}s`,
            }"
          ></i>
        </div>
      </div>

      <!-- Jog Shuttle Bardeck Controls -->
      <div class="bardeck-controls">
        <!-- Jog Step Buttons -->
        <div class="grp-jog">
          <button
            class="btn o s"
            title="Segmen sebelumnya (Alt + ←)"
            aria-label="Sebelumnya"
            :disabled="!hasPreviousSegment"
            @click="playPreviousSegment"
            :style="{ opacity: !hasPreviousSegment ? 0.35 : 1 }"
          >
            <svg viewBox="0 0 24 24"><path d="M19 5v14M17 12 7 5v14z"/></svg>
          </button>
          <button class="btn o s" @click="stepSeconds(-5)">-5s</button>
          <button class="btn o s" @click="stepSeconds(-1)">-1s</button>

          <button class="btn p s" @click="togglePlay" style="padding: 0 16px;">
            <svg viewBox="0 0 24 24">
              <path :d="isPlaying ? 'M7 5h4v14H7zM13 5h4v14h-4z' : 'M8 5v14l11-7z'"/>
            </svg>
            <span>{{ isPlaying ? 'Jeda' : 'Putar' }}</span>
          </button>

          <button class="btn o s" @click="stepSeconds(1)">+1s</button>
          <button class="btn o s" @click="stepSeconds(5)">+5s</button>
          <button
            class="btn o s"
            title="Segmen berikutnya (Alt + →)"
            aria-label="Berikutnya"
            :disabled="!hasNextSegment"
            @click="playNextSegment"
            :style="{ opacity: !hasNextSegment ? 0.35 : 1 }"
          >
            <svg viewBox="0 0 24 24"><path d="M5 5v14M7 12l10-7v14z"/></svg>
          </button>
        </div>

        <!-- Playback Rate Pill Segment -->
        <div class="seg" role="group" aria-label="Kecepatan Pemutaran">
          <button
            v-for="rate in [0.5, 1, 1.5, 2, 4]"
            :key="rate"
            :aria-pressed="playbackRate === rate"
            @click="setPlaybackRate(rate)"
          >
            {{ rate }}x
          </button>
        </div>

        <!-- Auto Advance Toggle -->
        <button
          class="btn o s"
          :class="{ active: autoAdvance }"
          @click="autoAdvance = !autoAdvance"
          title="Putar segmen berikutnya otomatis"
        >
          <svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          <span>Auto-lanjut</span>
        </button>
      </div>
    </article>

    <!-- AI Activity Ribbon Card -->
    <article class="card rv" style="--i:3; margin-bottom: 16px;">
      <div class="ch">
        <span class="ico">
          <svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8M15 7h6v6"/></svg>
        </span>
        <div style="flex: 1;">
          <h2>Pita Aktivitas AI (YOLO26n)</h2>
          <p class="mono">
            {{ activityWindows.length }} jendela aktivitas · bobot: orang 3, kendaraan 2, hewan 1
          </p>
        </div>

        <div style="display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--mu);">
          <span style="display: flex; align-items: center; gap: 4px;">
            <i style="width: 8px; height: 8px; border-radius: 50%; background: var(--crit); display: inline-block;"></i>
            Tinggi
          </span>
          <span style="display: flex; align-items: center; gap: 4px;">
            <i style="width: 8px; height: 8px; border-radius: 50%; background: var(--warn); display: inline-block;"></i>
            Sedang
          </span>
          <span style="display: flex; align-items: center; gap: 4px;">
            <i style="width: 8px; height: 8px; border-radius: 50%; background: var(--iris); display: inline-block;"></i>
            Rendah
          </span>
        </div>
      </div>

      <!-- Timeline Band Track -->
      <div class="band-track" ref="timelineTrackRef" aria-label="Pita aktivitas" @click="onTimelineClick">
        <div v-if="activityWindows.length === 0" class="empty-band">
          Tidak ada data jendela aktivitas tersimpan untuk segmen ini
        </div>
        <template v-else>
          <i
            v-for="(w, idx) in activityWindows"
            :key="idx"
            class="band-bar"
            :style="{
              height: `${Math.min(100, Math.max(16, (w.weighted_activity_score || 0) * 3.4))}%`,
              background: getActivityBarColor(w.weighted_activity_score),
              opacity: w.weighted_activity_score > 0 ? 0.95 : 0.35,
            }"
            :title="`Detik ${w.start_offset_sec}s | Skor: ${w.weighted_activity_score}`"
          ></i>
        </template>

        <!-- Current Realtime Playhead Line -->
        <b
          class="playhead-line"
          :style="{ left: `${videoDurationSec > 0 ? (currentTimeSec / videoDurationSec) * 100 : 0}%` }"
        ></b>
      </div>

      <!-- Time Axis -->
      <div class="ax mono">
        <span>00:00</span>
        <span>{{ formatSeconds(videoDurationSec * 0.25) }}</span>
        <span>{{ formatSeconds(videoDurationSec * 0.5) }}</span>
        <span>{{ formatSeconds(videoDurationSec * 0.75) }}</span>
        <span>{{ formatSeconds(videoDurationSec) }}</span>
      </div>
    </article>

    <!-- Two-Column Section: AI Detections & Available Segments -->
    <section class="g c">
      <!-- Left Column: AI Detection Events -->
      <article class="card rv" style="--i:4;">
        <div class="ch">
          <span class="ico">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </span>
          <div style="flex: 1;">
            <h2>Kejadian Deteksi AI</h2>
            <p class="mono">{{ filteredEvents.length }} dari {{ detectionEvents.length }} deteksi</p>
          </div>
        </div>

        <!-- Category Filters & Confidence Dropdown -->
        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px;">
          <div class="seg" role="group" aria-label="Kategori Deteksi">
            <button
              v-for="cat in ['semua', 'person', 'vehicle', 'pet']"
              :key="cat"
              :aria-pressed="selectedEventFilter === cat"
              @click="selectedEventFilter = cat"
            >
              {{ cat === 'semua' ? 'Semua' : cat === 'person' ? 'Orang' : cat === 'vehicle' ? 'Kendaraan' : 'Hewan' }}
            </button>
          </div>

          <select class="sel mono" style="height: 34px; margin-left: auto;" v-model="minConfidence">
            <option :value="0">Semua akurasi</option>
            <option :value="0.4">≥ 40%</option>
            <option :value="0.6">≥ 60%</option>
            <option :value="0.8">≥ 80%</option>
          </select>
        </div>

        <p v-if="filteredEvents.length === 0" class="empty-state">
          Tidak ada deteksi objek yang sesuai kriteria dalam segmen ini.
        </p>

        <!-- Events List -->
        <div v-else class="event-scroll-list">
          <button
            v-for="ev in filteredEvents"
            :key="ev.id"
            class="event-card-row"
            type="button"
            @click="seekToEvent(ev)"
          >
            <div style="display: flex; align-items: center; gap: 10px;">
              <span class="event-type-dot"></span>
              <span style="font-weight: 700; font-size: 13.5px; color: var(--tx);">{{ ev.class_name }}</span>
              <span class="pill iris mono" style="font-size: 11px;">
                {{ (ev.confidence * 100).toFixed(0) }}%
              </span>
            </div>
            <div class="mono" style="font-size: 12px; color: var(--mu);">
              {{ formatWIBTimeOnly(ev.detected_at) }} (+{{ getEventOffsetSec(ev) }}s)
            </div>
          </button>
        </div>
      </article>

      <!-- Right Column: Available Recordings Drawer -->
      <article class="card rv" style="--i:5;">
        <div class="ch">
          <span class="ico">
            <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </span>
          <div style="flex: 1;">
            <h2>Daftar Segmen Rekaman</h2>
            <p class="mono">{{ filteredRecordings.length }} segmen tersedia</p>
          </div>

          <select class="sel mono" style="height: 32px; font-size: 12px;" v-model="recordingStatusFilter">
            <option value="ALL">Semua status</option>
            <option value="FINISHED">Selesai</option>
            <option value="RECORDING">Merekam</option>
          </select>
        </div>

        <!-- Segment List -->
        <div class="segment-scroll-list">
          <button
            v-for="rec in filteredRecordings"
            :key="rec.id"
            class="segment-card-row"
            :class="{ active: activeRecording?.id === rec.id }"
            type="button"
            @click="selectRecording(rec)"
          >
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <i
                  class="segment-dot"
                  :class="{ live: rec.status === 'RECORDING', done: rec.status === 'COMPLETED' || rec.status === 'RAW' }"
                ></i>
                <span style="font-weight: 700; font-size: 13.5px;">Segmen #{{ rec.id }}</span>
              </div>
              <span class="pill mono" style="font-size: 11px;">
                {{ rec.status === 'RECORDING' ? 'Merekam…' : formatDuration(rec.duration_sec) }}
              </span>
            </div>

            <div style="font-size: 12px; color: var(--mu); margin: 4px 0;">
              {{ formatWIBDateTime(rec.started_at) }}
            </div>

            <div class="mono" style="display: flex; justify-content: space-between; font-size: 11.5px; color: var(--mu);">
              <span>Mentah: <b>{{ formatBytes(rec.raw_size_bytes) }}</b></span>
              <span>
                {{ rec.compressed_size_bytes ? 'Kompresi: ' + formatBytes(rec.compressed_size_bytes) : 'Belum kompresi' }}
              </span>
            </div>
          </button>
        </div>
      </article>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useCamerasStore } from "../stores/cameras.js";
import { useAuthStore } from "../stores/auth.js";
import { useConfigStore } from "../stores/config.js";
import { apiFetch } from "../services/api.js";

const camerasStore = useCamerasStore();
const authStore = useAuthStore();
const configStore = useConfigStore();

const playbackVideoRef = ref<HTMLVideoElement | null>(null);
const playerContainerRef = ref<HTMLElement | null>(null);
const timelineTrackRef = ref<HTMLElement | null>(null);

const selectedCamId = ref<number>(1);
const streamMode = ref<"raw" | "compressed">("raw");
const recordings = ref<any[]>([]);
const activeRecording = ref<any | null>(null);
const activityWindows = ref<any[]>([]);
const detectionEvents = ref<any[]>([]);

const isRecordingCompressed = (rec: any): boolean => {
  if (!rec) return false;
  return rec.status === "COMPLETED" && Boolean(rec.compressed_path);
};

const getRecordingAgeHours = (rec: any): number => {
  if (!rec?.started_at) return 0;
  const started = new Date(rec.started_at).getTime();
  if (isNaN(started)) return 0;
  return Math.max(0, (Date.now() - started) / (1000 * 3600));
};

const isCurrentRecordingCompressed = computed(() => {
  return isRecordingCompressed(activeRecording.value);
});

const isPlaying = ref<boolean>(false);
const playbackRate = ref<number>(1);
const autoAdvance = ref<boolean>(true);
const currentTimeSec = ref<number>(0);
const videoDurationSec = ref<number>(0);
const videoError = ref<string | null>(null);

// Filters
const selectedEventFilter = ref<string>("semua");
const minConfidence = ref<number>(0);
const recordingStatusFilter = ref<string>("ALL");

// Realtime WIB Clock for Header Chip
const liveTimeWIB = ref<string>("");
let clockInterval: any = null;

const updateWIBClock = () => {
  const d = new Date();
  liveTimeWIB.value = d.toLocaleTimeString("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }) + " WIB";
};

const selectedCamera = computed(() => {
  return camerasStore.cameras.find((cam) => cam.id === selectedCamId.value);
});

const currentCameraName = computed(() => {
  return selectedCamera.value?.name || `Kamera ${selectedCamId.value}`;
});

const timelineVideoStyle = computed(() => {
  const cam = selectedCamera.value;
  if (!cam || !cam.split_count || cam.split_count <= 1) {
    return {
      width: "100%",
      height: "100%",
      objectFit: "contain" as const,
    };
  }
  const count = cam.split_count;
  const idx = cam.slice_index || 0;
  return {
    position: "absolute" as const,
    width: "100%",
    height: `${count * 100}%`,
    top: `-${idx * 100}%`,
    left: "0",
    objectFit: "fill" as const,
  };
});

const videoPlaybackUrl = computed(() => {
  if (!activeRecording.value) return "";
  const token = authStore.token || localStorage.getItem("vms_access_token") || "";
  const tokenParam = token ? `&jwt=${encodeURIComponent(token)}` : "";
  return `/api/recordings/${activeRecording.value.id}/stream?mode=${streamMode.value}${tokenParam}`;
});

const currentFileSizeBytes = computed(() => {
  if (!activeRecording.value) return 0;
  if (streamMode.value === "compressed" && activeRecording.value.compressed_size_bytes) {
    return activeRecording.value.compressed_size_bytes;
  }
  return activeRecording.value.raw_size_bytes || 0;
});

const rawRatioFlex = computed(() => {
  const raw = activeRecording.value?.raw_size_bytes || 100;
  return Math.max(10, Math.min(100, (raw / (1024 * 1024 * 1024)) * 100));
});

const compRatioFlex = computed(() => {
  if (!isCurrentRecordingCompressed.value) return 0;
  const comp = activeRecording.value?.compressed_size_bytes || (activeRecording.value?.raw_size_bytes ? activeRecording.value.raw_size_bytes * 0.25 : 25);
  return Math.max(5, Math.min(100, (comp / (1024 * 1024 * 1024)) * 100));
});

const compressionRatioStr = computed(() => {
  if (!isCurrentRecordingCompressed.value) {
    return "Belum Dikompresi (RAW)";
  }
  if (!activeRecording.value?.raw_size_bytes || !activeRecording.value?.compressed_size_bytes) {
    return "1 : 1.0";
  }
  const ratio = activeRecording.value.raw_size_bytes / activeRecording.value.compressed_size_bytes;
  return `${ratio.toFixed(1)}x Kompak`;
});

const filteredRecordings = computed(() => {
  if (recordingStatusFilter.value === "FINISHED") {
    return recordings.value.filter((r) => r.status === "RAW" || r.status === "COMPLETED");
  }
  if (recordingStatusFilter.value === "RECORDING") {
    return recordings.value.filter((r) => r.status === "RECORDING");
  }
  return recordings.value;
});

const activeRecordingIndex = computed(() => {
  if (!activeRecording.value) return -1;
  return recordings.value.findIndex((r) => r.id === activeRecording.value.id);
});

const hasPreviousSegment = computed(() => {
  return activeRecordingIndex.value >= 0 && activeRecordingIndex.value < recordings.value.length - 1;
});

const hasNextSegment = computed(() => {
  return activeRecordingIndex.value > 0;
});

const playPreviousSegment = () => {
  if (hasPreviousSegment.value) {
    selectRecording(recordings.value[activeRecordingIndex.value + 1]);
  }
};

const playNextSegment = () => {
  if (hasNextSegment.value) {
    selectRecording(recordings.value[activeRecordingIndex.value - 1]);
  }
};

const filteredEvents = computed(() => {
  return detectionEvents.value.filter((ev) => {
    if (minConfidence.value > 0 && ev.confidence < minConfidence.value) {
      return false;
    }
    if (selectedEventFilter.value === "semua") return true;
    const c = (ev.class_name || "").toLowerCase();
    if (selectedEventFilter.value === "person") return c === "person";
    if (selectedEventFilter.value === "vehicle") return ["car", "truck", "bus", "motorcycle", "bicycle"].includes(c);
    if (selectedEventFilter.value === "pet") return ["cat", "dog", "bird"].includes(c);
    return true;
  });
});

const getEventOffsetSec = (ev: any): number => {
  if (!activeRecording.value || !ev.detected_at) return 0;
  const startMs = new Date(activeRecording.value.started_at).getTime();
  const eventMs = new Date(ev.detected_at).getTime();
  return Math.max(0, Math.floor((eventMs - startMs) / 1000));
};

const getActivityBarColor = (score: number): string => {
  if (score >= 30) return "var(--crit)";
  if (score >= 10) return "var(--warn)";
  return "var(--iris)";
};

const formatSeconds = (sec: number): string => {
  if (isNaN(sec) || sec < 0) return "00:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

const formatDuration = (sec: number | null | undefined): string => {
  if (sec == null || isNaN(sec)) return "Merekam…";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

const formatBytes = (bytes: number | null | undefined): string => {
  if (!bytes || isNaN(bytes)) return "0 MB";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
};

const formatWIBDateTime = (isoString: string): string => {
  if (!isoString) return "-";
  const d = new Date(isoString);
  return d.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }) + " WIB";
};

const formatWIBTimeOnly = (isoString: string): string => {
  if (!isoString) return "-";
  const d = new Date(isoString);
  return d.toLocaleTimeString("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }) + " WIB";
};

const togglePlay = () => {
  if (!playbackVideoRef.value) return;
  if (playbackVideoRef.value.paused) {
    playbackVideoRef.value.play().catch(() => {});
  } else {
    playbackVideoRef.value.pause();
  }
};

const stepSeconds = (delta: number) => {
  if (!playbackVideoRef.value) return;
  const newTime = Math.max(0, Math.min(videoDurationSec.value, playbackVideoRef.value.currentTime + delta));
  playbackVideoRef.value.currentTime = newTime;
};

const setPlaybackRate = (rate: number) => {
  playbackRate.value = rate;
  if (playbackVideoRef.value) {
    playbackVideoRef.value.playbackRate = rate;
  }
};

const toggleFullscreen = () => {
  if (!playerContainerRef.value) return;
  if (!document.fullscreenElement) {
    playerContainerRef.value.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
};

const onTimelineClick = (e: MouseEvent) => {
  const target = (e.currentTarget || e.target) as HTMLElement;
  if (!target || !playbackVideoRef.value) return;
  const rect = target.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const percent = Math.max(0, Math.min(1, clickX / rect.width));
  const targetTime = percent * (videoDurationSec.value || 60);
  playbackVideoRef.value.currentTime = targetTime;
  playbackVideoRef.value.play().catch(() => {});
};

const captureSnapshot = () => {
  const video = playbackVideoRef.value;
  if (!video) return;

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 1920;
  canvas.height = video.videoHeight || 1080;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Pristine video frame capture
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const camName = currentCameraName.value.replace(/\s+/g, "_");
  const filename = `Bukti_${camName}_${Date.now()}.jpg`;

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = filename;
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/jpeg", 0.92);
};

const downloadVideo = () => {
  if (!activeRecording.value) return;
  const token = authStore.token || localStorage.getItem("vms_access_token") || "";
  const tokenParam = token ? `&jwt=${encodeURIComponent(token)}` : "";
  const downloadUrl = `/api/recordings/${activeRecording.value.id}/download?mode=${streamMode.value}${tokenParam}`;
  window.open(downloadUrl, "_blank");
};

const setStreamMode = (mode: "raw" | "compressed") => {
  if (mode === "compressed" && !isCurrentRecordingCompressed.value) {
    return;
  }
  streamMode.value = mode;
  videoError.value = null;
  if (playbackVideoRef.value) {
    const prevTime = playbackVideoRef.value.currentTime;
    playbackVideoRef.value.load();
    playbackVideoRef.value.currentTime = prevTime;
    playbackVideoRef.value.playbackRate = playbackRate.value;
    playbackVideoRef.value.play().catch(() => {});
  }
};

const onTimeUpdate = () => {
  if (playbackVideoRef.value) {
    currentTimeSec.value = playbackVideoRef.value.currentTime;
  }
};

const onLoadedMetadata = () => {
  if (playbackVideoRef.value) {
    videoDurationSec.value = playbackVideoRef.value.duration || (activeRecording.value?.duration_sec || 60);
    playbackVideoRef.value.playbackRate = playbackRate.value;
    videoError.value = null;
  }
};

const onVideoEnded = () => {
  isPlaying.value = false;
  if (autoAdvance.value && hasNextSegment.value) {
    playNextSegment();
    setTimeout(() => {
      if (playbackVideoRef.value) {
        playbackVideoRef.value.play().catch(() => {});
      }
    }, 500);
  }
};

const onVideoError = (e: Event) => {
  const video = e.target as HTMLVideoElement;
  if (video && video.error) {
    videoError.value = `Kesalahan media (${video.error.code}): ${video.error.message || 'Gagal memuat video'}`;
  } else {
    videoError.value = "Tidak dapat memutar rekaman video.";
  }
};

const retryPlayback = () => {
  videoError.value = null;
  if (playbackVideoRef.value) {
    playbackVideoRef.value.load();
    playbackVideoRef.value.play().catch(() => {});
  }
};

const fetchRecordings = async () => {
  try {
    const res = await apiFetch(`/api/recordings?camera_id=${selectedCamId.value}&limit=100`);
    if (res.ok) {
      const data = await res.json();
      recordings.value = data.recordings || [];

      if (recordings.value.length > 0 && !activeRecording.value) {
        const healthySegment = recordings.value.find((r: any) => 
          (r.status === "RAW" || r.status === "COMPLETED") && ((r.raw_size_bytes || 0) > 200000 || (r.compressed_size_bytes || 0) > 200000)
        ) || recordings.value.find((r: any) => r.status === "RAW" || r.status === "COMPLETED") || recordings.value[0];
        
        if (healthySegment) {
          selectRecording(healthySegment);
        }
      }
    }
  } catch {}
};

const selectRecording = async (rec: any) => {
  activeRecording.value = rec;
  videoError.value = null;
  currentTimeSec.value = 0;
  videoDurationSec.value = rec.duration_sec || 60;

  // By default, open in Mode Mentah (RAW) for recordings younger than 24h or not yet compressed
  const delayHours = configStore.config?.compression?.compressionDelayHours ?? 24;
  const ageHours = getRecordingAgeHours(rec);
  const isCompressed = isRecordingCompressed(rec);

  if (ageHours < delayHours || !isCompressed) {
    streamMode.value = "raw";
  } else {
    streamMode.value = "compressed";
  }

  try {
    const res = await apiFetch(`/api/recordings/${rec.id}/activity-windows`);
    if (res.ok) {
      const data = await res.json();
      activityWindows.value = data.windows || [];
    } else {
      activityWindows.value = [];
    }
  } catch {
    activityWindows.value = [];
  }

  try {
    const fromTime = encodeURIComponent(rec.started_at);
    const toTime = encodeURIComponent(rec.ended_at || new Date().toISOString());
    const resEvents = await apiFetch(`/api/events?camera_id=${rec.camera_id}&from=${fromTime}&to=${toTime}&limit=100`);
    if (resEvents.ok) {
      const data = await resEvents.json();
      detectionEvents.value = data.events || [];
    } else {
      detectionEvents.value = [];
    }
  } catch {
    detectionEvents.value = [];
  }
};

const seekToEvent = (ev: any) => {
  const offset = getEventOffsetSec(ev);
  if (playbackVideoRef.value) {
    playbackVideoRef.value.currentTime = offset;
    playbackVideoRef.value.play().catch(() => {});
  }
};

const onCameraChange = () => {
  activeRecording.value = null;
  fetchRecordings();
};

onMounted(() => {
  updateWIBClock();
  clockInterval = setInterval(updateWIBClock, 1000);
  configStore.fetchConfig().catch(() => {});
  camerasStore.fetchCameras().then(() => {
    if (camerasStore.cameras.length > 0) {
      selectedCamId.value = camerasStore.cameras[0].id;
    }
    fetchRecordings();
  });
});

onUnmounted(() => {
  if (clockInterval) clearInterval(clockInterval);
});
</script>

<style scoped>
.timeline-view {
  min-width: 0;
  width: 100%;
  padding: 24px clamp(16px, 2vw, 32px) 48px;
}

/* Select Dropdown */
.sel {
  height: 38px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--glass2);
  color: var(--tx);
  font-weight: 600;
  font-size: var(--fs-sm);
  outline: none;
  cursor: pointer;
  transition: border-color .15s;
}

.sel:focus {
  border-color: var(--iris);
}

/* Video Player Frame */
.player-wrapper {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 12px 28px -10px rgba(0, 0, 0, 0.5), 0 0 0 1px var(--rim);
}

.video-el {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  cursor: pointer;
}

/* Player Overlays */
.player-chip {
  position: absolute;
  top: 14px;
  left: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border-radius: 999px;
  background: rgba(17, 17, 17, 0.85);
  color: #fff;
  font-size: 11px;
  backdrop-filter: blur(8px);
  pointer-events: none;
  border: 1px solid rgba(255, 255, 255, 0.15);
}

.player-beacon {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--mu);
}

.player-chip.on .player-beacon {
  background: var(--good);
  box-shadow: 0 0 0 3px rgba(35, 122, 72, 0.4);
}

.big-play-btn {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
  color: #111;
  display: grid;
  place-items: center;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
  transition: transform .15s ease, background-color .15s ease;
  cursor: pointer;
}

.big-play-btn:hover {
  transform: translate(-50%, -50%) scale(1.08);
  background: #fff;
}

.big-play-btn svg {
  width: 32px;
  height: 32px;
  margin-left: 4px;
}

.video-error-overlay {
  position: absolute;
  inset: 0;
  background: rgba(13, 13, 12, 0.94);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
}

/* Scrub Bar */
.player-scrub {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 8px;
  background: rgba(255, 255, 255, 0.2);
  cursor: pointer;
  transition: height .15s ease;
}

.player-scrub:hover {
  height: 12px;
}

.scrub-fill {
  height: 100%;
  background: var(--iris);
  border-radius: 0 4px 4px 0;
  transition: width .1s linear;
}

/* Equalizer Bars */
.bars.active i {
  animation: gv .7s var(--ease) infinite alternate;
}

/* Bardeck Controls Row */
.bardeck-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}

.grp-jog {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

/* Activity Band Track */
.band-track {
  position: relative;
  height: 68px;
  background: var(--well);
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  align-items: flex-end;
  padding: 0 2px;
  gap: 2px;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px var(--line);
  margin-top: 6px;
}

.band-bar {
  flex: 1;
  border-radius: 2px;
  transform-origin: bottom;
  transition: height .2s ease;
}

.empty-band {
  width: 100%;
  text-align: center;
  color: var(--mu);
  font-size: 12px;
  align-self: center;
}

.playhead-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #fff;
  box-shadow: 0 0 8px rgba(0, 0, 0, 0.6), 0 0 4px var(--iris);
  pointer-events: none;
  z-index: 5;
}

.ax {
  display: flex;
  justify-content: space-between;
  color: var(--fa);
  font-size: 12px;
  margin-top: 8px;
}

/* Lists */
.event-scroll-list, .segment-scroll-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 280px;
  overflow-y: auto;
  scrollbar-width: thin;
  padding-right: 4px;
}

.event-card-row, .segment-card-row {
  display: flex;
  flex-direction: column;
  padding: 10px 14px;
  border-radius: 12px;
  background: var(--glass2);
  border: 1px solid var(--line);
  text-align: left;
  cursor: pointer;
  transition: all .15s ease;
  width: 100%;
}

.event-card-row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.event-card-row:hover, .segment-card-row:hover {
  background: var(--well);
  border-color: var(--iris);
}

.segment-card-row.active {
  background: var(--raised);
  border-color: var(--iris);
  box-shadow: 0 0 0 1px var(--iris), 0 4px 12px -3px rgba(37, 99, 168, 0.2);
}

.event-type-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--iris);
}

.segment-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--mu);
}

.segment-dot.live {
  background: var(--warn);
  box-shadow: 0 0 0 3px rgba(180, 71, 42, 0.25);
  animation: beat 2s infinite;
}

.segment-dot.done {
  background: var(--good);
}

.empty-state {
  padding: 24px;
  text-align: center;
  color: var(--mu);
  font-size: 13px;
}
</style>
