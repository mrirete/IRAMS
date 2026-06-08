"""
CSV polling connector.
Watches a directory, parses files with pandas.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, AsyncGenerator, Dict

import pandas as pd

from .base import BaseConnector
from .schemas import CSVConfig


class CSVConnector(BaseConnector):
    def __init__(self, config: CSVConfig):
        super().__init__(config)
        self.config: CSVConfig = config

    async def connect(self) -> None:
        # File paths do not need persistent connections
        pass

    async def disconnect(self) -> None:
        pass

    async def test_connection(self) -> bool:
        path = Path(self.config.directory_path)
        if not path.exists() or not path.is_dir():
            self.logger.error("Directory not found: %s", path)
            return False
        return True

    async def get_schema(self) -> Dict[str, Any]:
        """Read header from first matching file."""
        path = Path(self.config.directory_path)
        files = list(path.glob(self.config.file_pattern))
        if files:
            df = pd.read_csv(files[0], nrows=0, sep=self.config.delimiter)
            return {"columns": list(df.columns)}
        return {"columns": []}

    async def get_field_mapping(self) -> Dict[str, str]:
        return {}

    async def sync_full(self) -> AsyncGenerator[Dict[str, Any], None]:
        path = Path(self.config.directory_path)
        files = path.glob(self.config.file_pattern)

        for filepath in files:
            # Yield chunks to not blow memory
            for chunk in pd.read_csv(filepath, sep=self.config.delimiter, chunksize=1000):
                # Convert NaN to None for JSON serializability
                chunk = chunk.where(pd.notnull(chunk), None)
                records = chunk.to_dict("records")
                for rec in records:
                    yield rec

    async def sync_incremental(self) -> AsyncGenerator[Dict[str, Any], None]:
        # Stub implementation. Usually requires moving processed files to an archive dir.
        async for r in self.sync_full():
            yield r
