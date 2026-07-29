"""AI Product Index as LlamaIndex tools.

    pip install llama-index-core httpx
"""

from typing import Optional

import httpx
from llama_index.core.tools import FunctionTool

BASE = "https://index.percall.dev"


def search_ai_products(query: str = "", category: Optional[str] = None) -> str:
    """Search the AI Product Index for AI products, APIs, agents and MCP servers."""
    listings = httpx.get(f"{BASE}/api/index.json", timeout=15).json()["listings"]
    q = query.lower()
    hits = [
        l for l in listings
        if (not q or q in l["name"].lower() or q in l["description"].lower())
        and (not category or l["category"] == category)
    ]
    return "\n".join(
        f"{l['name']} ({l['category']}) — {l['description']} — {l['url']}" for l in hits
    ) or "No matching products."


def agent_readability_score(url: str) -> str:
    """Score how readable a website is to AI agents (A-F). Free."""
    r = httpx.get(f"{BASE}/api/score", params={"url": url}, timeout=60).json()
    if not r.get("ok"):
        return f"Could not score {url}: {r.get('error', 'unknown error')}"
    failed = [c["label"] for c in r["checks"] if not c["pass"]]
    return f"{r['letter']} ({r['score']}/100). Failing: {', '.join(failed) or 'nothing'}"


ai_product_index_tools = [
    FunctionTool.from_defaults(fn=search_ai_products),
    FunctionTool.from_defaults(fn=agent_readability_score),
]
