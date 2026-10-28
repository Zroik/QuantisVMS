-- Migration: 001_initial_schema.up.sql
-- Description: Create core VMS tables per Spec §7

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','viewer') NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cameras (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  rtsp_url_enc VARBINARY(2048) NOT NULL,
  rtsp_host VARCHAR(255) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  active_yolo_classes JSON NOT NULL,
  confidence_threshold FLOAT NOT NULL DEFAULT 0.35,
  target_vmaf FLOAT NOT NULL DEFAULT 85.0,
  target_vmaf_p25 FLOAT NOT NULL DEFAULT 81.0,
  preferred_encoder ENUM('av1_nvenc','hevc_nvenc') NOT NULL DEFAULT 'av1_nvenc',
  smart_ai_sampling TINYINT(1) NOT NULL DEFAULT 1,
  static_cq_cache SMALLINT NULL,
  static_cq_cached_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recordings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  camera_id INT UNSIGNED NOT NULL,
  started_at DATETIME(3) NOT NULL,
  ended_at DATETIME(3) NULL,
  duration_sec INT NULL,
  raw_path VARCHAR(512) UNIQUE NOT NULL,
  compressed_path VARCHAR(512) NULL,
  raw_size_bytes BIGINT NULL,
  compressed_size_bytes BIGINT NULL,
  width INT NULL,
  height INT NULL,
  fps FLOAT NULL,
  codec_raw VARCHAR(16) NULL,
  optimal_cq DECIMAL(4,1) NULL,
  vmaf_mean FLOAT NULL,
  vmaf_p25 FLOAT NULL,
  quality_gate_met TINYINT(1) NULL,
  status ENUM('RECORDING','RAW','QUEUED','PROBING','ENCODING','VERIFYING','COMPLETED','SKIPPED','FAILED') NOT NULL DEFAULT 'RECORDING',
  failure_reason TEXT NULL,
  attempts INT NOT NULL DEFAULT 0,
  verified_at DATETIME(3) NULL,
  raw_deleted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_recordings_status_started (status, started_at),
  INDEX idx_recordings_camera_started (camera_id, started_at),
  CONSTRAINT fk_recordings_camera FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recording_chunks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  recording_id BIGINT UNSIGNED NOT NULL,
  chunk_index INT NOT NULL,
  start_offset_sec INT NOT NULL,
  duration_sec INT NOT NULL,
  sampling_mode ENUM('ai_peak','static_cache','blind_mid','blind_fallback') NOT NULL,
  sample_start_sec FLOAT NULL,
  optimal_cq DECIMAL(4,1) NULL,
  gate_met TINYINT(1) NULL,
  vmaf_mean FLOAT NULL,
  vmaf_p25 FLOAT NULL,
  compressed_path VARCHAR(512) NULL,
  status ENUM('PENDING','PROBING','ENCODED','VERIFIED','FAILED') DEFAULT 'PENDING',
  UNIQUE KEY uq_chunk_recording_index (recording_id, chunk_index),
  CONSTRAINT fk_chunks_recording FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recording_activity_windows (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  recording_id BIGINT UNSIGNED NOT NULL,
  segment_index INT NOT NULL DEFAULT 0,
  window_index INT NOT NULL,
  start_offset_sec INT NOT NULL,
  person_count INT NOT NULL DEFAULT 0,
  vehicle_count INT NOT NULL DEFAULT 0,
  pet_count INT NOT NULL DEFAULT 0,
  other_count INT NOT NULL DEFAULT 0,
  frames_processed INT NOT NULL DEFAULT 0,
  weighted_activity_score FLOAT NOT NULL DEFAULT 0.0,
  UNIQUE KEY uq_window_recording_index (recording_id, window_index),
  CONSTRAINT fk_windows_recording FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vmaf_probe_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  recording_id BIGINT UNSIGNED NOT NULL,
  chunk_id BIGINT UNSIGNED NULL,
  iteration_num INT NOT NULL,
  tested_cq DECIMAL(4,1) NOT NULL,
  sample_vmaf_mean FLOAT NOT NULL,
  sample_vmaf_p25 FLOAT NOT NULL,
  sample_vmaf_hmean FLOAT NULL,
  sample_vmaf_min FLOAT NULL,
  backend ENUM('cuda','cpu') NOT NULL,
  frames_scored INT NOT NULL,
  duration_ms INT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_vmaf_logs_recording FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE,
  CONSTRAINT fk_vmaf_logs_chunk FOREIGN KEY (chunk_id) REFERENCES recording_chunks(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_detection_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  camera_id INT UNSIGNED NOT NULL,
  recording_id BIGINT UNSIGNED NULL,
  class_id INT NOT NULL,
  class_name VARCHAR(32) NOT NULL,
  confidence FLOAT NOT NULL,
  bbox_json JSON NOT NULL,
  snapshot_path VARCHAR(512) NULL,
  detected_at DATETIME(3) NOT NULL,
  INDEX idx_events_camera_detected (camera_id, detected_at),
  INDEX idx_events_class_detected (class_id, detected_at),
  CONSTRAINT fk_events_camera FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE,
  CONSTRAINT fk_events_recording FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
