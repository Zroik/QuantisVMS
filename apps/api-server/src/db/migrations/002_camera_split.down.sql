-- Migration: 002_camera_split.down.sql
-- Description: Revert camera sensor trim/split capability

ALTER TABLE cameras DROP FOREIGN KEY fk_cameras_parent;
ALTER TABLE cameras
  DROP COLUMN parent_camera_id,
  DROP COLUMN slice_index,
  DROP COLUMN split_count;

