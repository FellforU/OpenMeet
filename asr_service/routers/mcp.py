"""MCP tool listing and invocation endpoints."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..knowledge.mcp_tools import TOOL_DEFINITIONS

router = APIRouter(prefix="/mcp", tags=["mcp"])

# Set by main.py during initialization
_mcp_tools = None


def set_mcp_tools(tools):
    global _mcp_tools
    _mcp_tools = tools


def _get_tools():
    if _mcp_tools is None:
        raise HTTPException(
            status_code=503,
            detail="MCP tools not initialized. Call POST /config first.",
        )
    return _mcp_tools


@router.get("/tools")
async def list_tools():
    return {"tools": TOOL_DEFINITIONS}


class InvokeRequest(BaseModel):
    name: str
    arguments: dict = {}


@router.post("/invoke")
async def invoke_tool(req: InvokeRequest):
    tools = _get_tools()
    result = await tools.invoke(req.name, req.arguments)
    return result
