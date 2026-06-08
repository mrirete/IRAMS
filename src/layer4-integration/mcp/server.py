"""Model Context Protocol (MCP) Server for ERS."""
import logging
import json
from typing import Any, Dict

try:
    from mcp.server import Server, NotificationOptions
    from mcp.server.models import InitializationOptions
    import mcp.types as types
    import mcp.server.stdio
    HAS_MCP = True
except ImportError:
    HAS_MCP = False
    logging.warning("mcp package not found. MCP server will not run. Run `pip install mcp`")

logger = logging.getLogger(__name__)

if HAS_MCP:
    ers_server = Server("ers-integration-hub")

    @ers_server.list_tools()
    async def handle_list_tools() -> list[types.Tool]:
        """List available ERS tools."""
        return [
            types.Tool(
                name="get_asset_health",
                description="Get the current health score, RUL, and condition indices for a given asset ID.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "equipment_id": {"type": "string"}
                    },
                    "required": ["equipment_id"]
                }
            ),
            types.Tool(
                name="draft_work_request",
                description="Draft a new Work Request based on anomalies or condition drops.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "equipment_id": {"type": "string"},
                        "description": {"type": "string"},
                        "priority": {"type": "string", "enum": ["LOW", "MEDIUM", "HIGH", "EMERGENCY"]}
                    },
                    "required": ["equipment_id", "description"]
                }
            )
        ]

    @ers_server.call_tool()
    async def handle_call_tool(
        name: str, arguments: dict | None
    ) -> list[types.TextContent | types.ImageContent | types.EmbeddedResource]:
        """Execute ERS tool requests."""
        if not arguments:
            raise ValueError("Missing arguments")

        if name == "get_asset_health":
            equipment_id = arguments.get("equipment_id")
            # Mock bridge to predict module
            health_data = {
                "equipment_id": equipment_id,
                "overall_health_score": 88.5,
                "rul_days": 112,
                "status": "HEALTHY",
                "active_alerts": []
            }
            return [types.TextContent(type="text", text=json.dumps(health_data, indent=2))]
            
        elif name == "draft_work_request":
            equipment_id = arguments.get("equipment_id")
            description = arguments.get("description")
            priority = arguments.get("priority", "MEDIUM")
            # Mock bridge to WO module
            wo_data = {
                "work_request_id": "WR-99120",
                "equipment_id": equipment_id,
                "status": "DRAFT",
                "priority": priority,
                "message": "Work request drafted via MCP."
            }
            return [types.TextContent(type="text", text=json.dumps(wo_data, indent=2))]
            
        else:
            raise ValueError(f"Unknown tool: {name}")

    async def run_mcp_stdio():
        """Run the MCP server over standard input/output streams."""
        logger.info("Starting ERS MCP Server over stdio...")
        async with mcp.server.stdio.stdio_server() as (read_stream, write_stream):
            await ers_server.run(
                read_stream,
                write_stream,
                InitializationOptions(
                    server_name="ers-integration-hub",
                    server_version="1.0.0",
                    capabilities=ers_server.get_capabilities(
                        notification_options=NotificationOptions(),
                        experimental_capabilities={},
                    )
                )
            )

def run():
    if not HAS_MCP:
        print("MCP SDK not installed. Skipping server start.")
        return
    import asyncio
    asyncio.run(run_mcp_stdio())

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
