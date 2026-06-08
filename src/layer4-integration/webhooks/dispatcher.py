"""Webhook dispatcher for outgoing ERS events."""
import logging
import httpx
import asyncio
from typing import List

from layer4_integration.schemas import WebhookEvent, WebhookSubscription

logger = logging.getLogger(__name__)

class WebhookDispatcher:
    """Dispatches webhook events to subscribed external systems."""
    
    def __init__(self, subscriptions: List[WebhookSubscription]):
        self.subscriptions = subscriptions
        self._client = httpx.AsyncClient(timeout=10.0)
        
    async def close(self):
        await self._client.aclose()

    async def _dispatch_to_subscriber(self, subscription: WebhookSubscription, event: WebhookEvent) -> bool:
        if event.event_type not in subscription.event_types:
            return False
            
        try:
            headers = subscription.headers or {}
            headers["Content-Type"] = "application/json"
            
            logger.info(f"Dispatching event {event.event_id} ({event.event_type}) to {subscription.target_url}")
            response = await self._client.post(
                subscription.target_url,
                json=event.dict(),
                headers=headers
            )
            response.raise_for_status()
            logger.debug(f"Successfully dispatched to {subscription.target_url}")
            return True
        except httpx.HTTPError as e:
            logger.error(f"Failed to dispatch to {subscription.target_url}: {str(e)}")
            # In production, we'd add it to a retry queue/DLQ here
            return False

    async def dispatch(self, event: WebhookEvent):
        """Dispatches an event to all appropriate, active subscriptions concurrently."""
        active_subs = [s for s in self.subscriptions if s.active]
        
        # Concurrently dispatch
        tasks = [self._dispatch_to_subscriber(sub, event) for sub in active_subs]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        success_count = sum(1 for r in results if r is True)
        logger.info(f"Event {event.event_id} dispatched successfully to {success_count} subscribers")
