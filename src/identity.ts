import type { LLMIdentity, ResolvedConfig } from "./types.js";

// Known provider prefixes for classification
const PROVIDER_MAP: Array<[RegExp, string]> = [
  [/^claude-/i, "anthropic"],
  [/^gpt-|^o[1-9]-/i, "openai"],
  [/^gemini-/i, "google"],
  [/^llama-|^mistral-/i, "meta"],
  [/^human$/i, "human"],
  [/^ci$/i, "ci"],
];

function sanitise(raw: string): string {
  return raw.trim().toLowerCase().replace(/\./g, "-").replace(/[^a-z0-9-]/g, "-").slice(0, 64);
}

function inferProvider(id: string): string {
  for (const [pattern, provider] of PROVIDER_MAP) {
    if (pattern.test(id)) return provider;
  }
  return "unknown";
}

export function resolveIdentity(
  toolArg: string | undefined,
  config: ResolvedConfig
): LLMIdentity {
  // Priority 1: tool argument
  if (toolArg && toolArg.trim()) {
    const id = sanitise(toolArg);
    return { provider: inferProvider(id), model: toolArg.trim(), id, source: "argument" };
  }

  // Priority 2: environment variable
  const envVal = process.env["SPEC_CHECK_LLM"];
  if (envVal && envVal.trim()) {
    const id = sanitise(envVal);
    return { provider: inferProvider(id), model: envVal.trim(), id, source: "env" };
  }

  // Priority 3: global/project config
  const configVal = config.value.default_llm;
  if (configVal && configVal.trim() && configVal !== "unknown") {
    const id = sanitise(configVal);
    return { provider: inferProvider(id), model: configVal.trim(), id, source: "config" };
  }

  // Fallback
  return { provider: "unknown", model: "unknown", id: "unknown", source: "fallback" };
}
