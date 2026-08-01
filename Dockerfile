# Dockerfile for Railway deployment
# Deploys the IREAMS FastAPI API Gateway with all Layer 2/3 modules

FROM python:3.11-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.11-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy installed packages from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy application source (only Python backend — not frontend)
COPY src/ /app/src/
COPY requirements.txt /app/

# Set Python path so imports work correctly
ENV PYTHONPATH=/app:/app/src
ENV PYTHONUNBUFFERED=1

# Railway injects PORT env var
EXPOSE ${PORT:-8000}

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8000}/api/v1/health || exit 1

# Start the gateway — Railway sets PORT dynamically
CMD uvicorn src.main:app --host 0.0.0.0 --port ${PORT:-8000}
