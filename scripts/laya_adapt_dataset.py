"""Generate independent, rule-labelled synthetic Ops Triage training data.

Only taxonomy and authored scenario blueprints enter this generator. It never
opens the frozen held-out data. Validation uses disjoint surface phrasings.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRAIN = ROOT / "datasets/laya-adapt-train.jsonl"
VALIDATION = ROOT / "datasets/laya-adapt-validation.jsonl"
METADATA = ROOT / "artifacts/laya-adapt-dataset.json"
SEED = 20261002
SIZES = {"train": 1120, "validation": 280}

# Each blueprint is authored from project taxonomy/rules, not a held-out row.
# (category, priority, risk, relative weight, subjects, train title/detail, validation title/detail)
SCENARIOS = [
    ("INCIDENT", "HIGH", "MEDIUM", 5, ["staging gateway", "test scheduler", "internal search", "preview portal"],
     ["{s} is unavailable", "Interrupted {s} service", "No response from {s}"],
     ["Requests to {s} no longer complete.", "The {s} endpoint stopped responding.", "Our team cannot reach {s}."],
     ["{s} cannot be reached", "Service interruption in {s}"],
     ["Connection attempts to {s} time out for this environment.", "The {s} service is currently inaccessible to the team."]),
    ("INCIDENT", "HIGH", "HIGH", 5, ["production checkout", "live order API", "production billing", "customer portal"],
     ["{s} is down", "Outage in {s}", "{s} is unavailable in production"],
     ["Live requests to {s} are failing.", "Users cannot complete requests through {s}.", "The production {s} endpoint has stopped serving traffic."],
     ["Production interruption in {s}", "No live traffic through {s}"],
     ["The live {s} service is currently unreachable.", "Production traffic to {s} fails immediately."]),
    ("INCIDENT", "CRITICAL", "HIGH", 4, ["production sign-in", "live checkout", "customer API", "production payments"],
     ["{s} outage across all customers", "Company-wide {s} outage", "{s} down for every user"],
     ["The production {s} service is unavailable to all customers.", "Nobody can use the live {s} service.", "All customer requests to {s} fail."],
     ["Broad production outage of {s}", "Every customer blocked by {s} outage"],
     ["The live {s} service is inaccessible across the full user base.", "The production {s} endpoint fails for every customer account."]),
    ("INCIDENT", "HIGH", "MEDIUM", 3, ["regional report service", "sandbox file service", "staging notification feed"],
     ["{s} degraded", "Intermittent {s} availability", "Slow responses from {s}"],
     ["The service has intermittent failures, with no production outage confirmed.", "Some requests stall in this nonproduction environment.", "Availability varies during the test cycle."],
     ["{s} intermittently unreachable", "Degradation affecting {s}"],
     ["This environment intermittently rejects requests; no live outage is reported.", "Some attempts fail while others succeed in the test environment."]),
    ("BUG", "MEDIUM", "LOW", 7, ["invoice preview", "saved filters", "export dialog", "order history", "profile editor"],
     ["Incorrect behavior in {s}", "{s} displays the wrong value", "Error in {s}"],
     ["One existing function returns the wrong result for a single record.", "The feature behaves incorrectly, but work can continue.", "The current view shows an error for one item."],
     ["{s} behaves incorrectly", "Wrong result from {s}"],
     ["A normal interaction produces an incorrect value without wider impact.", "This function has a reproducible defect affecting one record."]),
    ("BUG", "HIGH", "MEDIUM", 5, ["dispatch workflow", "release pipeline", "inventory sync", "invoice submission"],
     ["Blocking regression in {s}", "Recent release broke {s}", "{s} regression blocks work"],
     ["Since the release, staff cannot finish the existing workflow.", "The regression prevents operators from completing their work.", "The latest change blocks the normal task path."],
     ["{s} fails after update and blocks staff", "Work halted by {s} regression"],
     ["The newly introduced defect stops the team from completing the existing task.", "Operators are blocked after the recent deployment."]),
    ("BUG", "CRITICAL", "HIGH", 3, ["bulk import", "order ledger", "invoice save"],
     ["Data loss in {s}", "{s} corrupts stored records", "Records disappear after {s}"],
     ["An existing operation permanently loses saved data.", "Stored records are corrupted by this defective workflow.", "Persisted information disappears after the operation."],
     ["{s} is destroying saved data", "Persistent data corrupted by {s}"],
     ["The defect damages records already stored in the system.", "After this operation, saved records are missing."]),
    ("BUG", "MEDIUM", "MEDIUM", 4, ["staff queue", "review console", "shipment tracker"],
     ["Regression in {s} slows operators", "{s} has a recurring error", "{s} fails during review"],
     ["The defect disrupts an operational workflow, but a manual workaround exists.", "Operators need a workaround to finish the task.", "The recurring failure delays work without fully blocking it."],
     ["Operational defect in {s}", "{s} regression needs a workaround"],
     ["The team can still proceed through a slower manual path.", "The existing workflow now requires manual recovery after an error."]),
    ("BUG", "MEDIUM", "LOW", 4, ["date picker", "CSV download", "dashboard sort"],
     ["{s} occasionally shows an error", "Unexpected result in {s}", "{s} fails for one item"],
     ["The problem is limited to a single user's routine action.", "No blocking impact or data harm has been observed.", "The user can repeat the action using another item."],
     ["Minor functional defect in {s}", "A case of incorrect {s} output"],
     ["The issue is reproducible but ordinary work remains possible.", "Only this routine function has an incorrect result."]),
    ("ACCESS", "MEDIUM", "LOW", 6, ["staff dashboard", "training portal", "employee profile", "report viewer"],
     ["Cannot sign in to {s}", "Login rejected by {s}", "Password not accepted in {s}"],
     ["One employee cannot authenticate to their account.", "The sign-in flow rejects a single user's credentials.", "Authentication fails for this individual account."],
     ["{s} refuses one user's login", "Individual sign-in failure in {s}"],
     ["An employee's ordinary account cannot complete authentication.", "The issue affects one person's ability to log in."]),
    ("ACCESS", "MEDIUM", "MEDIUM", 5, ["review console", "finance reports", "team workspace"],
     ["Permission denied in {s}", "Unauthorized response from {s}", "Role access missing in {s}"],
     ["A team role cannot open the required operational view.", "Staff lack the authorization needed for a normal work task.", "The assigned role is denied access to its required resource."],
     ["{s} rejects the assigned staff role", "Operational authorization issue in {s}"],
     ["The team's intended permission is absent and slows the workflow.", "A work role receives a forbidden response for its normal task."]),
    ("ACCESS", "HIGH", "MEDIUM", 4, ["production deploy console", "on-call admin panel", "live release controls"],
     ["Admin access blocked in {s}", "Cannot access {s} for deployment", "On-call operator locked out of {s}"],
     ["The authorized operator cannot carry out a critical live task.", "A blocked privileged account prevents the planned production action.", "Deployment work cannot continue because access is denied."],
     ["Critical work blocked by {s} permissions", "Privileged account rejected in {s}"],
     ["An authorized administrator cannot complete the live operational task.", "Required production work is blocked by an access problem."]),
    ("ACCESS", "CRITICAL", "HIGH", 2, ["administrator account", "service credentials", "operations account"],
     ["Compromised {s}", "Unauthorized takeover of {s}", "Security breach involving {s}"],
     ["There is confirmed unauthorized use of the account.", "Credentials were stolen and used without authorization.", "Security logs confirm the account was compromised."],
     ["Verified compromise of {s}", "{s} used by an intruder"],
     ["Audit evidence confirms unauthorized control of this account.", "The credentials were misused by an attacker."]),
    ("FEATURE_REQUEST", "LOW", "LOW", 6, ["report builder", "team dashboard", "export tool", "search panel"],
     ["Add a new option to {s}", "Feature idea for {s}", "Would like a new {s} capability"],
     ["Please consider this capability for a future release.", "The existing product works; this is a requested enhancement.", "No current workflow is broken; an extra option would help."],
     ["Request an enhancement to {s}", "Proposed new function for {s}"],
     ["This is a desired future capability rather than an existing failure.", "The requester wants an additional option in the product."]),
    ("FEATURE_REQUEST", "LOW", "LOW", 5, ["CSV export", "saved searches", "dashboard widgets"],
     ["Could {s} support another format?", "New filter requested for {s}", "Idea to extend {s}"],
     ["The team can continue with current features while this is considered.", "This would reduce manual steps but is not needed immediately.", "No incident or broken behavior is reported."],
     ["Extend the available {s} options", "Request for additional {s} behavior"],
     ["The current path works, and the request is for an optional improvement.", "There is no active failure; the proposed addition is for a later release."]),
    ("FEATURE_REQUEST", "LOW", "LOW", 4, ["notification rules", "bulk tagging", "report templates"],
     ["Suggestion for {s}", "Please add {s}", "Request to introduce {s}"],
     ["This is a product idea without urgent operational impact.", "It would improve convenience in a future iteration.", "The request does not describe an existing defect."],
     ["Consider implementing {s}", "Proposal for a new {s} feature"],
     ["The requester is proposing a new capability with no current outage.", "This is a nonurgent enhancement request."]),
    ("CONTENT_CHANGE", "LOW", "LOW", 5, ["help-page heading", "email footer", "home-page banner"],
     ["Update the {s} wording", "Copy change for {s}", "Edit text in {s}"],
     ["The requested action is editorial wording only.", "Please revise the displayed copy without changing behavior.", "The text needs a routine content edit."],
     ["Revise copy in {s}", "Editorial update to {s}"],
     ["This is a text-only change to the published material.", "The current wording should be replaced; no feature change is requested."]),
    ("CONTENT_CHANGE", "LOW", "LOW", 4, ["French help page", "Spanish onboarding", "release-note summary"],
     ["Translation edit for {s}", "Fix a typo in {s}", "Correct {s} text"],
     ["The translation has a wording mistake but product behavior is normal.", "A spelling issue needs editorial correction.", "Only the published content requires revision."],
     ["Language correction in {s}", "Proofread and revise {s}"],
     ["The request concerns a textual mistake in the localized material.", "An editorial correction is needed; the service is unaffected."]),
    ("CONTENT_CHANGE", "LOW", "LOW", 3, ["campaign image", "onboarding illustration", "documentation screenshot"],
     ["Replace {s}", "Refresh the {s} asset", "Update visual content in {s}"],
     ["The visual asset is outdated and should be swapped.", "This is a routine editorial image update.", "No functionality or access change is required."],
     ["Editorial asset replacement for {s}", "Revise the visual in {s}"],
     ["The request is to update published visual content only.", "A newer image should replace the current one."]),
    ("SUPPORT", "LOW", "LOW", 5, ["saved reports", "workspace settings", "account preferences"],
     ["How do I use {s}?", "Need guidance on {s}", "Question about {s}"],
     ["Please explain the existing steps; no error occurs.", "The user wants instructions for a working feature.", "A short walkthrough of the current process would help."],
     ["Help using {s}", "Where are the {s} instructions?"],
     ["The feature works; the requester needs an explanation of the steps.", "Please provide usage guidance for the existing function."]),
    ("SUPPORT", "LOW", "LOW", 4, ["monthly report", "team preferences", "usage dashboard"],
     ["Clarify how {s} works", "Explain the {s} workflow", "Need help understanding {s}"],
     ["There is no reported failure; the question is about expected behavior.", "The user seeks an explanation, not a modification.", "Please describe what the current controls do."],
     ["Usage question regarding {s}", "Request for {s} guidance"],
     ["An explanation of existing behavior would resolve the request.", "The requester is asking how the current workflow operates."]),
    ("SUPPORT", "LOW", "LOW", 3, ["documentation index", "training materials", "report filters"],
     ["Where can I find {s}?", "Help locating {s}", "Need directions for {s}"],
     ["The resource exists, and the user needs navigation help.", "Please point the requester to the existing resource.", "No broken or missing capability has been reported."],
     ["How to locate {s}", "Navigation help for {s}"],
     ["The user needs directions to an already available resource.", "This is a help request about finding an existing item."]),
    ("OTHER", "LOW", "LOW", 4, ["quarterly planning", "team roster", "office calendar"],
     ["Note about {s}", "FYI: {s}", "Information on {s}"],
     ["This is a status note only; there is no requested action.", "The message records information without an issue to resolve.", "No change, guidance, or access request is included."],
     ["Informational update concerning {s}", "Recorded note on {s}"],
     ["The sender is sharing an update and asks for no action.", "This item is informational and needs no triage action."]),
    ("OTHER", "LOW", "LOW", 4, ["completed workshop", "scheduled review", "archived document"],
     ["Record: {s}", "Status FYI for {s}", "Notice concerning {s}"],
     ["This is a routine record of what already happened.", "No problem or new request is described.", "The message is purely informational."],
     ["Filed update on {s}", "Information-only item: {s}"],
     ["The note has no request for product or operational work.", "The item only documents a past or scheduled activity."]),
]

CONTEXT = {
    "train": ["Observed during the morning review.", "Recorded in the weekly team check.",
              "A staff member raised this in the afternoon.", "Seen during routine verification.",
              "Logged by the operations team today.", "Shared with the product team this week."],
    "validation": ["Reported during the evening handoff.", "Noted during the monthly review.",
                   "Sent by a colleague after routine inspection.", "Recorded in yesterday's team notes."],
}
LENGTH = {"train": ["", "", "", "There are no additional symptoms to report.",
                    "The team has not observed any separate incident or security event.",
                    "Background: this item was first recorded during routine work, reviewed by a second colleague, and passed to the triage queue with the original observation intact. The reporter has supplied the current symptom or request above and has not added a separate task. The next update can be collected through the usual ticket thread."],
          "validation": ["", "", "No separate problem was mentioned.",
                         "This note contains all the information currently available.",
                         "Additional context: another staff member checked that this ticket describes one matter only. The team recorded the observation in its regular handoff notes, retained the original report for follow-up, and will add more details if the requester provides them. No second task is being requested in this message."]}


def generate(split: str, count: int, seed: int) -> list[dict]:
    rng = random.Random(seed)
    weights = [scenario[3] for scenario in SCENARIOS]
    rows = []
    seen = set()
    for index in range(count):
        for _ in range(1000):
            scenario_index = rng.choices(range(len(SCENARIOS)), weights=weights)[0]
            category, priority, risk, _, subjects, train_titles, train_details, val_titles, val_details = SCENARIOS[scenario_index]
            titles, details = (train_titles, train_details) if split == "train" else (val_titles, val_details)
            subject = rng.choice(subjects)
            title = rng.choice(titles).format(s=subject)
            description = " ".join(part for part in
                                   (rng.choice(details).format(s=subject), rng.choice(CONTEXT[split]), rng.choice(LENGTH[split]))
                                   if part)
            fingerprint = (title.casefold(), description.casefold())
            if fingerprint not in seen:
                seen.add(fingerprint)
                break
        else:
            raise RuntimeError("Scenario space exhausted")
        rows.append({"id": f"laya-adapt-{split}-{index + 1:04d}",
                     "input": {"title": title, "description": description},
                     "expected": {"category": category, "priority": priority, "risk": risk},
                     "scenario": scenario_index})
    return rows


def summary(rows: list[dict]) -> dict:
    lengths = sorted(len(row["input"]["title"] + " " + row["input"]["description"]) for row in rows)
    return {"count": len(rows),
            "category": dict(sorted(Counter(row["expected"]["category"] for row in rows).items())),
            "priority": dict(sorted(Counter(row["expected"]["priority"] for row in rows).items())),
            "risk": dict(sorted(Counter(row["expected"]["risk"] for row in rows).items())),
            "tuples": dict(sorted(Counter("/".join(row["expected"][key] for key in ("category", "priority", "risk")) for row in rows).items())),
            "text_chars": {"min": lengths[0], "median": lengths[len(lengths)//2], "p95": lengths[int(.95 * (len(lengths)-1))], "max": lengths[-1]}}


def write_new(path: Path, value: str) -> str:
    with path.open("x", encoding="utf-8") as handle:
        handle.write(value)
    return hashlib.sha256(value.encode()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Verify existing files match deterministic generation")
    parser.add_argument("--regenerate", action="store_true", help="Replace only these pre-freeze generated dataset files")
    args = parser.parse_args()
    if args.check and args.regenerate:
        parser.error("--check and --regenerate are mutually exclusive")
    datasets = {split: generate(split, count, SEED + (0 if split == "train" else 1))
                for split, count in SIZES.items()}
    all_texts = [(row["input"]["title"].casefold(), row["input"]["description"].casefold())
                 for rows in datasets.values() for row in rows]
    if len(set(all_texts)) != len(all_texts):
        raise ValueError("Cross-split duplicate text")
    expected = {}
    for split, rows in datasets.items():
        content = "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows)
        path = TRAIN if split == "train" else VALIDATION
        digest = hashlib.sha256(content.encode()).hexdigest()
        if args.check:
            if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                raise ValueError(f"{split} differs from deterministic generation")
        elif args.regenerate:
            path.write_text(content, encoding="utf-8")
        else:
            write_new(path, content)
        expected[split] = {"path": str(path.relative_to(ROOT)), "sha256": digest, **summary(rows)}
    metadata = {"protocol": "laya-domain-adaptation-dataset-v1", "seed": SEED,
                "source": "authored project taxonomy/rules and scenario blueprints in scripts/laya_adapt_dataset.py; no LLM and no held-out source",
                "generator_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                "splits": expected}
    serialized = json.dumps(metadata, indent=2, ensure_ascii=False) + "\n"
    if args.check:
        if not METADATA.exists() or METADATA.read_text(encoding="utf-8") != serialized:
            raise ValueError("Metadata differs from deterministic generation")
    elif args.regenerate:
        METADATA.write_text(serialized, encoding="utf-8")
    else:
        write_new(METADATA, serialized)
    print(json.dumps({key: {"count": value["count"], "sha256": value["sha256"]}
                      for key, value in expected.items()}, indent=2))


if __name__ == "__main__":
    main()
