"""
Agent Router Engine (PROMPT 12.1)
═════════════════════════════════
Classifies user intent by keyword overlap, routes to the correct
specialist agent, and orchestrates multi-agent collaboration for
cross-domain queries.
"""
from typing import List, Dict, Any, Optional, Type
from uuid import uuid4
import logging
import os
import math

from layer3_agents.agents.base import BaseAgent
from layer3_agents.agents.reliability_analyst import ReliabilityAnalystAgent
from layer3_agents.agents.predictive_maintenance import PredictiveMaintenanceAgent
from layer3_agents.agents.strategic_asset import StrategicAssetAgent
from layer3_agents.agents.work_intelligence import WorkIntelligenceAgent
from layer3_agents.agents.compliance_safety import ComplianceSafetyAgent
from layer3_agents.agents.asset_integrity_auditor import AssetIntegrityAuditorAgent
from layer3_agents.agents.inspection_vision import InspectionVisionAgent
from layer3_agents.agents.sustainability import SustainabilityAgent
from layer3_agents.agents.knowledge_people import KnowledgePeopleAgent

from layer3_agents.schemas import (
    AgentDomain, IntentClassification, AgentRoute, AgentResponse,
    CollaborationPlan, CollaborationStep
)

logger = logging.getLogger("ers.router")

# ── Embedding-based Intent Classification ────────────────────
_intent_embeddings: Dict[str, List[float]] = {}
_intent_initialized = False


def _init_intent_embeddings(agents: Dict[AgentDomain, 'BaseAgent']) -> None:
    """Pre-compute keyword embeddings for each agent domain (once at startup)."""
    global _intent_embeddings, _intent_initialized
    if _intent_initialized:
        return
    _intent_initialized = True

    try:
        import google.generativeai as genai
        api_key = os.getenv("GEMINI_API_KEY", "")
        if not api_key:
            logger.info("No GEMINI_API_KEY — using keyword-only intent classification")
            return
        genai.configure(api_key=api_key)

        for domain, agent in agents.items():
            # Create a representative text from the agent's keywords
            keyword_text = ", ".join(agent.KEYWORDS[:20])
            result = genai.embed_content(
                model="text-embedding-004",
                content=keyword_text,
                task_type="RETRIEVAL_DOCUMENT",
            )
            embedding = result.get("embedding", [])
            if embedding:
                _intent_embeddings[domain.value] = embedding

        logger.info("Intent embeddings initialized for %d agents", len(_intent_embeddings))
    except Exception as e:
        logger.warning("Failed to initialize intent embeddings: %s", e)


def _cosine_sim(a: List[float], b: List[float]) -> float:
    """Cosine similarity between two vectors."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    return dot / (norm_a * norm_b) if norm_a > 0 and norm_b > 0 else 0.0


class AgentRouterEngine:
    """Intent classifier and multi-agent orchestrator.
    
    Uses embedding-based semantic similarity when Gemini API is available,
    with keyword overlap as fallback. Confidence threshold: 0.3 minimum.
    """

    CONFIDENCE_THRESHOLD = 0.3  # Below this, route to default agent

    def __init__(self):
        # Instantiate all 9 agents
        self._agents: Dict[AgentDomain, BaseAgent] = {
            AgentDomain.RELIABILITY_ANALYST: ReliabilityAnalystAgent(),
            AgentDomain.PREDICTIVE_MAINTENANCE: PredictiveMaintenanceAgent(),
            AgentDomain.STRATEGIC_ASSET: StrategicAssetAgent(),
            AgentDomain.WORK_INTELLIGENCE: WorkIntelligenceAgent(),
            AgentDomain.COMPLIANCE_SAFETY: ComplianceSafetyAgent(),
            AgentDomain.ASSET_INTEGRITY_AUDITOR: AssetIntegrityAuditorAgent(),
            AgentDomain.INSPECTION_VISION: InspectionVisionAgent(),
            AgentDomain.SUSTAINABILITY: SustainabilityAgent(),
            AgentDomain.KNOWLEDGE_PEOPLE: KnowledgePeopleAgent(),
        }
        # Lazy-init intent embeddings on first classify call
        self._embeddings_init_attempted = False

    def classify_intent(self, query: str) -> IntentClassification:
        """
        Classify user intent using semantic similarity (primary) or
        keyword overlap (fallback). Returns ranked agents with confidence.
        """
        # Lazy-init embeddings
        if not self._embeddings_init_attempted:
            self._embeddings_init_attempted = True
            _init_intent_embeddings(self._agents)

        q_lower = query.lower()
        q_tokens = set(q_lower.split())
        scores: List[Dict[str, Any]] = []

        # ── Path 1: Embedding-based similarity ────────────────
        if _intent_embeddings:
            try:
                import google.generativeai as genai
                result = genai.embed_content(
                    model="text-embedding-004",
                    content=query,
                    task_type="RETRIEVAL_QUERY",
                )
                query_embedding = result.get("embedding", [])

                if query_embedding:
                    for domain_value, domain_embedding in _intent_embeddings.items():
                        sim = _cosine_sim(query_embedding, domain_embedding)
                        if sim > 0.1:  # Minimum threshold to even consider
                            # Also check keyword overlap for boosting
                            agent = self._agents[AgentDomain(domain_value)]
                            kw_matched = []
                            for kw in agent.KEYWORDS:
                                kw_lower = kw.lower()
                                if " " in kw_lower:
                                    if kw_lower in q_lower:
                                        kw_matched.append(kw)
                                elif kw_lower in q_tokens:
                                    kw_matched.append(kw)

                            # Combine: 60% semantic + 40% keyword
                            kw_score = min(len(kw_matched), 5) / 5.0
                            combined = 0.6 * sim + 0.4 * kw_score
                            scores.append({
                                "domain": domain_value,
                                "score": round(combined * 5, 2),  # Normalize to existing 0-5 scale
                                "semantic_score": round(sim, 3),
                                "matched_keywords": kw_matched,
                            })
            except Exception as e:
                logger.warning("Semantic intent classification failed: %s", e)
                scores = []  # Fall through to keyword-only

        # ── Path 2: Keyword-only fallback ─────────────────────
        if not scores:
            for domain, agent in self._agents.items():
                matched = []
                score = 0.0

                for keyword in agent.KEYWORDS:
                    kw_lower = keyword.lower()
                    if " " in kw_lower:
                        if kw_lower in q_lower:
                            matched.append(keyword)
                            score += 2.0
                    else:
                        if kw_lower in q_tokens:
                            matched.append(keyword)
                            score += 1.0

                if matched:
                    scores.append({
                        "domain": domain.value,
                        "score": score,
                        "matched_keywords": matched
                    })

        # Sort by score descending
        scores.sort(key=lambda x: x["score"], reverse=True)

        # Confidence threshold: if best score < threshold, default to WorkIntelligence
        requires_collab = len(scores) >= 2 and scores[1]["score"] >= 1.0
        primary = AgentDomain(scores[0]["domain"]) if scores and scores[0]["score"] >= self.CONFIDENCE_THRESHOLD else AgentDomain.WORK_INTELLIGENCE

        return IntentClassification(
            query=query,
            matched_agents=scores,
            primary_agent=primary,
            requires_collaboration=requires_collab
        )

    def route(self, query: str) -> AgentRoute:
        """Classify and return the primary routing decision."""
        classification = self.classify_intent(query)
        
        primary_match = classification.matched_agents[0] if classification.matched_agents else {
            "domain": AgentDomain.WORK_INTELLIGENCE.value,
            "score": 0.0,
            "matched_keywords": []
        }

        return AgentRoute(
            query=query,
            target_agent=classification.primary_agent,
            confidence=min(primary_match["score"] / 5.0, 1.0),  # Normalize to 0-1
            matched_keywords=primary_match.get("matched_keywords", [])
        )

    def execute_single(self, query: str, context: Optional[Dict[str, Any]] = None) -> AgentResponse:
        """Route to a single agent and execute."""
        route = self.route(query)
        agent = self._agents[route.target_agent]
        return agent.execute(query, context)

    def build_collaboration_plan(self, query: str) -> CollaborationPlan:
        """
        For cross-domain queries, build an ordered execution plan
        involving multiple agents.
        """
        classification = self.classify_intent(query)
        
        # Take top agents that scored >= 1.0
        involved = [
            AgentDomain(m["domain"]) 
            for m in classification.matched_agents 
            if m["score"] >= 1.0
        ]

        if len(involved) < 2:
            involved = [classification.primary_agent]

        steps = []
        for i, agent_domain in enumerate(involved):
            steps.append(CollaborationStep(
                order=i + 1,
                agent=agent_domain,
                sub_query=query,  # In production: decompose into sub-queries
                depends_on=i if i > 0 else None
            ))

        return CollaborationPlan(
            original_query=query,
            steps=steps,
            agents_involved=involved
        )

    def execute_collaboration(self, query: str, context: Optional[Dict[str, Any]] = None) -> List[AgentResponse]:
        """Execute a multi-agent collaboration plan and return all responses."""
        plan = self.build_collaboration_plan(query)
        responses = []
        
        for step in plan.steps:
            agent = self._agents[step.agent]
            response = agent.execute(step.sub_query, context)
            responses.append(response)

        return responses
