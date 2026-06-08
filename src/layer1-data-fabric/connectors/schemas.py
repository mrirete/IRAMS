"""
Pydantic schemas for the Connector Framework.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ConnectorType(str, Enum):
    REST_API = "rest_api"
    OPC_UA = "opc_ua"
    DATABASE = "database"
    MQTT = "mqtt"
    CSV = "csv"
    HISTORIAN = "historian"


class ConnectorStatus(str, Enum):
    STOPPED = "stopped"
    STARTING = "starting"
    RUNNING = "running"
    ERROR = "error"


class SyncMode(str, Enum):
    FULL = "full"
    INCREMENTAL = "incremental"
    DRY_RUN = "dry_run"


# ── Configuration Schemas ─────────────────────────────────────

class ConnectorConfig(BaseModel):
    """Base configuration for all connectors."""
    model_config = ConfigDict(from_attributes=True, extra="allow")
    
    id: UUID
    name: str
    type_: ConnectorType = Field(alias="type")
    is_active: bool = True
    sync_interval_seconds: int = 3600
    retry_max_attempts: int = 5
    retry_backoff_base_seconds: int = 2
    
    # Target DQS record type mapping
    dqs_record_type: str = "asset"
    dqs_asset_class: str = "General"


class RESTConfig(ConnectorConfig):
    base_url: str
    auth_type: str = "bearer"
    auth_token: Optional[str] = None
    auth_user: Optional[str] = None
    auth_pass: Optional[str] = None
    pagination_style: str = "offset"  # offset, cursor, page
    rate_limit_rpm: int = 60


class OPCUAConfig(ConnectorConfig):
    endpoint_url: str
    username: Optional[str] = None
    password: Optional[str] = None
    namespace_index: int = 2
    root_node_id: str = "ns=2;i=85"


class DatabaseConfig(ConnectorConfig):
    connection_url: str  # async format (e.g. postgresql+asyncpg://)
    query: str
    incremental_column: Optional[str] = None


class MQTTConfig(ConnectorConfig):
    broker_url: str
    port: int = 1883
    topic: str
    qos: int = 1
    client_id: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None


class CSVConfig(ConnectorConfig):
    directory_path: str
    file_pattern: str = "*.csv"
    delimiter: str = ","
    has_header: bool = True


class HistorianConfig(ConnectorConfig):
    server_name: str
    api_url: str
    username: str
    password: str
    tag_prefix: str = ""


# ── Log and Status Schemas ───────────────────────────────────

class ConnectorSyncLog(BaseModel):
    """Log entry written after every scheduled sync."""
    log_id: UUID
    connector_id: UUID
    mode: SyncMode
    start_time: datetime
    end_time: datetime
    records_processed: int
    records_failed: int
    error_message: Optional[str] = None
    average_dqs_score: Optional[float] = None


class ConnectorHealth(BaseModel):
    connector_id: UUID
    name: str
    status: ConnectorStatus
    last_sync: Optional[datetime] = None
    next_sync: Optional[datetime] = None
    error_message: Optional[str] = None
