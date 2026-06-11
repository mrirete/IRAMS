"""
conftest.py — makes the hyphenated layer directories importable for pytest.

All registration is wrapped in try/except so a single broken module
never crashes the entire test collection (exit code 2).  Tests that
depend on an unloadable module simply fail at import time with a clear
ImportError, while the rest of the suite runs normally.
"""
import importlib
import importlib.util
import sys
import os
import warnings
from pathlib import Path

# Add the ERS src root to sys.path
SRC_DIR = Path(__file__).resolve().parent.parent / "src"
sys.path.insert(0, str(SRC_DIR))


# ── Helpers ──────────────────────────────────────────────────────

def _safe_register_package(pkg_name: str, pkg_dir: Path, subpackages: list[str] | None = None):
    """Register a hyphenated directory as a Python package, with full error isolation."""
    if not pkg_dir.exists():
        return

    init_file = pkg_dir / "__init__.py"
    if not init_file.exists():
        return

    sys.path.insert(0, str(pkg_dir.parent))

    try:
        spec = importlib.util.spec_from_file_location(
            pkg_name,
            str(init_file),
            submodule_search_locations=[str(pkg_dir)],
        )
        if spec and spec.loader:
            mod = importlib.util.module_from_spec(spec)
            sys.modules[pkg_name] = mod
            spec.loader.exec_module(mod)
    except Exception as e:
        sys.modules.pop(pkg_name, None)
        warnings.warn(f"conftest: Could not register package '{pkg_name}': {e}")
        return

    # Pre-register subpackages
    for sub in (subpackages or []):
        sub_dir = pkg_dir / sub
        sub_init = sub_dir / "__init__.py"
        if sub_init.exists():
            fqn = f"{pkg_name}.{sub}"
            try:
                sub_spec = importlib.util.spec_from_file_location(
                    fqn,
                    str(sub_init),
                    submodule_search_locations=[str(sub_dir)],
                )
                if sub_spec and sub_spec.loader:
                    sub_mod = importlib.util.module_from_spec(sub_spec)
                    sys.modules[fqn] = sub_mod
                    sub_spec.loader.exec_module(sub_mod)
            except Exception as e:
                sys.modules.pop(fqn, None)
                warnings.warn(f"conftest: Could not register subpackage '{fqn}': {e}")


def _safe_register_alias(alias: str, mod_file: Path):
    """Load a single .py file as a top-level alias module, with cleanup on failure.

    Handles relative imports (e.g. 'from .schemas import ...') by first
    registering the module's directory as a synthetic parent package.
    """
    if not mod_file.exists():
        return

    parent_dir = mod_file.parent
    # Build a synthetic parent package name from the directory structure
    # e.g. for "layer1-data-fabric/connectors/manager.py" we create
    # a parent package so `from .schemas import ...` works.
    parent_pkg_name = alias.rsplit("_", 1)[0] + "_pkg"  # unique per alias group

    try:
        # Step 1: Register the parent directory as a package (if not already)
        if parent_pkg_name not in sys.modules:
            parent_init = parent_dir / "__init__.py"
            if parent_init.exists():
                parent_spec = importlib.util.spec_from_file_location(
                    parent_pkg_name,
                    str(parent_init),
                    submodule_search_locations=[str(parent_dir)],
                )
                if parent_spec and parent_spec.loader:
                    parent_mod = importlib.util.module_from_spec(parent_spec)
                    sys.modules[parent_pkg_name] = parent_mod
                    try:
                        parent_spec.loader.exec_module(parent_mod)
                    except Exception:
                        pass  # Parent may have its own issues; that's OK
            else:
                # No __init__.py — create a bare namespace package
                import types
                parent_mod = types.ModuleType(parent_pkg_name)
                parent_mod.__path__ = [str(parent_dir)]
                parent_mod.__package__ = parent_pkg_name
                sys.modules[parent_pkg_name] = parent_mod

        # Step 2: Load the actual module as a submodule of that parent package
        sub_name = mod_file.stem  # e.g. "manager", "schemas"
        fqn = f"{parent_pkg_name}.{sub_name}"

        spec = importlib.util.spec_from_file_location(
            fqn,
            str(mod_file),
            submodule_search_locations=None,
        )
        if spec and spec.loader:
            mod = importlib.util.module_from_spec(spec)
            mod.__package__ = parent_pkg_name
            sys.modules[fqn] = mod
            sys.modules[alias] = mod  # Also register under the alias
            spec.loader.exec_module(mod)

    except Exception as e:
        # CRITICAL: remove the partially-loaded module so downstream
        # imports get a clean ImportError instead of a broken object
        sys.modules.pop(alias, None)
        warnings.warn(f"conftest: Failed to load alias '{alias}' from {mod_file}: {e}")


# ── Layer2 Package Registration ─────────────────────────────────

_safe_register_package(
    "ers_predict",
    SRC_DIR / "layer2-modules" / "ers-predict",
    ["features", "models", "sparse", "distributions", "alerts", "twin"],
)

_safe_register_package(
    "ers_analyze",
    SRC_DIR / "layer2-modules" / "ers-analyze",
    ["rcm", "monte_carlo", "fmea", "rca", "criticality",
     "bad_actor", "defect_elimination", "oee"],
)

_safe_register_package(
    "ers_comply",
    SRC_DIR / "layer2-modules" / "ers-comply",
    ["inspection", "corrosion", "ffs", "damage_mech", "iow", "regulatory", "audit"],
)

_safe_register_package(
    "ers_people",
    SRC_DIR / "layer2-modules" / "ers-people",
    ["engines"],
)

_safe_register_package(
    "ers_vision",
    SRC_DIR / "layer2-modules" / "ers-vision",
    ["corrosion", "thermal", "condition", "tagging", "drone", "comparison"],
)

_safe_register_package(
    "ers_sustain",
    SRC_DIR / "layer2-modules" / "ers-sustain",
    ["engines"],
)

_safe_register_package(
    "ers_plan",
    SRC_DIR / "layer2-modules" / "ers-plan",
    ["engines"],
)

_safe_register_package(
    "ers_work",
    SRC_DIR / "layer2-modules" / "ers-work",
    ["engines"],
)


# ── Layer3 Package Registration ─────────────────────────────────

_safe_register_package(
    "layer3_agents",
    SRC_DIR / "layer3-agents",
    ["engines", "agents"],
)


# ── Flat-file Alias Registration ────────────────────────────────
# Maps importable alias names → dotted paths relative to SRC_DIR
# (hyphens in directory names replaced with literal hyphens)

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
    mod_dir = SRC_DIR
    for p in parts[:-1]:
        mod_dir = mod_dir / p
    mod_file = mod_dir / (parts[-1] + ".py")
    _safe_register_alias(alias, mod_file)


# ── Layer4 Package Registration ─────────────────────────────────

def _register_layer4_integration():
    """Register layer4-integration, mapping hyphenated subdirs to underscore names."""
    _L4_DIR = SRC_DIR / "layer4-integration"
    if not _L4_DIR.exists():
        return

    _init = _L4_DIR / "__init__.py"
    if not _init.exists():
        return

    sys.path.insert(0, str(_L4_DIR.parent))

    try:
        spec = importlib.util.spec_from_file_location(
            "layer4_integration",
            str(_init),
            submodule_search_locations=[str(_L4_DIR)],
        )
        if spec and spec.loader:
            mod = importlib.util.module_from_spec(spec)
            sys.modules["layer4_integration"] = mod
            spec.loader.exec_module(mod)
    except Exception as e:
        sys.modules.pop("layer4_integration", None)
        warnings.warn(f"conftest: Could not register layer4_integration: {e}")
        return

    subdirs = {
        "api_portal": "api-portal",
        "cmms_writeback": "cmms-writeback",
        "mes_exchange": "mes-exchange",
        "webhooks": "webhooks",
        "mcp": "mcp",
    }

    for mod_name, dir_name in subdirs.items():
        sub_dir = _L4_DIR / dir_name
        sub_init = sub_dir / "__init__.py"
        if sub_init.exists():
            fqn = f"layer4_integration.{mod_name}"
            try:
                sub_spec = importlib.util.spec_from_file_location(
                    fqn,
                    str(sub_init),
                    submodule_search_locations=[str(sub_dir)],
                )
                if sub_spec and sub_spec.loader:
                    sub_mod = importlib.util.module_from_spec(sub_spec)
                    sys.modules[fqn] = sub_mod
                    sub_spec.loader.exec_module(sub_mod)
            except Exception as e:
                sys.modules.pop(fqn, None)
                warnings.warn(f"conftest: Could not register '{fqn}': {e}")


try:
    _register_layer4_integration()
except Exception as e:
    warnings.warn(f"conftest: layer4 registration failed: {e}")
