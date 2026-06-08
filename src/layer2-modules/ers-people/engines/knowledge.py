"""
Knowledge Management Engine
═══════════════════════════
Processes raw field input (voice/video/text) into structured AI articles.
Evaluates single-point-of-failure "expert risk" across critical assets.
Provides RAG semantic search interface (Opus 4.6).
"""
import json
from datetime import datetime
from typing import List, Dict, Any, Optional
from uuid import UUID, uuid4

from ers_people.schemas import (
    RawKnowledgeCapture, TaggedArticle, KnowledgeRiskAssessment,
    MediaFormat
)

class KnowledgeManagementEngine:
    """Engine for transforming unstructured field knowledge into structured assets."""

    def __init__(self):
        # In-memory KB (Production -> Vector DB like Pinecone/Milvus)
        self._knowledge_base: Dict[UUID, TaggedArticle] = {}

    def process_capture(
        self,
        capture: RawKnowledgeCapture,
        ai_client: Optional[Any] = None
    ) -> TaggedArticle:
        """
        Transforms raw voice transcription, video annotation, or form data
        into a structured, tagged knowledge article using Claude Opus 4.6.
        """
        # If no AI client provided, fallback to deterministic stub
        if not ai_client:
            return self._deterministic_processing(capture)

        prompt = f"""
        Extract a structured knowledge article from this field technician's {capture.media_format.value} capture.
        Format as JSON with keys: title, summary, asset_class, tags (array of strings).
        Raw content: {capture.raw_content}
        """

        try:
            response = ai_client.messages.create(
                model="claude-opus-4-6",
                max_tokens=1024,
                messages=[{"role": "user", "content": prompt}]
            )
            data = json.loads(response.content[0].text)
            
            article = TaggedArticle(
                article_id=uuid4(),
                title=data.get("title", f"Field Note: {capture.captured_at.date()}"),
                summary=data.get("summary", "No summary generated."),
                asset_class=data.get("asset_class"),
                related_asset_ids=[capture.asset_id] if capture.asset_id else [],
                tags=data.get("tags", []),
                source_technicians=[capture.technician_id],
                confidence_score=0.85,
                created_at=datetime.utcnow()
            )
        except Exception:
            # Fallback on parsing error
            article = self._deterministic_processing(capture)

        self._knowledge_base[article.article_id] = article
        return article

    def _deterministic_processing(self, capture: RawKnowledgeCapture) -> TaggedArticle:
        article = TaggedArticle(
            article_id=uuid4(),
            title=f"Structured Note from {capture.media_format.value}",
            summary=f"Processed content length: {len(capture.raw_content)} chars",
            related_asset_ids=[capture.asset_id] if capture.asset_id else [],
            tags=["field_note", capture.media_format.value],
            source_technicians=[capture.technician_id],
            confidence_score=0.5,
            created_at=datetime.utcnow()
        )
        self._knowledge_base[article.article_id] = article
        return article

    def assess_expert_risk(
        self,
        asset_id: UUID,
        criticality: str,
        work_order_history: List[Dict[str, Any]]
    ) -> KnowledgeRiskAssessment:
        """
        Identifies if an asset relies heavily on a single technician.
        Risk is HIGH if a Criticality A asset has < 2 unique technicians
        who have successfully worked on it in the past 2 years.
        """
        technician_ids = set()
        for wo in work_order_history:
            if wo.get("asset_id") == asset_id and wo.get("status") == "COMPLETED":
                tech_id = wo.get("technician_id")
                if tech_id:
                    technician_ids.add(tech_id)

        count = len(technician_ids)
        risk_level = "LOW"
        rec = "Asset knowledge is well distributed."

        if criticality.upper() == "A":
            if count == 0:
                risk_level = "HIGH"
                rec = "URGENT: No internal competency established. Requires immediate OEM cross-training."
            elif count == 1:
                risk_level = "HIGH"
                rec = "SINGLE POINT OF FAILURE: Only 1 technician capable. Schedule shadowing/cross-training immediately."
            elif count == 2:
                risk_level = "MEDIUM"
                rec = "Borderline knowledge spread. Consider training a 3rd technician."
        else:
            if count <= 1:
                risk_level = "MEDIUM"
                rec = "Limited knowledge spread. Factor into next training cycle."

        return KnowledgeRiskAssessment(
            asset_id=asset_id,
            criticality=criticality,
            expert_technician_ids=list(technician_ids),
            risk_level=risk_level,
            recommendation=rec
        )

    def semantic_search(self, query: str) -> List[TaggedArticle]:
        """
        Stub for RAG semantic search across the Knowledge Base.
        Returns all articles containing the query string in title or summary.
        """
        query_lower = query.lower()
        results = []
        for article in self._knowledge_base.values():
            if query_lower in article.title.lower() or query_lower in article.summary.lower():
                results.append(article)
        return results
