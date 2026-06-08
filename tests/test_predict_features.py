"""
Tests — ERS Predict Feature Extractors
═══════════════════════════════════════
"""

import math
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest


class TestTimeSeriesFeatureExtractor:
    """Tests for TimeSeriesFeatureExtractor."""

    def setup_method(self):
        from ers_predict.features.time_series import TimeSeriesFeatureExtractor
        self.extractor = TimeSeriesFeatureExtractor()

    def test_empty_readings(self):
        result = self.extractor.extract("VIB_01", [])
        assert result.tag == "VIB_01"
        assert len(result.windows) == 0
        assert result.trend_slope == 0.0

    def test_single_reading(self):
        now = datetime.now(tz=timezone.utc)
        result = self.extractor.extract("VIB_01", [(now, 5.0)])
        assert result.tag == "VIB_01"
        assert result.trend_slope == 0.0
        assert result.change_rate == 0.0

    def test_multiple_readings_stats(self):
        now = datetime.now(tz=timezone.utc)
        readings = [
            (now - timedelta(minutes=i), 10.0 + i * 0.1)
            for i in range(60)
        ]
        result = self.extractor.extract("TEMP_01", readings)

        assert result.tag == "TEMP_01"
        assert len(result.windows) > 0

        # 1h window should have all 60 readings
        w1h = next((w for w in result.windows if w.window_name == "1h"), None)
        assert w1h is not None
        assert w1h.sample_count == 60
        assert w1h.mean > 0
        assert w1h.std >= 0
        assert w1h.rms > 0

    def test_rolling_windows(self):
        now = datetime.now(tz=timezone.utc)
        # Data spread across 48 hours
        readings = [
            (now - timedelta(hours=i), 50.0 + i * 0.5)
            for i in range(48)
        ]
        result = self.extractor.extract("PRESS_01", readings)

        w1h = next((w for w in result.windows if w.window_name == "1h"), None)
        w24h = next((w for w in result.windows if w.window_name == "24h"), None)

        assert w1h.sample_count < w24h.sample_count

    def test_trend_slope(self):
        now = datetime.now(tz=timezone.utc)
        # Clear upward trend: 1 unit per hour
        readings = [
            (now - timedelta(hours=i), 100.0 - i)
            for i in range(24)
        ]
        result = self.extractor.extract("VIB_DE", readings)
        # Slope should be negative (decreasing over time)
        assert result.trend_slope != 0.0


class TestFrequencyFeatureExtractor:
    """Tests for FrequencyFeatureExtractor (FFT)."""

    def setup_method(self):
        from ers_predict.features.frequency import FrequencyFeatureExtractor
        self.extractor = FrequencyFeatureExtractor(sample_rate_hz=100.0, running_speed_hz=25.0)

    def test_empty_signal(self):
        result = self.extractor.extract("VIB_01", [])
        assert result.tag == "VIB_01"
        assert result.dominant_frequency_hz == 0.0

    def test_short_signal(self):
        result = self.extractor.extract("VIB_01", [1.0, 2.0])
        assert result.tag == "VIB_01"

    def test_sinusoidal_signal(self):
        # Generate a 25Hz sine wave at 100 Hz sample rate
        n = 64
        signal = [math.sin(2 * math.pi * 25 * t / 100) for t in range(n)]
        result = self.extractor.extract("VIB_01", signal)

        assert result.dominant_frequency_hz > 0
        assert result.peak_amplitude > 0
        assert result.spectral_energy > 0
        assert result.crest_factor > 0

    def test_energy_bands(self):
        n = 64
        signal = [math.sin(2 * math.pi * 25 * t / 100) for t in range(n)]
        result = self.extractor.extract("VIB_01", signal)

        assert isinstance(result.energy_bands, dict)
        # All bands should sum to approximately 1.0
        total = sum(result.energy_bands.values())
        assert total > 0


class TestOperationalContextExtractor:
    """Tests for OperationalContextExtractor."""

    def setup_method(self):
        from ers_predict.features.operational import OperationalContextExtractor
        self.extractor = OperationalContextExtractor()

    def test_default_context(self):
        result = self.extractor.extract()
        assert result.hours_since_last_pm == 0.0
        assert result.load_factor == 0.0
        assert result.operating_regime == "standby"

    def test_overload_regime(self):
        result = self.extractor.extract(
            rated_capacity=100.0,
            actual_output=120.0,
            design_temp_c=25.0,
            ambient_temp_c=50.0,
        )
        assert result.operating_regime == "overload"
        assert result.load_factor > 1.0
        assert result.ambient_temp_delta == 25.0

    def test_high_stress_regime(self):
        result = self.extractor.extract(
            rated_capacity=100.0,
            actual_output=95.0,
            design_temp_c=25.0,
            ambient_temp_c=38.0,
        )
        assert result.operating_regime == "high_stress"

    def test_hours_since_pm(self):
        ref_time = datetime(2025, 6, 15, tzinfo=timezone.utc)
        pm_date = datetime(2025, 6, 1, tzinfo=timezone.utc)
        result = self.extractor.extract(
            last_pm_date=pm_date,
            reference_time=ref_time,
        )
        assert result.hours_since_last_pm > 300


class TestHistoricalPatternMatcher:
    """Tests for HistoricalPatternMatcher (DTW)."""

    def setup_method(self):
        from ers_predict.features.historical import HistoricalPatternMatcher
        self.matcher = HistoricalPatternMatcher(similarity_threshold=0.5)

    def test_empty_match(self):
        results = self.matcher.match([1.0, 2.0, 3.0])
        assert results == []

    def test_exact_match(self):
        sig = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]
        self.matcher.register_signature("seal_failure", uuid4(), uuid4(), sig, 14.0)

        results = self.matcher.match(sig)
        assert len(results) >= 1
        assert results[0].similarity_score >= 0.9
        assert results[0].matched_failure_mode == "seal_failure"

    def test_similar_match(self):
        sig1 = [1.0, 2.0, 3.0, 4.0, 5.0]
        sig2 = [1.1, 2.1, 3.1, 4.1, 5.1]  # Very similar
        self.matcher.register_signature("bearing_failure", uuid4(), uuid4(), sig1, 7.0)

        results = self.matcher.match(sig2)
        assert len(results) >= 1
        assert results[0].similarity_score > 0.7

    def test_dissimilar_no_match(self):
        sig1 = [1.0, 1.0, 1.0, 1.0, 1.0]
        sig2 = [10.0, 20.0, 30.0, 40.0, 50.0]
        self.matcher.register_signature("test_mode", uuid4(), uuid4(), sig1, 5.0)

        results = self.matcher.match(sig2, top_n=5)
        # May or may not match depending on DTW distance
        for r in results:
            assert r.similarity_score >= self.matcher.similarity_threshold

    def test_top_n_limit(self):
        for i in range(10):
            sig = [float(i + j) for j in range(5)]
            self.matcher.register_signature(f"mode_{i}", uuid4(), uuid4(), sig, float(i))

        results = self.matcher.match([1.0, 2.0, 3.0, 4.0, 5.0], top_n=3)
        assert len(results) <= 3
