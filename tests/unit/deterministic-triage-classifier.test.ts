import { describe, expect, it } from "vitest";
import { DeterministicTriageClassifier } from "../../src/application/classifiers/deterministic-triage-classifier.ts";
import {
  Category,
  Priority,
  Risk,
  SuggestedTeam,
} from "../../src/domain/triage.ts";

const classifier = new DeterministicTriageClassifier();

async function classify(title: string, description = "Routine request") {
  return classifier.classify({ title, description });
}

describe("DeterministicTriageClassifier", () => {
  it.each([
    ["Production is down", "All customers are affected", Category.INCIDENT],
    ["Login access denied", "The user receives 403", Category.ACCESS],
    ["Regression in checkout", "Checkout fails after release", Category.BUG],
    ["Feature request: export CSV", "Add support for reports", Category.FEATURE_REQUEST],
    ["Banner text change", "Update the copy", Category.CONTENT_CHANGE],
    ["Need help with reports", "How do I export?", Category.SUPPORT],
  ])("classifies explicit signals: %s", async (title, description, category) => {
    await expect(classify(title, description)).resolves.toMatchObject({ category });
  });

  it("lets a specific feature phrase beat an incidental generic error", async () => {
    const result = await classify(
      "Feature request: clearer validation",
      "Show a more useful error when a field is missing",
    );
    expect(result.category).toBe(Category.FEATURE_REQUEST);
  });

  it("uses the documented tie-break only for an exact scoring tie", async () => {
    const result = await classify("Bug 401", "Routine request");
    expect(result.category).toBe(Category.ACCESS);
    expect(result.confidence).toBe(0.5);
    expect(result.rationale).toContain("CATEGORY_TIE_BREAK");
  });

  it("returns conservative defaults when there are no signals", async () => {
    await expect(classify("Weekly operational note")).resolves.toMatchObject({
      category: Category.OTHER,
      priority: Priority.LOW,
      risk: Risk.LOW,
      suggestedTeam: SuggestedTeam.HUMAN_REVIEW,
      confidence: 0.5,
    });
  });

  it("marks a broad production outage as critical and high risk", async () => {
    await expect(
      classify("Production is down", "The outage affects all customers"),
    ).resolves.toMatchObject({
      category: Category.INCIDENT,
      priority: Priority.CRITICAL,
      risk: Risk.HIGH,
      suggestedTeam: SuggestedTeam.INFRASTRUCTURE,
      confidence: 0.9,
    });
  });

  it("raises data loss and security signals independently of category", async () => {
    const dataLoss = await classify("Bug in import", "The regression causes data loss");
    const security = await classify("Login access denied", "Account compromised");
    expect(dataLoss).toMatchObject({ priority: Priority.CRITICAL, risk: Risk.HIGH });
    expect(security).toMatchObject({ priority: Priority.CRITICAL, risk: Risk.HIGH });
  });

  it("returns only the three heuristic confidence bands and never 1.0", async () => {
    const results = await Promise.all([
      classify("Production is down", "Outage for all customers"),
      classify("Bug in report"),
      classify("Weekly operational note"),
    ]);
    expect(results.map(({ confidence }) => confidence)).toEqual([0.9, 0.7, 0.5]);
    expect(results.every(({ confidence }) => confidence !== (1 as number))).toBe(true);
  });

  it("keeps summary and rationale short and auditable", async () => {
    const result = await classify("A".repeat(170) + " bug", "An error occurs");
    expect(result.summary).toHaveLength(160);
    expect(result.summary.endsWith("...")).toBe(true);
    expect(result.rationale).toMatch(/BUG_(HIGH|PARTIAL)_SIGNAL/);
    expect(result.rationale.length).toBeLessThan(240);
  });
});
