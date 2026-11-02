DELETE FROM recording_activity_windows;
DELETE FROM recording_chunks;
DELETE FROM vmaf_probe_logs;
DELETE FROM ai_detection_events;
DELETE FROM recordings;
ALTER TABLE recordings AUTO_INCREMENT = 1;

DELETE FROM cameras;
ALTER TABLE cameras AUTO_INCREMENT = 1;

INSERT INTO cameras (id, name, rtsp_host, rtsp_url_enc, enabled, active_yolo_classes, confidence_threshold, target_vmaf, preferred_encoder)
VALUES (1, 'Hikvision CCTV', '192.168.100.67:554', UNHEX('A19F36A2119F9B480BB23DB465F16BBBD6B180F6F78CF4BE1371F3452973B7C0F3BCD9714D90DD5EB37E62E64E8780C4391B1818EFCD01F20E53F7A7D72DD8D65876B57A370EF9A128800DA5682D80FB8F352D1A221E4326E323C61113175D985F'), 1, '{"preset_groups": {}, "custom_class_ids": [], "resolved_active_ids": [0, 1, 2, 3, 5, 7, 14, 15, 16]}', 0.35, 85, 'av1_nvenc');

INSERT INTO cameras (id, name, rtsp_host, rtsp_url_enc, enabled, active_yolo_classes, confidence_threshold, target_vmaf, preferred_encoder)
VALUES (2, 'v380 pro', '192.168.100.16', UNHEX('9D702EAD9262CA57F6EC65C447DF7CD47F4D0D3F2798AB219810FAE446C5AF617A369B353B4A3A88A26B0D73537F60182D'), 1, '{"preset_groups": {}, "custom_class_ids": [], "resolved_active_ids": [0, 1, 2, 3, 5, 7, 14, 15, 16]}', 0.35, 85, 'av1_nvenc');

