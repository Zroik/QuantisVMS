-- Migration: 004_onvif_support.up.sql
-- Description: Add ONVIF discovery, credentials, and capabilities columns to cameras table

ALTER TABLE cameras
  ADD COLUMN onvif_xaddr VARCHAR(255) NULL AFTER rtsp_host,
  ADD COLUMN onvif_user VARCHAR(64) NULL AFTER onvif_xaddr,
  ADD COLUMN onvif_pass_enc VARBINARY(1024) NULL AFTER onvif_user,
  ADD COLUMN onvif_capabilities JSON NULL AFTER onvif_pass_enc;

