<template>
  <div class="timeline-view app">
    <!-- Breadcrumb Trail -->
    <p class="crumb">
      Quantis
      <svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg>
      <b>{{ t('nav.playback') }}</b>
    </p>

    <!-- Zero-Camera Empty State Banner -->
    <div v-if="!hasCameras" class="empty-banner rv" role="status">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M23 7l-7 5 7 5zM1 5h15v14H1z" />
        <path d="M4 4l16 16" />
      </svg>
      <div>
        <b>{{ t('timeline.noCamerasConnected') }}</b>
        <p>
          {{ t('timeline.addCameraPrompt') }}
          <router-link :to="{ name: 'configuration' }">{{ t('nav.configuration') }}</router-link>.
        </p>
      </div>
    </div>

    <!-- Header Section with Realtime Status Chip -->
    <div class="hd">
      <h1>{{ t('nav.playback') }}</h1>
      <div class="chip" aria-live="off">
        <i class="dot pulse"></i>
        <b class="mono">{{ liveTimeWIB }}</b>
        <hr />
        <div>
          <b>{{ t('timeline.syncLive') }}</b>
          <small>{{ t('timeline.syncLiveSub') }}</small>
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
          <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--mu);">{{ t('timeline.selectedCamera') }}</span>
          <span style="font-size: 15px; font-weight: 700; color: var(--tx);">{{ currentCameraName }}</span>
        </div>
      </div>

      <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
        <select
          class="sel mono"
          :aria-label="t('timeline.selectCamera')"
          v-model="selectedCamId"
          :disabled="!hasCameras"
          @change="onCameraChange"
        >
          <option v-if="!hasCameras" :value="0">{{ t('timeline.noCameras') }}</option>
          <option v-for="cam in camerasStore.cameras" :key="cam.id" :value="cam.id">
            {{ cam.name }}
          </option>
        </select>

        <button
          class="btn o s"
          type="button"
          :title="t('timeline.refreshTooltip')"
          :disabled="!hasCameras"
          @click="fetchRecordings"
        >
          <svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5" /></svg>
          <span>{{ t('timeline.refresh') }}</span>
        </button>
      </div>
    </div>

    <!-- Hero Summary Card with Stacked Disk Usage -->
    <article class="card hero rv" style="--i:1; margin-bottom: 16px;">
      <p class="eb">{{ t('timeline.heroEyebrow') }}</p>
      <h2>{{ t('timeline.segmentPrefix') }} #{{ activeRecording ? activeRecording.id : '-' }} · {{ currentCameraName }}</h2>
      <p v-if="activeRecording">
        {{ t('timeline.producedAt') }} <b>{{ formatWIBDateTime(activeRecording.started_at) }}</b>
        {{ t('timeline.withDuration') }} <b>{{ formatDuration(activeRecording.duration_sec) }}</b>.
        {{ t('timeline.rawSize') }} <b>{{ formatBytes(activeRecording?.raw_size_bytes) }}</b>
        {{ t('timeline.compressedTo') }} <b>{{ activeRecording?.compressed_size_bytes ? formatBytes(activeRecording.compressed_size_bytes) : t('timeline.notFinished') }}</b>
        {{ t('timeline.vmafBased') }}.
      </p>
      <p v-else>{{ t('timeline.noActiveSegment') }}</p>

      <!-- Quick Action Buttons -->
      <div class="acts">
        <button class="btn p" type="button" :disabled="!isPlayerReady" @click="captureSnapshot">
          <svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>
          <span>{{ t('timeline.captureSnapshot') }}</span>
        </button>
        <button class="btn o" type="button" :disabled="!activeRecording" @click="downloadVideo">
          <svg viewBox="0 0 24 24"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>
          <span>{{ t('timeline.downloadMp4') }}</span>
        </button>

        <div class="seg" role="group" :aria-label="t('timeline.streamModeLabel')" style="margin-left: auto;">
          <button
            type="button"
            :aria-pressed="streamMode === 'compressed'"
            :disabled="!isCurrentRecordingCompressed"
            :title="!isCurrentRecordingCompressed ? t('timeline.streamModeUncompressedTooltip') : t('timeline.streamModeCompressed')"
            @click="setStreamMode('compressed')"
          >
            {{ t('timeline.streamModeCompressed') }}
          </button>
          <button
            type="button"
            :aria-pressed="streamMode === 'raw'"
            @click="setStreamMode('raw')"
          >
            {{ t('timeline.streamModeRaw') }}
          </button>
        </div>
      </div>

      <!-- Segment Storage Breakdown Stack -->
      <div class="ch" style="margin-bottom: 10px; margin-top: 10px;">
        <span class="ico"><svg viewBox="0 0 24 24"><path d="M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg></span>
        <div style="flex: 1;">
          <h2>{{ t('timeline.compressionRatio') }}</h2>
          <p>{{ t('timeline.storageEfficiency') }}</p>
        </div>
        <div style="text-align: right;">
          <b style="font-size: 20px; color: var(--iris); letter-spacing: -.02em;">
            {{ compressionRatioStr }}
          </b>
          <p class="mono">{{ formatBytes(currentFileSizeBytes) }} {{ t('timeline.activeBadge') }}</p>
        </div>
      </div>

      <div class="stack" role="img" :aria-label="t('timeline.compressionRatio')">
        <span :style="{ flex: rawRatioFlex, background: 'var(--coral)' }"></span>
        <span :style="{ flex: compRatioFlex, background: 'var(--iris)' }"></span>
      </div>

      <div class="leg">
        <div>
          <span><i style="background: var(--coral);"></i>{{ t('timeline.rawFile') }}</span>
          <b>{{ formatBytes(activeRecording?.raw_size_bytes) }}</b>
        </div>
        <div>
          <span><i style="background: var(--iris);"></i>{{ t('timeline.compressedFile') }}</span>
          <b>{{ activeRecording?.compressed_size_bytes && isCurrentRecordingCompressed ? formatBytes(activeRecording.compressed_size_bytes) : '-' }}</b>
        </div>
        <div>
          <span><i style="background: var(--good);"></i>{{ t('timeline.vmafQuality') }}</span>
          <b style="color: var(--good);">{{ activeRecording?.vmaf_mean != null && !isNaN(Number(activeRecording.vmaf_mean)) ? Number(activeRecording.vmaf_mean).toFixed(1) : '—' }}</b>
        </div>
        <div>
          <span><i style="background: var(--mu);"></i>{{ t('timeline.nodeStatus') }}</span>
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
          <h2>{{ t('timeline.playerTitle') }}</h2>
          <p class="mono">{{ t('timeline.playerSub') }}</p>
        </div>

        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="pill" :class="{ warn: !isPlaying }">
            ● {{ isPlaying ? t('timeline.playing') : t('timeline.paused') }} ({{ playbackRate }}x)
          </span>
          <button class="btn o s" type="button" @click="toggleFullscreen" :title="t('timeline.fullscreen') + ' (F)'">
            <svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>
            <span>{{ t('timeline.fullscreen') }}</span>
          </button>
        </div>
      </div>

      <!-- Player Frame -->
      <div class="player-wrapper" ref="playerContainerRef">
        <video
          v-if="videoPlaybackUrl"
          ref="playbackVideoRef"
          class="video-el"
          :style="timelineVideoStyle"
          playsinline
          preload="metadata"
          :src="videoPlaybackUrl"
          @timeupdate="onTimeUpdate"
          @loadedmetadata="onLoadedMetadata"
          @error="onVideoError"
          @ended="onVideoEnded"
          @play="isPlaying = true"
          @pause="isPlaying = false"
          @click="togglePlay"
        ></video>
        <div v-else-if="!videoError" class="video-empty-state">
          {{
            !hasCameras
              ? t('timeline.emptyNoCameras')
              : !hasRecordings
                ? t('timeline.emptyNoRecordings')
                : t('timeline.emptySelectSegment')
          }}
        </div>

        <!-- Top Chip Overlay -->
        <div class="player-chip mono" :class="{ on: isPlaying }">
          <i class="player-beacon"></i>
          <span>{{ isPlaying ? t('timeline.playingUpper') : t('timeline.pausedUpper') }}</span>
          <s>|</s>
          <span>{{ playbackRate }}x</span>
          <s>|</s>
          <span>{{ t('timeline.segmentPrefixUpper') }} #{{ activeRecording ? activeRecording.id : '-' }}</span>
          <s>|</s>
          <span>{{ formatSeconds(currentTimeSec) }} / {{ formatSeconds(videoDurationSec) }}</span>
        </div>

        <!-- Big Center Play Button Overlay -->
        <button
          v-if="!isPlaying && activeRecording && !videoError"
          class="big-play-btn"
          type="button"
          @click="togglePlay"
          :aria-label="t('timeline.play')"
        >
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
        </button>

        <!-- Video Error Overlay -->
        <div v-if="videoError" class="video-error-overlay">
          <svg viewBox="0 0 24 24" style="width: 32px; height: 32px; color: var(--crit); margin-bottom: 8px;">
            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
          <p style="font-weight: 700; font-size: 14px; color: var(--tx);">{{ t('timeline.videoLoadFailed') }}</p>
          <p style="font-size: 12px; color: var(--mu); margin-top: 4px;">{{ videoError }}</p>
          <button class="btn o s" style="margin-top: 12px;" @click="retryPlayback">
            {{ t('timeline.retry') }}
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
            {{ t('timeline.streamActivity') }}
          </span>
          <span class="pill mono" style="font-size: 11px; padding: 1px 8px;">
            {{ isPlaying ? t('timeline.streamFps') : t('timeline.streamIdle') }}
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
            :title="t('timeline.prevSegment') + ' (Alt + ←)'"
            :aria-label="t('timeline.prevSegment')"
            :disabled="!isPlayerReady || !hasPreviousSegment"
            @click="playPreviousSegment"
            :style="{ opacity: !isPlayerReady || !hasPreviousSegment ? 0.35 : 1 }"
          >
            <svg viewBox="0 0 24 24"><path d="M19 5v14M17 12 7 5v14z"/></svg>
          </button>
          <button class="btn o s" :disabled="!isPlayerReady" @click="stepSeconds(-5)">-5s</button>
          <button class="btn o s" :disabled="!isPlayerReady" @click="stepSeconds(-1)">-1s</button>

          <button class="btn p s" :disabled="!isPlayerReady" @click="togglePlay" style="padding: 0 16px;">
            <svg viewBox="0 0 24 24">
              <path :d="isPlaying ? 'M7 5h4v14H7zM13 5h4v14h-4z' : 'M8 5v14l11-7z'"/>
            </svg>
            <span>{{ isPlaying ? t('timeline.paused') : t('timeline.play') }}</span>
          </button>

          <button class="btn o s" :disabled="!isPlayerReady" @click="stepSeconds(1)">+1s</button>
          <button class="btn o s" :disabled="!isPlayerReady" @click="stepSeconds(5)">+5s</button>
          <button
            class="btn o s"
            :title="t('timeline.nextSegment') + ' (Alt + →)'"
            :aria-label="t('timeline.nextSegment')"
            :disabled="!isPlayerReady || !hasNextSegment"
            @click="playNextSegment"
            :style="{ opacity: !isPlayerReady || !hasNextSegment ? 0.35 : 1 }"
          >
            <svg viewBox="0 0 24 24"><path d="M5 5v14M7 12l10-7v14z"/></svg>
          </button>
        </div>

        <!-- Playback Rate Pill Segment -->
        <div class="seg" role="group" :aria-label="t('timeline.playbackRate')">
          <button
            v-for="rate in [0.5, 1, 1.5, 2, 4]"
            :key="rate"
            :aria-pressed="playbackRate === rate"
            :disabled="!isPlayerReady"
            @click="setPlaybackRate(rate)"
          >
            {{ rate }}x
          </button>
        </div>

        <!-- Auto Advance Toggle -->
        <button
          class="btn o s"
          :class="{ active: autoAdvance }"
          :disabled="!isPlayerReady"
          @click="autoAdvance = !autoAdvance"
          :title="t('timeline.autoAdvanceTooltip')"
        >
          <svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          <span>{{ t('timeline.autoAdvance') }}</span>
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
          <h2>{{ t('timeline.activityRibbon') }}</h2>
          <p class="mono">
            {{ t('timeline.activityWindows', { count: activityWindows.length }) }} · {{ t('timeline.weightedLegend') }}
          </p>
        </div>

        <div style="display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--mu);">
          <span style="display: flex; align-items: center; gap: 4px;">
            <i style="width: 8px; height: 8px; border-radius: 50%; background: var(--crit); display: inline-block;"></i>
            {{ t('timeline.levelHigh') }}
          </span>
          <span style="display: flex; align-items: center; gap: 4px;">
            <i style="width: 8px; height: 8px; border-radius: 50%; background: var(--warn); display: inline-block;"></i>
            {{ t('timeline.levelMid') }}
          </span>
          <span style="display: flex; align-items: center; gap: 4px;">
            <i style="width: 8px; height: 8px; border-radius: 50%; background: var(--iris); display: inline-block;"></i>
            {{ t('timeline.levelLow') }}
          </span>
        </div>
      </div>

      <!-- Timeline Band Track -->
      <div class="band-track" ref="timelineTrackRef" :aria-label="t('timeline.activityRibbon')" @click="onTimelineClick">
        <div v-if="activityWindows.length === 0" class="empty-band">
          {{ activityWindowsSource === 'unavailable' ? 'Indeks aktivitas AI tidak tersedia (Activity index unavailable)' : t('timeline.noActivityData') }}
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
            <h2>{{ t('timeline.eventsList') }}</h2>
            <p class="mono">{{ t('timeline.eventsCount', { filtered: filteredEvents.length, total: detectionEvents.length }) }}</p>
          </div>
        </div>

        <!-- Category Filters & Confidence Dropdown -->
        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px;">
          <div class="seg" role="group" :aria-label="t('timeline.eventCategories')">
            <button
              v-for="cat in ['semua', 'person', 'vehicle', 'pet']"
              :key="cat"
              :aria-pressed="selectedEventFilter === cat"
              @click="selectedEventFilter = cat"
            >
              {{ cat === 'semua' ? t('timeline.filterAll') : cat === 'person' ? t('toggle.person') : cat === 'vehicle' ? t('toggle.vehicles') : t('toggle.pets') }}
            </button>
          </div>

          <select class="sel mono" style="height: 34px; margin-left: auto;" v-model="minConfidence">
            <option :value="0">{{ t('timeline.allConfidence') }}</option>
            <option :value="0.4">≥ 40%</option>
            <option :value="0.6">≥ 60%</option>
            <option :value="0.8">≥ 80%</option>
          </select>
        </div>

        <p v-if="filteredEvents.length === 0" class="empty-state">
          {{ t('timeline.noEventsMatch') }}
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
            <h2>{{ t('timeline.segmentsList') }}</h2>
            <p class="mono">{{ t('timeline.segmentsAvailable', { count: filteredRecordings.length }) }}</p>
          </div>

          <select class="sel mono" style="height: 32px; font-size: 12px;" v-model="recordingStatusFilter">
            <option value="ALL">{{ t('timeline.allStatus') }}</option>
            <option value="FINISHED">{{ t('timeline.statusFinished') }}</option>
            <option value="RECORDING">{{ t('timeline.statusRecording') }}</option>
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
                <span style="font-weight: 700; font-size: 13.5px;">{{ t('timeline.segmentPrefix') }} #{{ rec.id }}</span>
              </div>
              <span class="pill mono" style="font-size: 11px;">
                {{ rec.status === 'RECORDING' ? t('timeline.statusRecordingText') : formatDuration(rec.duration_sec) }}
              </span>
            </div>

            <div style="font-size: 12px; color: var(--mu); margin: 4px 0;">
              {{ formatWIBDateTime(rec.started_at) }}
            </div>

            <div class="mono" style="display: flex; justify-content: space-between; font-size: 11.5px; color: var(--mu);">
              <span>{{ t('timeline.rawPrefix') }}: <b>{{ formatBytes(rec.raw_size_bytes) }}</b></span>
              <span>
                {{ rec.compressed_size_bytes ? t('timeline.compPrefix') + ': ' + formatBytes(rec.compressed_size_bytes) : t('timeline.notCompressed') }}
              </span>
            </div>
          </button>
        </div>
      </article>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from "vue";
import { useCamerasStore } from "../stores/cameras.js";
import { useAuthStore } from "../stores/auth.js";
import { useConfigStore } from "../stores/config.js";
import { useI18n } from "../i18n/index.js";
import { apiFetch } from "../services/api.js";
import { isRecordingPlayable, findNextPlayableIndex } from "../services/playback.js";

const { t } = useI18n();
const camerasStore = useCamerasStore();
const authStore = useAuthStore();
const configStore = useConfigStore();

const playbackVideoRef = ref<HTMLVideoElement | null>(null);
const playerContainerRef = ref<HTMLElement | null>(null);
const timelineTrackRef = ref<HTMLElement | null>(null);

const selectedCamId = ref<number>(0);
const streamMode = ref<"raw" | "compressed">("raw");
const recordings = ref<any[]>([]);
const activeRecording = ref<any | null>(null);
const activityWindows = ref<any[]>([]);
const activityWindowsSource = ref<string>("indexed");
const detectionEvents = ref<any[]>([]);
const mediaTicket = ref<string>("");

const requestMediaTicket = async (recordingId: number): Promise<string> => {
  try {
    const res = await apiFetch(`/api/recordings/${recordingId}/ticket`, {
      method: "POST",
    });
    if (res.ok) {
      const data = await res.json();
      if (typeof data?.ticket === "string") {
        return data.ticket;
      }
    }
  } catch {
    // Fallback if ticket endpoint fails in offline/mocked tests
  }
  return "";
};

const isRecordingCompressed = (rec: any): boolean => {
  if (!rec) return false;
  return rec.status === "COMPLETED" && (Boolean(rec.has_compressed) || (rec.compressed_size_bytes || 0) > 0);
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
const pendingAutoplay = ref<boolean>(false);

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

const hasCameras = computed(() => camerasStore.cameras.length > 0);

const hasRecordings = computed(() => recordings.value.length > 0);

const currentCameraName = computed(() => {
  if (selectedCamera.value) return selectedCamera.value.name;
  if (!hasCameras.value) return t("timeline.noCameras");
  return selectedCamId.value ? `${t("timeline.camera")} ${selectedCamId.value}` : t("timeline.noCameras");
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
  if (!activeRecording.value || !isRecordingPlayable(activeRecording.value)) return "";
  const ticketParam = mediaTicket.value ? `&ticket=${encodeURIComponent(mediaTicket.value)}` : "";
  return `/api/recordings/${activeRecording.value.id}/stream?mode=${streamMode.value}${ticketParam}`;
});

const isPlayerReady = computed(() => Boolean(videoPlaybackUrl.value));

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
    return t("timeline.notCompressedRaw");
  }
  if (!activeRecording.value?.raw_size_bytes || !activeRecording.value?.compressed_size_bytes) {
    return "1 : 1.0";
  }
  const ratio = activeRecording.value.raw_size_bytes / activeRecording.value.compressed_size_bytes;
  return `${ratio.toFixed(1)}x ${t("timeline.compact")}`;
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
  if (activeRecordingIndex.value <= 0) return false;
  return findNextPlayableIndex(recordings.value, activeRecordingIndex.value) >= 0;
});

const playPreviousSegment = () => {
  if (hasPreviousSegment.value) {
    selectRecording(recordings.value[activeRecordingIndex.value + 1]);
  }
};

const playNextSegment = () => {
  const nextIndex = findNextPlayableIndex(recordings.value, activeRecordingIndex.value);
  if (nextIndex >= 0) {
    selectRecording(recordings.value[nextIndex]);
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
  if (sec == null || isNaN(sec)) return t("timeline.statusRecordingText");
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
  // The scrub bar and the activity band both bind this handler. Bind strictly to
  // the element the listener is attached to (currentTarget) so clicks on 2px
  // children such as .band-bar or .playhead-line cannot skew the ratio.
  const target = e.currentTarget as HTMLElement | null;
  if (!target || !playbackVideoRef.value) return;
  const rect = target.getBoundingClientRect();
  if (rect.width <= 0) return;
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

const downloadVideo = async () => {
  if (!activeRecording.value) return;
  const rec = activeRecording.value;
  try {
    const freshTicket = (await requestMediaTicket(rec.id)) || mediaTicket.value;
    const ticketParam = freshTicket ? `&ticket=${encodeURIComponent(freshTicket)}` : "";
    const downloadUrl = `/api/recordings/${rec.id}/download?mode=${streamMode.value}${ticketParam}`;
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `Cam${rec.camera_id}_${String(rec.id)}.mp4`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err: any) {
    videoError.value = err.message || "Gagal mengunduh rekaman";
  }
};

const setStreamMode = async (mode: "raw" | "compressed") => {
  if (mode === "compressed" && !isCurrentRecordingCompressed.value) {
    return;
  }
  if (streamMode.value === mode) {
    return;
  }
  const prevTime = playbackVideoRef.value?.currentTime ?? 0;
  const wasPlaying = playbackVideoRef.value ? !playbackVideoRef.value.paused : false;

  if (activeRecording.value) {
    const freshTicket = await requestMediaTicket(activeRecording.value.id);
    if (freshTicket) {
      mediaTicket.value = freshTicket;
    }
  }

  streamMode.value = mode;
  videoError.value = null;
  await nextTick();

  const videoEl = playbackVideoRef.value;
  if (videoEl) {
    videoEl.addEventListener(
      "loadedmetadata",
      () => {
        videoEl.currentTime = prevTime;
        videoEl.playbackRate = playbackRate.value;
        if (wasPlaying) {
          videoEl.play().catch(() => {});
        }
      },
      { once: true }
    );
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
    if (pendingAutoplay.value) {
      pendingAutoplay.value = false;
      playbackVideoRef.value.play().catch(() => {});
    }
  }
};

const onVideoEnded = () => {
  isPlaying.value = false;
  if (!autoAdvance.value) return;
  const nextIndex = findNextPlayableIndex(recordings.value, activeRecordingIndex.value);
  if (nextIndex < 0) return;
  pendingAutoplay.value = true;
  selectRecording(recordings.value[nextIndex]);
};

const onVideoError = (e: Event) => {
  const video = e.target as HTMLVideoElement;
  // An unmounted/empty source fires a synthetic MEDIA_ELEMENT_ERROR (code 4).
  // Ignore it; only report a real source failure.
  if (!video.currentSrc) return;
  if (video && video.error) {
    const code = video.error.code;
    videoError.value =
      code === 4
        ? "Format video tidak didukung atau berkas rekaman belum selesai diproses (MEDIA_ELEMENT_ERROR: Format error)."
        : `Kesalahan media (${code}): ${video.error.message || 'Gagal memuat video'}`;
  } else {
    videoError.value = "Tidak dapat memutar rekaman video.";
  }
};

const retryPlayback = async () => {
  if (!activeRecording.value || !playbackVideoRef.value) return;
  videoError.value = null;

  // The original media ticket may have expired; fetch a fresh one before
  // reloading so retry does not replay the same 401'd URL.
  const freshTicket = await requestMediaTicket(activeRecording.value.id);
  if (freshTicket) mediaTicket.value = freshTicket;

  const prevTime = currentTimeSec.value || playbackVideoRef.value.currentTime || 0;
  const wasPlaying = !playbackVideoRef.value.paused;

  await nextTick();
  const videoEl = playbackVideoRef.value;
  if (!videoEl) return;
  videoEl.addEventListener(
    "loadedmetadata",
    () => {
      videoEl.currentTime = prevTime;
      videoEl.playbackRate = playbackRate.value;
      if (wasPlaying) videoEl.play().catch(() => {});
    },
    { once: true }
  );
  videoEl.load();
  videoEl.play().catch(() => {});
};

const fetchRecordings = async () => {
  if (!selectedCamId.value) {
    recordings.value = [];
    activeRecording.value = null;
    activityWindows.value = [];
    detectionEvents.value = [];
    return;
  }
  try {
    const res = await apiFetch(`/api/recordings?camera_id=${selectedCamId.value}&limit=100`);
    if (res.ok) {
      const data = await res.json();
      recordings.value = data.recordings || [];

      if (recordings.value.length > 0 && !activeRecording.value) {
        const healthySegment = recordings.value.find((r: any) =>
          isRecordingPlayable(r) && ((r.raw_size_bytes || 0) > 200000 || (r.compressed_size_bytes || 0) > 200000)
        ) || recordings.value.find((r: any) => isRecordingPlayable(r));

        if (healthySegment) {
          selectRecording(healthySegment);
        } else {
          videoError.value = "Belum ada segmen rekaman yang selesai dan dapat diputar.";
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

  if (!isRecordingPlayable(rec)) {
    const status = rec?.status || "UNKNOWN";
    videoError.value =
      status === "RECORDING"
        ? "Rekaman ini masih sedang direkam. Pilih segmen yang sudah selesai (RAW/COMPLETED)."
        : status === "QUEUED" || status === "PROBING" || status === "ENCODING" || status === "VERIFYING"
          ? "Rekaman masih diproses. Coba lagi setelah transcode selesai."
          : "Berkas rekaman ini tidak tersedia untuk diputar.";
    streamMode.value = "raw";
    return;
  }

  // By default, open in Mode Mentah (RAW) for recordings younger than 24h or not yet compressed
  const delayHours = configStore.config?.compression?.compressionDelayHours ?? 24;
  const ageHours = getRecordingAgeHours(rec);
  const isCompressed = isRecordingCompressed(rec);
  const hasRaw = rec.has_raw !== false;

  // If the raw file was already reclaimed, play the compressed artifact
  // regardless of the 24h delay. Otherwise keep raw for young recordings.
  if (!hasRaw && isCompressed) {
    streamMode.value = "compressed";
  } else if (ageHours < delayHours || !isCompressed) {
    streamMode.value = "raw";
  } else {
    streamMode.value = "compressed";
  }

  mediaTicket.value = await requestMediaTicket(rec.id);

  try {
    const res = await apiFetch(`/api/recordings/${rec.id}/activity-windows`);
    if (res.ok) {
      const data = await res.json();
      activityWindows.value = data.windows || [];
      activityWindowsSource.value = data.windows_source || (activityWindows.value.length > 0 ? "indexed" : "unavailable");
    } else {
      activityWindows.value = [];
      activityWindowsSource.value = "unavailable";
    }
  } catch {
    activityWindows.value = [];
    activityWindowsSource.value = "unavailable";
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
  videoError.value = null;
  fetchRecordings();
};

onMounted(() => {
  updateWIBClock();
  clockInterval = setInterval(updateWIBClock, 1000);
  configStore.fetchConfig().catch(() => {});
  camerasStore.fetchCameras().then(() => {
    if (camerasStore.cameras.length > 0) {
      selectedCamId.value = camerasStore.cameras[0].id;
      fetchRecordings();
    } else {
      selectedCamId.value = 0;
      recordings.value = [];
      activeRecording.value = null;
    }
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
  transition: border-color .15s, background-color .15s;
}

.sel option {
  background-color: #ffffff;
  color: #111111;
  font-family: inherit;
  font-size: var(--fs-sm);
  padding: 6px 12px;
}

:root[data-theme="dark"] .sel,
.dark .sel {
  background-color: #181816;
  color: #f2f2ee;
  color-scheme: dark !important;
  border-color: rgba(255, 255, 255, 0.16);
}

:root[data-theme="dark"] .sel option,
.dark .sel option {
  background-color: #1c1c1a !important;
  color: #f2f2ee !important;
}

:root[data-theme="dark"] .sel option:checked,
.dark .sel option:checked {
  background-color: #2563a8 !important;
  color: #ffffff !important;
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

.video-empty-state {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  font-size: 13px;
  text-align: center;
  padding: 24px;
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

/* Zero-Camera Empty State Banner */
.empty-banner {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
  padding: 14px 18px;
  border-radius: 16px;
  background: var(--well);
  border: 1px solid var(--line);
  color: var(--tx);
}

.empty-banner svg {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  fill: none;
  stroke: var(--mu);
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.empty-banner b {
  display: block;
  font-size: 14px;
}

.empty-banner p {
  margin: 2px 0 0;
  font-size: 12.5px;
  color: var(--mu);
}

.empty-banner a {
  color: var(--iris);
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
