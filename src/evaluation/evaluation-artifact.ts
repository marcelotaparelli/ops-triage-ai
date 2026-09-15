import { OLLAMA_TRIAGE_PROMPT_VERSION } from "../infrastructure/ollama/ollama-prompt-v1.ts";

export interface EvaluationArtifactMetadata {
  generatedAt: string;
  commit: string;
  dataset: string;
  classifierMode: "DETERMINISTIC" | "OLLAMA" | "HYBRID";
  promptVersion: string;
  model?: string;
  timeoutMs?: number;
}

export function evaluationMetadata(input: Omit<EvaluationArtifactMetadata, "generatedAt" | "commit" | "promptVersion">): EvaluationArtifactMetadata {
  return {
    ...input,
    generatedAt: new Date().toISOString(),
    commit: gitCommit(),
    promptVersion: OLLAMA_TRIAGE_PROMPT_VERSION,
  };
}

function gitCommit(): string {
  try {
    const result = Bun.spawnSync(["git", "rev-parse", "HEAD"]);
    if (result.exitCode === 0) return new TextDecoder().decode(result.stdout).trim();
  } catch { /* Artifact generation remains usable outside a Git checkout. */ }
  return "unknown";
}
