import type { EvidenceNode, Finding } from "./review.js";

export function validateEvidence(
  nodes: readonly EvidenceNode[],
  findings: readonly Finding[],
): void {
  const byId = new Map<string, EvidenceNode>();
  for (const node of nodes) {
    if (!node.id || byId.has(node.id)) throw new Error("Evidence IDs must be unique and nonempty");
    byId.set(node.id, node);
    if (node.kind === "observed") {
      const source = node.source;
      if (
        !source.snapshotSha ||
        !source.blobSha ||
        !source.path ||
        !source.contentDigest ||
        source.startLine < 1 ||
        source.endLine < source.startLine
      ) {
        throw new Error(`Observed evidence ${node.id} has no verifiable source`);
      }
    } else {
      if (node.dependsOn.length === 0) throw new Error(`Evidence ${node.id} has no dependencies`);
      if (node.kind === "derived" && (!node.producer || !node.producerVersion)) {
        throw new Error(`Derived evidence ${node.id} has no producer version`);
      }
    }
  }

  const visiting = new Set<string>();
  const observed = new Map<string, boolean>();
  function hasObserved(id: string): boolean {
    const node = byId.get(id);
    if (!node) throw new Error(`Missing evidence ${id}`);
    if (visiting.has(id)) throw new Error(`Cycle in evidence at ${id}`);
    const cached = observed.get(id);
    if (cached !== undefined) return cached;
    if (node.kind === "observed") {
      observed.set(id, true);
      return true;
    }
    visiting.add(id);
    let found = false;
    for (const dependency of node.dependsOn) {
      if (hasObserved(dependency)) found = true;
    }
    visiting.delete(id);
    observed.set(id, found);
    return found;
  }

  // Validate every node, including unattached nodes that might be persisted later.
  for (const id of byId.keys()) hasObserved(id);
  for (const finding of findings) {
    if (finding.evidenceRootIds.length === 0)
      throw new Error(`Finding ${finding.id} has no evidence`);
    if (!finding.evidenceRootIds.some(hasObserved)) {
      throw new Error(`Finding ${finding.id} has no observed evidence`);
    }
  }
}
