"""
Claude Vision extraction engine for P&ID drawings.
Sends enhanced page images to Claude Opus 4.6 with a structured
extraction prompt and parses the JSON response.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Dict, List, Optional

import anthropic

from .schemas import (
    ExtractedConnection,
    ExtractedEquipment,
    EquipmentType,
    PageExtractionResult,
)

logger = logging.getLogger("ers.pid_parser.vision")

# ── Structured Prompt ─────────────────────────────────────────

PID_EXTRACTION_PROMPT = """Analyze this Piping & Instrumentation Diagram (P&ID).

For EVERY equipment item visible on this drawing, extract:
  - tag: The equipment tag number (e.g. P-101A, V-201, E-301)
  - type: One of: pump, compressor, heat_exchanger, vessel, tank, valve,
          filter, reactor, column, turbine, instrument, pipe, unknown
  - description: Brief description if readable
  - connections_in: Array of incoming connections, each with:
      - target_tag: The tag of the equipment this connects FROM
      - flow_type: "process", "utility", "instrument", or "signal"
      - line_number: Pipe line number if readable
  - connections_out: Array of outgoing connections, each with:
      - target_tag: The tag of the equipment this connects TO
      - flow_type: "process", "utility", "instrument", or "signal"
      - line_number: Pipe line number if readable
  - confidence: Your confidence in this extraction (0.0 to 1.0)

Return ONLY a valid JSON array of objects. No markdown fences, no explanation.
Example:
[
  {
    "tag": "P-101A",
    "type": "pump",
    "description": "Feed pump",
    "connections_in": [{"target_tag": "V-100", "flow_type": "process", "line_number": "4-P-101"}],
    "connections_out": [{"target_tag": "E-101", "flow_type": "process", "line_number": "4-P-102"}],
    "confidence": 0.92
  }
]
"""


# ── Vision API Call ───────────────────────────────────────────

def _get_client() -> anthropic.Anthropic:
    """Retrieve or create an Anthropic client from env."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY environment variable is required")
    return anthropic.Anthropic(api_key=api_key)


def extract_page(
    image_base64: str,
    page_number: int,
    model: str = "claude-opus-4-6-20250219",
) -> PageExtractionResult:
    """
    Send a single P&ID page image to Claude Vision and parse results.

    Args:
        image_base64: Base64-encoded PNG of the enhanced P&ID page.
        page_number: 1-indexed page number for tracking.
        model: Anthropic model identifier.

    Returns:
        PageExtractionResult with extracted equipment and confidence data.
    """
    client = _get_client()
    start = time.monotonic()

    try:
        message = client.messages.create(
            model=model,
            max_tokens=8192,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/png",
                                "data": image_base64,
                            },
                        },
                        {
                            "type": "text",
                            "text": PID_EXTRACTION_PROMPT,
                        },
                    ],
                }
            ],
        )

        raw_text = message.content[0].text
        elapsed = time.monotonic() - start

        # Parse JSON array
        equipment_list = _parse_vision_response(raw_text, page_number)

        low_conf = sum(1 for eq in equipment_list if eq.confidence < 0.85)

        return PageExtractionResult(
            page_number=page_number,
            equipment=equipment_list,
            low_confidence_count=low_conf,
            processing_time_seconds=round(elapsed, 2),
            raw_vision_response=raw_text,
        )

    except Exception as e:
        elapsed = time.monotonic() - start
        logger.error("Vision extraction failed for page %d: %s", page_number, e)
        return PageExtractionResult(
            page_number=page_number,
            equipment=[],
            low_confidence_count=0,
            processing_time_seconds=round(elapsed, 2),
            raw_vision_response=str(e),
        )


def _parse_vision_response(
    raw_text: str,
    page_number: int,
) -> List[ExtractedEquipment]:
    """Parse the raw JSON text from Claude into typed equipment objects."""
    # Strip markdown fences if present (safety)
    text = raw_text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
    if text.endswith("```"):
        text = text.rsplit("```", 1)[0]
    text = text.strip()

    try:
        items = json.loads(text)
    except json.JSONDecodeError as e:
        logger.error("Failed to parse vision JSON on page %d: %s", page_number, e)
        return []

    if not isinstance(items, list):
        items = [items]

    equipment: List[ExtractedEquipment] = []
    for item in items:
        try:
            # Normalise type
            raw_type = item.get("type", "unknown").lower().strip()
            try:
                eq_type = EquipmentType(raw_type)
            except ValueError:
                eq_type = EquipmentType.UNKNOWN

            connections_in = [
                ExtractedConnection(**c) for c in item.get("connections_in", [])
            ]
            connections_out = [
                ExtractedConnection(**c) for c in item.get("connections_out", [])
            ]

            eq = ExtractedEquipment(
                tag=item["tag"],
                type=eq_type,
                description=item.get("description"),
                connections_in=connections_in,
                connections_out=connections_out,
                confidence=float(item.get("confidence", 0.0)),
                page_number=page_number,
            )
            equipment.append(eq)
        except (KeyError, TypeError, ValueError) as e:
            logger.warning("Skipping malformed equipment item on page %d: %s", page_number, e)

    return equipment


# ── Batch extraction ──────────────────────────────────────────

def extract_all_pages(
    pages_b64: List[str],
    model: str = "claude-opus-4-6-20250219",
) -> List[PageExtractionResult]:
    """Extract equipment from all pre-processed pages sequentially."""
    results = []
    for i, b64 in enumerate(pages_b64, start=1):
        logger.info("Extracting page %d / %d", i, len(pages_b64))
        result = extract_page(b64, page_number=i, model=model)
        results.append(result)
    return results
