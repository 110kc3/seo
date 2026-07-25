"""AI Product Index as a LangChain tool. Paste into your project; no package to install.

    pip install langchain-core httpx

The registry is a plain JSON document, so this is a thin, honest wrapper: one
GET, filtered locally. No key, no account, no rate limit.
"""

from typing import Optional

import httpx
from langchain_core.tools import tool

BASE = "https://index.kc-it.pl"


@tool
def search_ai_products(query: str = "", category: Optional[str] = None) -> str:
    """Search the AI Product Index — a directory of AI products, APIs, agents and
    MCP servers that registered themselves for agents to discover.

    Args:
        query: words to match against name and description. Empty returns all.
        category: one of api, app, agent, mcp, other.
    """
    listings = httpx.get(f"{BASE}/api/index.json", timeout=15).json()["listings"]
    q = query.lower()
    hits = [
        l for l in listings
        if (not q or q in l["name"].lower() or q in l["description"].lower())
        and (not category or l["category"] == category)
    ]
    if not hits:
        return "No matching products."
    return "\n".join(
        f"{l['name']} ({l['category']}, {l['pricing']}) — {l['description']} — {l['url']}"
        for l in hits
    )


@tool
def agent_readability_score(url: str) -> str:
    """Score how readable a website is to AI agents: A-F plus which of 13 checks
    failed. Free. For the reason each check failed and paste-ready fixes, the paid
    endpoint is POST /api/audit (see pay_x402.py)."""
    r = httpx.get(f"{BASE}/api/score", params={"url": url}, timeout=60).json()
    if not r.get("ok"):
        return f"Could not score {url}: {r.get('error', 'unknown error')}"
    failed = [c["label"] for c in r["checks"] if not c["pass"]]
    return (
        f"{r['letter']} ({r['score']}/100, {r['grade']}). "
        f"Passed {r['passed']}/{r['total_checks']}. "
        + ("Failing: " + ", ".join(failed) if failed else "Everything passes.")
    )
