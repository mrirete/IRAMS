"""
Connector Lifecycle Manager.
Registry pattern using APScheduler for intervals.
Routes ingestion data through the DQS scoring engine.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Type
from uuid import UUID, uuid4

from apscheduler.schedulers.asyncio import AsyncIOScheduler

# Import connector schemas and base
from .schemas import (
    ConnectorConfig,
    ConnectorHealth,
    ConnectorStatus,
    ConnectorSyncLog,
    ConnectorType,
    SyncMode,
    RESTConfig,
    OPCUAConfig,
    DatabaseConfig,
    MQTTConfig,
    CSVConfig,
    HistorianConfig,
)
from .base import BaseConnector

# Import specific connector implementations
from .rest_api import RESTConnector
from .opc_ua import OPCUAConnector
from .database import DatabaseConnector
from .mqtt import MQTTConnector
from .csv_file import CSVConnector
from .historian import HistorianConnector

# Hook up DQS for in-flight scoring
import sys
import os
sys.path.insert(0, os.path.realpath(os.path.join(os.path.dirname(__file__), "..", "..")))
try:
    from layer1_data_fabric.quality.engine import compute_dqs
except ModuleNotFoundError:
    # Handle the hyphens during direct run vs pytest alias
    def compute_dqs(*args, **kwargs):
        from types import SimpleNamespace
        return SimpleNamespace(composite_score=0.0)

logger = logging.getLogger("ers.connectors.manager")


# Factory mapping
_CONNECTOR_CLASSES: Dict[ConnectorType, Type[BaseConnector]] = {
    ConnectorType.REST_API: RESTConnector,
    ConnectorType.OPC_UA: OPCUAConnector,
    ConnectorType.DATABASE: DatabaseConnector,
    ConnectorType.MQTT: MQTTConnector,
    ConnectorType.CSV: CSVConnector,
    ConnectorType.HISTORIAN: HistorianConnector,
}


class ConnectorManager:
    """Manages lifecycles, registries, and scheduling of ERS Connectors."""

    def __init__(self):
        self.scheduler = AsyncIOScheduler(timezone=timezone.utc)
        self._registry: Dict[UUID, BaseConnector] = {}
        self._health: Dict[UUID, ConnectorHealth] = {}
        self._logs: list[ConnectorSyncLog] = [] # Memory stub, db in prod

    async def start(self) -> None:
        """Start the internal scheduler."""
        self.scheduler.start()
        logger.info("ConnectorManager scheduler started")

    async def stop(self) -> None:
        """Stop scheduler and disconnect all active connectors."""
        self.scheduler.shutdown(wait=True)
        for conn_id, conn in self._registry.items():
            try:
                await conn.disconnect()
            except Exception as e:
                logger.error("Error disconnecting %s: %s", conn_id, e)
        self._registry.clear()
        logger.info("ConnectorManager stopped")

    def register_connector(self, config: Any) -> BaseConnector:
        """Instantiate and register a connector implementation by config type."""
        ctype = config.type_
        klass = _CONNECTOR_CLASSES.get(ctype)
        if not klass:
            raise ValueError(f"Unknown connector type: {ctype}")

        connector = klass(config)
        self._registry[config.id] = connector
        self._health[config.id] = ConnectorHealth(
            connector_id=config.id,
            name=config.name,
            status=ConnectorStatus.STOPPED,
        )

        if config.is_active:
            # Schedule sync loop
            job_id = f"sync_{config.id}"
            if self.scheduler.get_job(job_id):
                self.scheduler.remove_job(job_id)
            
            self.scheduler.add_job(
                self._sync_task,
                "interval",
                seconds=config.sync_interval_seconds,
                args=[config.id, SyncMode.INCREMENTAL],
                id=job_id,
            )
            self._health[config.id].status = ConnectorStatus.RUNNING
            self._health[config.id].next_sync = self.scheduler.get_job(job_id).next_run_time

        logger.info("Registered connector %s (%s)", config.id, ctype)
        return connector

    def get_health(self) -> Dict[UUID, ConnectorHealth]:
        # Update next_syncs from scheduler
        for cid, health in self._health.items():
            job = self.scheduler.get_job(f"sync_{cid}")
            if job:
                health.next_sync = job.next_run_time
        return self._health

    async def trigger_sync(self, connector_id: UUID, mode: SyncMode = SyncMode.FULL) -> None:
        """Manually trigger a foreground sync."""
        await self._sync_task(connector_id, mode)

    async def _sync_task(self, connector_id: UUID, mode: SyncMode) -> None:
        """The core sync loop executed by APScheduler. Features exponential backoff on retries."""
        connector = self._registry.get(connector_id)
        health = self._health.get(connector_id)
        if not connector or not health:
            return

        cfg = connector.config
        
        # Exponential backoff loop
        max_attempts = cfg.retry_max_attempts
        base_backoff = cfg.retry_backoff_base_seconds
        
        for attempt in range(1, max_attempts + 1):
            start_time = datetime.now(tz=timezone.utc)
            processed, failed = 0, 0
            dqs_sum = 0.0
            error_msg = None
            
            try:
                if mode == SyncMode.FULL:
                    iterator = connector.sync_full()
                elif mode == SyncMode.INCREMENTAL or mode == SyncMode.DRY_RUN:
                    iterator = connector.sync_incremental()
                
                async for record in iterator:
                    if mode != SyncMode.DRY_RUN:
                        # ── In-flight DQS Scoring ──
                        # Route through DQS scorer
                        asset_id = uuid4() # In real impl, look up from MDM mapping
                        dqs_res = compute_dqs(
                            asset_id=asset_id,
                            record=record,
                            record_type=cfg.dqs_record_type,
                            asset_class=cfg.dqs_asset_class,
                            last_sync_at=start_time,
                            source_type=str(cfg.type_),
                            consistent_refs=1,
                            total_refs=1,
                        )
                        dqs_sum += getattr(dqs_res, "composite_score", 0.0)
                        
                        # In real impl, store the mapped/scored record in generic DB or cache here
                    processed += 1

                # Success - break retry loop
                health.status = ConnectorStatus.RUNNING
                health.last_sync = datetime.now(tz=timezone.utc)
                health.error_message = None
                break

            except Exception as e:
                error_msg = str(e)
                failed += 1
                logger.warning(
                    "Connector %s sync failed (attempt %d/%d): %s", 
                    connector_id, attempt, max_attempts, e
                )
                if attempt < max_attempts:
                    await asyncio.sleep(base_backoff ** attempt)
                else:
                    health.status = ConnectorStatus.ERROR
                    health.error_message = error_msg
                    logger.error("Connector %s sync aborted after %d attempts.", connector_id, max_attempts)

        # Write log
        end_time = datetime.now(tz=timezone.utc)
        log = ConnectorSyncLog(
            log_id=uuid4(),
            connector_id=connector_id,
            mode=mode,
            start_time=start_time,
            end_time=end_time,
            records_processed=processed,
            records_failed=failed,
            error_message=error_msg,
            average_dqs_score=(dqs_sum / processed) if processed > 0 else None,
        )
        self._logs.append(log)


# Singleton
manager = ConnectorManager()
