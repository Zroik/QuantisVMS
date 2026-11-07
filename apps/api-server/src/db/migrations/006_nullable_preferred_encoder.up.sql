-- Migration 006: Allow cameras.preferred_encoder to be NULL by default so system_config compression.preferredEncoder applies unless overridden
ALTER TABLE cameras MODIFY COLUMN preferred_encoder ENUM('av1_nvenc', 'hevc_nvenc', 'libx265', 'libsvtav1') NULL DEFAULT NULL;

