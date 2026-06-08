"""
RAG Engine (PROMPT 12.3)
════════════════════════
pgvector-based Retrieval-Augmented Generation with 512-token chunking,
embedding stubs, vector search simulation, reranking, and source attribution.
Includes safety exclusion zone enforcement.
"""
import hashlib
import math
import os
import re
from typing import List, Dict, Any, Optional
from uuid import uuid4
import logging

from layer3_agents.schemas import DocumentChunk, RAGSearchResult, RAGResponse

logger = logging.getLogger("ers.rag")

# ── Gemini Embedding Client (Optional) ───────────────────────
_EMBED_MODEL = "text-embedding-004"
_embedding_client = None

def _get_embed_client():
    global _embedding_client
    if _embedding_client is None:
        try:
            import google.generativeai as genai
            api_key = os.getenv("GEMINI_API_KEY", "")
            if api_key:
                genai.configure(api_key=api_key)
                _embedding_client = genai
                logger.info("RAG embedding client initialized (model: %s)", _EMBED_MODEL)
            else:
                logger.warning("GEMINI_API_KEY not set — using mock embeddings")
        except ImportError:
            logger.warning("google-generativeai not installed — using mock embeddings")
    return _embedding_client


# Safety exclusion keywords — queries containing these are blocked
_SAFETY_EXCLUSION_PATTERNS = [
    r"bypass\s+(safety|interlock|alarm)",
    r"disable\s+(alarm|trip|interlock|shutdown)",
    r"override\s+(safety|protection|psm)",
    r"how\s+to\s+defeat",
    r"remove\s+safety\s+guard",
]


class RAGEngine:
    """Retrieval-Augmented Generation engine with safety enforcement."""

    def __init__(self, chunk_size: int = 512):
        self.chunk_size = chunk_size
        # In production: pgvector connection pool
        self._vector_store: List[DocumentChunk] = []

    # ── Chunking ───────────────────────────────────────────────

    def chunk_document(self, text: str, source: str, overlap: int = 64) -> List[DocumentChunk]:
        """
        Split a document into overlapping chunks of ~chunk_size tokens.
        Uses whitespace-based token approximation (production: tiktoken).
        """
        tokens = text.split()
        chunks = []
        i = 0
        idx = 0

        while i < len(tokens):
            chunk_tokens = tokens[i:i + self.chunk_size]
            chunk_text = " ".join(chunk_tokens)
            
            chunk = DocumentChunk(
                source_document=source,
                chunk_index=idx,
                text=chunk_text,
                token_count=len(chunk_tokens),
                embedding=None  # Will be filled by embed_chunks
            )
            chunks.append(chunk)
            i += max(1, self.chunk_size - overlap)
            idx += 1

        return chunks

    # ── Embedding (Stub) ──────────────────────────────────────

    def embed_chunks(self, chunks: List[DocumentChunk]) -> List[DocumentChunk]:
        """
        Embed document chunks using Gemini text-embedding-004.
        Falls back to deterministic hash-based mock when API is unavailable.
        """
        client = _get_embed_client()

        if client is not None:
            # Production path: batch embed via Gemini
            try:
                texts = [c.text for c in chunks]
                # Batch in groups of 100 (API limit)
                for batch_start in range(0, len(texts), 100):
                    batch_texts = texts[batch_start:batch_start + 100]
                    result = client.embed_content(
                        model=_EMBED_MODEL,
                        content=batch_texts,
                        task_type="RETRIEVAL_DOCUMENT",
                    )
                    embeddings = result["embedding"] if isinstance(result.get("embedding"), list) and isinstance(result["embedding"][0], list) else [result.get("embedding", [])]
                    # Handle both single and batch responses
                    if len(embeddings) == 1 and len(batch_texts) > 1:
                        # API returned single embedding for batch — re-embed individually
                        for i, text in enumerate(batch_texts):
                            r = client.embed_content(
                                model=_EMBED_MODEL,
                                content=text,
                                task_type="RETRIEVAL_DOCUMENT",
                            )
                            chunks[batch_start + i].embedding = r.get("embedding", [])
                    else:
                        for i, emb in enumerate(embeddings):
                            if batch_start + i < len(chunks):
                                chunks[batch_start + i].embedding = emb

                logger.info("Embedded %d chunks via %s", len(chunks), _EMBED_MODEL)
                return chunks
            except Exception as e:
                logger.warning("Gemini embedding failed, falling back to mock: %s", e)

        # Fallback: deterministic hash-based mock embedding (128-dim)
        for chunk in chunks:
            h = hashlib.md5(chunk.text.encode()).hexdigest()
            chunk.embedding = [int(c, 16) / 15.0 for c in h[:128].ljust(128, '0')]
        return chunks

    def ingest_document(self, text: str, source: str) -> int:
        """Chunk, embed, and store a document. Returns number of chunks stored."""
        chunks = self.chunk_document(text, source)
        chunks = self.embed_chunks(chunks)
        self._vector_store.extend(chunks)
        return len(chunks)

    # ── Vector Search (Stub) ──────────────────────────────────

    def vector_search(self, query: str, top_k: int = 10) -> List[RAGSearchResult]:
        """
        Vector search using cosine similarity when real embeddings are available.
        Falls back to token overlap when embeddings are mock (128-dim hash).
        In production: SELECT * FROM documents ORDER BY embedding <=> query_embedding LIMIT k
        """
        results = []

        # Try embedding-based search first
        client = _get_embed_client()
        query_embedding = None
        if client is not None:
            try:
                r = client.embed_content(
                    model=_EMBED_MODEL,
                    content=query,
                    task_type="RETRIEVAL_QUERY",
                )
                query_embedding = r.get("embedding", None)
            except Exception as e:
                logger.warning("Query embedding failed: %s", e)

        for chunk in self._vector_store:
            if query_embedding and chunk.embedding and len(query_embedding) == len(chunk.embedding):
                # Cosine similarity
                score = self._cosine_similarity(query_embedding, chunk.embedding)
            else:
                # Fallback: token overlap
                q_tokens = set(query.lower().split())
                chunk_tokens = set(chunk.text.lower().split())
                overlap = len(q_tokens & chunk_tokens)
                score = min(overlap / max(len(q_tokens), 1), 1.0) if overlap > 0 else 0.0

            if score > 0:
                results.append(RAGSearchResult(chunk=chunk, similarity_score=round(score, 4)))

        results.sort(key=lambda r: r.similarity_score, reverse=True)
        return results[:top_k]

    @staticmethod
    def _cosine_similarity(a: List[float], b: List[float]) -> float:
        """Compute cosine similarity between two vectors."""
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = math.sqrt(sum(x * x for x in a))
        norm_b = math.sqrt(sum(x * x for x in b))
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)

    # ── Reranking (Stub) ──────────────────────────────────────

    def rerank_results(self, query: str, candidates: List[RAGSearchResult], top_k: int = 5) -> List[RAGSearchResult]:
        """
        Cross-encoder rescoring using Gemini embeddings for semantic relevance.
        
        When the Gemini API is available, re-embeds the query and each candidate
        chunk using RETRIEVAL_QUERY/RETRIEVAL_DOCUMENT task types respectively,
        computing fresh cosine similarity scores. This acts as a pseudo cross-encoder
        that captures deeper semantic relationships missed by the initial retrieval.
        
        Falls back to vector similarity + term-frequency combo when API is unavailable.
        
        Production upgrade path: Replace with Cohere Rerank API or a fine-tuned
        cross-encoder model (e.g. ms-marco-MiniLM) for even better precision.
        """
        if not candidates:
            return []

        client = _get_embed_client()
        
        # ── Path 1: Gemini cross-encoder rescoring ─────────────────
        if client is not None:
            try:
                # Embed query with RETRIEVAL_QUERY task type
                q_result = client.embed_content(
                    model=_EMBED_MODEL,
                    content=query,
                    task_type="RETRIEVAL_QUERY",
                )
                query_emb = q_result.get("embedding", [])

                if query_emb:
                    scored = []
                    # Batch re-embed candidate texts for cross-encoder scoring
                    candidate_texts = [r.chunk.text[:512] for r in candidates]  # Truncate for API limits
                    
                    # Process in batches of 20 to avoid API limits
                    all_candidate_embs: List[List[float]] = []
                    for batch_start in range(0, len(candidate_texts), 20):
                        batch = candidate_texts[batch_start:batch_start + 20]
                        c_result = client.embed_content(
                            model=_EMBED_MODEL,
                            content=batch,
                            task_type="RETRIEVAL_DOCUMENT",
                        )
                        emb_data = c_result.get("embedding", [])
                        # Handle both single and batch responses
                        if isinstance(emb_data, list) and len(emb_data) > 0:
                            if isinstance(emb_data[0], list):
                                all_candidate_embs.extend(emb_data)
                            else:
                                # Single embedding returned for batch of 1
                                all_candidate_embs.append(emb_data)
                        
                    # Score each candidate
                    for i, r in enumerate(candidates):
                        if i < len(all_candidate_embs):
                            # Cross-encoder semantic score
                            semantic_score = self._cosine_similarity(query_emb, all_candidate_embs[i])
                            # Term-frequency boost for exact-match relevance
                            q_tokens = set(query.lower().split())
                            chunk_tokens = set(r.chunk.text.lower().split())
                            tf_score = len(q_tokens & chunk_tokens) / max(len(q_tokens), 1)
                            # Combined: 70% cross-encoder semantic + 20% original vector + 10% TF
                            combined = 0.70 * semantic_score + 0.20 * r.similarity_score + 0.10 * tf_score
                        else:
                            # Fallback for candidates beyond embedding batch
                            combined = r.similarity_score
                        scored.append((r, combined))

                    scored.sort(key=lambda x: x[1], reverse=True)
                    logger.info("Cross-encoder reranked %d candidates", len(scored))
                    return [r for r, _ in scored[:top_k]]

            except Exception as e:
                logger.warning("Cross-encoder reranking failed, falling back: %s", e)

        # ── Path 2: Fallback — vector similarity + TF combo ────────
        q_tokens = set(query.lower().split())
        scored = []
        for r in candidates:
            chunk_tokens = set(r.chunk.text.lower().split())
            # Term frequency boost
            tf_score = len(q_tokens & chunk_tokens) / max(len(q_tokens), 1)
            # Combined: 70% vector + 30% TF
            combined = 0.7 * r.similarity_score + 0.3 * tf_score
            scored.append((r, combined))
        scored.sort(key=lambda x: x[1], reverse=True)
        return [r for r, _ in scored[:top_k]]

    # ── Safety Exclusion Zone ─────────────────────────────────

    def _check_safety_exclusion(self, query: str) -> Optional[str]:
        """Check if the query attempts to bypass safety systems."""
        q_lower = query.lower()
        for pattern in _SAFETY_EXCLUSION_PATTERNS:
            if re.search(pattern, q_lower):
                return f"Query blocked by safety exclusion zone. Matched pattern: '{pattern}'"
        return None

    # ── Query Pipeline ────────────────────────────────────────

    def query(self, query: str, top_k: int = 5) -> RAGResponse:
        """
        Full RAG pipeline: safety check → search → rerank → format with sources.
        """
        # 1. Safety exclusion check
        safety_block = self._check_safety_exclusion(query)
        if safety_block:
            return RAGResponse(
                query=query,
                answer="",
                sources=[],
                safety_blocked=True,
                safety_reason=safety_block
            )

        # 2. Vector search
        candidates = self.vector_search(query, top_k=top_k * 2)

        # 3. Rerank
        top_results = self.rerank_results(query, candidates, top_k=top_k)

        # 4. Format with source attribution
        sources = []
        context_text = ""
        for r in top_results:
            sources.append({
                "document": r.chunk.source_document,
                "chunk_index": r.chunk.chunk_index,
                "score": r.similarity_score,
                "excerpt": r.chunk.text[:200] + "..." if len(r.chunk.text) > 200 else r.chunk.text
            })
            context_text += r.chunk.text + "\n\n"

        # In production: Pass context_text to LLM for answer generation
        answer = f"Based on {len(top_results)} sources: {context_text[:300]}..." if top_results else "No relevant documents found."

        return RAGResponse(
            query=query,
            answer=answer,
            sources=sources,
            safety_blocked=False
        )
