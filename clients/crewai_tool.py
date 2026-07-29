"""AI Product Index as a CrewAI tool.

    pip install crewai-tools httpx pydantic
"""

from typing import Optional, Type

import httpx
from crewai_tools import BaseTool
from pydantic import BaseModel, Field

BASE = "https://index.percall.dev"


class SearchInput(BaseModel):
    query: str = Field(default="", description="Words to match in name or description.")
    category: Optional[str] = Field(
        default=None, description="One of api, app, agent, mcp, other."
    )


class AIProductIndexTool(BaseTool):
    name: str = "AI Product Index"
    description: str = (
        "Search a directory of AI products, APIs, agents and MCP servers that "
        "registered themselves so agents could discover them."
    )
    args_schema: Type[BaseModel] = SearchInput

    def _run(self, query: str = "", category: Optional[str] = None) -> str:
        listings = httpx.get(f"{BASE}/api/index.json", timeout=15).json()["listings"]
        q = query.lower()
        hits = [
            l for l in listings
            if (not q or q in l["name"].lower() or q in l["description"].lower())
            and (not category or l["category"] == category)
        ]
        return "\n".join(
            f"{l['name']} ({l['category']}, {l['pricing']}) — {l['description']} — {l['url']}"
            for l in hits
        ) or "No matching products."
