"""
ERS — Enterprise Reliability System
═════════════════════════════════════
FastAPI gateway application.

Uses importlib to load router modules from hyphenated directory names
that Python cannot import via standard dotted syntax.

Usage:
    cd ERS
    uvicorn src.main:app --reload --port 8000
"""

from __future__ import annotations

import importlib
import importlib.util
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from types import ModuleType

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# ── Logging ──────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s │ %(name)-28s │ %(levelname)-7s │ %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("ers.gateway")

# ── Path Setup ───────────────────────────────────────────────
SRC_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SRC_DIR.parent
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


# ── Lifecycle ────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("🚀 IREAMS Gateway starting …")
    logger.info("   OpenAPI docs → http://localhost:8000/docs")
    yield
    logger.info("🛑 IREAMS Gateway shutting down …")


# ── Application ──────────────────────────────────────────────
app = FastAPI(
    title="IREAMS — Integrated Reliability and Enterprise Management System",
    description=(
        "IREAMS by Relantern — AI-powered modern Enterprise Asset Management (EAM) platform.\n\n"
        "Single source of truth for assets, maintenance, inventory, "
        "people, and performance — optimized for Oil & Gas.\n\n"
        "ISO 55000 · ISO 14224 · SAE JA1011 · API 580/581"
    ),
    version="0.3.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS ─────────────────────────────────────────────────────
import os as _os

# Production: set CORS_ORIGINS="https://ers.yourcompany.com"
# Development: defaults to localhost origins
_cors_env = _os.getenv("CORS_ORIGINS", "")
_cors_origins: list[str] = (
    [o.strip() for o in _cors_env.split(",") if o.strip()]
    if _cors_env
    else [
        "https://irams.vercel.app",
        "https://irams-p9hk.vercel.app",
        "http://localhost:5173",
        "http://localhost:4173",
        "http://localhost:3000",
    ]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
)


# ── Package Loader ───────────────────────────────────────────
def _load_package(pkg_dir: Path, package_name: str) -> ModuleType | None:
    """
    Load a Python package from a directory with a potentially
    non-importable name (hyphens, etc.).

    This registers the package and all its sub-packages in sys.modules
    so that relative imports within the package work correctly.
    """
    init_file = pkg_dir / "__init__.py"
    if not init_file.exists():
        return None

    try:
        # Register the package itself
        spec = importlib.util.spec_from_file_location(
            package_name,
            str(init_file),
            submodule_search_locations=[str(pkg_dir)],
        )
        if spec is None or spec.loader is None:
            return None

        mod = importlib.util.module_from_spec(spec)
        sys.modules[package_name] = mod
        spec.loader.exec_module(mod)

        # Pre-register all immediate sub-packages so relative imports work
        for child in pkg_dir.iterdir():
            if child.is_dir() and (child / "__init__.py").exists():
                child_pkg_name = f"{package_name}.{child.name}"
                if child_pkg_name not in sys.modules:
                    _load_package(child, child_pkg_name)

        return mod
    except Exception as e:
        logger.warning("  Failed to load package %s: %s", package_name, e)
        return None


def _load_router_from_package(
    pkg_dir: Path,
    package_name: str,
    label: str,
) -> ModuleType | None:
    """
    Load a package and then import its router.py module.
    """
    # First ensure the package is loaded
    pkg = _load_package(pkg_dir, package_name)
    if pkg is None:
        logger.warning("  ✗ %s → package not found", label)
        return None

    # Now load router.py
    router_file = pkg_dir / "router.py"
    if not router_file.exists():
        logger.warning("  ✗ %s → router.py not found", label)
        return None

    router_mod_name = f"{package_name}.router"
    try:
        spec = importlib.util.spec_from_file_location(
            router_mod_name,
            str(router_file),
            submodule_search_locations=[str(pkg_dir)],
        )
        if spec is None or spec.loader is None:
            return None

        mod = importlib.util.module_from_spec(spec)
        sys.modules[router_mod_name] = mod
        spec.loader.exec_module(mod)
        return mod
    except Exception as e:
        logger.warning("  ✗ %s → %s", label, e)
        return None


# ── Mount Routers ────────────────────────────────────────────

# Shared — Auth (no hyphens, standard import works)
try:
    from shared.auth.router import router as auth_router
    app.include_router(auth_router)
    logger.info("  ✓ Auth")
except Exception as e:
    logger.warning("  ✗ Auth → %s", e)


# Layer 1 — Data Fabric
L1_DIR = SRC_DIR / "layer1-data-fabric"
L1_MODULES = [
    ("connectors",      "Connectors"),
    ("quality",         "Data Quality"),
    ("knowledge-graph", "Knowledge Graph"),
    ("pid-parser",      "P&ID Parser"),
]

for sub_name, label in L1_MODULES:
    pkg_dir = L1_DIR / sub_name
    safe_name = sub_name.replace("-", "_")
    pkg_name = f"l1_{safe_name}"

    mod = _load_router_from_package(pkg_dir, pkg_name, f"L1: {label}")
    if mod and hasattr(mod, "router"):
        app.include_router(mod.router)
        logger.info("  ✓ L1: %s", label)


# Layer 2 — Modules
L2_DIR = SRC_DIR / "layer2-modules"
L2_PREFIX = "/api/v1"
L2_MODULES = [
    ("ers-predict",  "ERS Predict",  L2_PREFIX),
    ("ers-analyze",  "ERS Analyze",  L2_PREFIX),
    ("ers-work",     "ERS Work",     L2_PREFIX),
    ("ers-plan",     "ERS Plan",     L2_PREFIX),
    ("ers-vision",   "ERS Vision",   L2_PREFIX),
    ("ers-sustain",  "ERS Sustain",  L2_PREFIX),
    ("ers-people",   "ERS People",   L2_PREFIX),
    ("ers-comply",   "ERS Comply",   ""),  # already has /api/v1/integrity
    ("ers-ai",       "ERS AI",       L2_PREFIX),
]

for sub_name, label, prefix in L2_MODULES:
    pkg_dir = L2_DIR / sub_name
    safe_name = sub_name.replace("-", "_")
    pkg_name = safe_name   # e.g. "ers_predict"

    mod = _load_router_from_package(pkg_dir, pkg_name, f"L2: {label}")
    if mod and hasattr(mod, "router"):
        app.include_router(mod.router, prefix=prefix)
        logger.info("  ✓ L2: %s", label)


# ── Health Check ─────────────────────────────────────────────
@app.get("/api/v1/health", tags=["System"])
async def health_check():
    """System health endpoint for load balancers and monitoring."""
    return {
        "status": "healthy",
        "service": "ers-gateway",
        "version": "0.3.0",
    }
