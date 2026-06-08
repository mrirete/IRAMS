-- ============================================================
-- Seed ERS Predict tables with realistic oil & gas demo data
-- Dynamically looks up asset UUIDs from the assets register.
-- All inserts use ON CONFLICT DO NOTHING for idempotency.
-- ============================================================

DO $$
DECLARE
    v_asset   RECORD;
    v_hi      NUMERIC;
    v_rul     NUMERIC;
    v_conf    NUMERIC;
    v_dist    TEXT;
    v_tier    INT;
    v_drift   NUMERIC;
    v_cal     NUMERIC;
    v_proj    JSONB;
    v_deg     JSONB;
    v_sensors JSONB;
    v_bands   JSONB;
    v_idx     INT := 0;
    -- Sensor sparkline helper
    v_readings JSONB;
    v_base    NUMERIC;
    v_i       INT;
BEGIN

-- ────────────────────────────────────────────────────────────
--  Loop through every asset in the register
-- ────────────────────────────────────────────────────────────
FOR v_asset IN
    SELECT id, name, tag, criticality
    FROM assets
    ORDER BY tag
LOOP
    v_idx := v_idx + 1;

    -- ── Vary health / RUL by criticality ──────────────────
    CASE v_asset.criticality
        WHEN 'A' THEN
            v_hi   := 70 + (random() * 20)::NUMERIC(5,1);   -- 70-90
            v_rul  := 80 + (random() * 200)::NUMERIC(8,1);   -- 80-280 days
            v_conf := 0.80 + (random() * 0.15)::NUMERIC(4,2);
            v_dist := CASE WHEN random() > 0.5 THEN 'weibull_2p' ELSE 'weibull_3p' END;
            v_tier := CASE WHEN v_hi < 75 THEN 2 ELSE 3 END;
            v_cal  := 90 + (random() * 8)::NUMERIC(5,1);
            v_drift := (random() * 0.04)::NUMERIC(5,3);
        WHEN 'B' THEN
            v_hi   := 60 + (random() * 30)::NUMERIC(5,1);   -- 60-90
            v_rul  := 60 + (random() * 250)::NUMERIC(8,1);   -- 60-310
            v_conf := 0.70 + (random() * 0.20)::NUMERIC(4,2);
            v_dist := CASE WHEN random() > 0.5 THEN 'lognormal' ELSE 'weibull_2p' END;
            v_tier := 3;
            v_cal  := 80 + (random() * 15)::NUMERIC(5,1);
            v_drift := (random() * 0.08)::NUMERIC(5,3);
        ELSE  -- C or NULL
            v_hi   := 75 + (random() * 20)::NUMERIC(5,1);   -- 75-95
            v_rul  := 200 + (random() * 500)::NUMERIC(8,1);  -- 200-700
            v_conf := 0.85 + (random() * 0.12)::NUMERIC(4,2);
            v_dist := 'exponential';
            v_tier := 4;
            v_cal  := 85 + (random() * 12)::NUMERIC(5,1);
            v_drift := (random() * 0.03)::NUMERIC(5,3);
    END CASE;

    -- Clamp confidence
    IF v_conf > 0.99 THEN v_conf := 0.99; END IF;

    -- ── Build 30-day health projection ───────────────────
    SELECT jsonb_agg(
        jsonb_build_object(
            'days_ahead', d,
            'health_index', GREATEST(20, ROUND((v_hi - d * (0.08 + random() * 0.15))::NUMERIC, 1)),
            'confidence_lower', GREATEST(10, ROUND((v_hi - d * (0.08 + random() * 0.15) - d * (0.03 + random() * 0.04))::NUMERIC, 1)),
            'confidence_upper', LEAST(100, ROUND((v_hi - d * (0.08 + random() * 0.15) + d * (0.03 + random() * 0.04))::NUMERIC, 1))
        )
    )
    INTO v_proj
    FROM generate_series(0, 29) AS d;

    -- ── Build degradation models ─────────────────────────
    v_deg := '[]'::JSONB;
    IF v_asset.criticality = 'A' THEN
        v_deg := jsonb_build_array(
            jsonb_build_object(
                'mechanism', 'Bearing Wear',
                'model_type', 'L10 Lifetime',
                'parameters', jsonb_build_object('l10_base', 50000),
                'current_damage_pct', ROUND((10 + random() * 35)::NUMERIC, 1),
                'projected_failure_date', (NOW() + (v_rul || ' days')::INTERVAL)::TEXT
            ),
            jsonb_build_object(
                'mechanism', 'Seal Degradation',
                'model_type', 'Linear Wear',
                'parameters', jsonb_build_object('wear_rate', 0.003),
                'current_damage_pct', ROUND((15 + random() * 40)::NUMERIC, 1),
                'projected_failure_date', (NOW() + ((v_rul * 0.7)::INT || ' days')::INTERVAL)::TEXT
            )
        );
    ELSIF v_asset.criticality = 'B' THEN
        v_deg := jsonb_build_array(
            jsonb_build_object(
                'mechanism', CASE WHEN v_idx % 3 = 0 THEN 'Impeller Erosion'
                                  WHEN v_idx % 3 = 1 THEN 'Corrosion Under Insulation'
                                  ELSE 'Fatigue Cracking' END,
                'model_type', CASE WHEN v_idx % 2 = 0 THEN 'Exponential' ELSE 'Power Law' END,
                'parameters', jsonb_build_object('rate', ROUND((0.002 + random() * 0.006)::NUMERIC, 4)),
                'current_damage_pct', ROUND((20 + random() * 50)::NUMERIC, 1),
                'projected_failure_date', (NOW() + (v_rul || ' days')::INTERVAL)::TEXT
            )
        );
    ELSE
        v_deg := jsonb_build_array(
            jsonb_build_object(
                'mechanism', 'General Wear',
                'model_type', 'Linear',
                'parameters', jsonb_build_object('wear_rate', 0.001),
                'current_damage_pct', ROUND((5 + random() * 15)::NUMERIC, 1),
                'projected_failure_date', (NOW() + (v_rul || ' days')::INTERVAL)::TEXT
            )
        );
    END IF;

    -- ── Build sensor summary ─────────────────────────────
    v_sensors := jsonb_build_object(
        'Vibration (mm/s)', ROUND((1.5 + random() * 8)::NUMERIC, 1),
        'Temperature (°C)',  ROUND((45 + random() * 60)::NUMERIC, 1),
        'Pressure (bar)',    ROUND((2 + random() * 25)::NUMERIC, 1),
        'Flow (m³/h)',       ROUND((100 + random() * 2000)::NUMERIC, 1)
    );

    -- ════════════════════════════════════════════════════════
    --  INSERT: ers_twin_states
    -- ════════════════════════════════════════════════════════
    INSERT INTO ers_twin_states (
        asset_id, twin_id, health_index,
        calibration_quality, calibration_drift,
        sensor_summary, degradation_models, health_projection,
        last_calibrated_at
    ) VALUES (
        v_asset.id,
        'twn-' || SUBSTRING(v_asset.id::TEXT, 1, 8),
        v_hi,
        v_cal,
        v_drift,
        v_sensors,
        v_deg,
        COALESCE(v_proj, '[]'::JSONB),
        NOW() - (random() * INTERVAL '7 days')
    )
    ON CONFLICT (asset_id) DO NOTHING;

    -- ════════════════════════════════════════════════════════
    --  INSERT: ers_rul_estimates
    -- ════════════════════════════════════════════════════════
    v_bands := jsonb_build_array(
        jsonb_build_object('percentile', 50,
            'lower_days', ROUND((v_rul * 0.85)::NUMERIC, 0),
            'upper_days', ROUND((v_rul * 1.15)::NUMERIC, 0),
            'median_days', ROUND(v_rul::NUMERIC, 0)),
        jsonb_build_object('percentile', 80,
            'lower_days', ROUND((v_rul * 0.70)::NUMERIC, 0),
            'upper_days', ROUND((v_rul * 1.35)::NUMERIC, 0),
            'median_days', ROUND(v_rul::NUMERIC, 0)),
        jsonb_build_object('percentile', 95,
            'lower_days', ROUND((v_rul * 0.55)::NUMERIC, 0),
            'upper_days', ROUND((v_rul * 1.60)::NUMERIC, 0),
            'median_days', ROUND(v_rul::NUMERIC, 0))
    );

    INSERT INTO ers_rul_estimates (
        asset_id, rul_days, confidence, distribution_type,
        dqs_impact, governance_tier, confidence_bands
    ) VALUES (
        v_asset.id,
        v_rul,
        v_conf,
        v_dist,
        ROUND((random() * 0.08)::NUMERIC, 2),
        v_tier,
        v_bands
    )
    ON CONFLICT (asset_id) DO NOTHING;

    -- ════════════════════════════════════════════════════════
    --  INSERT: ers_sensor_readings (4 per asset)
    -- ════════════════════════════════════════════════════════

    -- Vibration
    v_base := 2.0 + random() * 6;
    SELECT jsonb_agg(ROUND((v_base + (random()-0.5)*1.5)::NUMERIC, 2))
    INTO v_readings FROM generate_series(1,24);

    INSERT INTO ers_sensor_readings (asset_id, tag, current_value, unit, trend, alarm_high, alarm_low, readings)
    VALUES (v_asset.id, 'Vibration (mm/s)', ROUND(v_base::NUMERIC, 1), 'mm/s',
            CASE WHEN v_base > 6 THEN 'rising' WHEN v_base < 3 THEN 'stable' ELSE 'stable' END,
            10.0, 1.0, v_readings);

    -- Temperature
    v_base := 50 + random() * 55;
    SELECT jsonb_agg(ROUND((v_base + (random()-0.5)*8)::NUMERIC, 1))
    INTO v_readings FROM generate_series(1,24);

    INSERT INTO ers_sensor_readings (asset_id, tag, current_value, unit, trend, alarm_high, alarm_low, readings)
    VALUES (v_asset.id, 'Temperature (°C)', ROUND(v_base::NUMERIC, 1), '°C',
            CASE WHEN v_base > 85 THEN 'rising' WHEN v_base < 60 THEN 'falling' ELSE 'stable' END,
            120.0, 30.0, v_readings);

    -- Pressure
    v_base := 3 + random() * 20;
    SELECT jsonb_agg(ROUND((v_base + (random()-0.5)*3)::NUMERIC, 2))
    INTO v_readings FROM generate_series(1,24);

    INSERT INTO ers_sensor_readings (asset_id, tag, current_value, unit, trend, alarm_high, alarm_low, readings)
    VALUES (v_asset.id, 'Pressure (bar)', ROUND(v_base::NUMERIC, 1), 'bar',
            CASE WHEN v_base > 18 THEN 'rising' ELSE 'stable' END,
            30.0, 1.0, v_readings);

    -- Flow
    v_base := 200 + random() * 1800;
    SELECT jsonb_agg(ROUND((v_base + (random()-0.5)*200)::NUMERIC, 1))
    INTO v_readings FROM generate_series(1,24);

    INSERT INTO ers_sensor_readings (asset_id, tag, current_value, unit, trend, alarm_high, alarm_low, readings)
    VALUES (v_asset.id, 'Flow (m³/h)', ROUND(v_base::NUMERIC, 1), 'm³/h',
            CASE WHEN v_base < 400 THEN 'falling' ELSE 'stable' END,
            2500.0, 100.0, v_readings);

END LOOP;

-- ════════════════════════════════════════════════════════════
--  INSERT: ers_prediction_alerts (cross-asset)
-- ════════════════════════════════════════════════════════════
-- Pick first 5 Criticality-A assets for realistic alerts

INSERT INTO ers_prediction_alerts (alert_id, asset_id, alert_type, severity, title, description, confidence, dqs_impact, governance_tier)
SELECT
    'alt-seed-' || ROW_NUMBER() OVER () AS alert_id,
    a.id AS asset_id,
    t.alert_type,
    t.severity,
    t.title,
    t.description,
    t.confidence,
    t.dqs_impact,
    t.governance_tier
FROM (
    SELECT id, name, ROW_NUMBER() OVER (ORDER BY tag) AS rn
    FROM assets
    WHERE criticality = 'A'
    LIMIT 5
) a
CROSS JOIN LATERAL (
    VALUES
        -- Alert 1 for each asset
        (
            'trend_deviation'::TEXT,
            CASE WHEN a.rn <= 2 THEN 'high' ELSE 'medium' END,
            'Accelerated ' || CASE WHEN a.rn % 3 = 0 THEN 'Bearing' WHEN a.rn % 3 = 1 THEN 'Seal' ELSE 'Impeller' END || ' Wear Detected',
            'Vibration signature in high-frequency band indicates early stage degradation on ' || a.name || '. Trend has been accelerating for 72 hours.',
            0.88 + (a.rn * 0.02),
            0.01 + (a.rn * 0.005),
            CASE WHEN a.rn <= 2 THEN 2 ELSE 3 END
        ),
        -- Alert 2 for first 3 assets
        (
            CASE WHEN a.rn <= 3 THEN 'threshold_breach' ELSE 'anomaly' END,
            CASE WHEN a.rn = 1 THEN 'high' ELSE 'low' END,
            CASE WHEN a.rn <= 3
                 THEN 'Temperature Exceeding Dynamic Threshold on ' || a.name
                 ELSE 'Minor Flow Anomaly on ' || a.name END,
            CASE WHEN a.rn <= 3
                 THEN 'Bearing temperature is 8°C above the rolling 30-day P95 threshold. Investigate lubrication condition.'
                 ELSE 'Flow rate dropped 4% below expected norm. May indicate partial blockage or instrument drift.' END,
            0.78 + (a.rn * 0.03),
            0.02,
            3
        )
) t(alert_type, severity, title, description, confidence, dqs_impact, governance_tier)
ON CONFLICT (alert_id) DO NOTHING;

RAISE NOTICE 'Seeded ERS Predict data for % assets', v_idx;

END $$;
