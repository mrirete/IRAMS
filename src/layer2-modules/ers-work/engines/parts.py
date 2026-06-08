"""
Spare Parts Forecasting Engine
══════════════════════════════
Uses simple predictive trend aggregation and Monte Carlo sampling
to forecast spare parts consumption and highlight stockout risks.
"""
import random
from typing import List, Dict, Any
from uuid import UUID

from ers_work.schemas import PartsDemandForecast, PartForecastItem

class PartsForecastingEngine:
    """Engine for determining proactive inventory requirements."""

    def forecast_demand(
        self, 
        current_inventory: Dict[str, Dict[str, Any]], 
        historical_monthly_usage: Dict[str, float],
        horizon_days: int = 30,
        iterations: int = 1000
    ) -> PartsDemandForecast:
        """
        Calculates predictive demand over `horizon_days`.
        `current_inventory`: dict mapping part_id -> {'name': str, 'qty': int, 'lead_time': int}
        """
        items = []
        high_risk_count = 0
        horizon_months = horizon_days / 30.0

        for part_id, inv_data in current_inventory.items():
            run_rate = historical_monthly_usage.get(part_id, 0.0)
            
            # Predictive Demand
            expected_demand = run_rate * horizon_months
            
            # Monte Carlo for P90 (90th percentile pessimistic demand)
            # Assume usage follows a Poisson distribution roughly approximated by Normal
            # Mean = expected_demand, Variance roughly == Mean
            simulations = []
            for _ in range(iterations):
                # Using a rough normal approx for speed, bounded at 0
                sample = random.gauss(expected_demand, max(1.0, expected_demand**0.5))
                simulations.append(max(0, sample))
                
            simulations.sort()
            p90_demand = int(round(simulations[int(iterations * 0.90)]))
            
            # Risk calculation
            current_qty = inv_data['qty']
            lead_time = inv_data['lead_time']
            
            stockouts = [s for s in simulations if s > current_qty]
            stockout_risk_pct = (len(stockouts) / iterations) * 100.0
            
            rec = "Adequate stock."
            if stockout_risk_pct >= 25.0:
                rec = f"Order {p90_demand - current_qty + 1} units immediately to cover P90 demand."
                high_risk_count += 1
            elif stockout_risk_pct >= 5.0 and lead_time > (horizon_days / 2):
                rec = "Monitor closely. Lead time is long relative to horizon."

            items.append(PartForecastItem(
                part_id=part_id,
                part_name=inv_data['name'],
                current_stock=current_qty,
                predicted_demand_qty=round(expected_demand, 1),
                p90_demand_qty=p90_demand,
                lead_time_days=lead_time,
                stockout_risk_pct=round(stockout_risk_pct, 1),
                recommendation=rec
            ))

        items.sort(key=lambda x: x.stockout_risk_pct, reverse=True)

        return PartsDemandForecast(
            horizon_days=horizon_days,
            items=items,
            high_risk_stockouts=high_risk_count
        )
