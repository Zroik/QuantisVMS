-- Migration: 002_camera_split.up.sql
-- Description: Add camera sensor trim/split capability (Spec §6 & §8)

ALTER TABLE cameras
  ADD COLUMN split_count INT NOT NULL DEFAULT 1 AFTER smart_ai_sampling,
  ADD COLUMN slice_index INT NOT NULL DEFAULT 0 AFTER split_count,
  ADD COLUMN parent_camera_id INT UNSIGNED NULL AFTER slice_index;

ALTER TABLE cameras
  ADD CONSTRAINT fk_cameras_parent FOREIGN KEY (parent_camera_id) REFERENCES cameras(id) ON DELETE CASCADE;

