import random

def generate_thickness_data(vessel_count=20, piping_count=15, tank_count=5):
    """Generates thickness readings for RBI and FFS analysis"""
    readings = []
    
    # Generate 3 years of UT readings
    for i in range(vessel_count):
        t_nom = random.uniform(10.0, 25.0)
        t_min = t_nom * 0.6 # Retire thickness
        current_t = t_nom
        
        for yr in range(3):
            loss = random.uniform(0.1, 0.4)
            current_t -= loss
            readings.append({
                "asset_id": f"VESSEL-{100+i}",
                "cml_id": f"CML-V{i}-1",
                "inspection_date": f"{2024-yr}-06-15",
                "thickness_reading": round(current_t, 2),
                "t_min": round(t_min, 2)
            })
            
    # Add some piping and tank mock data
    for i in range(piping_count):
        readings.append({
            "asset_id": f"PIPE-{200+i}",
            "cml_id": f"CML-P{i}-1",
            "inspection_date": "2024-01-10",
            "thickness_reading": round(random.uniform(5.0, 12.0), 2),
            "t_min": 3.2
        })
        
    for i in range(tank_count):
        readings.append({
            "asset_id": f"TANK-{300+i}",
            "cml_id": f"FLOOR-T{i}",
            "inspection_date": "2023-11-20",
            "thickness_reading": round(random.uniform(4.0, 8.0), 2),
            "t_min": 3.0
        })

    return readings

def generate_ffs_test_cases():
    """10 FFS Level 1 test cases (API 579) with known Pass/Fail outcomes"""
    return [
        {"case_id": "FFS-01", "type": "General Metal Loss", "t_min": 5.0, "t_measured": 4.8, "expected_result": "FAIL"},
        {"case_id": "FFS-02", "type": "General Metal Loss", "t_min": 5.0, "t_measured": 5.2, "expected_result": "PASS"},
        {"case_id": "FFS-03", "type": "Local Metal Loss", "t_min": 5.0, "t_measured": 4.5, "length": 10, "expected_result": "PASS"}, # Short flaw
        {"case_id": "FFS-04", "type": "Local Metal Loss", "t_min": 5.0, "t_measured": 4.5, "length": 500, "expected_result": "FAIL"}, # Long flaw
        {"case_id": "FFS-05", "type": "Pitting", "t_min": 3.0, "widespread": True, "expected_result": "FAIL"},
        {"case_id": "FFS-06", "type": "Pitting", "t_min": 3.0, "widespread": False, "depth": 0.5, "expected_result": "PASS"},
        {"case_id": "FFS-07", "type": "Crack-Like Flaw", "length": 10, "depth": 2, "expected_result": "FAIL"}, # Level 1 often fails cracks immediately
        {"case_id": "FFS-08", "type": "Crack-Like Flaw", "length": 50, "depth": 5, "expected_result": "FAIL"},
        {"case_id": "FFS-09", "type": "Blister", "diameter": 15, "distance_from_weld": 100, "expected_result": "PASS"},
        {"case_id": "FFS-10", "type": "Blister", "diameter": 55, "distance_from_weld": 10, "expected_result": "FAIL"},
    ]

def generate_damage_mechanisms():
    """100 damage mechanism scenarios"""
    dms = ["CUI", "Erosion", "Chloride SCC", "Sulfidation", "HIC", "Fatigue", "Creep"]
    return [{"id": f"DM-SCENARIO-{i}", "primary_dm": random.choice(dms), "susceptibility": random.choice(["Low", "Medium", "High"])} for i in range(100)]
