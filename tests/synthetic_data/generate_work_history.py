import random
from datetime import datetime, timedelta

def generate_work_orders(asset_ids, num_wos=36000, days_history=1825):
    """Generates 36K work orders distributed over a timeline"""
    wos = []
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days_history)
    
    types = ["PM", "CM", "EM", "PdM", "CBM"]
    statuses = ["CLOSED", "CLOSED", "CLOSED", "COMPLETED", "IN_PROGRESS", "OPEN"]
    
    for i in range(num_wos):
        random_days = random.randint(0, days_history)
        created_at = start_date + timedelta(days=random_days)
        
        wo_type = random.choice(types)
        status = random.choice(statuses)
        asset_id = random.choice(asset_ids)
        
        # Simulate cost
        materials_cost = round(random.uniform(50, 5000), 2)
        labor_hours = random.choice([1, 2, 4, 8, 12, 24])
        labor_cost = labor_hours * 75.0
        
        wos.append({
            "wo_id": f"WO-{1000000 + i}",
            "asset_id": asset_id,
            "type": wo_type,
            "status": status,
            "created_at": created_at.isoformat(),
            "closed_at": (created_at + timedelta(days=random.randint(1, 14))).isoformat() if status in ["CLOSED", "COMPLETED"] else None,
            "total_cost": materials_cost + labor_cost,
            "failure_mode": f"FM_MOCK_{random.randint(1,10)}" if wo_type in ["CM", "EM"] else None
        })
        
    return wos

def generate_rcas(asset_ids, num_rcas=50):
    rcas = []
    for i in range(num_rcas):
        rcas.append({
            "rca_id": f"RCA-{100 + i}",
            "asset_id": random.choice(asset_ids),
            "trigger": "High Downtime",
            "root_cause_summary": "Bearing failed due to chronic misalignment from weak baseplate.",
            "status": random.choice(["Draft", "In Review", "Approved", "Closed"]),
            "action_items": random.randint(1, 5)
        })
    return rcas
