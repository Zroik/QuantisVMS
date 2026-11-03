-- Migration 005 Down: Revert preferred_encoder enum
ALTER TABLE cameras MODIFY COLUMN preferred_encoder ENUM('av1_nvenc', 'hevc_nvenc') NOT NULL DEFAULT 'av1_nvenc';

