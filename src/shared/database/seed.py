import os
import sys
from datetime import datetime, timedelta
import random
import uuid

# Add the src directory to the path so we can import our models
sys.path.insert(0, os.path.realpath(os.path.join(os.path.dirname(__file__), '../../..')))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from shared.database.models import (
    Base, Asset, DataQualityScore, DataSource, EquipmentRegistry,
    ConditionMonitoringLocation, ThicknessReading
)

# Use the environment variable if available, otherwise default to local
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/ers")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def seed_data():
    session = SessionLocal()
    
    print("Seeding Data Sources...")
    source = DataSource(
        name="Primary CMMS",
        source_type="cmms",
        status="active",
        sync_interval_seconds=3600
    )
    session.add(source)
    session.commit()
    session.refresh(source)

    print("Seeding Data Fabric (5 Pumps)...")
    plant = Asset(name="Plant A", asset_class="Plant", criticality_rank="A")
    session.add(plant)
    session.commit()
    session.refresh(plant)

    unit = Asset(name="Unit 1", asset_class="Unit", criticality_rank="A", parent_asset_id=plant.id)
    session.add(unit)
    session.commit()
    session.refresh(unit)

    pumps = []
    for i in range(1, 6):
        pump = Asset(
            name=f"Pump P-{100+i}",
            external_id=f"EXT-P-{100+i}",
            asset_class="Pump",
            criticality_rank=random.choice(['A', 'B', 'C']),
            parent_asset_id=unit.id,
            taxonomy_code="ISO-14224-PUMP",
            commissioning_date=datetime.utcnow() - timedelta(days=random.randint(1000, 5000)),
            design_life_years=20
        )
        pumps.append(pump)
        session.add(pump)
    
    session.commit()

    for pump in pumps:
        dqs = DataQualityScore(
            asset_id=pump.id,
            source_id=source.id,
            record_type="equipment",
            completeness=random.uniform(80.0, 100.0),
            accuracy=random.uniform(85.0, 95.0),
            timeliness=random.uniform(90.0, 100.0),
            consistency=random.uniform(70.0, 99.0),
        )
        dqs.composite = (dqs.completeness + dqs.accuracy + dqs.timeliness + dqs.consistency) / 4.0
        session.add(dqs)

    session.commit()

    print("Seeding AIM Data (20 Vessels, 15 Piping Circuits, 5 Tanks)...")
    # 20 Pressure Vessels
    for i in range(1, 21):
        vessel = Asset(
            name=f"Vessel V-{200+i}", asset_class="Pressure Vessel", 
            criticality_rank=random.choice(['A', 'B']), parent_asset_id=unit.id
        )
        session.add(vessel)
        session.commit()
        session.refresh(vessel)

        reg = EquipmentRegistry(
            asset_id=vessel.id, governing_code="api_510",
            design_pressure=random.uniform(100, 500),
            design_temperature=random.uniform(100, 400),
            nominal_thickness=0.5, corrosion_allowance=0.125
        )
        session.add(reg)
        session.commit()
        session.refresh(reg)

        # 2 CMLs per vessel with thickness readings
        for j in range(2):
            cml = ConditionMonitoringLocation(
                equipment_id=reg.id, cml_number=f"CML-V{200+i}-{j+1}",
                component_type="shell", nominal_thickness=0.5,
                retirement_thickness=0.25, min_required_thickness=0.25
            )
            session.add(cml)
            session.commit()
            session.refresh(cml)

            # Add historical readings
            for k in range(5):
                reading = ThicknessReading(
                    cml_id=cml.id,
                    reading_date=datetime.utcnow() - timedelta(days=1000 - (k*200)),
                    measured_thickness=0.5 - (k * random.uniform(0.005, 0.015)),
                    method="ut_contact"
                )
                session.add(reading)
        session.commit()

    # 15 Piping Circuits
    for i in range(1, 16):
        piping = Asset(
            name=f"Piping Circuit PC-{300+i}", asset_class="Piping", 
            criticality_rank='B', parent_asset_id=unit.id
        )
        session.add(piping)
        session.commit()
        session.refresh(piping)

        reg = EquipmentRegistry(
            asset_id=piping.id, governing_code="api_570",
            nominal_thickness=0.375, corrosion_allowance=0.0625
        )
        session.add(reg)
        session.commit()

    # 5 Storage Tanks
    for i in range(1, 6):
        tank = Asset(
            name=f"Tank TK-{400+i}", asset_class="Storage Tank", 
            criticality_rank='A', parent_asset_id=plant.id
        )
        session.add(tank)
        session.commit()
        session.refresh(tank)

        reg = EquipmentRegistry(
            asset_id=tank.id, governing_code="api_653",
            nominal_thickness=0.75, corrosion_allowance=0.125
        )
        session.add(reg)
        session.commit()

    print("Seeding complete.")

if __name__ == "__main__":
    seed_data()
