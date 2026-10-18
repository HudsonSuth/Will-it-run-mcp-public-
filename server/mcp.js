// Will It Run? MCP server: protocol layer and tool definitions.
// Hosted at https://willitrunllm.com/api/mcp (Streamable HTTP, stateless, read-only, no key needed).
//
// This is the Vercel function behind the hosted endpoint, published so you can see exactly what each tool does.
// It is NOT standalone: the fit engine (../src/lib.js), the hardware/model/benchmark data (./_data.json) and the
// /api/v1 and /api/hf handlers it calls run on the hosted service and are not part of this repo.
// Use the hosted URL; see README.md.
//
// Will It Run? remote MCP server: Streamable HTTP, stateless, read-only, no auth.
// Minimal JSON-RPC 2.0 implementation (no SDK dependency): initialize, ping, tools/list, tools/call.
// Tools wrap the same code as /api/v1 (src/lib.js on api/_data.json) and /api/hf for Hugging Face GGUF files.
const L = require("../src/lib.js"), D = require("./_data.json"), v1 = require("./v1.js"), hf = require("./hf.js");
const SITE = "https://willitrunllm.com", VERSION = "1.0.0";
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const r2 = n => n == null ? null : Math.round(n * 100) / 100;

// Call another function handler in-process with a fake req/res.
function call(handler, query, ip) {
  return new Promise((resolve, reject) => {
    const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, body: o }); }, end() { resolve({ code: this.code, body: null }); } };
    Promise.resolve(handler({ method: "GET", internal: true, headers: { "x-forwarded-for": ip }, query }, res)).catch(reject);
  });
}
const api = async (route, q, ip) => { const r = await call(v1, { ...clean(q), route }, ip); if (!r.body || !r.body.ok) throw new Error((r.body && r.body.error) || "request failed"); delete r.body.meta; delete r.body.ok; return r.body; };
const clean = o => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)]));

const HWP = { type: "string", description: "Hardware id(s) from search_hardware. Comma-separate for multi-GPU, e.g. \"rtx-3090,rtx-3090\". Custom VRAM: \"custom-48\" (48 GB, no specific card) or \"rtx-3090:30\" (that card's chip with 30 GB)." };
const COMMON = {
  ram: { type: "number", description: "System RAM in GB available for offload (discrete GPUs only). Default 0 = no offload." },
  rambw: { type: "number", description: "RAM bandwidth in GB/s for offload speed estimates. One of: " + L.RAMBW.map(([v]) => v).join(", ") + ". Default 50." },
  ctx: { type: "integer", description: "Context length in tokens. Default 4096." },
  kv: { type: "string", enum: ["f16", "q8_0", "q4_0"], description: "KV-cache type. Default f16." },
  engram: { type: "string", enum: ["resident", "offload"], description: "DeepSeek V4.1 Engram table: resident in GPU memory (default) or offloaded to RAM/disk." },
};
const TOOLS = [
  { name: "search_hardware", description: "Find GPUs, Apple Silicon Macs and unified-memory machines (Strix Halo, DGX/RTX Spark) the Will It Run? checker knows, with memory, GPU-usable memory and bandwidth. Use the returned id as `hw` in check_fit / what_fits.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Words to match, any order, e.g. \"3090\", \"m4 max 128\", \"strix\". Empty = all." }, type: { type: "string", enum: ["gpu", "mac", "unified-apu"] }, limit: { type: "integer", description: "Max results (default 25, max 200)." } } } },
  { name: "search_models", description: "Find open-weight LLMs in the Will It Run? database (params, MoE, release date, max context). Use the returned slug as `model` in check_fit.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Words to match in name/slug/HF repo, e.g. \"qwen 32b\", \"deepseek\"." }, include_old: { type: "boolean", description: "Include older/legacy models." }, limit: { type: "integer", description: "Max results (default 25, max 200)." } } } },
  { name: "check_fit", description: "Will this model run on this hardware? Returns verdict (fits / tight / offload / no), memory needed vs GPU-usable memory (estimates), placement for RAM offload (MoE experts-to-RAM like llama.cpp --cpu-moe, or layer split), measured or estimated generation speed, and a checker deep link. Give `model` (slug) OR `hf` + `file` (any Hugging Face GGUF repo/file, sized from the real file). Omit `quant` to get the best quant that fits.",
    inputSchema: { type: "object", required: ["hw"], properties: { hw: HWP, model: { type: "string", description: "Model slug from search_models." }, hf: { type: "string", description: "Hugging Face GGUF repo, e.g. \"unsloth/Qwen3.6-35B-A3B-GGUF\"." }, file: { type: "string", description: "GGUF file name in that repo (split files: the name without -0000N-of-0000M). Omit to list files." },
      quant: { type: "string", description: "Quant for `model`, e.g. Q4_K_M, IQ4_XS, Q8_0, F16. Omit for best fit." }, minq: { type: "string", enum: ["all", "q3", "q4", "q5", "q8"], description: "Lowest quant allowed when picking best fit (default all)." }, ...COMMON } } },
  { name: "what_fits", description: "List the models that fit on this hardware (best quant each), fully on GPU first, then with RAM offload, biggest first. Includes speed where known and checker deep links.",
    inputSchema: { type: "object", required: ["hw"], properties: { hw: HWP, minq: { type: "string", enum: ["all", "q3", "q4", "q5", "q8"], description: "Lowest quant allowed (default q3 = IQ3_XXS or better)." }, include_old: { type: "boolean" }, limit: { type: "integer", description: "Max models (default 30)." }, ...COMMON } } },
  { name: "get_benchmarks", description: "Measured community llama.cpp benchmarks (tg128 = generation tok/s, pp512 = prompt tok/s), each with its source link. Filter by hardware id, model slug and/or quant.",
    inputSchema: { type: "object", properties: { hw: { type: "string", description: "Single hardware id." }, model: { type: "string", description: "Model slug (or benchmark key such as llama2-7b)." }, quant: { type: "string" }, limit: { type: "integer", description: "Max rows (default 50, max 500)." } } } },
];
const words = s => String(s || "").toLowerCase().split(/[\s\-_,()·]+/).filter(Boolean);
const lim = (n, d, mx) => Math.max(1, Math.min(mx, parseInt(n) || d));

async function hfFit(a, ip) {
  if (!/^[A-Za-z0-9][\w.-]{0,95}\/[\w.-]{1,96}$/.test(a.hf || "")) throw new Error("hf must look like org/repo");
  const r = await call(hf, { repo: a.hf }, ip); const I = r.body;
  if (!I || !I.ok) throw new Error((I && I.error) || "Hugging Face lookup failed");
  if (I.filesError) throw new Error(I.filesError);
  const files = I.files || [];
  if (!a.file) return { repo: a.hf, message: "Pass `file` to check one of these GGUF files.", files: files.map(f => ({ file: f.file, sizeGB: r2(f.bytes / 1e9) })) };
  const fi = files.find(f => f.file === a.file || f.first === a.file); if (!fi) throw new Error("file not found in repo. Available: " + files.map(f => f.file).slice(0, 40).join(", "));
  const sels = String(a.hw).split(",").map(s => s.trim()).filter(Boolean).slice(0, 8).map(id => { const h = D.HW.find(x => x.id === id) || L.hwFromToken(id, D.HW); if (!h) throw new Error("unknown hw id: " + id); return h; });
  const QRE = /(PTQ1_0|PQ2_0|IQ\d_[A-Z]+|Q\d_K_[SMLX]L?|Q\d_K|Q\d_[01]|TQ\d_\d|BF16|F16|F32|MXFP4)/i;
  const qm = (fi.file.match(QRE) || [""])[0].toUpperCase().replace("BF16", "F16"), known = qm in L.QUANTS;
  const local = D.models.find(x => (I.base || []).includes(x.hf) || x.hf === a.hf);
  const arch = I.arch || (local && local.arch);
  const m = { slug: "hf:" + a.hf, name: a.hf, fileBytes: fi.bytes, params: I.params || (local && local.params) || 0, arch, roughKV: !arch, moe: local ? local.moe : /\bA\d+(\.\d+)?B\b|moe/i.test(a.hf), benchKey: local && known ? (local.benchKey || local.slug) : "__none" };
  if (!arch && I.ggufCtx) m.ctxMax = I.ggufCtx;
  const ctx = Math.max(256, Math.min(1048576, parseInt(a.ctx) || 4096)), kvq = L.KVQ[a.kv] ? a.kv : "f16", single = sels[0].mac || sels[0].uma;
  const ram = single ? 0 : Math.max(0, Math.min(2048, parseInt(a.ram) || 0)), rambw = L.RAMBW.some(([v]) => v === +a.rambw) ? +a.rambw : 50, opt = { ctx, kvq };
  const quant = known ? qm : "Q4_K_M", res = L.check(m, sels, quant, D.bench, D.refParams, ram, opt);
  const o = res.verdict === "offload" && !single ? L.offloadPlan(m, sels, quant, D.bench, D.refParams, ram, null, rambw, opt) : null;
  const u = new URLSearchParams({ hw: sels.map(s => s.id).join(","), hf: a.hf, file: fi.file, ctx, kvq }); if (!single) { u.set("ram", ram); u.set("rambw", rambw); }
  const speed = res.measured ? { kind: "measured", tg128_median: r2(L.med(res.measured.map(b => b.tg128))) } : res.estimate ? { kind: "ESTIMATE", tg128_low: r2(res.estimate.lo), tg128_high: r2(res.estimate.hi) } : o && o.speed ? { kind: "ESTIMATE", tg128_low: r2(o.speed.lo), tg128_high: r2(o.speed.hi), basis: o.speed.basis } : { kind: "none" };
  return { hardware: sels.map(s => ({ id: s.id, name: s.name })), hf: a.hf, file: fi.file, fileSizeGB: r2(fi.bytes / 1e9), quant: qm || "unknown", ctx, kv: kvq, ramGB: ram, verdict: res.verdict,
    memory: { kind: "ESTIMATE", needGB: r2(res.need), weightsGB: r2(res.weights), kvCacheGB: r2(res.kv), kvCacheRough: res.roughKV || undefined, gpuUsableGB: r2(res.usable), headroomGB: r2(res.usable - res.need) },
    offload: o ? { kind: "ESTIMATE", pctOnGpu: o.autoPct, vramGB: r2(o.vram), ramGB: r2(o.ram), status: o.status, placement: o.mode === "moe" ? "moe-experts-to-ram" : "layers" } : undefined, speed,
    notes: /bonsai|prism-ml/i.test(a.hf) || /PQ2_0|PTQ1_0/i.test(fi.file) ? ["Ternary Bonsai PQ2_0/PTQ1_0 files need the PrismML llama.cpp build (github.com/PrismML-Eng/llama.cpp); stock llama.cpp rejects them."] : undefined,
    checkerUrl: SITE + "/?" + u.toString().replace(/%2C/g, ",").replace(/%2F/g, "/").replace(/%3A/g, ":") + "#checker" };
}

async function runTool(name, a, ip) {
  a = a || {};
  if (name === "search_hardware") {
    const r = await api("hardware", { type: a.type }, ip), w = words(a.query);
    const hs = r.hardware.filter(h => !w.length || L.hwMatch(a.query, h.name + " " + h.id));
    return { count: hs.length, hardware: hs.slice(0, lim(a.limit, 25, 200)) };
  }
  if (name === "search_models") {
    const r = await api("models", { old: a.include_old ? 1 : null }, ip), w = words(a.query);
    const ms = r.models.filter(m => w.every(x => (m.name + " " + m.slug + " " + (m.hf || "")).toLowerCase().includes(x)));
    return { count: ms.length, models: ms.slice(0, lim(a.limit, 25, 200)) };
  }
  if (name === "check_fit") {
    if (!a.hw) throw new Error("hw is required");
    if (a.hf) return hfFit(a, ip);
    if (!a.model) throw new Error("Give `model` (slug from search_models) or `hf` + `file`.");
    return api("fit", { hw: a.hw, model: a.model, q: a.quant, minq: a.minq || "all", ram: a.ram, rambw: a.rambw, ctx: a.ctx, kv: a.kv, engram: a.engram }, ip);
  }
  if (name === "what_fits") {
    if (!a.hw) throw new Error("hw is required");
    const r = await api("fits", { hw: a.hw, minq: a.minq, ram: a.ram, rambw: a.rambw, ctx: a.ctx, kv: a.kv, engram: a.engram, old: a.include_old ? 1 : null }, ip);
    const n = lim(a.limit, 30, 200); r.returned = Math.min(n, r.models.length); r.models = r.models.slice(0, n).map(m => ({ name: m.name, model: m.model, bestQuant: m.bestQuant, verdict: m.verdict, needGB: m.memory.needGB, gpuUsableGB: m.memory.gpuUsableGB, offload: m.offload, speed: m.speed.kind === "none" ? null : m.speed, checkerUrl: m.checkerUrl }));
    return r;
  }
  if (name === "get_benchmarks") {
    const r = await api("benchmarks", { hw: a.hw, model: a.model, quant: a.quant, limit: lim(a.limit, 50, 500) }, ip); return r;
  }
  throw Object.assign(new Error("Unknown tool: " + name), { rpc: -32602 });
}

async function handle(msg, ip) {
  const { id, method, params } = msg || {};
  const ok = result => ({ jsonrpc: "2.0", id, result }), err = (code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== "2.0" || typeof method !== "string") return err(-32600, "Invalid Request");
  if (id === undefined) return null; // notification (e.g. notifications/initialized): no response
  if (method === "initialize") {
    const want = params && params.protocolVersion;
    return ok({ protocolVersion: PROTOCOLS.includes(want) ? want : PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: "will-it-run", title: "Will It Run?", version: VERSION, websiteUrl: SITE + "/mcp/" },
      instructions: "Checks whether local LLMs fit a GPU or Mac. Typical flow: search_hardware -> search_models -> check_fit (or what_fits). Memory and speed numbers marked ESTIMATE are estimates; 'measured' speeds are community llama.cpp benchmarks with source links. Data: " + D.rev + "." });
  }
  if (method === "ping") return ok({});
  if (method === "tools/list") return ok({ tools: TOOLS.map(t => ({ ...t, annotations: { readOnlyHint: true, openWorldHint: t.name === "check_fit" } })) });
  if (method === "tools/call") {
    const name = params && params.name;
    if (!TOOLS.some(t => t.name === name)) return err(-32602, "Unknown tool: " + name);
    try { const out = await runTool(name, params.arguments, ip); return ok({ content: [{ type: "text", text: JSON.stringify(out, null, 1) }], structuredContent: out, isError: false }); }
    catch (e) { return ok({ content: [{ type: "text", text: "Error: " + e.message }], isError: true }); }
  }
  return err(-32601, "Method not found: " + method);
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Authorization"); res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") { res.setHeader("Allow", "POST"); return res.status(405).json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "This is a stateless MCP endpoint (Streamable HTTP): POST JSON-RPC here. Docs: " + SITE + "/mcp/" } }); }
  if (req.method === "DELETE") return res.status(405).end();
  if (req.method !== "POST") return res.status(405).end();
  let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { return res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); } }
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "?";
  res.setHeader("Cache-Control", "no-store");
  try {
    if (Array.isArray(body)) { const out = (await Promise.all(body.slice(0, 20).map(m => handle(m, ip)))).filter(Boolean); return out.length ? res.status(200).json(out) : res.status(202).end(); }
    const out = await handle(body, ip); return out ? res.status(200).json(out) : res.status(202).end();
  } catch (e) { console.error("mcp", e); return res.status(500).json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error" } }); }
};
module.exports.TOOLS = TOOLS;
