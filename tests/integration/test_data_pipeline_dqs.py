import pytest
import pandas as pd
from layer1_data_fabric_quality_engine import compute_dqs
from uuid import uuid4
from datetime import datetime, timezone
from tests.synthetic_data.generate_work_history import generate_work_orders
from tests.synthetic_data.generate_sensor_data import generate_timeseries
from tests.synthetic_data.generate_assets_neo4j import generate_assets

@pytest.fixture
def mock_pipeline_data():
    asset_data = generate_assets(num_units=1, total_assets=50)
    asset_ids = [n["id"] for n in asset_data["nodes"] if n["type"] == "Asset"]
    wos = generate_work_orders(asset_ids, num_wos=1000, days_history=365)
    
    # take subset for timeseries
    ts_df = generate_timeseries(asset_ids[:5], days=30)
    return {"assets": asset_ids, "wos": wos, "ts": ts_df}
    
def test_dqs_scoring_logic(mock_pipeline_data):
    """Integrates DQS Engine against a synthetic record"""
    df = mock_pipeline_data["ts"]
    
    # Introduce anomalies deliberately to test DQS penalties
    row = df.iloc[5].to_dict()
    row["temperature_c"] = 9999.0  # Massive outlier
    
    # Calculate DQS
    result = compute_dqs(
        asset_id=uuid4(),
        record=row,
        record_type="timeseries",
        asset_class="Pump",
        last_sync_at=datetime.now(tz=timezone.utc),
        source_type="Historian",
        consistent_refs=1,
        total_refs=1
    )
    
    # Score should be < 100 due to accuracy penalties
    assert result.composite_score < 100
    accuracy_dim = next((d for d in result.dimensions if d.dimension == "accuracy"), None)
    assert accuracy_dim.score < 100
