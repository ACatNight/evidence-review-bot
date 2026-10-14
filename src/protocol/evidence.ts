import type { EvidenceNode } from "./types.js";

export function validateEvidenceDependencies(nodes: readonly EvidenceNode[]): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const remaining = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  const ready: string[] = [];
  for (const node of nodes) {
    const dependencies = node.kind === "source" ? [] : node.dependsOn;
    if (new Set(dependencies).size !== dependencies.length) {
      throw new Error("Evidence has duplicate dependencies");
    }
    remaining.set(node.id, dependencies.length);
    if (dependencies.length === 0) ready.push(node.id);
    for (const dependency of dependencies) {
      if (!byId.has(dependency)) throw new Error("Evidence references missing dependency");
      const consumers = dependents.get(dependency) ?? [];
      consumers.push(node.id);
      dependents.set(dependency, consumers);
    }
  }
  // Iterative traversal also handles long valid chains without overflowing the stack.
  for (let index = 0; index < ready.length; index++) {
    for (const consumer of dependents.get(ready[index] as string) ?? []) {
      const pending = (remaining.get(consumer) as number) - 1;
      remaining.set(consumer, pending);
      if (pending === 0) ready.push(consumer);
    }
  }
  if (ready.length !== nodes.length) throw new Error("Cycle in evidence dependencies");
}
