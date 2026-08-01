# Build spec for the Glama MCP registry, which starts the server and calls
# initialize + tools/list over stdio to decide whether the listing is healthy.
# Nothing else in this project uses it: the hosted server is a Cloudflare Worker
# at https://index.percall.dev/mcp, and local users run `node mcp/server.mjs`
# against a checkout. It exists so that health check has one deterministic way
# to start the stdio server rather than guessing at an entrypoint.
FROM node:22-alpine

WORKDIR /app

# The stdio server has no dependencies — there is deliberately no npm install
# here — but it does read site.config.json from the repo root at startup to
# learn the base URL and repo, so the build context is the root, not mcp/.
#
# worker/discovery.js comes along because the stdio server imports the Worker's
# tool definitions from it rather than keeping a second copy that can drift. It
# has no imports of its own, so this one file is the whole dependency.
COPY site.config.json ./
COPY worker/discovery.js ./worker/discovery.js
COPY mcp/ ./mcp/

ENTRYPOINT ["node", "mcp/server.mjs"]
