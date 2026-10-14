export const REVIEW_PROTOCOL_VERSION = "1.0" as const;

export type ReviewProvider = "github" | "gitee" | "local";
export type ReviewStatus = "passed" | "findings" | "partial" | "failed";
export type CheckStatus = "complete" | "partial" | "not_run" | "error";
export type FindingSeverity = "info" | "low" | "medium" | "high" | "critical";
export type FindingConfidence = "deterministic" | "candidate";

export interface ReviewFile {
  readonly path: string;
  readonly blobSha?: string;
  readonly content?: string;
  readonly changedLines?: readonly ChangedLineRange[];
}

export interface ChangedLineRange {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
}

export interface ReviewPolicy {
  readonly enabledRules: readonly string[];
  readonly aiEnabled: boolean;
  readonly failOn: FindingSeverity;
}

export interface ReviewRequest {
  readonly protocolVersion: typeof REVIEW_PROTOCOL_VERSION;
  readonly provider: ReviewProvider;
  readonly repository: {
    readonly id: string;
    readonly fullName: string;
    readonly visibility?: "public" | "private";
  };
  readonly pullRequest?: {
    readonly number: number;
    readonly baseSha: string;
    readonly headSha: string;
  };
  readonly snapshot: {
    readonly baseSha?: string;
    readonly headSha?: string;
    readonly files: readonly ReviewFile[];
    readonly changedLines: readonly ChangedLineRange[];
  };
  readonly policy: ReviewPolicy;
}

export interface ProtocolLocation {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
}

export interface ProtocolFinding {
  readonly id: string;
  readonly ruleId: string;
  readonly severity: FindingSeverity;
  readonly confidence: FindingConfidence;
  readonly location: ProtocolLocation;
  readonly title: string;
  readonly explanation: string;
  readonly remediation?: string;
  readonly evidenceIds: readonly string[];
}

export type EvidenceNode =
  | {
      readonly id: string;
      readonly kind: "source";
      readonly snapshotSha: string;
      readonly path: string;
      readonly startLine: number;
      readonly endLine: number;
      readonly redactedExcerpt?: string;
    }
  | {
      readonly id: string;
      readonly kind: "rule" | "model";
      readonly source: string;
      readonly version: string;
      readonly dependsOn: readonly string[];
      readonly explanation: string;
    };

export interface CheckCoverage {
  readonly status: CheckStatus;
  readonly processed: number;
  readonly total?: number;
  readonly reason?: string;
}

export interface ReviewCoverage {
  readonly files: {
    readonly eligible: number;
    readonly reviewed: number;
    readonly skipped: number;
  };
  readonly changedLines?: {
    readonly eligible: number;
    readonly reviewed: number;
  };
  readonly checks: {
    readonly deterministic: CheckCoverage;
    readonly ai?: CheckCoverage;
    readonly lint: CheckCoverage;
    readonly build: CheckCoverage;
    readonly tests: CheckCoverage;
    readonly dependencies: CheckCoverage;
  };
}

export interface SkippedScope {
  readonly path?: string;
  readonly check: string;
  readonly reason: string;
}

export interface ReviewCheckResult {
  readonly id: string;
  readonly status: CheckStatus;
  readonly findingIds: readonly string[];
  readonly message?: string;
}

export interface ReviewResult {
  readonly runId: string;
  readonly protocolVersion: typeof REVIEW_PROTOCOL_VERSION;
  readonly engineVersion: string;
  readonly ruleSetVersion: string;
  readonly status: ReviewStatus;
  readonly coverage: ReviewCoverage;
  readonly findings: readonly ProtocolFinding[];
  readonly evidence: readonly EvidenceNode[];
  readonly skipped: readonly SkippedScope[];
  readonly checks: readonly ReviewCheckResult[];
}
