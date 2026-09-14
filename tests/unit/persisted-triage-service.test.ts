import { describe, expect, it } from "vitest";
import { ClassifierUnavailableError } from "../../src/application/errors/classifier-errors.ts";
import { PersistedTriageService } from "../../src/application/persisted-triage-service.ts";
import type {
  CompleteTriageRun,
  CreateFeedback,
  FailTriageRun,
  FeedbackRecord,
  StartTriageRun,
  TriageAuditRecord,
  TriageRunRepository,
} from "../../src/application/ports/triage-persistence.ts";
import type { FeedbackRepository } from "../../src/application/ports/triage-persistence.ts";
import { TriageTicket } from "../../src/application/triage-ticket.ts";
import { Category, Priority, Risk, SuggestedTeam } from "../../src/domain/triage.ts";

const input = { title: "Need help", description: "How do I export?" };
const result = {
  category: Category.SUPPORT,
  priority: Priority.LOW,
  risk: Risk.LOW,
  suggestedTeam: SuggestedTeam.SUPPORT,
  confidence: 0.9 as const,
  summary: "Need help",
  rationale: "Support request",
};

class FakeRunRepository implements TriageRunRepository {
  started?: StartTriageRun;
  completed?: CompleteTriageRun;
  failed?: FailTriageRun;
  audit: TriageAuditRecord | null = null;

  async start(input: StartTriageRun): Promise<void> {
    this.started = input;
  }

  async complete(input: CompleteTriageRun): Promise<void> {
    this.completed = input;
  }

  async fail(input: FailTriageRun): Promise<void> {
    this.failed = input;
  }

  async findDecisionAudit(): Promise<TriageAuditRecord | null> {
    return this.audit;
  }
}

class FakeFeedbackRepository implements FeedbackRepository {
  created?: CreateFeedback;

  async create(input: CreateFeedback): Promise<FeedbackRecord> {
    this.created = input;
    return { ...input, comment: input.comment ?? null, createdAt: new Date() };
  }
}

function service(
  outcome: typeof result | Error = result,
  runRepository = new FakeRunRepository(),
  feedbackRepository = new FakeFeedbackRepository(),
) {
  const classifier = {
    classify: async () => {
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
  return {
    service: new PersistedTriageService(
      new TriageTicket({ mode: "deterministic", classifier }),
      "DETERMINISTIC",
      runRepository,
      feedbackRepository,
    ),
    runRepository,
    feedbackRepository,
  };
}

describe("PersistedTriageService", () => {
  it("starts and completes an execution with application-generated UUIDs", async () => {
    const { service: useCase, runRepository } = service();
    const execution = await useCase.execute(input);

    expect(execution.decisionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(runRepository.started?.ticketId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(runRepository.started?.runId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(runRepository.started?.ticket).toEqual(input);
    expect(runRepository.completed?.decisionId).toBe(execution.decisionId);
    expect(runRepository.completed?.decision).toEqual({
      ...result,
      decisionSource: "DETERMINISTIC",
      requiresHumanReview: false,
      reviewReasons: [],
    });
    expect(runRepository.completed?.completedAt).toBeInstanceOf(Date);
    expect(runRepository.failed).toBeUndefined();
  });

  it("marks unexpected classifier failures without changing the error", async () => {
    const unexpected = new Error("unexpected classifier defect");
    const { service: useCase, runRepository } = service(unexpected);

    await expect(useCase.execute(input)).rejects.toBe(unexpected);
    expect(runRepository.failed?.failureCode).toBe("UNEXPECTED");
    expect(runRepository.completed).toBeUndefined();
  });

  it("maps known classifier failures to their persisted failure code", async () => {
    const { service: useCase, runRepository } = service(new ClassifierUnavailableError());

    await expect(useCase.execute(input)).rejects.toBeInstanceOf(ClassifierUnavailableError);
    expect(runRepository.failed?.failureCode).toBe("UNAVAILABLE");
  });

  it("derives the corrected suggested team from the corrected category", async () => {
    const { service: useCase, feedbackRepository } = service();

    await useCase.addFeedback("decision-id", {
      reviewedBy: "declared-reviewer",
      correctedCategory: Category.BUG,
      correctedPriority: Priority.HIGH,
      correctedRisk: Risk.HIGH,
      comment: "Manual correction",
    });

    expect(feedbackRepository.created).toEqual({
      id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
      decisionId: "decision-id",
      reviewedBy: "declared-reviewer",
      correctedCategory: Category.BUG,
      correctedPriority: Priority.HIGH,
      correctedRisk: Risk.HIGH,
      correctedSuggestedTeam: SuggestedTeam.DEVELOPMENT,
      comment: "Manual correction",
    });
  });
});
