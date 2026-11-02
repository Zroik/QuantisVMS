-- Migration: 004_onvif_support.down.sql
-- Description: Drop ONVIF columns from cameras table

ALTER TABLE cameras
  DROP COLUMN onvif_capabilities,
  DROP COLUMN onvif_pass_enc,
  DROP COLUMN onvif_user,
  DROP COLUMN onvif_xaddr;

