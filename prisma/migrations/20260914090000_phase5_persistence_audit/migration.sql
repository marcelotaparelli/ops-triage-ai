-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TriageMode" AS ENUM ('DETERMINISTIC', 'OLLAMA', 'HYBRID');

-- CreateEnum
CREATE TYPE "TriageRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "TriageFailureCode" AS ENUM ('TIMEOUT', 'UNAVAILABLE', 'INVALID_RESPONSE', 'UNEXPECTED');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('INCIDENT', 'BUG', 'FEATURE_REQUEST', 'CONTENT_CHANGE', 'SUPPORT', 'ACCESS', 'OTHER');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "Risk" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "SuggestedTeam" AS ENUM ('DEVELOPMENT', 'INFRASTRUCTURE', 'CONTENT', 'SUPPORT', 'PRODUCT', 'HUMAN_REVIEW');

-- CreateEnum
CREATE TYPE "DecisionSource" AS ENUM ('DETERMINISTIC', 'LLM', 'HYBRID', 'DETERMINISTIC_FALLBACK');

-- CreateEnum
CREATE TYPE "HumanReviewReason" AS ENUM ('CLASSIFIER_DISAGREEMENT', 'LOW_CONFIDENCE', 'HIGH_SEVERITY', 'LLM_UNAVAILABLE');

-- CreateTable
CREATE TABLE "Ticket" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriageRun" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "mode" "TriageMode" NOT NULL,
    "status" "TriageRunStatus" NOT NULL,
    "failureCode" "TriageFailureCode",
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),

    CONSTRAINT "TriageRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriageDecision" (
    "id" UUID NOT NULL,
    "triageRunId" UUID NOT NULL,
    "category" "Category" NOT NULL,
    "priority" "Priority" NOT NULL,
    "risk" "Risk" NOT NULL,
    "suggestedTeam" "SuggestedTeam" NOT NULL,
    "confidence" DECIMAL(2,1) NOT NULL,
    "summary" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "decisionSource" "DecisionSource" NOT NULL,
    "requiresHumanReview" BOOLEAN NOT NULL,
    "reviewReasons" "HumanReviewReason"[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TriageDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" UUID NOT NULL,
    "decisionId" UUID NOT NULL,
    "reviewedBy" TEXT NOT NULL,
    "correctedCategory" "Category" NOT NULL,
    "correctedPriority" "Priority" NOT NULL,
    "correctedRisk" "Risk" NOT NULL,
    "correctedSuggestedTeam" "SuggestedTeam" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TriageRun_ticketId_idx" ON "TriageRun"("ticketId");

-- CreateIndex
CREATE INDEX "TriageRun_startedAt_idx" ON "TriageRun"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TriageDecision_triageRunId_key" ON "TriageDecision"("triageRunId");

-- CreateIndex
CREATE INDEX "Feedback_decisionId_idx" ON "Feedback"("decisionId");

-- AddForeignKey
ALTER TABLE "TriageRun" ADD CONSTRAINT "TriageRun_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageDecision" ADD CONSTRAINT "TriageDecision_triageRunId_fkey" FOREIGN KEY ("triageRunId") REFERENCES "TriageRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "TriageDecision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
