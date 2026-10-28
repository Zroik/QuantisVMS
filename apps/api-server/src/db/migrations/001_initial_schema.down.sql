-- Migration: 001_initial_schema.down.sql
-- Description: Drop core VMS tables in reverse dependency order

DROP TABLE IF EXISTS ai_detection_events;
DROP TABLE IF EXISTS vmaf_probe_logs;
DROP TABLE IF EXISTS recording_activity_windows;
DROP TABLE IF EXISTS recording_chunks;
DROP TABLE IF EXISTS recordings;
DROP TABLE IF EXISTS cameras;
DROP TABLE IF EXISTS users;
