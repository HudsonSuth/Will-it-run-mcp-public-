#!/usr/bin/env bash
# Quick check of the hosted Will It Run? MCP server. Needs curl (python3 optional, for pretty output).
set -euo pipefail
URL="${1:-https://willitrunllm.com/api/mcp}"
post() { curl -fsS "$URL" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d "$1"; echo; }

echo "== initialize"
post '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke-test","version":"0"}}}'

echo "== tools/list (names)"
post '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | python3 -c 'import json,sys; print([t["name"] for t in json.load(sys.stdin)["result"]["tools"]])' 2>/dev/null || true

echo "== search_hardware 3090"
post '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_hardware","arguments":{"query":"3090","limit":3}}}'
