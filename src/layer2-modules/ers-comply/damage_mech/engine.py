"""
Damage Mechanism Identifier — API 571 Rule-Based + AI Advisory
══════════════════════════════════════════════════════════════
Rule-based API 571 lookup table with optional AI enhancement.
All suggestions are Tier 2 (advisory) — engineer must confirm.

SAFETY DISCLAIMER: This module NEVER makes autonomous safety decisions.
ALL safety actions require physical human confirmation and multi-party
approval (Tier 5). It is a reference tool, not a safety authority.
"""
from typing import List, Optional, Dict, Any

import sys, os
sys.path.insert(0, os.path.realpath(os.path.join(os.path.dirname(__file__), '../..')))

from ers_comply.schemas import (
    DamageMechIdentifyInput, DamageMechIdentifyOutput,
    DamageMechSuggestion
)


# ══════════════════════════════════════════════════════════════
#  API 571 Damage Mechanism Rule Table
#  Keyed by (material_category, service_category) → list of DMs
# ══════════════════════════════════════════════════════════════

API_571_RULES: List[Dict[str, Any]] = [
    # ── High-temperature mechanisms ──
    {
        "code": "4.2.1", "name": "Galvanic Corrosion",
        "conditions": lambda inp: True,  # universal check
        "likelihood": "low",
        "rationale": "Possible wherever dissimilar metals are in contact.",
        "inspection": "Visual inspection, UT thickness",
        "interval": "Per code schedule",
    },
    {
        "code": "4.2.7", "name": "Atmospheric Corrosion",
        "conditions": lambda inp: True,
        "likelihood": "medium",
        "rationale": "All external carbon steel surfaces exposed to atmosphere.",
        "inspection": "Visual, UT spot checks on CUI-prone areas",
        "interval": "5-year external inspection",
    },
    {
        "code": "4.2.9", "name": "CO2 Corrosion (Sweet Corrosion)",
        "conditions": lambda inp: (
            inp.co2_content is not None and inp.co2_content > 0.5
        ),
        "likelihood": "high",
        "rationale": "CO₂ content > 0.5 mol% promotes carbonic acid attack on carbon steel.",
        "inspection": "UT thickness mapping, internal visual",
        "interval": "2–5 years depending on rate",
    },
    {
        "code": "4.2.14", "name": "Amine Corrosion",
        "conditions": lambda inp: (
            "amine" in inp.process_fluid.lower()
        ),
        "likelihood": "medium",
        "rationale": "Amine service promotes corrosion at elevated temperatures.",
        "inspection": "UT thickness, WFMT on welds",
        "interval": "3–5 years",
    },
    {
        "code": "4.2.16", "name": "Caustic Corrosion",
        "conditions": lambda inp: (
            inp.caustic_concentration is not None and inp.caustic_concentration > 0
        ),
        "likelihood": "high" if True else "medium",
        "rationale": "Concentrated caustic solutions cause thinning and cracking.",
        "inspection": "UT thickness, WFMT on welds, metallography",
        "interval": "2–5 years",
    },
    {
        "code": "4.3.3", "name": "Sulfidation (High-Temp H₂S Corrosion)",
        "conditions": lambda inp: (
            inp.h2s_content is not None and inp.h2s_content > 0
            and inp.operating_temperature > 450
        ),
        "likelihood": "high",
        "rationale": "H₂S at temperatures above 450°F causes sulfidation of carbon steel.",
        "inspection": "UT thickness mapping, metallographic exam",
        "interval": "2–3 years at accelerated rates",
    },
    {
        "code": "4.3.4", "name": "Naphthenic Acid Corrosion",
        "conditions": lambda inp: (
            "crude" in inp.process_fluid.lower()
            and inp.operating_temperature > 430
        ),
        "likelihood": "high",
        "rationale": "Crude oil service at >430°F with high TAN values.",
        "inspection": "UT thickness, ER probes, coupons",
        "interval": "1–3 years based on TAN and velocity",
    },
    {
        "code": "4.5.1", "name": "Chloride Stress Corrosion Cracking (Cl-SCC)",
        "conditions": lambda inp: (
            inp.chloride_content is not None and inp.chloride_content > 10
            and inp.operating_temperature > 140
            and "stainless" in (inp.material_spec or "").lower()
        ),
        "likelihood": "high",
        "rationale": "Austenitic SS with chlorides >10 ppm at >140°F is highly susceptible.",
        "inspection": "PT/MT on welds, TOFD/PAUT for cracking",
        "interval": "2–5 years depending on stress level",
    },
    {
        "code": "4.5.2", "name": "Caustic Stress Corrosion Cracking (Caustic SCC)",
        "conditions": lambda inp: (
            inp.caustic_concentration is not None
            and inp.caustic_concentration > 5
            and inp.operating_temperature > 150
        ),
        "likelihood": "high",
        "rationale": "Carbon steel in caustic >5 wt% at >150°F — SCC susceptible.",
        "inspection": "WFMT, TOFD, AE testing",
        "interval": "2–3 years",
    },
    {
        "code": "4.5.4", "name": "Hydrogen Embrittlement (HE)",
        "conditions": lambda inp: (
            inp.h2_partial_pressure is not None and inp.h2_partial_pressure > 100
        ),
        "likelihood": "medium",
        "rationale": "H₂ partial pressure >100 psi may cause HE in susceptible steels.",
        "inspection": "Hardness testing, MT/PT, metallography",
        "interval": "5 years or per API 941 Nelson Curve review",
    },
    {
        "code": "4.5.5", "name": "High Temperature Hydrogen Attack (HTHA)",
        "conditions": lambda inp: (
            inp.h2_partial_pressure is not None and inp.h2_partial_pressure > 50
            and inp.operating_temperature > 400
        ),
        "likelihood": "high",
        "rationale": "H₂ > 50 psi at > 400°F — check API 941 Nelson Curves.",
        "inspection": "Advanced UT (backscatter, velocity ratio), AUBT, TOFD",
        "interval": "2–5 years per API 941 assessment",
    },
    {
        "code": "4.3.1", "name": "Oxidation (High-Temp)",
        "conditions": lambda inp: inp.operating_temperature > 800,
        "likelihood": "medium",
        "rationale": "Carbon steel at >800°F is susceptible to oxide scale formation.",
        "inspection": "UT thickness, visual for scale",
        "interval": "3–5 years",
    },
    {
        "code": "4.2.10", "name": "Corrosion Under Insulation (CUI)",
        "conditions": lambda inp: (
            inp.operating_temperature > 25 and inp.operating_temperature < 350
        ),
        "likelihood": "high",
        "rationale": "Carbon steel equipment operating between 25–350°F is CUI-susceptible.",
        "inspection": "CUI inspection (insulation removal, profile RT, pulsed-eddy-current)",
        "interval": "5 years or per RBI",
    },
    {
        "code": "4.5.3", "name": "Wet H₂S Cracking (HIC/SOHIC/SSC)",
        "conditions": lambda inp: (
            inp.h2s_content is not None and inp.h2s_content > 50
            and inp.operating_temperature < 300
        ),
        "likelihood": "high",
        "rationale": "Wet H₂S >50 ppm at <300°F — HIC/SOHIC/SSC susceptible.",
        "inspection": "Wet fluorescent MT, TOFD, AUBT, C-scan UT",
        "interval": "3–5 years",
    },
    {
        "code": "4.2.2", "name": "Microbiologically Influenced Corrosion (MIC)",
        "conditions": lambda inp: (
            "water" in inp.process_fluid.lower()
            and inp.operating_temperature < 180
        ),
        "likelihood": "medium",
        "rationale": "Water service at <180°F can support microbial colonies.",
        "inspection": "UT thickness, internal visual, biological sampling",
        "interval": "3–5 years",
    },
]


class DamageMechanismEngine:
    """
    Damage mechanism identifier using deterministic API 571 rules.

    Input: material_spec, process_fluid, temperature, pressure, etc.
    Output: Applicable DMs with API 571 section, likelihood, and inspection guidance.

    All suggestions are Tier 2 (advisory). Engineer MUST confirm.
    """

    def identify(
        self, inp: DamageMechIdentifyInput
    ) -> DamageMechIdentifyOutput:
        """Identify applicable damage mechanisms."""

        suggestions: List[DamageMechSuggestion] = []

        for rule in API_571_RULES:
            try:
                if rule["conditions"](inp):
                    # Calculate confidence based on how many conditions matched
                    confidence = self._calc_confidence(rule, inp)
                    suggestions.append(DamageMechSuggestion(
                        api_571_code=rule["code"],
                        name=rule["name"],
                        api_571_section=f"API 571 Section {rule['code']}",
                        likelihood=self._adjust_likelihood(rule["likelihood"], inp),
                        rationale=rule["rationale"],
                        recommended_inspection=rule["inspection"],
                        recommended_interval=rule["interval"],
                        confidence=confidence,
                    ))
            except Exception:
                # Skip rules that fail evaluation (missing data, etc.)
                continue

        # Sort by confidence (highest first), then by likelihood
        likelihood_order = {"high": 0, "medium": 1, "low": 2}
        suggestions.sort(
            key=lambda s: (likelihood_order.get(s.likelihood, 3), -s.confidence)
        )

        return DamageMechIdentifyOutput(
            equipment_id=inp.equipment_id,
            mechanisms=suggestions,
        )

    def _calc_confidence(
        self, rule: Dict, inp: DamageMechIdentifyInput
    ) -> float:
        """Calculate confidence score based on data availability."""
        base = 0.5  # rule-based match starts at 0.5

        # Boost for specific data present
        boosts = 0
        checks = 0

        if inp.material_spec:
            boosts += 1
            checks += 1
        if inp.process_fluid:
            boosts += 1
            checks += 1
        if inp.operating_temperature > 0:
            boosts += 1
            checks += 1
        if inp.operating_pressure > 0:
            boosts += 0.5
            checks += 1
        if inp.h2_partial_pressure is not None:
            boosts += 1
            checks += 1
        if inp.h2s_content is not None:
            boosts += 1
            checks += 1
        if inp.caustic_concentration is not None:
            boosts += 1
            checks += 1
        if inp.chloride_content is not None:
            boosts += 1
            checks += 1

        if checks > 0:
            data_completeness = boosts / (checks * 1.0)
            base += 0.4 * data_completeness

        return min(0.95, round(base, 2))

    @staticmethod
    def _adjust_likelihood(
        base_likelihood: str, inp: DamageMechIdentifyInput
    ) -> str:
        """Adjust likelihood based on temperature severity."""
        # If operating at very high temps, increase likelihood
        if inp.operating_temperature > 800 and base_likelihood == "medium":
            return "high"
        return base_likelihood
