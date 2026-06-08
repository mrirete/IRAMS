import random

def generate_assets(num_units=4, total_assets=500):
    """Generates a hierarchical asset structure representing 500 assets across 4 units."""
    units = [f"UNIT-{i+1}" for i in range(num_units)]
    systems = ["Pump System", "Compressor System", "Heating System", "Cooling System", "Conveyor System"]
    asset_types = ["Pump", "Motor", "Valve", "Heat Exchanger", "Compressor", "Vessel", "Piping", "Tank"]
    
    nodes = []
    edges = []
    
    # Create Units
    for unit in units:
        nodes.append({"id": unit, "type": "Unit", "label": unit})
    
    asset_count = 0
    while asset_count < total_assets:
        unit = random.choice(units)
        sys_type = random.choice(systems)
        sys_id = f"{unit}-{sys_type.replace(' ', '')}-{random.randint(100, 999)}"
        
        if sys_id not in [n["id"] for n in nodes]:
            nodes.append({"id": sys_id, "type": "System", "label": sys_type})
            edges.append({"source": sys_id, "target": unit, "rel": "PART_OF"})
        
        # Add 3-5 assets per system
        for _ in range(random.randint(3, 5)):
            if asset_count >= total_assets:
                break
                
            atype = random.choice(asset_types)
            asset_id = f"{atype[:3].upper()}-{random.randint(1000, 9999)}"
            crit = random.choice(["A", "A", "B", "C"]) # weighted towards A/B
            
            nodes.append({
                "id": asset_id, 
                "type": "Asset", 
                "label": atype, 
                "criticality": crit,
                "status": "Active"
            })
            edges.append({"source": asset_id, "target": sys_id, "rel": "PART_OF"})
            asset_count += 1

    return {"nodes": nodes, "edges": edges}

def generate_competency_nodes():
    return [
        {"id": "john_doe", "type": "Person", "role": "Senior Technician", "cert": "API 510"},
        {"id": "jane_smith", "type": "Person", "role": "Reliability Engineer", "cert": "Reliability Leader"},
        {"id": "bob_jones", "type": "Person", "role": "Inspector", "cert": "NDT Level 2"}
    ]

def generate_failure_causes():
    causes = ["Misalignment", "Unbalance", "Lubrication Failure", "Fatigue", "Corrosion", "Erosion"]
    nodes = [{"id": f"FC_{i}", "type": "FailureCause", "label": c} for i, c in enumerate(causes)]
    return nodes
