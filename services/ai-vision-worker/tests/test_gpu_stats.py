"""Unit tests for GPU telemetry collector (Spec §6.2, §8.2)."""

from unittest.mock import MagicMock, patch

from src.gpu_stats import GPUStatsCollector


def test_gpu_stats_schema_and_keys():
    """Verify GPU stats payload schema matches Spec §6.2."""
    collector = GPUStatsCollector(gpu_index=0)

    # When NVML is not available or mocked
    stats = collector.collect_stats_fallback()
    expected_keys = {
        "gpu_util",
        "vram_used_mb",
        "vram_total_mb",
        "temp_c",
        "enc_util",
        "dec_util",
    }
    assert set(stats.keys()) == expected_keys
    assert isinstance(stats["gpu_util"], (int, float))
    assert isinstance(stats["vram_used_mb"], (int, float))
    assert isinstance(stats["vram_total_mb"], (int, float))
    assert isinstance(stats["temp_c"], (int, float))
    assert isinstance(stats["enc_util"], (int, float))
    assert isinstance(stats["dec_util"], (int, float))


def test_gpu_stats_mocked_nvml():
    """Verify collector reads nvml properties correctly when NVML is active."""
    collector = GPUStatsCollector(gpu_index=0)

    mock_nvml = MagicMock()
    mock_handle = MagicMock()

    mock_nvml.nvmlDeviceGetHandleByIndex.return_value = mock_handle

    mock_util = MagicMock()
    mock_util.gpu = 42
    mock_nvml.nvmlDeviceGetUtilizationRates.return_value = mock_util

    mock_mem = MagicMock()
    mock_mem.used = 2 * 1024 * 1024 * 1024  # 2048 MB
    mock_mem.total = 8 * 1024 * 1024 * 1024  # 8192 MB
    mock_nvml.nvmlDeviceGetMemoryInfo.return_value = mock_mem

    mock_nvml.nvmlDeviceGetTemperature.return_value = 54
    mock_nvml.nvmlDeviceGetEncoderUtilization.return_value = [15, 0]
    mock_nvml.nvmlDeviceGetDecoderUtilization.return_value = [25, 0]

    with patch("src.gpu_stats.pynvml", mock_nvml):
        stats = collector.collect_nvml_stats(mock_handle)
        assert stats["gpu_util"] == 42
        assert stats["vram_used_mb"] == 2048.0
        assert stats["vram_total_mb"] == 8192.0
        assert stats["temp_c"] == 54
        assert stats["enc_util"] == 15
        assert stats["dec_util"] == 25

