import pytest
import pandas as pd
from ers_predict.models.physics_informed import PhysicsInformedModel
from ers_predict.features.time_series import SeriesFeatures
from tests.synthetic_data.generate_sensor_data import generate_timeseries

@pytest.fixture
def twin_data():
    asset_id = "PUMP-1002"
    df = generate_timeseries([asset_id], days=365)
    return asset_id, df

def test_digital_twin_what_if_scenario(twin_data):
    """Tests the twin simulation logic when operating parameters change"""
    asset_id, df = twin_data
    physics_model = PhysicsInformedModel(asset_class="pump")
    
    # We must mock the feature vector since we are bypassing the db
    class MockOpFeatures:
        running_hours = 10000.0
        load_factor = 0.8
        ambient_temp_delta = 5.0
        
    class MockFeatureVector:
        operational = MockOpFeatures()
        
    base_features = MockFeatureVector()
    
    # Baseline
    base_prediction = physics_model.predict(base_features)
    base_health = base_prediction["value"]
    
    # Simulate harsher conditions: increase temp
    harsh_features = MockFeatureVector()
    harsh_features.operational.ambient_temp_delta = 50.0 # Huge temp spike
    
    harsh_prediction = physics_model.predict(harsh_features)
    harsh_health = harsh_prediction["value"]
    
    # Health should decrease under harsher simulated conditions
    assert harsh_health < base_health
