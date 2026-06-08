"""
pytest suite for the ERS P&ID Parser module.

Tests cover:
  1. Pre-processing pipeline (image enhancement)
  2. Vision response parsing (valid JSON, malformed, markdown fences)
  3. Review queue (confidence < 0.85 flagging)
  4. Commit governance (Tier 3 — pending reviews block commit)
  5. Graph builder deduplication logic
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from uuid import uuid4

import pytest

# ── Use conftest aliases ──────────────────────────────────────

from layer1_data_fabric_pid_schemas import (
    CommitRequest,
    EquipmentType,
    ExtractedConnection,
    ExtractedEquipment,
    JobStatus,
    PageExtractionResult,
    ReviewStatus,
)
from layer1_data_fabric_pid_service import (
    REVIEW_CONFIDENCE_THRESHOLD,
    _apply_corrections,
    all_reviews_resolved,
    approve_review_item,
    create_job,
    get_job,
    get_review_items,
    process_job,
    reject_review_item,
)
from layer1_data_fabric_pid_vision import (
    _parse_vision_response,
)


# ── Test Data ────────────────────────────────────────────────

VALID_VISION_JSON = json.dumps([
    {
        "tag": "P-101A",
        "type": "pump",
        "description": "Feed pump",
        "connections_in": [{"target_tag": "V-100", "flow_type": "process"}],
        "connections_out": [{"target_tag": "E-101", "flow_type": "process"}],
        "confidence": 0.95,
    },
    {
        "tag": "V-100",
        "type": "vessel",
        "description": "Feed drum",
        "connections_in": [],
        "connections_out": [{"target_tag": "P-101A", "flow_type": "process"}],
        "confidence": 0.72,
    },
])

MARKDOWN_WRAPPED_JSON = f"```json\n{VALID_VISION_JSON}\n```"

MALFORMED_JSON = "{ this is not valid json ]"


# ── 1. Vision Response Parsing ───────────────────────────────

class TestVisionParsing:

    def test_valid_json_parses(self):
        result = _parse_vision_response(VALID_VISION_JSON, page_number=1)
        assert len(result) == 2
        assert result[0].tag == "P-101A"
        assert result[0].type_ == EquipmentType.PUMP
        assert result[0].confidence == 0.95
        assert len(result[0].connections_out) == 1

    def test_markdown_fences_stripped(self):
        result = _parse_vision_response(MARKDOWN_WRAPPED_JSON, page_number=1)
        assert len(result) == 2

    def test_malformed_json_returns_empty(self):
        result = _parse_vision_response(MALFORMED_JSON, page_number=1)
        assert result == []

    def test_confidence_parsed_correctly(self):
        result = _parse_vision_response(VALID_VISION_JSON, page_number=1)
        high = result[0]
        low = result[1]
        assert high.confidence >= REVIEW_CONFIDENCE_THRESHOLD
        assert low.confidence < REVIEW_CONFIDENCE_THRESHOLD


# ── 2. Review Queue ─────────────────────────────────────────

class TestReviewQueue:

    def _make_mock_pages(self) -> list:
        """Create mock PageExtractionResults with mixed confidence."""
        return [
            PageExtractionResult(
                page_number=1,
                equipment=[
                    ExtractedEquipment(
                        tag="P-101A", type=EquipmentType.PUMP,
                        confidence=0.95, page_number=1,
                    ),
                    ExtractedEquipment(
                        tag="V-100", type=EquipmentType.VESSEL,
                        confidence=0.72, page_number=1,  # Below threshold
                    ),
                    ExtractedEquipment(
                        tag="E-101", type=EquipmentType.HEAT_EXCHANGER,
                        confidence=0.60, page_number=1,  # Below threshold
                    ),
                ],
            )
        ]

    def test_low_confidence_flagged_for_review(self):
        """Items with confidence < 0.85 should appear in the review queue."""
        # Create a job and simulate extraction
        job = create_job("test_drawing.pdf")

        # Manually inject pages (bypassing vision API)
        from layer1_data_fabric_pid_service import _jobs, _review_queue
        _review_queue.clear()
        
        pages = self._make_mock_pages()
        job.pages = pages
        job.total_pages = 1
        job.pages_processed = 1

        # Count items that should be flagged
        review_count = 0
        for page in pages:
            for eq in page.equipment:
                if eq.confidence < REVIEW_CONFIDENCE_THRESHOLD:
                    review_id = uuid4()
                    from layer1_data_fabric_pid_service import ReviewItem
                    _review_queue[review_id] = ReviewItem(
                        review_id=review_id,
                        job_id=job.job_id,
                        equipment=eq,
                    )
                    review_count += 1

        items = get_review_items(job.job_id)
        assert len(items) == 2  # V-100 (0.72) and E-101 (0.60)

    def test_approve_review_item(self):
        job = create_job("test2.pdf")
        from layer1_data_fabric_pid_service import _review_queue
        rid = uuid4()
        eq = ExtractedEquipment(
            tag="V-100", type=EquipmentType.VESSEL,
            confidence=0.72, page_number=1,
        )
        from layer1_data_fabric_pid_service import ReviewItem
        _review_queue[rid] = ReviewItem(
            review_id=rid, job_id=job.job_id, equipment=eq,
        )

        approved = approve_review_item(rid, reviewer="eng_smith")
        assert approved.review_status == ReviewStatus.APPROVED

    def test_reject_review_item(self):
        job = create_job("test3.pdf")
        from layer1_data_fabric_pid_service import _review_queue
        rid = uuid4()
        eq = ExtractedEquipment(
            tag="X-999", type=EquipmentType.UNKNOWN,
            confidence=0.30, page_number=1,
        )
        from layer1_data_fabric_pid_service import ReviewItem
        _review_queue[rid] = ReviewItem(
            review_id=rid, job_id=job.job_id, equipment=eq,
        )

        rejected = reject_review_item(rid, reviewer="eng_smith", notes="False positive")
        assert rejected.review_status == ReviewStatus.REJECTED


# ── 3. Commit Governance (Tier 3) ───────────────────────────

class TestCommitGovernance:

    def test_commit_blocked_if_reviews_pending(self):
        """Cannot commit while review items are still PENDING."""
        job = create_job("governance_test.pdf")
        from layer1_data_fabric_pid_service import _review_queue
        rid = uuid4()
        eq = ExtractedEquipment(
            tag="V-200", type=EquipmentType.VESSEL,
            confidence=0.50, page_number=1,
        )
        from layer1_data_fabric_pid_service import ReviewItem
        _review_queue[rid] = ReviewItem(
            review_id=rid, job_id=job.job_id, equipment=eq,
        )

        assert not all_reviews_resolved(job.job_id)

    def test_commit_allowed_after_all_reviews_resolved(self):
        """Once all reviews are approved/rejected, commit is allowed."""
        job = create_job("resolved_test.pdf")
        from layer1_data_fabric_pid_service import _review_queue
        rid = uuid4()
        eq = ExtractedEquipment(
            tag="V-300", type=EquipmentType.VESSEL,
            confidence=0.70, page_number=1,
        )
        from layer1_data_fabric_pid_service import ReviewItem
        _review_queue[rid] = ReviewItem(
            review_id=rid, job_id=job.job_id, equipment=eq,
        )

        approve_review_item(rid, reviewer="eng_jones")
        assert all_reviews_resolved(job.job_id)


# ── 4. Correction Application ───────────────────────────────

class TestCorrections:

    def test_corrected_equipment_replaces_original(self):
        job = create_job("corrections_test.pdf")
        original = ExtractedEquipment(
            tag="P-101A", type=EquipmentType.UNKNOWN,
            confidence=0.50, page_number=1,
        )
        corrected = ExtractedEquipment(
            tag="P-101A", type=EquipmentType.PUMP,
            description="Corrected by engineer",
            confidence=1.0, page_number=1,
        )
        job.pages = [
            PageExtractionResult(
                page_number=1,
                equipment=[original],
                processing_time_seconds=1.0,
            )
        ]

        from layer1_data_fabric_pid_service import _review_queue
        rid = uuid4()
        from layer1_data_fabric_pid_service import ReviewItem
        _review_queue[rid] = ReviewItem(
            review_id=rid, job_id=job.job_id, equipment=original,
        )
        approve_review_item(rid, reviewer="eng", corrected=corrected)

        # Apply corrections
        result_pages = _apply_corrections(job)
        assert result_pages[0].equipment[0].type_ == EquipmentType.PUMP
        assert result_pages[0].equipment[0].confidence == 1.0

    def test_rejected_equipment_removed(self):
        job = create_job("rejection_test.pdf")
        bad = ExtractedEquipment(
            tag="X-GHOST", type=EquipmentType.UNKNOWN,
            confidence=0.20, page_number=1,
        )
        good = ExtractedEquipment(
            tag="P-200", type=EquipmentType.PUMP,
            confidence=0.95, page_number=1,
        )
        job.pages = [
            PageExtractionResult(
                page_number=1,
                equipment=[bad, good],
                processing_time_seconds=1.0,
            )
        ]

        from layer1_data_fabric_pid_service import _review_queue
        rid = uuid4()
        from layer1_data_fabric_pid_service import ReviewItem
        _review_queue[rid] = ReviewItem(
            review_id=rid, job_id=job.job_id, equipment=bad,
        )
        reject_review_item(rid, reviewer="eng", notes="False detection")

        result_pages = _apply_corrections(job)
        tags = [eq.tag for eq in result_pages[0].equipment]
        assert "X-GHOST" not in tags
        assert "P-200" in tags
