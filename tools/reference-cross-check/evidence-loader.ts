#!/usr/bin/env bun
/**
 * Evidence side: load tools/build-artifact-evidence.json and resolve
 * dotted paths into it. 178. Offline.
 */

export interface Evidence {
  [k: string]: any;
}

export async function loadEvidence(path: string): Promise<Evidence> {
  return (await Bun.file(path).json()) as Evidence;
}

/**
 * Resolve a dotted path into the evidence JSON. Supports:
 *   scenarios.<scenarioName>.<rest>   - find a scenario by its name field
 *   <key>[n].<rest>                   - array index
 * Returns undefined for any missing segment.
 */
export function resolvePath(ev: Evidence, path: string): unknown {
  const segs = path.split('.');
  let cur: any = ev;
  let i = 0;
  while (i < segs.length) {
    let seg = segs[i]!;
    if (cur === null || cur === undefined) return undefined;
    const idxMatch = seg.match(/^(.+)\[(\d+)\]$/);
    if (seg === 'scenarios' && i + 1 < segs.length) {
      const name = segs[i + 1]!;
      const arr = cur.scenarios;
      if (!Array.isArray(arr)) return undefined;
      const found = arr.find((x: any) => x.name === name);
      cur = found;
      i += 2;
      continue;
    }
    if (idxMatch) {
      const key = idxMatch[1]!;
      const n = Number(idxMatch[2]);
      const arr = cur[key];
      if (!Array.isArray(arr)) return undefined;
      cur = arr[n];
    } else {
      cur = cur[seg];
    }
    i++;
  }
  return cur;
}

export {};