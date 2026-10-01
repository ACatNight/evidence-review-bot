export type CoverageState = "complete" | "partial" | "not_run";

export type CoverageReason =
  | "read_failed"
  | "diff_unavailable"
  | "too_large"
  | "parse_failed"
  | "timeout"
  | "unsupported"
  | "rule_disabled";

export interface ReviewSnapshot {
  readonly provider: string;
  readonly repositoryId: string;
  readonly pullRequestId: string;
  readonly mergeBaseSha: string;
  readonly baseSha: string;
  readonly headSha: string;
}

export interface CoverageRecord {
  readonly ruleId: string;
  readonly path: string;
  readonly state: "complete" | "incomplete" | "excluded";
  readonly reason?: CoverageReason;
}

export interface CoverageSummary {
  readonly state: CoverageState;
  readonly changedFiles: number;
  readonly applicableFiles: number;
  readonly completedFiles: number;
  readonly incompleteFiles: number;
  readonly excludedFiles: number;
}

export interface FindingLocation {
  readonly path: string;
  readonly blobSha: string;
  readonly side: "LEFT" | "RIGHT";
  readonly startLine: number;
  readonly endLine: number;
}

export interface Finding {
  readonly id: string;
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly confidence: "low" | "medium" | "high";
  readonly method: "deterministic" | "hybrid" | "llm";
  readonly title: string;
  readonly location: FindingLocation;
  readonly evidenceRootIds: readonly string[];
}

export interface EvidenceSource {
  readonly snapshotSha: string;
  readonly path: string;
  readonly blobSha: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly contentDigest: string;
}

export type EvidenceNode =
  | {
      readonly id: string;
      readonly kind: "observed";
      readonly source: EvidenceSource;
      readonly redactedExcerpt: string;
    }
  | {
      readonly id: string;
      readonly kind: "derived";
      readonly producer: string;
      readonly producerVersion: string;
      readonly dependsOn: readonly string[];
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly kind: "reasoning";
      readonly dependsOn: readonly string[];
      readonly description: string;
    };
