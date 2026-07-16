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
