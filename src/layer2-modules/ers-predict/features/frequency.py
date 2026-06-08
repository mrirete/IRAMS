"""
ERS Predict — Frequency Feature Extractor (FFT)
══════════════════════════════════════════════════
FFT-based vibration analysis: dominant frequencies, spectral
energy bands, peak amplitude, crest factor, harmonic ratios.
"""

from __future__ import annotations

import math
from typing import Dict, List, Tuple

from ..schemas import FrequencyFeatures


# Default spectral energy band boundaries (Hz)
DEFAULT_BANDS: Dict[str, Tuple[float, float]] = {
    "sub_synchronous": (0.0, 0.4),
    "1x_band": (0.4, 1.5),
    "2x_band": (1.5, 2.5),
    "high_frequency": (2.5, 10.0),
    "very_high": (10.0, float("inf")),
}


class FrequencyFeatureExtractor:
    """
    FFT-based feature extraction for vibration sensor data.

    Usage:
        extractor = FrequencyFeatureExtractor(sample_rate_hz=1000)
        features = extractor.extract("VIB_DE", signal_values)
    """

    def __init__(
        self,
        sample_rate_hz: float = 1000.0,
        running_speed_hz: float = 60.0,
        bands: Dict[str, Tuple[float, float]] | None = None,
    ):
        self.sample_rate = sample_rate_hz
        self.running_speed = running_speed_hz
        # Normalize band boundaries relative to running speed
        self.bands = bands or DEFAULT_BANDS

    def extract(self, tag: str, signal: List[float]) -> FrequencyFeatures:
        """
        Compute FFT and extract frequency-domain features.

        Args:
            tag: Sensor tag name.
            signal: Time-domain vibration values (uniformly sampled).

        Returns:
            FrequencyFeatures with dominant freq, energy bands, etc.
        """
        if not signal or len(signal) < 4:
            return FrequencyFeatures(tag=tag)

        n = len(signal)

        # --- Compute FFT (real-valued signal) ---
        fft_result = self._fft_real(signal)
        half_n = n // 2
        magnitudes = [abs(fft_result[i]) / n for i in range(half_n)]
        frequencies = [i * self.sample_rate / n for i in range(half_n)]

        if not magnitudes:
            return FrequencyFeatures(tag=tag)

        # --- Dominant frequency ---
        peak_idx = max(range(1, len(magnitudes)), key=lambda i: magnitudes[i], default=1)
        dominant_freq = frequencies[peak_idx]
        peak_amplitude = magnitudes[peak_idx]

        # --- Spectral energy ---
        total_energy = sum(m ** 2 for m in magnitudes)
        spectral_energy = total_energy

        # --- Energy bands (normalized to running speed multiples) ---
        energy_bands: Dict[str, float] = {}
        for band_name, (lo_mult, hi_mult) in self.bands.items():
            lo_hz = lo_mult * self.running_speed
            hi_hz = hi_mult * self.running_speed
            band_energy = sum(
                m ** 2
                for f, m in zip(frequencies, magnitudes)
                if lo_hz <= f < hi_hz
            )
            energy_bands[band_name] = round(
                band_energy / total_energy if total_energy > 0 else 0.0, 6
            )

        # --- Harmonic ratios (1x, 2x, 3x, 4x relative to 1x) ---
        harmonic_ratios = self._compute_harmonic_ratios(frequencies, magnitudes)

        # --- Crest factor: peak / RMS ---
        rms = math.sqrt(sum(v ** 2 for v in signal) / n) if n > 0 else 1.0
        peak_signal = max(abs(v) for v in signal)
        crest_factor = peak_signal / rms if rms > 0 else 0.0

        return FrequencyFeatures(
            tag=tag,
            dominant_frequency_hz=round(dominant_freq, 4),
            peak_amplitude=round(peak_amplitude, 6),
            spectral_energy=round(spectral_energy, 6),
            harmonic_ratios=[round(r, 4) for r in harmonic_ratios],
            energy_bands=energy_bands,
            crest_factor=round(crest_factor, 4),
        )

    def _compute_harmonic_ratios(
        self,
        frequencies: List[float],
        magnitudes: List[float],
    ) -> List[float]:
        """Compute amplitude ratios at 1x, 2x, 3x, 4x running speed."""
        ratios: List[float] = []
        base_amplitude = self._amplitude_at_freq(
            frequencies, magnitudes, self.running_speed
        )
        if base_amplitude <= 0:
            return [0.0, 0.0, 0.0, 0.0]

        for harmonic in [1, 2, 3, 4]:
            target_freq = harmonic * self.running_speed
            amp = self._amplitude_at_freq(frequencies, magnitudes, target_freq)
            ratios.append(amp / base_amplitude if base_amplitude > 0 else 0.0)

        return ratios

    @staticmethod
    def _amplitude_at_freq(
        frequencies: List[float],
        magnitudes: List[float],
        target_hz: float,
        tolerance_hz: float = 2.0,
    ) -> float:
        """Find peak amplitude near target frequency."""
        candidates = [
            m
            for f, m in zip(frequencies, magnitudes)
            if abs(f - target_hz) <= tolerance_hz
        ]
        return max(candidates) if candidates else 0.0

    @staticmethod
    def _fft_real(signal: List[float]) -> List[complex]:
        """
        Simple DFT implementation for real-valued signals.
        Production: replace with numpy.fft.rfft for performance.
        """
        n = len(signal)
        result: List[complex] = []
        for k in range(n):
            val = complex(0, 0)
            for t in range(n):
                angle = -2.0 * math.pi * k * t / n
                val += signal[t] * complex(math.cos(angle), math.sin(angle))
            result.append(val)
        return result
