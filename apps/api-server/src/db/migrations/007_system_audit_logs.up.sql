-- Migration: 007_system_audit_logs.up.sql
-- Description: Persist configuration/security audit entries (BE-04). The API
-- also creates this table defensively at runtime; the migration makes a fresh
-- schema complete before the first write.
CREATE TABLE IF NOT EXISTS system_audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  timestamp DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  user VARCHAR(100) NOT NULL,
  action VARCHAR(100) NOT NULL,
  target VARCHAR(255) NOT NULL,
  ip VARCHAR(45) NOT NULL,
  status VARCHAR(20) NOT NULL,
  INDEX idx_audit_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
