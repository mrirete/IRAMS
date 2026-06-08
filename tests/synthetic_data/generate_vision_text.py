import random

def generate_vision_descriptions(count=200):
    """
    Generates text descriptions simulating what Claude Opus 4.6 Vision 
    would extract from 200 different inspection photos.
    """
    conditions = [
        "severe uniform corrosion with heavy flaking",
        "minor surface rust, coating intact but fading",
        "deep localized pitting near the weld seam",
        "thermal insulation missing, exposed metal showing signs of CUI",
        "visible crack extending approximately 2 inches from the nozzle attachment",
        "clean surface, no visible degradation",
        "oil leak detected at the mechanical seal interface",
        "heavy crystalline deposit buildup on the valve stem",
        "refractory lining exhibiting spider web cracking and a 3-inch spall",
        "bolts showing active galvanic corrosion"
    ]
    
    severities = ["Critical", "Warning", "Normal", "Unknown"]
    
    records = []
    for i in range(count):
        desc = random.choice(conditions)
        # Add some noise to make it realistic
        num = random.randint(1, 100)
        desc += f" (Location marker: L-{num})"
        
        # Determine expected severity for the integration test to assert against
        expected_sev = "Critical" if "crack" in desc.lower() or "severe" in desc.lower() else "Warning" if "leak" in desc.lower() or "CUI" in desc else "Normal"
        
        records.append({
            "photo_id": f"IMG-{10000+i}",
            "simulated_vision_text": desc,
            "expected_classification": expected_sev
        })
        
    return records
