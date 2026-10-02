# Laya held-out error list

Frozen run: `a9725eaf341a52bb21e4c68a4591b90c9ce2beb0`; 62 of 70 Laya tuples differ from the labels. Full probabilities and latencies remain in [the machine-readable artifact](../../artifacts/laya-held-out.json). `C/P/R` means category/priority/risk. Jev tuple status uses its published raw per-ticket artifact. The historical deterministic and Ollama artifacts do not provide per-ticket predictions, so no per-ticket status can be assigned to them.

| Ticket | Expected C/P/R | Laya C/P/R | Laya wrong field(s) | Jev tuple |
| --- | --- | --- | --- | --- |
| eval-incident-04 | INCIDENT/HIGH/MEDIUM | INCIDENT/CRITICAL/HIGH | priority, risk | correct |
| eval-incident-05 | INCIDENT/HIGH/MEDIUM | INCIDENT/CRITICAL/HIGH | priority, risk | correct |
| eval-incident-06 | INCIDENT/HIGH/HIGH | INCIDENT/HIGH/MEDIUM | risk | wrong: risk |
| eval-incident-07 | INCIDENT/HIGH/MEDIUM | INCIDENT/CRITICAL/HIGH | priority, risk | correct |
| eval-incident-08 | INCIDENT/HIGH/MEDIUM | INCIDENT/CRITICAL/HIGH | priority, risk | correct |
| eval-incident-10 | INCIDENT/HIGH/HIGH | INCIDENT/CRITICAL/HIGH | priority | wrong: priority |
| eval-bug-01 | BUG/MEDIUM/LOW | BUG/MEDIUM/MEDIUM | risk | correct |
| eval-bug-04 | BUG/MEDIUM/LOW | BUG/MEDIUM/MEDIUM | risk | correct |
| eval-bug-05 | BUG/MEDIUM/LOW | BUG/MEDIUM/MEDIUM | risk | correct |
| eval-bug-06 | BUG/MEDIUM/LOW | BUG/MEDIUM/MEDIUM | risk | correct |
| eval-bug-07 | BUG/CRITICAL/HIGH | BUG/MEDIUM/MEDIUM | priority, risk | correct |
| eval-bug-09 | BUG/MEDIUM/LOW | BUG/MEDIUM/MEDIUM | risk | correct |
| eval-bug-10 | BUG/MEDIUM/LOW | BUG/MEDIUM/MEDIUM | risk | correct |
| eval-feature-01 | FEATURE_REQUEST/LOW/LOW | FEATURE_REQUEST/MEDIUM/MEDIUM | priority, risk | correct |
| eval-feature-02 | FEATURE_REQUEST/LOW/LOW | FEATURE_REQUEST/MEDIUM/LOW | priority | correct |
| eval-feature-03 | FEATURE_REQUEST/LOW/LOW | FEATURE_REQUEST/MEDIUM/LOW | priority | correct |
| eval-feature-04 | FEATURE_REQUEST/LOW/LOW | FEATURE_REQUEST/MEDIUM/LOW | priority | correct |
| eval-feature-05 | FEATURE_REQUEST/LOW/LOW | CONTENT_CHANGE/MEDIUM/LOW | category, priority | correct |
| eval-feature-06 | FEATURE_REQUEST/LOW/LOW | FEATURE_REQUEST/MEDIUM/LOW | priority | correct |
| eval-feature-07 | FEATURE_REQUEST/LOW/LOW | FEATURE_REQUEST/MEDIUM/MEDIUM | priority, risk | correct |
| eval-feature-08 | FEATURE_REQUEST/LOW/LOW | FEATURE_REQUEST/MEDIUM/LOW | priority | correct |
| eval-feature-09 | FEATURE_REQUEST/LOW/LOW | FEATURE_REQUEST/MEDIUM/LOW | priority | correct |
| eval-feature-10 | FEATURE_REQUEST/LOW/LOW | CONTENT_CHANGE/MEDIUM/LOW | category, priority | correct |
| eval-content-01 | CONTENT_CHANGE/LOW/LOW | CONTENT_CHANGE/MEDIUM/MEDIUM | priority, risk | correct |
| eval-content-02 | CONTENT_CHANGE/LOW/LOW | CONTENT_CHANGE/MEDIUM/LOW | priority | correct |
| eval-content-03 | CONTENT_CHANGE/LOW/LOW | BUG/MEDIUM/LOW | category, priority | correct |
| eval-content-04 | CONTENT_CHANGE/LOW/LOW | CONTENT_CHANGE/MEDIUM/LOW | priority | correct |
| eval-content-05 | CONTENT_CHANGE/LOW/LOW | CONTENT_CHANGE/MEDIUM/LOW | priority | correct |
| eval-content-06 | CONTENT_CHANGE/LOW/LOW | CONTENT_CHANGE/MEDIUM/MEDIUM | priority, risk | correct |
| eval-content-07 | CONTENT_CHANGE/LOW/LOW | CONTENT_CHANGE/MEDIUM/MEDIUM | priority, risk | correct |
| eval-content-08 | CONTENT_CHANGE/LOW/LOW | CONTENT_CHANGE/MEDIUM/LOW | priority | correct |
| eval-content-09 | CONTENT_CHANGE/LOW/LOW | CONTENT_CHANGE/MEDIUM/LOW | priority | correct |
| eval-content-10 | CONTENT_CHANGE/LOW/LOW | CONTENT_CHANGE/MEDIUM/LOW | priority | correct |
| eval-support-01 | SUPPORT/LOW/LOW | SUPPORT/MEDIUM/LOW | priority | correct |
| eval-support-02 | SUPPORT/LOW/LOW | SUPPORT/MEDIUM/LOW | priority | correct |
| eval-support-03 | SUPPORT/LOW/LOW | OTHER/MEDIUM/LOW | category, priority | correct |
| eval-support-04 | SUPPORT/LOW/LOW | OTHER/MEDIUM/LOW | category, priority | correct |
| eval-support-05 | SUPPORT/LOW/LOW | SUPPORT/MEDIUM/LOW | priority | correct |
| eval-support-06 | SUPPORT/LOW/LOW | SUPPORT/MEDIUM/LOW | priority | correct |
| eval-support-07 | SUPPORT/LOW/LOW | SUPPORT/MEDIUM/LOW | priority | correct |
| eval-support-08 | SUPPORT/LOW/LOW | OTHER/MEDIUM/LOW | category, priority | correct |
| eval-support-09 | SUPPORT/LOW/LOW | OTHER/MEDIUM/LOW | category, priority | correct |
| eval-support-10 | SUPPORT/LOW/LOW | SUPPORT/MEDIUM/LOW | priority | correct |
| eval-access-01 | ACCESS/MEDIUM/LOW | ACCESS/MEDIUM/MEDIUM | risk | correct |
| eval-access-02 | ACCESS/MEDIUM/LOW | ACCESS/MEDIUM/MEDIUM | risk | correct |
| eval-access-03 | ACCESS/MEDIUM/MEDIUM | OTHER/MEDIUM/MEDIUM | category | wrong: risk |
| eval-access-04 | ACCESS/MEDIUM/LOW | BUG/MEDIUM/LOW | category | correct |
| eval-access-05 | ACCESS/MEDIUM/LOW | ACCESS/HIGH/MEDIUM | priority, risk | correct |
| eval-access-06 | ACCESS/MEDIUM/LOW | ACCESS/MEDIUM/MEDIUM | risk | correct |
| eval-access-07 | ACCESS/HIGH/MEDIUM | INCIDENT/HIGH/MEDIUM | category | correct |
| eval-access-08 | ACCESS/CRITICAL/HIGH | ACCESS/CRITICAL/MEDIUM | risk | correct |
| eval-access-09 | ACCESS/MEDIUM/LOW | INCIDENT/HIGH/MEDIUM | category, priority, risk | correct |
| eval-other-01 | OTHER/LOW/LOW | OTHER/MEDIUM/MEDIUM | priority, risk | correct |
| eval-other-02 | OTHER/LOW/LOW | OTHER/MEDIUM/LOW | priority | correct |
| eval-other-03 | OTHER/LOW/LOW | OTHER/MEDIUM/MEDIUM | priority, risk | correct |
| eval-other-04 | OTHER/LOW/LOW | OTHER/MEDIUM/LOW | priority | correct |
| eval-other-05 | OTHER/LOW/LOW | OTHER/MEDIUM/LOW | priority | correct |
| eval-other-06 | OTHER/LOW/LOW | OTHER/MEDIUM/LOW | priority | correct |
| eval-other-07 | OTHER/LOW/LOW | OTHER/MEDIUM/LOW | priority | correct |
| eval-other-08 | OTHER/LOW/LOW | OTHER/MEDIUM/LOW | priority | correct |
| eval-other-09 | OTHER/LOW/LOW | OTHER/MEDIUM/MEDIUM | priority, risk | correct |
| eval-other-10 | OTHER/LOW/LOW | OTHER/MEDIUM/LOW | priority | correct |
