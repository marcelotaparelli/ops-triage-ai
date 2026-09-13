# Phase 4 — Hybrid Policy

Phase 4 is complete. Its central responsibility rule is: **the classifier
classifies; the policy decides.**

## Architecture

The LLM classifier is the semantic classifier. The deterministic classifier is
the deterministic guardrail and comparison signal. Both receive the same
`TicketInput`; they are not treated as statistically independent. The
`HybridPolicy` is the pure decision layer.

```text
HTTP
  -> TriageTicket
      -> DeterministicTriageClassifier
      -> OllamaTriageClassifier
      -> HybridPolicy
  -> TriageDecision
  -> HTTP
```

When both classifiers succeed, the policy preserves the complete LLM
`ClassifierResult`, sets `decisionSource` to `HYBRID`, and decides whether
human review is required. It does not merge fields or recalculate a
classification. Disagreement in category, priority, or risk, confidence 0.5,
HIGH/CRITICAL priority, or HIGH risk requires review.

Known LLM failures (`TIMEOUT`, `UNAVAILABLE`, and `INVALID_RESPONSE`) produce a
`DETERMINISTIC_FALLBACK` decision. The deterministic `ClassifierResult` is
preserved, `requiresHumanReview` is true, and `LLM_UNAVAILABLE` is recorded as
a review reason. This is graceful degradation: it keeps the API operational,
but does not claim that the deterministic result is equivalent to the LLM
result. Unknown failures continue to propagate.

## Real host validation

With Ollama available, a real `POST /tickets/triage` completed the full hybrid
flow and returned an INCIDENT/CRITICAL/HIGH decision routed to INFRASTRUCTURE,
with confidence 0.9, `decisionSource: HYBRID`, and `HIGH_SEVERITY` review.

With the Ollama systemd service stopped, the same request returned the complete
deterministic INCIDENT/CRITICAL/HIGH result routed to INFRASTRUCTURE, with
confidence 0.7, `decisionSource: DETERMINISTIC_FALLBACK`, and the stable review
reasons `HIGH_SEVERITY` followed by `LLM_UNAVAILABLE`.

No persistence, retry, circuit breaker, field-level merging, prompt change, or
benchmark tuning is part of Phase 4.
