"""
Scheduling Optimization Engine (Google OR-Tools)
════════════════════════════════════════════════
Uses constraint programming to optimize work order assignments
based on technician availability, skills, and WO priority.
"""
from datetime import datetime, timedelta
from typing import Dict, List, Any
from uuid import UUID

from ortools.sat.python import cp_model

from ers_work.schemas import (
    ScheduleInput, ScheduleResult, OptimizedTask,
    WorkOrder, ResourceAvailability, WorkOrderStatus
)

class SchedulingEngine:
    """Engine for optimizing work schedules using Google OR-Tools."""

    def optimize_schedule(self, input_data: ScheduleInput) -> ScheduleResult:
        """
        Builds and solves a CP-SAT model to assign Work Orders to technicians.
        Goal: Maximize priority-weighted completion without exceeding capacity.
        """
        model = cp_model.CpModel()
        horizon_hours = input_data.horizon_days * 24
        start_ts = int(input_data.start_date.timestamp())

        # Filter out WOs that are already scheduled or completed
        valid_wos = [wo for wo in input_data.work_orders if wo.status in (WorkOrderStatus.APPROVED, WorkOrderStatus.READY)]
        
        # ── Variables ──────────────────────────────────────────
        
        # assigns[(w, t)]: Boolean var == 1 if WO `w` is assigned to tech `t`
        assigns: Dict[tuple, cp_model.IntVar] = {}
        
        # start_time[w]: Integer var representing start time (offset in hours from start_date)
        start_times: Dict[UUID, cp_model.IntVar] = {}
        # end_time[w]: Output of start_time + duration
        end_times: Dict[UUID, cp_model.IntVar] = {}

        for wo in valid_wos:
            w_id = wo.wo_id
            dur = int(max(1, round(wo.estimated_duration_hours)))
            
            start_times[w_id] = model.NewIntVar(0, horizon_hours - dur, f"start_{w_id}")
            end_times[w_id] = model.NewIntVar(dur, horizon_hours, f"end_{w_id}")
            
            # Constraint: end = start + duration
            model.Add(end_times[w_id] == start_times[w_id] + dur)

            for tech in input_data.resources:
                # Can this tech do this WO? (Skill match)
                can_do = True
                if wo.required_skills:
                    if not set(wo.required_skills).issubset(set(tech.skills)):
                        can_do = False
                
                if can_do:
                    assigns[(w_id, tech.technician_id)] = model.NewBoolVar(f"assign_{w_id}_{tech.technician_id}")
                else:
                    # Create a boolean forced to 0
                    var = model.NewBoolVar(f"assign_{w_id}_{tech.technician_id}_fail")
                    model.Add(var == 0)
                    assigns[(w_id, tech.technician_id)] = var

            # A requested WO can be assigned to at most 1 technician
            model.Add(sum(assigns[(w_id, t.technician_id)] for t in input_data.resources) <= 1)

        # ── Constraints ────────────────────────────────────────

        # 1. Capacity Constraints: Tech total assigned hours <= available hours
        for tech in input_data.resources:
            t_id = tech.technician_id
            assigned_durations = []
            for wo in valid_wos:
                dur = int(max(1, round(wo.estimated_duration_hours)))
                assigned_durations.append(assigns[(wo.wo_id, t_id)] * dur)
            
            # Sum of assigned hours <= weekly availability (scaled to horizon)
            max_hours = int(tech.available_hours_per_week * (input_data.horizon_days / 7.0))
            model.Add(sum(assigned_durations) <= max_hours)

        # 2. Dependency Constraints
        # If WO B depends on WO A, and both are scheduled, A must end before B starts
        for wo in valid_wos:
            for dep_id in wo.dependencies:
                # Find the dependency WO in our current list
                dep_wo = next((w for w in valid_wos if w.wo_id == dep_id), None)
                if dep_wo:
                    # Only enforce if BOTH are assigned
                    # This requires auxiliary logic in CP-SAT (Implication)
                    w_is_assigned = sum(assigns[(wo.wo_id, t.technician_id)] for t in input_data.resources)
                    dep_is_assigned = sum(assigns[(dep_wo.wo_id, t.technician_id)] for t in input_data.resources)
                    
                    both_assigned = model.NewBoolVar(f"both_{wo.wo_id}_{dep_wo.wo_id}")
                    # both_assigned == 1 iff (w_is_assigned == 1 AND dep_is_assigned == 1)
                    # Using mathematical bounds since w_is_assigned is 0 or 1
                    model.Add(w_is_assigned + dep_is_assigned - 1 <= both_assigned)
                    model.Add(both_assigned <= w_is_assigned)
                    model.Add(both_assigned <= dep_is_assigned)
                    
                    # If both assigned, dep_end <= curr_start
                    model.Add(end_times[dep_wo.wo_id] <= start_times[wo.wo_id]).OnlyEnforceIf(both_assigned)

        # 3. Non-overlapping Tasks for the same technician
        # We use NoOverlap constraint. Needs interval variables.
        for tech in input_data.resources:
            t_id = tech.technician_id
            intervals = []
            for wo in valid_wos:
                dur = int(max(1, round(wo.estimated_duration_hours)))
                # Only create interval if assigned to THIS technician
                # Optional intervals in CP-SAT:
                is_present = assigns[(wo.wo_id, t_id)]
                interval = model.NewOptionalIntervalVar(
                    start_times[wo.wo_id], 
                    dur, 
                    end_times[wo.wo_id], 
                    is_present, 
                    f"interval_{wo.wo_id}_{t_id}"
                )
                intervals.append(interval)
            
            if intervals:
                model.AddNoOverlap(intervals)

        # ── Objective ──────────────────────────────────────────

        # Maximize: Sum(Assignment * PriorityWeight) - Sum(Assignment * ExpectedCost)
        objective_terms = []
        for wo in valid_wos:
            # Priority scale: Emergency(1) = highest weight, Low(5) = lowest weight
            # Weight formula: (6 - priority) * user_multiplier
            weight = (6 - wo.priority.value) * int(input_data.maximize_priority_weight)
            dur = int(max(1, round(wo.estimated_duration_hours)))
            
            for tech in input_data.resources:
                cost = int(tech.hourly_cost * dur)
                # We want to maximize weight and minimize cost
                term_val = weight - cost
                objective_terms.append(assigns[(wo.wo_id, tech.technician_id)] * term_val)
                
        model.Maximize(sum(objective_terms))

        # ── Solve ─────────────────────────────────────────────

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5.0  # Limit solve time
        status = solver.Solve(model)

        status_str = solver.StatusName(status)
        
        assigned_tasks = []
        unassigned_wos = []
        tech_assigned_hours = {t.technician_id: 0.0 for t in input_data.resources}

        if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            for wo in valid_wos:
                is_assigned = False
                for tech in input_data.resources:
                    if solver.Value(assigns[(wo.wo_id, tech.technician_id)]) == 1:
                        is_assigned = True
                        dur = wo.estimated_duration_hours
                        start_offset = solver.Value(start_times[wo.wo_id])
                        
                        start_dt = input_data.start_date + timedelta(hours=start_offset)
                        end_dt = start_dt + timedelta(hours=dur)
                        
                        assigned_tasks.append(OptimizedTask(
                            wo_id=wo.wo_id,
                            wo_code=wo.code,
                            assigned_technician_id=tech.technician_id,
                            technician_name=tech.name,
                            scheduled_start=start_dt,
                            scheduled_end=end_dt,
                            estimated_hours=dur
                        ))
                        tech_assigned_hours[tech.technician_id] += dur
                        break
                
                if not is_assigned:
                    unassigned_wos.append(wo.wo_id)
        else:
            # If infeasible or unknown, all are unassigned
            unassigned_wos = [w.wo_id for w in valid_wos]

        # Calculate Utilization
        utilization = {}
        for tech in input_data.resources:
            max_h = tech.available_hours_per_week * (input_data.horizon_days / 7.0)
            if max_h > 0:
                utilization[tech.technician_id] = round((tech_assigned_hours[tech.technician_id] / max_h) * 100.0, 1)
            else:
                utilization[tech.technician_id] = 0.0

        return ScheduleResult(
            start_date=input_data.start_date,
            end_date=input_data.start_date + timedelta(days=input_data.horizon_days),
            tasks=assigned_tasks,
            unassigned_wos=unassigned_wos,
            total_scheduled_hours=sum(tech_assigned_hours.values()),
            resource_utilization=utilization,
            solver_status=status_str,
            explanation=f"Solved with status: {status_str}. Scheduled {len(assigned_tasks)} out of {len(valid_wos)} eligible WOs."
        )
