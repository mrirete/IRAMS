"""
ERS AI Service — Server-side Gemini proxy with audit logging.
══════════════════════════════════════════════════════════════

Moves Gemini API key server-side (NIST/IEC 62443 compliance).
Logs every AI interaction to ers_ai_audit_log for full traceability.
Rate limits per user to prevent abuse.

SDK: google-genai (new SDK — replaces deprecated google.generativeai)

Environment Variables:
    GEMINI_API_KEY — Server-side Gemini API key (NOT exposed to frontend)
    SUPABASE_URL — Supabase project URL
    SUPABASE_SERVICE_KEY — Supabase service role key
"""

from __future__ import annotations

import base64
import logging
import os
import re
import time
from typing import Any, Optional
from uuid import uuid4

from google import genai
from google.genai import types

logger = logging.getLogger("ers.ai.service")

# ── Gemini Configuration ────────────────────────────────────
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

_client: genai.Client | None = None


def _get_client() -> genai.Client:
    """Lazy-init the Gemini client."""
    global _client
    if _client is None:
        if GEMINI_API_KEY:
            _client = genai.Client(api_key=GEMINI_API_KEY)
            logger.info("Gemini client initialized (model: %s)", GEMINI_MODEL)
        else:
            logger.warning("GEMINI_API_KEY not set — AI endpoints will return errors")
            raise RuntimeError("GEMINI_API_KEY not configured on server")
    return _client


# ── Supabase Client (lazy) ──────────────────────────────────
_supabase_client = None


def _get_supabase():
    """Lazy-init Supabase client for audit logging."""
    global _supabase_client
    if _supabase_client is None:
        try:
            from supabase import create_client
            url = os.getenv("SUPABASE_URL", "")
            key = os.getenv("SUPABASE_SERVICE_KEY", "")
            if url and key:
                _supabase_client = create_client(url, key)
                logger.info("Supabase audit client initialized")
            else:
                logger.warning("SUPABASE_URL or SUPABASE_SERVICE_KEY not set — audit logging disabled")
        except ImportError:
            logger.warning("supabase-py not installed — audit logging disabled")
    return _supabase_client


# ── Rate Limiting ────────────────────────────────────────────
# Simple in-memory per-user rate limiter
_rate_limits: dict[str, list[float]] = {}
RATE_LIMIT_WINDOW = 60  # seconds
RATE_LIMIT_MAX_REQUESTS = 20  # max requests per window


def _check_rate_limit(user_id: str) -> bool:
    """Returns True if request is allowed, False if rate limited."""
    now = time.time()
    if user_id not in _rate_limits:
        _rate_limits[user_id] = []

    # Purge old entries
    _rate_limits[user_id] = [t for t in _rate_limits[user_id] if now - t < RATE_LIMIT_WINDOW]

    if len(_rate_limits[user_id]) >= RATE_LIMIT_MAX_REQUESTS:
        return False

    _rate_limits[user_id].append(now)
    return True


# ── Daily Spend Budget (durable) ─────────────────────────────
# The limiter above is per-process and dies on restart, so it bounds bursts
# but not spend. The daily ceiling lives in Postgres (migration 0229) where
# it survives restarts, is shared across replicas, and is the SAME rule the
# agent-run Edge Function enforces.
#
# Two-phase: reserve a slot before the model call, record real tokens after.
# Fails OPEN on infrastructure trouble — a cost guard must never be the
# reason the product stops answering.


def _budget_reserve(user_id: str) -> tuple[bool, str]:
    """Reserve one AI call against the user's daily budget.

    Returns (allowed, reason). Allows the call if the budget backend is
    unavailable — this caps cost, it is not a security control.
    """
    sb = _get_supabase()
    if sb is None:
        return True, ""
    try:
        res = sb.rpc("ers_ai_budget_reserve", {"p_user_id": user_id}).execute()
        rows = res.data or []
        row = rows[0] if isinstance(rows, list) and rows else rows
        if not row:
            return True, ""
        if row.get("allowed"):
            return True, ""
        reason = row.get("reason") or "daily AI budget reached"
        logger.warning(
            "AI budget refused user %s: %s (requests=%s tokens=%s)",
            user_id, reason, row.get("requests_today"), row.get("tokens_today"),
        )
        return False, reason
    except Exception as e:
        logger.warning("AI budget reserve failed (allowing call): %s", e)
        return True, ""


def _budget_record(user_id: str, tokens_used: int) -> None:
    """Add the call's actual token cost to today's counter (non-blocking)."""
    sb = _get_supabase()
    if sb is None:
        return
    try:
        sb.rpc("ers_ai_budget_record", {"p_user_id": user_id, "p_tokens": int(tokens_used)}).execute()
    except Exception as e:
        logger.warning("AI budget record failed: %s", e)


# ── Core AI Service ──────────────────────────────────────────

RELANTERN_SYSTEM_INSTRUCTION = """You are the "Reliability Specialist" — an AI-powered advisor embedded in an Enterprise Asset Management system.
You follow ISO 55000, ISO 14224, IEC 60812, SAE JA1011, and OREDA standards.
You think like an experienced asset manager, act like an operations manager, and learn like a data scientist.

HITL Principle: All your outputs are SUGGESTIONS — you cannot authorize shutdowns, create POs, or close investigations without human validation.

You are grounded in Oil & Gas best practices but flexible across industries."""


async def call_gemini_proxy(
    prompt: str,
    *,
    user_id: str,
    username: str,
    module: str = "general",
    action_type: str = "chat",
    context_type: Optional[str] = None,
    context_summary: Optional[str] = None,
    temperature: float = 0.3,
    system_instruction: Optional[str] = None,
    ip_address: Optional[str] = None,
) -> dict:
    """
    Server-side Gemini call with full audit logging.

    Returns: {"text": "...", "tokens_used": N, "duration_ms": N}
    Raises: ValueError on rate limit, RuntimeError on Gemini errors.
    """
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY not configured on server")

    # Burst limit (per process) then the durable daily budget (Postgres).
    if not _check_rate_limit(user_id):
        raise ValueError(f"Rate limit exceeded ({RATE_LIMIT_MAX_REQUESTS} requests/{RATE_LIMIT_WINDOW}s)")

    budget_ok, budget_reason = _budget_reserve(user_id)
    if not budget_ok:
        raise ValueError(budget_reason)

    start_time = time.time()

    try:
        client = _get_client()
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction or RELANTERN_SYSTEM_INSTRUCTION,
                temperature=temperature,
            ),
        )

        text = response.text or ""
        duration_ms = int((time.time() - start_time) * 1000)

        # Estimate tokens (rough: 4 chars per token)
        tokens_used = (len(prompt) + len(text)) // 4
        _budget_record(user_id, tokens_used)

        # Audit log (fire-and-forget)
        _log_ai_interaction(
            user_id=user_id,
            username=username,
            module=module,
            action_type=action_type,
            query_text=prompt[:2000],  # Truncate for storage
            response_text=text[:5000],
            context_type=context_type,
            context_summary=context_summary,
            model_used=GEMINI_MODEL,
            temperature=temperature,
            tokens_used=tokens_used,
            duration_ms=duration_ms,
            ip_address=ip_address,
        )

        return {
            "text": text,
            "tokens_used": tokens_used,
            "duration_ms": duration_ms,
        }

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        error_msg = str(e)
        logger.error("Gemini call failed for user %s: %s", username, error_msg)

        # Still log the failed attempt
        _log_ai_interaction(
            user_id=user_id,
            username=username,
            module=module,
            action_type=action_type,
            query_text=prompt[:2000],
            response_text=f"ERROR: {error_msg[:500]}",
            context_type=context_type,
            context_summary=context_summary,
            model_used=GEMINI_MODEL,
            temperature=temperature,
            tokens_used=0,
            duration_ms=duration_ms,
            ip_address=ip_address,
        )

        raise RuntimeError(f"AI service error: {error_msg}")


# ── Multi-Modal Vision Service ───────────────────────────────

async def call_gemini_vision(
    image_b64: str,
    prompt: str,
    *,
    user_id: str,
    username: str,
    module: str = "vision",
    action_type: str = "vision_analysis",
    context_type: Optional[str] = None,
    context_summary: Optional[str] = None,
    temperature: float = 0.3,
    ip_address: Optional[str] = None,
) -> dict:
    """
    Multi-modal Gemini call: image + text prompt → structured analysis.

    Accepts base64-encoded image data. Supports JPEG, PNG, WEBP.
    Returns: {"text": "...", "tokens_used": N, "duration_ms": N}
    """
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY not configured on server")

    if not _check_rate_limit(user_id):
        raise ValueError(f"Rate limit exceeded ({RATE_LIMIT_MAX_REQUESTS} requests/{RATE_LIMIT_WINDOW}s)")

    budget_ok, budget_reason = _budget_reserve(user_id)
    if not budget_ok:
        raise ValueError(budget_reason)

    start_time = time.time()

    try:
        client = _get_client()

        # Decode base64 to bytes
        image_bytes = base64.b64decode(image_b64)

        # Detect MIME type from image header
        mime_type = "image/jpeg"
        if image_bytes[:4] == b'\x89PNG':
            mime_type = "image/png"
        elif image_bytes[:4] == b'RIFF':
            mime_type = "image/webp"

        # Build multi-modal content
        system_instruction = (
            RELANTERN_SYSTEM_INSTRUCTION +
            "\n\nYou are also a visual inspection specialist trained in corrosion assessment, "
            "thermal analysis, mechanical damage identification, and general equipment condition monitoring. "
            "When analyzing images, identify defects, estimate severity, and suggest failure modes per ISO 14224."
            "\n\nIMPORTANT: Always respond with valid JSON only. No markdown, no code fences, just raw JSON."
        )

        image_part = types.Part.from_bytes(data=image_bytes, mime_type=mime_type)
        text_part = types.Part.from_text(text=prompt)

        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=[image_part, text_part],
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=temperature,
            ),
        )

        text = response.text or ""
        duration_ms = int((time.time() - start_time) * 1000)
        tokens_used = (len(prompt) + len(text)) // 4
        _budget_record(user_id, tokens_used)

        _log_ai_interaction(
            user_id=user_id,
            username=username,
            module=module,
            action_type=action_type,
            query_text=f"[VISION] {prompt[:1800]}",
            response_text=text[:5000],
            context_type=context_type,
            context_summary=context_summary or "Multi-modal vision analysis",
            model_used=GEMINI_MODEL,
            temperature=temperature,
            tokens_used=tokens_used,
            duration_ms=duration_ms,
            ip_address=ip_address,
        )

        return {
            "text": text,
            "tokens_used": tokens_used,
            "duration_ms": duration_ms,
        }

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        error_msg = str(e)
        logger.error("Gemini Vision call failed for user %s: %s", username, error_msg)

        _log_ai_interaction(
            user_id=user_id,
            username=username,
            module=module,
            action_type=action_type,
            query_text=f"[VISION] {prompt[:1800]}",
            response_text=f"ERROR: {error_msg[:500]}",
            context_type=context_type,
            context_summary=context_summary,
            model_used=GEMINI_MODEL,
            temperature=temperature,
            tokens_used=0,
            duration_ms=duration_ms,
            ip_address=ip_address,
        )

        raise RuntimeError(f"Vision AI service error: {error_msg}")


# ── Safe SQL Execution (NL-to-SQL) ──────────────────────────

# Tables that are safe for user queries (read-only)
_SQL_WHITELIST_TABLES = {
    "assets", "work_orders", "work_requests", "service_requests",
    "recurring_work", "inventory_items", "readings", "contacts",
    "ers_rcm_studies", "ers_rcm_functions", "ers_rcm_failure_modes",
    "ers_rcm_decisions", "wo_failure_data", "ers_fmea_items",
    "ers_agent_actions", "dictionaries", "dictionary_entries",
}

# SQL keywords that indicate write operations
_SQL_DANGEROUS_PATTERNS = [
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE)\b",
    r"\b(EXEC|EXECUTE|CALL)\b",
    r"--",     # SQL comments (potential injection)
    r"/\*",    # Block comments
    r";\s*\w", # Multiple statements
]

SQL_MAX_ROWS = 100
SQL_TIMEOUT_MS = 10_000


def validate_sql_query(query: str) -> tuple[bool, str]:
    """
    Validate a SQL query for safety.
    Returns (is_safe, error_message).
    """
    q_upper = query.strip().upper()

    # Must start with SELECT
    if not q_upper.startswith("SELECT"):
        return False, "Only SELECT queries are allowed."

    # Check for dangerous patterns
    for pattern in _SQL_DANGEROUS_PATTERNS:
        if re.search(pattern, q_upper, re.IGNORECASE):
            return False, f"Query contains forbidden SQL pattern."

    # Verify all referenced tables are whitelisted
    # Extract table names from FROM and JOIN clauses
    from_pattern = r'\bFROM\s+([a-zA-Z_][a-zA-Z0-9_]*)'
    join_pattern = r'\bJOIN\s+([a-zA-Z_][a-zA-Z0-9_]*)'
    tables = set()
    for match in re.finditer(from_pattern, query, re.IGNORECASE):
        tables.add(match.group(1).lower())
    for match in re.finditer(join_pattern, query, re.IGNORECASE):
        tables.add(match.group(1).lower())

    # Filter out common SQL keywords that might be mistakenly captured
    sql_keywords = {"select", "where", "and", "or", "not", "in", "is", "null",
                    "true", "false", "as", "on", "by", "order", "group", "having",
                    "limit", "offset", "case", "when", "then", "else", "end"}
    tables -= sql_keywords

    for table in tables:
        if table not in _SQL_WHITELIST_TABLES:
            return False, f"Table '{table}' is not in the allowed query scope."

    # Ensure LIMIT is present (inject if missing)
    if "LIMIT" not in q_upper:
        return True, ""  # Will be added by the executor

    return True, ""


async def execute_safe_sql(
    query: str,
    *,
    user_id: str,
    username: str,
    ip_address: Optional[str] = None,
) -> dict[str, Any]:
    """
    Execute a validated, read-only SQL query against Supabase.

    Returns: {"columns": [...], "rows": [...], "row_count": N, "execution_time_ms": N}
    Raises: ValueError on validation failure, RuntimeError on execution errors.
    """
    # 1. Validate
    is_safe, error_msg = validate_sql_query(query)
    if not is_safe:
        raise ValueError(f"Query rejected: {error_msg}")

    # 2. Enforce row limit
    q_upper = query.strip().upper()
    if "LIMIT" not in q_upper:
        query = query.rstrip().rstrip(";") + f" LIMIT {SQL_MAX_ROWS}"
    else:
        # Replace existing LIMIT with max
        query = re.sub(
            r'LIMIT\s+(\d+)',
            lambda m: f"LIMIT {min(int(m.group(1)), SQL_MAX_ROWS)}",
            query,
            flags=re.IGNORECASE
        )

    # 3. Execute via Supabase RPC (raw SQL)
    sb = _get_supabase()
    if sb is None:
        raise RuntimeError("Database connection not available")

    start_time = time.time()

    try:
        result = sb.rpc("execute_readonly_sql", {"query_text": query}).execute()
        execution_time_ms = int((time.time() - start_time) * 1000)

        rows = result.data or []
        columns = list(rows[0].keys()) if rows else []

        # Audit log
        _log_ai_interaction(
            user_id=user_id,
            username=username,
            module="nl_to_sql",
            action_type="sql_query",
            query_text=query[:2000],
            response_text=f"{len(rows)} rows returned in {execution_time_ms}ms",
            context_type="sql_execution",
            context_summary=None,
            model_used="direct_sql",
            temperature=0.0,
            tokens_used=0,
            duration_ms=execution_time_ms,
            ip_address=ip_address,
        )

        return {
            "columns": columns,
            "rows": rows[:SQL_MAX_ROWS],
            "row_count": len(rows),
            "execution_time_ms": execution_time_ms,
        }

    except Exception as e:
        execution_time_ms = int((time.time() - start_time) * 1000)
        error_msg_str = str(e)
        logger.error("SQL execution failed for user %s: %s", username, error_msg_str)

        _log_ai_interaction(
            user_id=user_id,
            username=username,
            module="nl_to_sql",
            action_type="sql_query",
            query_text=query[:2000],
            response_text=f"ERROR: {error_msg_str[:500]}",
            context_type="sql_execution",
            context_summary=None,
            model_used="direct_sql",
            temperature=0.0,
            tokens_used=0,
            duration_ms=execution_time_ms,
            ip_address=ip_address,
        )

        raise RuntimeError(f"SQL execution error: {error_msg_str}")


# ── Audit Logging ────────────────────────────────────────────

def _log_ai_interaction(
    user_id: str,
    username: str,
    module: str,
    action_type: str,
    query_text: str,
    response_text: Optional[str],
    context_type: Optional[str],
    context_summary: Optional[str],
    model_used: str,
    temperature: float,
    tokens_used: int,
    duration_ms: int,
    ip_address: Optional[str],
) -> None:
    """Persist AI interaction to ers_ai_audit_log (non-blocking)."""
    sb = _get_supabase()
    if sb is None:
        return

    try:
        sb.table("ers_ai_audit_log").insert({
            "id": str(uuid4()),
            "user_id": user_id,
            "username": username,
            "module": module,
            "action_type": action_type,
            "query_text": query_text,
            "response_text": response_text,
            "context_type": context_type,
            "context_summary": context_summary,
            "model_used": model_used,
            "temperature": temperature,
            "tokens_used": tokens_used,
            "duration_ms": duration_ms,
            "ip_address": ip_address,
        }).execute()
    except Exception as e:
        logger.warning("Failed to log AI interaction: %s", e)
