"""
RCM AI Failure Mode Suggestion — Tier 2 Governance
════════════════════════════════════════════════════
NLP-based extraction of failure modes from WO history.
AI suggests, engineer approves (HITL).
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from typing import Dict, List, Optional, Set
from uuid import UUID, uuid4

from ers_analyze.schemas import (
    AIFailureModeSuggestion,
    FailureModeSource,
    GovernanceTier,
)


# ISO 14224 Failure Mode taxonomy (subset for common oil & gas equipment)
ISO14224_FAILURE_MODES: Dict[str, List[str]] = {
    "pump": [
        "FTS - Failure to start",
        "STP - Failure to stop",
        "UST - Spurious stop",
        "ELP - External leakage — process medium",
        "ELU - External leakage — utility medium",
        "INL - Internal leakage",
        "AIR - Abnormal instrument reading",
        "VIB - Vibration",
        "NOI - Noise",
        "OHE - Overheating",
        "SER - Structural deficiency / erosion",
        "OTH - Other",
    ],
    "compressor": [
        "FTS - Failure to start",
        "STP - Failure to stop",
        "UST - Spurious stop",
        "LOO - Low output",
        "HIO - High output",
        "ELP - External leakage — process medium",
        "INL - Internal leakage",
        "VIB - Vibration",
        "OHE - Overheating",
        "SER - Structural deficiency",
        "OTH - Other",
    ],
    "valve": [
        "FTC - Failure to close",
        "FTO - Failure to open",
        "LCP - Leakage in closed position",
        "ELP - External leakage — process medium",
        "DOP - Delayed operation",
        "SPO - Spurious operation",
        "SER - Structural deficiency",
        "OTH - Other",
    ],
    "motor": [
        "FTS - Failure to start",
        "STP - Failure to stop",
        "UST - Spurious stop",
        "OHE - Overheating",
        "VIB - Vibration",
        "INS - Insulation failure",
        "BRG - Bearing failure",
        "NOI - Noise",
        "OTH - Other",
    ],
    "turbine": [
        "FTS - Failure to start",
        "STP - Failure to stop",
        "UST - Spurious stop",
        "LOO - Low output",
        "VIB - Vibration",
        "OHE - Overheating",
        "BLD - Blade damage",
        "ELP - External leakage",
        "SER - Structural deficiency",
        "OTH - Other",
    ],
    "heat_exchanger": [
        "ELP - External leakage — process medium",
        "INL - Internal leakage (tube leak)",
        "PLU - Plugged / blocked",
        "RED - Reduced heat transfer",
        "SER - Structural deficiency / erosion",
        "FOU - Fouling",
        "OTH - Other",
    ],
    "generic": [
        "FTS - Failure to start / function",
        "ELP - External leakage",
        "INL - Internal leakage",
        "VIB - Vibration",
        "OHE - Overheating",
        "SER - Structural deficiency",
        "NOI - Noise",
        "BRD - Breakdown",
        "OTH - Other",
    ],
}

# Keywords that map WO text to failure modes
_FAILURE_KEYWORDS: Dict[str, List[str]] = {
    "vibration": ["vibrat", "shak", "oscillat", "imbalanc", "misalign"],
    "overheating": ["overheat", "hot", "temperatur", "thermal", "burn"],
    "leakage": ["leak", "seep", "drip", "weep", "fluid loss"],
    "noise": ["nois", "knock", "rattle", "squeal", "grind"],
    "failure_to_start": ["fail to start", "won't start", "no start", "fts", "trip"],
    "bearing": ["bearing", "brg", "journal", "thrust bearing"],
    "blockage": ["block", "plug", "clog", "restrict", "foul"],
    "corrosion": ["corros", "rust", "pitting", "eros"],
    "insulation": ["insulat", "winding", "megger", "dielectr"],
    "spurious_stop": ["spurious", "trip", "unexpect", "sudden stop", "ust"],
    "low_output": ["low output", "reduced capacity", "underperform", "degraded"],
    "structural": ["crack", "fracture", "fatigue", "deform", "structural"],
}


@dataclass
class WorkOrderText:
    """Simplified representation of WO text for NLP analysis."""
    wo_id: str
    description: str
    failure_description: Optional[str] = None
    remedy: Optional[str] = None


class RCMAIFailureModeSuggestor:
    """
    NLP-based failure mode suggestion from WO history.

    Governance: ALL suggestions are Tier 2 — human review required.
    The AI is an ADVISOR, not an authority.
    """

    def __init__(self):
        self._keyword_cache: Dict[str, Set[str]] = {}

    def suggest_failure_modes(
        self,
        asset_class: str,
        wo_history: List[WorkOrderText],
        max_suggestions: int = 10,
    ) -> List[AIFailureModeSuggestion]:
        """
        Analyze WO history text and suggest failure modes.

        Process:
        1. Extract keywords from WO descriptions
        2. Map keywords to ISO 14224 failure mode categories
        3. Score by frequency and relevance
        4. Return ranked suggestions with evidence
        """
        if not wo_history:
            return self._get_default_suggestions(asset_class, max_suggestions)

        # Step 1: Count keyword matches across all WO text
        category_matches: Dict[str, List[WorkOrderText]] = {}

        for wo in wo_history:
            text = self._normalize_text(wo)
            matched_categories = self._match_keywords(text)

            for category in matched_categories:
                if category not in category_matches:
                    category_matches[category] = []
                category_matches[category].append(wo)

        # Step 2: Rank by frequency
        ranked = sorted(
            category_matches.items(),
            key=lambda x: len(x[1]),
            reverse=True,
        )

        # Step 3: Map to ISO 14224 and create suggestions
        suggestions: List[AIFailureModeSuggestion] = []
        iso_modes = ISO14224_FAILURE_MODES.get(
            asset_class.lower(), ISO14224_FAILURE_MODES["generic"]
        )

        for category, matching_wos in ranked[:max_suggestions]:
            # Find the best ISO 14224 match
            iso_code = self._map_to_iso14224(category, iso_modes)

            # Calculate confidence based on evidence
            confidence = self._calculate_confidence(
                match_count=len(matching_wos),
                total_wos=len(wo_history),
            )

            # Extract evidence snippets
            snippets = [
                self._extract_snippet(wo, category)
                for wo in matching_wos[:5]  # max 5 evidence pieces
            ]

            suggestions.append(
                AIFailureModeSuggestion(
                    description=self._category_to_description(category),
                    source=FailureModeSource.AI_SUGGESTED,
                    iso14224_code=iso_code,
                    confidence=confidence,
                    evidence_wo_ids=[wo.wo_id for wo in matching_wos[:10]],
                    evidence_snippets=[s for s in snippets if s],
                    governance_tier=GovernanceTier.TIER_2_HUMAN_REVIEW,
                )
            )

        # Add ISO 14224 defaults not already covered
        covered = {s.iso14224_code for s in suggestions if s.iso14224_code}
        for mode in iso_modes:
            code = mode.split(" - ")[0].strip()
            if code not in covered and len(suggestions) < max_suggestions:
                suggestions.append(
                    AIFailureModeSuggestion(
                        description=mode,
                        source=FailureModeSource.AI_SUGGESTED,
                        iso14224_code=code,
                        confidence=0.3,  # low confidence for defaults
                        evidence_wo_ids=[],
                        evidence_snippets=["ISO 14224 standard taxonomy (no WO evidence)"],
                        governance_tier=GovernanceTier.TIER_2_HUMAN_REVIEW,
                    )
                )

        return suggestions[:max_suggestions]

    def _normalize_text(self, wo: WorkOrderText) -> str:
        """Combine and normalize all WO text fields."""
        parts = [wo.description or ""]
        if wo.failure_description:
            parts.append(wo.failure_description)
        if wo.remedy:
            parts.append(wo.remedy)
        return " ".join(parts).lower()

    def _match_keywords(self, text: str) -> List[str]:
        """Match text against failure keyword categories."""
        matches = []
        for category, keywords in _FAILURE_KEYWORDS.items():
            for kw in keywords:
                if kw in text:
                    matches.append(category)
                    break  # one match per category is enough
        return matches

    def _map_to_iso14224(self, category: str, iso_modes: List[str]) -> Optional[str]:
        """Map a keyword category to the closest ISO 14224 code."""
        mapping = {
            "vibration": "VIB",
            "overheating": "OHE",
            "leakage": "ELP",
            "noise": "NOI",
            "failure_to_start": "FTS",
            "bearing": "BRG",
            "blockage": "PLU",
            "corrosion": "SER",
            "insulation": "INS",
            "spurious_stop": "UST",
            "low_output": "LOO",
            "structural": "SER",
        }
        code = mapping.get(category)
        if code:
            # Verify code exists in this asset class's modes
            for mode in iso_modes:
                if mode.startswith(code):
                    return code
        return "OTH"

    def _calculate_confidence(self, match_count: int, total_wos: int) -> float:
        """
        Calculate confidence score for a suggestion.

        Based on: frequency ratio × evidence weight
        Capped at 0.90 (AI never exceeds 90% on suggestions).
        """
        if total_wos == 0:
            return 0.3

        frequency_ratio = match_count / total_wos
        # Scale: 1 match → 0.3, 5+ matches → 0.7, 10+ → 0.85
        if match_count >= 10:
            base = 0.85
        elif match_count >= 5:
            base = 0.55 + (match_count - 5) * 0.06
        elif match_count >= 2:
            base = 0.35 + (match_count - 2) * 0.066
        else:
            base = 0.30

        # Boost if high frequency ratio
        boost = min(frequency_ratio * 0.1, 0.05)

        return min(base + boost, 0.90)  # cap at 90%

    def _extract_snippet(self, wo: WorkOrderText, category: str) -> Optional[str]:
        """Extract a relevant text snippet from a WO."""
        text = wo.description or ""
        if wo.failure_description:
            text = wo.failure_description

        # Return first 120 chars as snippet
        if len(text) > 120:
            return text[:120] + "..."
        return text if text else None

    def _category_to_description(self, category: str) -> str:
        """Convert keyword category to human-readable description."""
        descriptions = {
            "vibration": "Abnormal vibration — imbalance, misalignment, or bearing defect",
            "overheating": "Overheating — thermal stress or cooling system failure",
            "leakage": "External leakage — seal, gasket, or connection failure",
            "noise": "Abnormal noise — mechanical wear or loose components",
            "failure_to_start": "Failure to start — control, electrical, or blockage issue",
            "bearing": "Bearing failure — wear, contamination, or lubrication issue",
            "blockage": "Plugging / fouling — flow restriction or buildup",
            "corrosion": "Corrosion / erosion — material degradation",
            "insulation": "Insulation breakdown — dielectric failure",
            "spurious_stop": "Spurious trip / stop — unexpected shutdown",
            "low_output": "Reduced / low output — degraded performance",
            "structural": "Structural deficiency — crack, fatigue, or deformation",
        }
        return descriptions.get(category, f"Failure mode: {category}")

    def _get_default_suggestions(
        self, asset_class: str, max_suggestions: int = 10
    ) -> List[AIFailureModeSuggestion]:
        """Return ISO 14224 defaults when no WO history exists."""
        modes = ISO14224_FAILURE_MODES.get(
            asset_class.lower(), ISO14224_FAILURE_MODES["generic"]
        )
        return [
            AIFailureModeSuggestion(
                description=mode,
                source=FailureModeSource.AI_SUGGESTED,
                iso14224_code=mode.split(" - ")[0].strip(),
                confidence=0.3,
                evidence_wo_ids=[],
                evidence_snippets=["ISO 14224 standard taxonomy (no WO data available)"],
                governance_tier=GovernanceTier.TIER_2_HUMAN_REVIEW,
            )
            for mode in modes[:max_suggestions]
        ]
