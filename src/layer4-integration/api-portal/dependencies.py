"""API Authorization dependencies."""
import time
from fastapi import HTTPException, Security, Request
from fastapi.security.api_key import APIKeyHeader
from starlette.status import HTTP_403_FORBIDDEN, HTTP_429_TOO_MANY_REQUESTS

from layer4_integration.schemas import APIKeyRecord

API_KEY_NAME = "X-API-Key"
api_key_header = APIKeyHeader(name=API_KEY_NAME, auto_error=False)

# Mocked DB for demonstration purposes. In real ERS, this connects to the DB mapped via schemas.py
MOCK_API_KEYS = {
    "test-dev-key": APIKeyRecord(
        key_id="k1", hashed_key="mock_hash", owner="dev_testing", rate_limit_rpm=10
    )
}

# Simple Token Bucket state for dev mock
_RATE_LIMIT_STORE = {}

async def verify_api_key(api_key_header: str = Security(api_key_header), request: Request = None) -> APIKeyRecord:
    if not api_key_header:
        raise HTTPException(status_code=HTTP_403_FORBIDDEN, detail="API Key header missing")
        
    # Validation logic (Mocked for testing. Typically we'd hash the key and lookup db)
    record = MOCK_API_KEYS.get(api_key_header)
    if not record or not record.active:
        raise HTTPException(status_code=HTTP_403_FORBIDDEN, detail="Invalid or inactive API Key")
        
    # Rate Limiting check
    now = time.time()
    if record.key_id not in _RATE_LIMIT_STORE:
        _RATE_LIMIT_STORE[record.key_id] = []
        
    # cleanup old requests outside the 60s window
    _RATE_LIMIT_STORE[record.key_id] = [t for t in _RATE_LIMIT_STORE[record.key_id] if now - t < 60]
    
    if len(_RATE_LIMIT_STORE[record.key_id]) >= record.rate_limit_rpm:
        raise HTTPException(status_code=HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded")
        
    _RATE_LIMIT_STORE[record.key_id].append(now)
    
    return record
