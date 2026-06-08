"""
Abstract Base Class for Data Fabric Connectors.

Defines the contract for external system ingestion.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any, AsyncGenerator, Dict, Optional

from .schemas import ConnectorConfig

logger = logging.getLogger("ers.connectors.base")


class BaseConnector(ABC):
    """
    Abstract base class for all ERS Connectors.
    """

    def __init__(self, config: ConnectorConfig):
        self.config = config
        self.logger = logging.getLogger(f"ers.connectors.{self.config.type_}.{self.config.id}")

    @abstractmethod
    async def connect(self) -> None:
        """Establish connection to the external system."""
        pass

    @abstractmethod
    async def disconnect(self) -> None:
        """Close connection cleanly."""
        pass

    @abstractmethod
    async def test_connection(self) -> bool:
        """Validate credentials and reachability."""
        pass

    @abstractmethod
    async def get_schema(self) -> Dict[str, Any]:
        """Discover and return the external system schema metadata."""
        pass

    @abstractmethod
    async def get_field_mapping(self) -> Dict[str, str]:
        """Return the mapping from external fields to ERS standard fields."""
        pass

    @abstractmethod
    async def sync_full(self) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Yield all records from the target. 
        Paginated internally.
        """
        yield {}

    @abstractmethod
    async def sync_incremental(self) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Yield only records updated since the last watermark.
        """
        yield {}
