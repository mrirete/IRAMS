"""
conftest.py — makes the hyphenated layer directories importable for pytest.
"""
import importlib
import importlib.util
import sys
import os
from pathlib import Path

# Add the ERS src root to sys.path
SRC_DIR = Path(__file__).resolve().parent.parent / "src"
sys.path.insert(0, str(SRC_DIR))


def _register_ers_predict():
    """Register ers-predict as ers_predict before test collection."""
    _ERS_PREDICT_DIR = SRC_DIR / "layer2-modules" / "ers-predict"
    if not _ERS_PREDICT_DIR.exists():
        return

    _init = _ERS_PREDICT_DIR / "__init__.py"
    if not _init.exists():
        return

    # Register parent so submodule imports work
    sys.path.insert(0, str(_ERS_PREDICT_DIR.parent))

    # Register the top-level package
    spec = importlib.util.spec_from_file_location(
        "ers_predict",
        str(_init),
        submodule_search_locations=[str(_ERS_PREDICT_DIR)],
    )
    if spec and spec.loader:
        mod = importlib.util.module_from_spec(spec)
        sys.modules["ers_predict"] = mod
        spec.loader.exec_module(mod)

    # Pre-register subpackages so chained imports work
    subpackages = [
        "features", "models", "sparse", "distributions", "alerts", "twin",
    ]
    for sub in subpackages:
        sub_dir = _ERS_PREDICT_DIR / sub
        sub_init = sub_dir / "__init__.py"
        if sub_init.exists():
            sub_spec = importlib.util.spec_from_file_location(
                f"ers_predict.{sub}",
                str(sub_init),
                submodule_search_locations=[str(sub_dir)],
            )
            if sub_spec and sub_spec.loader:
                sub_mod = importlib.util.module_from_spec(sub_spec)
                sys.modules[f"ers_predict.{sub}"] = sub_mod
                sub_spec.loader.exec_module(sub_mod)


# Run immediately at conftest import time (before collection)
_register_ers_predict()


def _register_ers_analyze():
    """Register ers-analyze as ers_analyze before test collection."""
    _ERS_ANALYZE_DIR = SRC_DIR / "layer2-modules" / "ers-analyze"
    if not _ERS_ANALYZE_DIR.exists():
        return

    _init = _ERS_ANALYZE_DIR / "__init__.py"
    if not _init.exists():
        return

    sys.path.insert(0, str(_ERS_ANALYZE_DIR.parent))

    spec = importlib.util.spec_from_file_location(
        "ers_analyze",
        str(_init),
        submodule_search_locations=[str(_ERS_ANALYZE_DIR)],
    )
    if spec and spec.loader:
        mod = importlib.util.module_from_spec(spec)
        sys.modules["ers_analyze"] = mod
        spec.loader.exec_module(mod)

    subpackages = [
        "rcm", "monte_carlo", "fmea", "rca", "criticality",
        "bad_actor", "defect_elimination", "oee",
    ]
    for sub in subpackages:
        sub_dir = _ERS_ANALYZE_DIR / sub
        sub_init = sub_dir / "__init__.py"
        if sub_init.exists():
            sub_spec = importlib.util.spec_from_file_location(
                f"ers_analyze.{sub}",
                str(sub_init),
                submodule_search_locations=[str(sub_dir)],
            )
            if sub_spec and sub_spec.loader:
                sub_mod = importlib.util.module_from_spec(sub_spec)
                sys.modules[f"ers_analyze.{sub}"] = sub_mod
                sub_spec.loader.exec_module(sub_mod)


_register_ers_analyze()


def _register_ers_comply():
    """Register ers-comply as ers_comply before test collection."""
    _ERS_COMPLY_DIR = SRC_DIR / "layer2-modules" / "ers-comply"
    if not _ERS_COMPLY_DIR.exists():
        return

    _init = _ERS_COMPLY_DIR / "__init__.py"
    if not _init.exists():
        return

    sys.path.insert(0, str(_ERS_COMPLY_DIR.parent))

    spec = importlib.util.spec_from_file_location(
        "ers_comply",
        str(_init),
        submodule_search_locations=[str(_ERS_COMPLY_DIR)],
    )
    if spec and spec.loader:
        mod = importlib.util.module_from_spec(spec)
        sys.modules["ers_comply"] = mod
        spec.loader.exec_module(mod)

    subpackages = [
        "inspection", "corrosion", "ffs", "damage_mech", "iow", "regulatory", "audit",
    ]
    for sub in subpackages:
        sub_dir = _ERS_COMPLY_DIR / sub
        sub_init = sub_dir / "__init__.py"
        if sub_init.exists():
            sub_spec = importlib.util.spec_from_file_location(
                f"ers_comply.{sub}",
                str(sub_init),
                submodule_search_locations=[str(sub_dir)],
            )
            if sub_spec and sub_spec.loader:
                sub_mod = importlib.util.module_from_spec(sub_spec)
                sys.modules[f"ers_comply.{sub}"] = sub_mod
                sub_spec.loader.exec_module(sub_mod)


_register_ers_comply()


def _register_ers_people():
    """Register ers-people as ers_people before test collection."""
    _ERS_PEOPLE_DIR = SRC_DIR / "layer2-modules" / "ers-people"
    if not _ERS_PEOPLE_DIR.exists():
        return

    _init = _ERS_PEOPLE_DIR / "__init__.py"
    if not _init.exists():
        return

    sys.path.insert(0, str(_ERS_PEOPLE_DIR.parent))

    spec = importlib.util.spec_from_file_location(
        "ers_people",
        str(_init),
        submodule_search_locations=[str(_ERS_PEOPLE_DIR)],
    )
    if spec and spec.loader:
        mod = importlib.util.module_from_spec(spec)
        sys.modules["ers_people"] = mod
        spec.loader.exec_module(mod)

    subpackages = ["engines"]
    for sub in subpackages:
        sub_dir = _ERS_PEOPLE_DIR / sub
        sub_init = sub_dir / "__init__.py"
        if sub_init.exists():
            sub_spec = importlib.util.spec_from_file_location(
                f"ers_people.{sub}",
                str(sub_init),
                submodule_search_locations=[str(sub_dir)],
            )
            if sub_spec and sub_spec.loader:
                sub_mod = importlib.util.module_from_spec(sub_spec)
                sys.modules[f"ers_people.{sub}"] = sub_mod
                sub_spec.loader.exec_module(sub_mod)


_register_ers_people()
def _register_ers_vision():
    """Register ers-vision as ers_vision before test collection."""
    _ERS_VISION_DIR = SRC_DIR / "layer2-modules" / "ers-vision"
    if not _ERS_VISION_DIR.exists():
        return

    _init = _ERS_VISION_DIR / "__init__.py"
    if not _init.exists():
        return

    sys.path.insert(0, str(_ERS_VISION_DIR.parent))

    spec = importlib.util.spec_from_file_location(
        "ers_vision",
        str(_init),
        submodule_search_locations=[str(_ERS_VISION_DIR)],
    )
    if spec and spec.loader:
        mod = importlib.util.module_from_spec(spec)
        sys.modules["ers_vision"] = mod
        spec.loader.exec_module(mod)

    subpackages = [
        "corrosion", "thermal", "condition", "tagging", "drone", "comparison",
    ]
    for sub in subpackages:
        sub_dir = _ERS_VISION_DIR / sub
        sub_init = sub_dir / "__init__.py"
        if sub_init.exists():
            sub_spec = importlib.util.spec_from_file_location(
                f"ers_vision.{sub}",
                str(sub_init),
                submodule_search_locations=[str(sub_dir)],
            )
            if sub_spec and sub_spec.loader:
                sub_mod = importlib.util.module_from_spec(sub_spec)
                sys.modules[f"ers_vision.{sub}"] = sub_mod
                sub_spec.loader.exec_module(sub_mod)
_register_ers_vision()


def _register_ers_sustain():
    """Register ers-sustain as ers_sustain before test collection."""
    _ERS_SUSTAIN_DIR = SRC_DIR / "layer2-modules" / "ers-sustain"
    if not _ERS_SUSTAIN_DIR.exists():
        return

    _init = _ERS_SUSTAIN_DIR / "__init__.py"
    if not _init.exists():
        return

    sys.path.insert(0, str(_ERS_SUSTAIN_DIR.parent))

    spec = importlib.util.spec_from_file_location(
        "ers_sustain",
        str(_init),
        submodule_search_locations=[str(_ERS_SUSTAIN_DIR)],
    )
    if spec and spec.loader:
        mod = importlib.util.module_from_spec(spec)
        sys.modules["ers_sustain"] = mod
        spec.loader.exec_module(mod)

    subpackages = ["engines"]
    for sub in subpackages:
        sub_dir = _ERS_SUSTAIN_DIR / sub
        sub_init = sub_dir / "__init__.py"
        if sub_init.exists():
            sub_spec = importlib.util.spec_from_file_location(
                f"ers_sustain.{sub}",
                str(sub_init),
                submodule_search_locations=[str(sub_dir)],
            )
            if sub_spec and sub_spec.loader:
                sub_mod = importlib.util.module_from_spec(sub_spec)
                sys.modules[f"ers_sustain.{sub}"] = sub_mod
                sub_spec.loader.exec_module(sub_mod)


_register_ers_sustain()


def _register_ers_plan():
    """Register ers-plan as ers_plan before test collection."""
    _ERS_PLAN_DIR = SRC_DIR / "layer2-modules" / "ers-plan"
    if not _ERS_PLAN_DIR.exists():
        return

    _init = _ERS_PLAN_DIR / "__init__.py"
    if not _init.exists():
        return

    sys.path.insert(0, str(_ERS_PLAN_DIR.parent))

    spec = importlib.util.spec_from_file_location(
        "ers_plan",
        str(_init),
        submodule_search_locations=[str(_ERS_PLAN_DIR)],
    )
    if spec and spec.loader:
        mod = importlib.util.module_from_spec(spec)
        sys.modules["ers_plan"] = mod
        spec.loader.exec_module(mod)

    subpackages = ["engines"]
    for sub in subpackages:
        sub_dir = _ERS_PLAN_DIR / sub
        sub_init = sub_dir / "__init__.py"
        if sub_init.exists():
            sub_spec = importlib.util.spec_from_file_location(
                f"ers_plan.{sub}",
                str(sub_init),
                submodule_search_locations=[str(sub_dir)],
            )
            if sub_spec and sub_spec.loader:
                sub_mod = importlib.util.module_from_spec(sub_spec)
                sys.modules[f"ers_plan.{sub}"] = sub_mod
                sub_spec.loader.exec_module(sub_mod)


_register_ers_plan()


def _register_ers_work():
    """Register ers-work as ers_work before test collection."""
    _ERS_WORK_DIR = SRC_DIR / "layer2-modules" / "ers-work"
    if not _ERS_WORK_DIR.exists():
        return

    _init = _ERS_WORK_DIR / "__init__.py"
    if not _init.exists():
        return

    sys.path.insert(0, str(_ERS_WORK_DIR.parent))

    spec = importlib.util.spec_from_file_location(
        "ers_work",
        str(_init),
        submodule_search_locations=[str(_ERS_WORK_DIR)],
    )
    if spec and spec.loader:
        mod = importlib.util.module_from_spec(spec)
        sys.modules["ers_work"] = mod
        spec.loader.exec_module(mod)

    subpackages = ["engines"]
    for sub in subpackages:
        sub_dir = _ERS_WORK_DIR / sub
        sub_init = sub_dir / "__init__.py"
        if sub_init.exists():
            sub_spec = importlib.util.spec_from_file_location(
                f"ers_work.{sub}",
                str(sub_init),
                submodule_search_locations=[str(sub_dir)],
            )
            if sub_spec and sub_spec.loader:
                sub_mod = importlib.util.module_from_spec(sub_spec)
                sys.modules[f"ers_work.{sub}"] = sub_mod
                sub_spec.loader.exec_module(sub_mod)


_register_ers_work()


def _register_layer3_agents():
    """Register layer3-agents as layer3_agents before test collection."""
    _L3_DIR = SRC_DIR / "layer3-agents"
    if not _L3_DIR.exists():
        return

    _init = _L3_DIR / "__init__.py"
    if not _init.exists():
        return

    sys.path.insert(0, str(_L3_DIR.parent))

    spec = importlib.util.spec_from_file_location(
        "layer3_agents",
        str(_init),
        submodule_search_locations=[str(_L3_DIR)],
    )
    if spec and spec.loader:
        mod = importlib.util.module_from_spec(spec)
        sys.modules["layer3_agents"] = mod
        spec.loader.exec_module(mod)

    subpackages = ["engines", "agents"]
    for sub in subpackages:
        sub_dir = _L3_DIR / sub
        sub_init = sub_dir / "__init__.py"
        if sub_init.exists():
            sub_spec = importlib.util.spec_from_file_location(
                f"layer3_agents.{sub}",
                str(sub_init),
                submodule_search_locations=[str(sub_dir)],
            )
            if sub_spec and sub_spec.loader:
                sub_mod = importlib.util.module_from_spec(sub_spec)
                sys.modules[f"layer3_agents.{sub}"] = sub_mod
                sub_spec.loader.exec_module(sub_mod)


_register_layer3_agents()

# Register hyphenated directories as importable modules via aliases
_ALIASES = {
    "layer1_data_fabric_quality_engine": "layer1-data-fabric.quality.engine",
    "layer1_data_fabric_quality_schemas": "layer1-data-fabric.quality.schemas",
    "layer1_data_fabric_quality_router": "layer1-data-fabric.quality.router",
    "layer1_data_fabric_kg_driver": "layer1-data-fabric.knowledge-graph.driver",
    "layer1_data_fabric_kg_schemas": "layer1-data-fabric.knowledge-graph.schemas",
    "layer1_data_fabric_kg_service": "layer1-data-fabric.knowledge-graph.service",
    "layer1_data_fabric_kg_router": "layer1-data-fabric.knowledge-graph.router",
    "layer1_data_fabric_connector_schemas": "layer1-data-fabric.connectors.schemas",
    "layer1_data_fabric_connector_base": "layer1-data-fabric.connectors.base",
    "layer1_data_fabric_connector_manager": "layer1-data-fabric.connectors.manager",
    "layer1_data_fabric_pid_schemas": "layer1-data-fabric.pid-parser.schemas",
    "layer1_data_fabric_pid_preprocessor": "layer1-data-fabric.pid-parser.preprocessor",
    "layer1_data_fabric_pid_vision": "layer1-data-fabric.pid-parser.vision",
    "layer1_data_fabric_pid_graph_builder": "layer1-data-fabric.pid-parser.graph_builder",
    "layer1_data_fabric_pid_service": "layer1-data-fabric.pid-parser.service",
    "layer1_data_fabric_pid_router": "layer1-data-fabric.pid-parser.router",
    "shared_auth_schemas": "shared.auth.schemas",
    "shared_auth_security": "shared.auth.security",
    "shared_auth_service": "shared.auth.service",
    "shared_auth_decorators": "shared.auth.decorators",
    "shared_auth_dependencies": "shared.auth.dependencies",
    "shared_auth_router": "shared.auth.router",
}

for alias, dotpath in _ALIASES.items():
    parts = dotpath.split(".")
    # Build path manually
    mod_dir = SRC_DIR
    for p in parts[:-1]:
        mod_dir = mod_dir / p
    mod_file = mod_dir / (parts[-1] + ".py")

    if mod_file.exists():
        try:
            spec = importlib.util.spec_from_file_location(alias, str(mod_file))
            if spec and spec.loader:
                mod = importlib.util.module_from_spec(spec)
                sys.modules[alias] = mod
                spec.loader.exec_module(mod)
        except (ImportError, ModuleNotFoundError):
            pass  # Skip modules with missing dependencies

def _register_layer4_integration():
    """Register layer4-integration as layer4_integration before test collection."""
    _L4_DIR = SRC_DIR / "layer4-integration"
    if not _L4_DIR.exists():
        return

    _init = _L4_DIR / "__init__.py"
    if not _init.exists():
        return

    sys.path.insert(0, str(_L4_DIR.parent))

    spec = importlib.util.spec_from_file_location(
        "layer4_integration",
        str(_init),
        submodule_search_locations=[str(_L4_DIR)],
    )
    if spec and spec.loader:
        mod = importlib.util.module_from_spec(spec)
        sys.modules["layer4_integration"] = mod
        spec.loader.exec_module(mod)

    subpackages = ["api_portal", "cmms_writeback", "mes_exchange", "webhooks", "mcp"]
    
    # Actually, layer4 subpackages are hyphenated in src (api-portal, cmms-writeback, mes-exchange)!
    # Let me fix that. The python paths use underscores, but directory names have hyphens.
    
    # We will just map the directory names with hyphens to python modules with underscores
    subdirs = {"api_portal": "api-portal", "cmms_writeback": "cmms-writeback", 
              "mes_exchange": "mes-exchange", "webhooks": "webhooks", "mcp": "mcp"}
              
    for mod_name, dir_name in subdirs.items():
        sub_dir = _L4_DIR / dir_name
        sub_init = sub_dir / "__init__.py"
        if sub_init.exists():
            sub_spec = importlib.util.spec_from_file_location(
                f"layer4_integration.{mod_name}",
                str(sub_init),
                submodule_search_locations=[str(sub_dir)],
            )
            if sub_spec and sub_spec.loader:
                sub_mod = importlib.util.module_from_spec(sub_spec)
                sys.modules[f"layer4_integration.{mod_name}"] = sub_mod
                sub_spec.loader.exec_module(sub_mod)

_register_layer4_integration()
