"""
ERS Predict — Historical Pattern Matcher
══════════════════════════════════════════
DTW-based similarity matching against stored pre-failure
sensor signatures. Returns top-N matching failure patterns.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from ..schemas import HistoricalPattern


class HistoricalPatternMatcher:
    """
    Matches current sensor trajectory against known pre-failure
    signatures using Dynamic Time Warping (DTW).

    Usage:
        matcher = HistoricalPatternMatcher()
        matcher.register_signature("seal_failure", event_id, asset_id, signal, days_before=14)
        matches = matcher.match(current_signal, top_n=5)
    """

    def __init__(self, similarity_threshold: float = 0.6):
        self.signatures: List[Dict[str, Any]] = []
        self.similarity_threshold = similarity_threshold

    def register_signature(
        self,
        failure_mode: str,
        failure_event_id: UUID,
        asset_id: UUID,
        signal: List[float],
        days_before_failure: float = 0.0,
    ) -> None:
        """
        Register a known pre-failure signature for future matching.

        Args:
            failure_mode: The failure mode this signature precedes.
            failure_event_id: Source failure event ID.
            asset_id: Asset where the failure occurred.
            signal: Sensor values in the window before failure.
            days_before_failure: How many days before failure this pattern was seen.
        """
        if not signal or len(signal) < 2:
            return

        # Normalize signal to [0, 1] for comparison
        normalized = self._normalize(signal)

        self.signatures.append({
            "failure_mode": failure_mode,
            "failure_event_id": failure_event_id,
            "asset_id": asset_id,
            "signal": normalized,
            "raw_length": len(signal),
            "days_before_failure": days_before_failure,
        })

    def match(
        self,
        current_signal: List[float],
        top_n: int = 5,
    ) -> List[HistoricalPattern]:
        """
        Match current signal against all registered signatures.

        Args:
            current_signal: Recent sensor readings.
            top_n: Number of top matches to return.

        Returns:
            List of HistoricalPattern sorted by similarity (descending).
        """
        if not current_signal or len(current_signal) < 2 or not self.signatures:
            return []

        normalized_current = self._normalize(current_signal)

        results: List[Tuple[float, Dict[str, Any]]] = []
        for sig in self.signatures:
            distance = self._dtw_distance(normalized_current, sig["signal"])
            # Convert distance to similarity (0-1)
            max_possible = max(len(normalized_current), len(sig["signal"]))
            similarity = max(0.0, 1.0 - (distance / max(max_possible, 1.0)))
            if similarity >= self.similarity_threshold:
                results.append((similarity, sig))

        # Sort by similarity descending
        results.sort(key=lambda x: x[0], reverse=True)

        return [
            HistoricalPattern(
                matched_failure_mode=sig["failure_mode"],
                similarity_score=round(sim, 4),
                days_before_failure=sig["days_before_failure"],
                source_asset_id=sig["asset_id"],
                source_failure_event_id=sig["failure_event_id"],
            )
            for sim, sig in results[:top_n]
        ]

    @staticmethod
    def _normalize(signal: List[float]) -> List[float]:
        """Normalize signal to [0, 1] range."""
        min_val = min(signal)
        max_val = max(signal)
        span = max_val - min_val
        if span == 0:
            return [0.5] * len(signal)
        return [(v - min_val) / span for v in signal]

    @staticmethod
    def _dtw_distance(seq_a: List[float], seq_b: List[float]) -> float:
        """
        Compute Dynamic Time Warping distance between two sequences.

        Uses O(n*m) dynamic programming. For production with large
        sequences, use FastDTW or the dtaidistance library.
        """
        n = len(seq_a)
        m = len(seq_b)

        # Initialize cost matrix
        dtw = [[float("inf")] * (m + 1) for _ in range(n + 1)]
        dtw[0][0] = 0.0

        for i in range(1, n + 1):
            for j in range(1, m + 1):
                cost = abs(seq_a[i - 1] - seq_b[j - 1])
                dtw[i][j] = cost + min(
                    dtw[i - 1][j],      # insertion
                    dtw[i][j - 1],      # deletion
                    dtw[i - 1][j - 1],  # match
                )

        return dtw[n][m]
