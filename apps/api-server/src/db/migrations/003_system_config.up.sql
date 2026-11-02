-- Migration: 003_system_config.up.sql
-- Description: System configuration key-value storage

CREATE TABLE IF NOT EXISTS system_config (
  config_key VARCHAR(64) PRIMARY KEY,
  config_value JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

