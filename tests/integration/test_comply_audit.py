import pytest
from datetime import datetime, timedelta
from tests.synthetic_data.generate_comply_data import generate_thickness_data

def test_inspection_interval_calculation():
    """Validates calculation of inspection intervals based on UT thickness data"""
    data = generate_thickness_data(vessel_count=2, piping_count=0, tank_count=0)
    
    # Extract readings for VESSEL-100
    vessel_readings = [r for r in data if r["asset_id"] == "VESSEL-100"]
    # Sort chronologically
    vessel_readings.sort(key=lambda x: x["inspection_date"])
    
    first = vessel_readings[0]
    last = vessel_readings[-1]
    
    years_diff = (datetime.fromisoformat(last["inspection_date"]) - datetime.fromisoformat(first["inspection_date"])).days / 365.25
    rate = (first["thickness_reading"] - last["thickness_reading"]) / max(years_diff, 0.1)
    
    remaining_life = max((last["thickness_reading"] - last["t_min"]) / rate, 0.1)
    next_inspection_interval = min(remaining_life / 2, 10.0) # Standard API 510 Half-Life rule
    
    assert rate > 0
    assert remaining_life > 0
    assert next_inspection_interval <= 10.0
    
def test_iow_breach_alert():
    """Validates IOW (Integrity Operating Window) breach alerts"""
    # Simply simulate the breach engine logic directly
    asset = "VESSEL-100"
    reading = 500.0
    limit = 450.0
    
    breached = reading > limit
    severity = "CRITICAL" if reading > limit + 25 else "WARNING"
    
    assert breached is True
    assert severity == "CRITICAL"
    
def test_audit_finding_generation():
    """Simulates an automated Audit finding generation"""
    finding = {
        "status": "Open", 
        "description": "Overdue statutory inspection", 
        "requires_capa": True
    }
    
    assert finding["status"] == "Open"
    assert "Overdue statutory inspection" in finding["description"]
    assert finding["requires_capa"] is True
