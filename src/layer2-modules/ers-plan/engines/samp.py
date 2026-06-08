"""
SAMP Engine
═══════════
Strategic Asset Management Plan lifecycle, objective management,
KPI formula validation with safe expression evaluation.
"""
import ast
import operator
import re
from datetime import datetime
from typing import Dict, List, Optional
from uuid import UUID, uuid4

from ers_plan.schemas import (
    SAMPTemplate, SAMPStatus, StrategicObjective,
    KPIDefinition, KPIDirection, LOSNode, LOSTree, LOSLevel
)

# Allowed operators for safe KPI formula evaluation
_SAFE_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
}

_SAFE_FUNCTIONS = {"abs": abs, "min": min, "max": max, "round": round}


class SAMPEngine:
    """Engine for SAMP template lifecycle, KPI validation, and Line-of-Sight."""

    def __init__(self):
        self._samps: Dict[UUID, SAMPTemplate] = {}
        self._los_trees: Dict[UUID, LOSTree] = {}

    # ── SAMP CRUD ──────────────────────────────────────────

    def create_samp(self, title: str, horizon_years: int = 5) -> SAMPTemplate:
        samp = SAMPTemplate(title=title, planning_horizon_years=horizon_years)
        self._samps[samp.samp_id] = samp
        return samp

    def get_samp(self, samp_id: UUID) -> Optional[SAMPTemplate]:
        return self._samps.get(samp_id)

    def add_objective(self, samp_id: UUID, objective: StrategicObjective) -> SAMPTemplate:
        samp = self._samps.get(samp_id)
        if not samp:
            raise ValueError(f"SAMP {samp_id} not found")
        samp.objectives.append(objective)
        samp.updated_at = datetime.utcnow()
        return samp

    def approve_samp(self, samp_id: UUID, approver_id: UUID) -> SAMPTemplate:
        samp = self._samps.get(samp_id)
        if not samp:
            raise ValueError(f"SAMP {samp_id} not found")
        samp.status = SAMPStatus.APPROVED
        samp.approved_by = approver_id
        samp.updated_at = datetime.utcnow()
        return samp

    # ── KPI Formula Validation ─────────────────────────────

    def validate_kpi_formula(self, kpi: KPIDefinition, test_values: Optional[Dict[str, float]] = None) -> Dict:
        """
        Validates a KPI formula for syntax correctness and evaluates
        with test values if provided. Uses safe AST evaluation.
        """
        result = {"valid": False, "formula": kpi.formula, "error": None, "computed_value": None}

        # Extract variable names from formula
        detected_vars = set(re.findall(r'\b([a-zA-Z_]\w*)\b', kpi.formula))
        detected_vars -= set(_SAFE_FUNCTIONS.keys())

        if kpi.variables:
            missing = set(kpi.variables) - detected_vars
            if missing:
                result["error"] = f"Declared variables not found in formula: {missing}"
                return result

        try:
            ast.parse(kpi.formula, mode='eval')
        except SyntaxError as e:
            result["error"] = f"Syntax error: {e}"
            return result

        if test_values:
            try:
                computed = self._safe_eval(kpi.formula, test_values)
                result["computed_value"] = round(computed, 4)
            except Exception as e:
                result["error"] = f"Evaluation error: {e}"
                return result

        result["valid"] = True
        return result

    def _safe_eval(self, formula: str, variables: Dict[str, float]) -> float:
        """AST-based safe evaluation — no exec/eval, only math ops."""
        tree = ast.parse(formula, mode='eval')
        return self._eval_node(tree.body, variables)

    def _eval_node(self, node: ast.AST, variables: Dict[str, float]) -> float:
        if isinstance(node, ast.Constant):
            if isinstance(node.value, (int, float)):
                return float(node.value)
            raise ValueError(f"Unsupported constant: {node.value}")

        if isinstance(node, ast.Name):
            if node.id in _SAFE_FUNCTIONS:
                return _SAFE_FUNCTIONS[node.id]
            if node.id in variables:
                return variables[node.id]
            raise ValueError(f"Unknown variable: {node.id}")

        if isinstance(node, ast.BinOp):
            op_func = _SAFE_OPS.get(type(node.op))
            if not op_func:
                raise ValueError(f"Unsupported operator: {type(node.op).__name__}")
            return op_func(self._eval_node(node.left, variables), self._eval_node(node.right, variables))

        if isinstance(node, ast.UnaryOp):
            op_func = _SAFE_OPS.get(type(node.op))
            if not op_func:
                raise ValueError(f"Unsupported unary op: {type(node.op).__name__}")
            return op_func(self._eval_node(node.operand, variables))

        if isinstance(node, ast.Call):
            func = self._eval_node(node.func, variables)
            args = [self._eval_node(a, variables) for a in node.args]
            if callable(func):
                return func(*args)
            raise ValueError(f"Not callable: {func}")

        raise ValueError(f"Unsupported AST node: {type(node).__name__}")

    # ── Line-of-Sight ──────────────────────────────────────

    def build_line_of_sight(self, samp_id: UUID, nodes: List[LOSNode]) -> LOSTree:
        """Builds a Line-of-Sight tree from Board -> Department -> Asset KPIs."""
        tree = LOSTree(samp_id=samp_id, nodes=nodes)
        self._los_trees[samp_id] = tree
        return tree

    def get_line_of_sight(self, samp_id: UUID) -> Optional[LOSTree]:
        return self._los_trees.get(samp_id)

    def evaluate_los_kpis(self, samp_id: UUID, actuals: Dict[UUID, Dict[str, float]]) -> LOSTree:
        """
        Evaluates KPI formulas across the LoS tree using actual values.
        actuals: {node_id: {variable_name: value}}
        """
        tree = self._los_trees.get(samp_id)
        if not tree:
            raise ValueError(f"LoS tree for SAMP {samp_id} not found")

        for node in tree.nodes:
            node_actuals = actuals.get(node.node_id, {})
            for kpi in node.kpis:
                try:
                    val = self._safe_eval(kpi.formula, node_actuals)
                    node.actual_values[kpi.name] = round(val, 4)
                except Exception:
                    node.actual_values[kpi.name] = -1.0  # Signal error

        return tree
