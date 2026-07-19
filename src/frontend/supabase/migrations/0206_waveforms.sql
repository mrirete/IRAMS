-- ============================================================
-- 0206: Vibration waveform captures — the DM layer's raw material.
-- Time-waveforms (pasted/CSV today, online feed later) + the spectral
-- features computed from them (RMS/kurtosis/crest, spectrum & envelope
-- peaks, screening diagnosis). Samples are capped client-side; features
-- always persist even when the raw waveform is too large to keep.
-- ============================================================

CREATE TABLE IF NOT EXISTS ers_waveforms (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id       UUID REFERENCES assets(id) ON DELETE CASCADE,
    tag            TEXT NOT NULL,
    sample_rate_hz NUMERIC NOT NULL,
    rpm            NUMERIC,
    samples        JSONB,            -- raw waveform (null when capture exceeded the storage cap)
    features       JSONB NOT NULL,   -- { time, specPeaks, envPeaks, diagnosis, n }
    captured_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waveforms_asset ON ers_waveforms(asset_id, captured_at DESC);
