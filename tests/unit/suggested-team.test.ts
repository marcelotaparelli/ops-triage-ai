import { describe, expect, it } from "vitest";
import { suggestedTeamForCategory } from "../../src/domain/suggested-team.ts";
import { Category, SuggestedTeam } from "../../src/domain/triage.ts";

describe("suggestedTeamForCategory", () => {
  it.each([
    [Category.INCIDENT, SuggestedTeam.INFRASTRUCTURE],
    [Category.BUG, SuggestedTeam.DEVELOPMENT],
    [Category.FEATURE_REQUEST, SuggestedTeam.PRODUCT],
    [Category.CONTENT_CHANGE, SuggestedTeam.CONTENT],
    [Category.SUPPORT, SuggestedTeam.SUPPORT],
    [Category.ACCESS, SuggestedTeam.SUPPORT],
    [Category.OTHER, SuggestedTeam.HUMAN_REVIEW],
  ])("maps %s to %s", (category, team) => {
    expect(suggestedTeamForCategory(category)).toBe(team);
  });
});
