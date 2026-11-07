-- Rollback Migration 006: Restore NOT NULL DEFAULT 'av1_nvenc' on cameras.preferred_encoder
UPDATE cameras SET preferred_encoder = 'av1_nvenc' WHERE preferred_encoder IS NULL;
ALTER TABLE cameras MODIFY COLUMN preferred_encoder ENUM('av1_nvenc', 'hevc_nvenc', 'libx265', 'libsvtav1') NOT NULL DEFAULT 'av1_nvenc';

