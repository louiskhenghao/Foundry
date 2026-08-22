export interface DagNode {
  id: string;
  dependsOn: string[];
}

export class DagError extends Error {}

/** Kahn's algorithm. Throws on cycles or unknown dependencies. Returns ids in topological order. */
export function topoSort(nodes: DagNode[]): string[] {
  const ids = new Set(nodes.map((n) => n.id));
  const indeg = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const n of nodes) {
    indeg.set(n.id, 0);
    out.set(n.id, []);
  }
  for (const n of nodes) {
    for (const d of n.dependsOn) {
      if (!ids.has(d)) throw new DagError(`Task ${n.id} depends on unknown task ${d}`);
      if (d === n.id) throw new DagError(`Task ${n.id} depends on itself`);
      indeg.set(n.id, (indeg.get(n.id) ?? 0) + 1);
      out.get(d)!.push(n.id);
    }
  }
  const queue = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of out.get(id)!) {
      const v = indeg.get(next)! - 1;
      indeg.set(next, v);
      if (v === 0) queue.push(next);
    }
  }
  if (order.length !== nodes.length) throw new DagError('Task graph contains a cycle');
  return order;
}

/** Depth (longest path from a root) per node; used to lay out columns in the UI. */
export function depths(nodes: DagNode[]): Map<string, number> {
  const order = topoSort(nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depth = new Map<string, number>();
  for (const id of order) {
    const n = byId.get(id)!;
    const d = n.dependsOn.reduce((m, dep) => Math.max(m, (depth.get(dep) ?? 0) + 1), 0);
    depth.set(id, d);
  }
  return depth;
}
