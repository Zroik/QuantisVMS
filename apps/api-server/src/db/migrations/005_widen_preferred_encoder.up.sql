-- Migration 005: Widen preferred_encoder to allow CPU encoders libx265 and libsvtav1
ALTER TABLE cameras MODIFY COLUMN preferred_encoder ENUM('av1_nvenc', 'hevc_nvenc', 'libx265', 'libsvtav1') NOT NULL DEFAULT 'av1_nvenc';

