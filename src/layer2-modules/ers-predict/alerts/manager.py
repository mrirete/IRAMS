"""
ERS Predict — Alert Fatigue Manager
════════════════════════════════════
Correlation grouping, suppression timers, auto-threshold
adjustment targeting default 80% precision.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

from ..schemas import AlertSeverity, GovernanceTier, PredictionAlert

logger = logging.getLogger("ers.predict.alerts")

# Default suppression window per alert type (hours)
DEFAULT_SUPPRESSION_HOURS: Dict[str, float] = {
    "anomaly": 4.0,
    "threshold_breach": 2.0,
    "trend_deviation": 8.0,
    "rul_critical": 1.0,
    "pattern_match": 6.0,
}

# Target precision for auto-threshold adjustment
TARGET_PRECISION = 0.80

# Correlation window: alerts from same asset within this window are grouped
CORRELATION_WINDOW_MINUTES = 30


class AlertFatigueManager:
    """
    Manages prediction-driven alerts to reduce alert fatigue:

    1. Correlation Grouping: Temporally co-located alerts from the same
       asset are grouped under a single root-cause alert.
    2. Suppression Timers: Configurable cooldown per alert type to
       prevent alert storms.
    3. Auto-Threshold Adjustment: Adjusts alert thresholds to maintain
       target precision (default 80%).
    """

    def __init__(
        self,
        suppression_config: Dict[str, float] | None = None,
        target_precision: float = TARGET_PRECISION,
    ):
        self.suppression_config = suppression_config or DEFAULT_SUPPRESSION_HOURS.copy()
        self.target_precision = target_precision

        # Active alerts by asset_id
        self.active_alerts: Dict[UUID, List[PredictionAlert]] = {}
        # Suppression timestamps: (asset_id, alert_type) → suppressed_until
        self.suppression_log: Dict[tuple, datetime] = {}
        # Correlation groups
        self.correlation_groups: Dict[UUID, List[PredictionAlert]] = {}
        # Threshold tracking for auto-adjustment
        self.threshold_history: Dict[str, List[Dict[str, Any]]] = {}
        # Current thresholds per alert type
        self.thresholds: Dict[str, float] = {
            "anomaly": 50.0,        # anomaly score threshold
            "threshold_breach": 0.8, # fraction of limit
            "trend_deviation": 2.0,  # sigma multiplier
            "rul_critical": 30.0,    # days
            "pattern_match": 0.7,    # similarity score
        }

    def process_alert(
        self,
        asset_id: UUID,
        alert_type: str,
        severity: AlertSeverity,
        title: str,
        description: str,
        confidence: float,
        value: float = 0.0,
        dqs_impact: float = 0.0,
    ) -> Optional[PredictionAlert]:
        """
        Process a candidate alert through the fatigue management pipeline.

        Returns:
            PredictionAlert if the alert should be raised, None if suppressed.
        """
        now = datetime.now(tz=timezone.utc)

        # 1. Check threshold
        threshold = self.thresholds.get(alert_type, 0.5)
        if not self._exceeds_threshold(alert_type, value, threshold):
            return None

        # 2. Check suppression
        supp_key = (asset_id, alert_type)
        supp_until = self.suppression_log.get(supp_key)
        if supp_until and now < supp_until:
            logger.debug("Alert suppressed for %s type=%s until %s", asset_id, alert_type, supp_until)
            return None

        # 3. Check correlation — is there a recent alert for same asset?
        correlation_group_id = self._check_correlation(asset_id, alert_type, now)

        alert = PredictionAlert(
            alert_id=uuid4(),
            asset_id=asset_id,
            alert_type=alert_type,
            severity=severity,
            title=title,
            description=description,
            confidence=confidence,
            dqs_impact=dqs_impact,
            governance_tier=GovernanceTier.TIER_3_STANDARD,
            suppressed=False,
            correlation_group_id=correlation_group_id,
            created_at=now,
        )

        # 4. Activate suppression timer
        supp_hours = self.suppression_config.get(alert_type, 4.0)
        self.suppression_log[supp_key] = now + timedelta(hours=supp_hours)

        # 5. Record alert
        self.active_alerts.setdefault(asset_id, []).append(alert)
        if correlation_group_id:
            self.correlation_groups.setdefault(correlation_group_id, []).append(alert)

        logger.info(
            "Alert raised: %s | %s | severity=%s | confidence=%.2f",
            asset_id, alert_type, severity.value, confidence,
        )

        return alert

    def acknowledge_alert(self, alert_id: UUID, user_id: UUID) -> bool:
        """Mark an alert as acknowledged."""
        for alerts in self.active_alerts.values():
            for alert in alerts:
                if alert.alert_id == alert_id:
                    # Note: PredictionAlert is immutable via Pydantic, track separately
                    logger.info("Alert %s acknowledged by %s", alert_id, user_id)
                    return True
        return False

    def record_outcome(
        self,
        alert_type: str,
        was_true_positive: bool,
    ) -> None:
        """
        Record whether an alert was a true positive for precision tracking.
        Used by auto-threshold adjustment.
        """
        history = self.threshold_history.setdefault(alert_type, [])
        history.append({
            "was_tp": was_true_positive,
            "timestamp": datetime.now(tz=timezone.utc),
            "threshold": self.thresholds.get(alert_type, 0.5),
        })

        # Auto-adjust if we have enough history (rolling 50 alerts)
        if len(history) >= 50:
            self._auto_adjust_threshold(alert_type, history[-50:])

    def get_active_alerts(self, asset_id: UUID) -> List[PredictionAlert]:
        """Get all active (non-suppressed) alerts for an asset."""
        return [a for a in self.active_alerts.get(asset_id, []) if not a.suppressed]

    def get_correlation_group(self, group_id: UUID) -> List[PredictionAlert]:
        """Get all alerts in a correlation group."""
        return self.correlation_groups.get(group_id, [])

    # ── Internal methods ──

    def _check_correlation(
        self,
        asset_id: UUID,
        alert_type: str,
        now: datetime,
    ) -> Optional[UUID]:
        """Check if recent alerts from same asset should be grouped."""
        recent = self.active_alerts.get(asset_id, [])
        window = timedelta(minutes=CORRELATION_WINDOW_MINUTES)

        for existing in reversed(recent):
            if (now - existing.created_at) <= window:
                # Group with existing alert
                group_id = existing.correlation_group_id or uuid4()
                return group_id

        return None

    @staticmethod
    def _exceeds_threshold(alert_type: str, value: float, threshold: float) -> bool:
        """Check if value exceeds the threshold for this alert type."""
        if alert_type == "rul_critical":
            return value <= threshold  # RUL below threshold → alert
        return value >= threshold  # Other metrics above threshold → alert

    def _auto_adjust_threshold(
        self,
        alert_type: str,
        recent_history: List[Dict[str, Any]],
    ) -> None:
        """
        Adjust threshold to maintain target precision.

        If precision < target: raise threshold (fewer but more accurate alerts)
        If precision > target + 0.1: lower threshold (catch more events)
        """
        tp_count = sum(1 for h in recent_history if h["was_tp"])
        total = len(recent_history)
        current_precision = tp_count / max(total, 1)

        current_threshold = self.thresholds.get(alert_type, 0.5)

        if current_precision < self.target_precision:
            # Too many false positives — raise threshold
            adjustment = 1.05
            reason = "precision below target"
        elif current_precision > self.target_precision + 0.10:
            # Very high precision — we might be missing real alerts
            adjustment = 0.95
            reason = "precision above target, lowering to catch more"
        else:
            return  # Within acceptable range

        new_threshold = current_threshold * adjustment
        self.thresholds[alert_type] = new_threshold
        logger.info(
            "Auto-adjusted %s threshold: %.4f → %.4f (%s, precision=%.2f)",
            alert_type, current_threshold, new_threshold, reason, current_precision,
        )
