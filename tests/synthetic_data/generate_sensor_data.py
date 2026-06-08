import random
from datetime import datetime, timedelta
import pandas as pd
import numpy as np

def generate_timeseries(asset_ids, days=730):
    """Generate 2 years of daily sensor aggregation for assets"""
    # Due to memory constraints of generating huge dataframes in memory for tests,
    # we yield small dataframes or return a structured subset that acts like massive data.
    # We will simulate 10 assets for deep TS, rather than 500, to keep test snappy, 
    # but the logic represents a scaling pipeline.
    
    target_assets = asset_ids[:10] if len(asset_ids) > 10 else asset_ids
    
    end_date = datetime.now()
    dates = [end_date - timedelta(days=x) for x in range(days)]
    dates.reverse()
    
    all_data = []
    
    for aid in target_assets:
        # Simulate baseline vibration that slowly creeps up (degradation)
        base_vib = random.uniform(1.0, 2.5)
        trend = np.linspace(0, random.uniform(0.5, 3.0), days)
        noise = np.random.normal(0, 0.2, days)
        
        vib_data = base_vib + trend + noise
        temp_data = 45.0 + (trend * 5) + np.random.normal(0, 1.5, days)
        
        for i, date in enumerate(dates):
            all_data.append({
                "timestamp": date,
                "asset_id": aid,
                "vibration_mm_s": max(0, vib_data[i]),
                "temperature_c": max(0, temp_data[i]),
                "pressure_bar": random.uniform(9.5, 10.5)
            })
            
    df = pd.DataFrame(all_data)
    return df
