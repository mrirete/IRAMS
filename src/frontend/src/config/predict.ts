/**
 * Predict module configuration.
 */

/**
 * Data-freshness gate: when the newest twin/sensor data is older than this,
 * the module must stop presenting itself as live — the operating-state pill
 * shows "Stale — reconnect" and the readings header drops "Live". A monitoring
 * surface that hasn't seen data in weeks must never show a green heartbeat.
 */
export const STALE_DAYS = 7;

/**
 * Health-index value the heuristic RUL treats as failure (PredictionService
 * fallback: remaining health = HI - threshold). The twin trajectory draws the
 * same line so the two never disagree on where "failed" is.
 */
export const HEALTH_FAILURE_THRESHOLD = 30;
