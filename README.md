# Will It Run? MCP server

Ask your AI assistant whether a local LLM will fit your GPU or Mac, and how fast it'll run.

This is the remote MCP server for [Will It Run?](https://willitrunllm.com). It's hosted, read-only and free to use, with no API key and nothing to install.

**Endpoint:** `https://willitrunllm.com/api/mcp` (Streamable HTTP, stateless)

Docs: https://willitrunllm.com/mcp/

## Setup

### Claude Code

```bash
claude mcp add --transport http will-it-run https://willitrunllm.com/api/mcp
```

### Cursor

Add this to `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{"mcpServers":{"will-it-run":{"url":"https://willitrunllm.com/api/mcp"}}}
```

### Other clients

Any MCP client that supports remote servers over Streamable HTTP can point at `https://willitrunllm.com/api/mcp`.

## Tools

| Tool | What it does |
| --- | --- |
| `search_hardware` | Finds GPUs, Apple Silicon Macs and unified-memory machines (Strix Halo, DGX/RTX Spark), with memory, GPU-usable memory and bandwidth. Returns the `hw` ids the other tools take. |
| `search_models` | Finds open-weight LLMs in the database (params, MoE, release date, max context). Returns model slugs. |
| `check_fit` | Checks whether a model runs on given hardware. Returns a verdict (fits / tight / offload / no), memory needed vs. available, RAM-offload placement, a measured or estimated speed, and a link to the checker. Takes a model slug, or any Hugging Face GGUF repo + file. |
| `what_fits` | Lists the models that fit on given hardware (best quant for each), biggest first. |
| `get_benchmarks` | Returns measured community llama.cpp benchmarks (tg128 / pp512 tok/s), each with a link to its source. |

All tools are read-only. Numbers labeled `ESTIMATE` are estimates; `measured` speeds come from community benchmarks with source links. Full input schemas are in [`tools.json`](tools.json).

Typical flow: `search_hardware` → `search_models` → `check_fit` (or `what_fits`).

## Example prompts

- "Will Qwen3 32B run on my RTX 3090 at Q4?"
- "What's the biggest model I can run on an M4 Max with 128 GB?"
- "Two 3090s plus 64 GB of RAM: what fits with 32k context?"

## Try it with curl

```bash
curl -s https://willitrunllm.com/api/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

See [`examples/smoke-test.sh`](examples/smoke-test.sh) for a `tools/call` example.

## What's in this repo

- `server/mcp.js`: the protocol layer behind the hosted endpoint (JSON-RPC handling and tool definitions). It's here for transparency. It isn't standalone: the fit engine and data it calls run on the hosted service and aren't included.
- `tools.json`: the tool list exactly as `tools/list` returns it.
- `server.json`: metadata for the [official MCP Registry](https://registry.modelcontextprotocol.io).
- `examples/smoke-test.sh`: a quick check with curl.

## Feedback

Open an issue here, or use the site: https://willitrunllm.com

## License

MIT. See [LICENSE](LICENSE).
