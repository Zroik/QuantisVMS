-- Reset application tables.
-- Camera credentials are intentionally NOT stored here. Provision cameras with:
--   node scripts/seed-cameras.mjs   (see .env.example for SEED_CAM* variables)
DELETE FROM recording_activity_windows;
DELETE FROM recording_chunks;
DELETE FROM vmaf_probe_logs;
DELETE FROM ai_detection_events;
DELETE FROM recordings;
ALTER TABLE recordings AUTO_INCREMENT = 1;

DELETE FROM cameras;
ALTER TABLE cameras AUTO_INCREMENT = 1;
