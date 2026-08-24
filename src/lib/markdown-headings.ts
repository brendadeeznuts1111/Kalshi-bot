/**
 * markdown-headings.ts — Bun.markdown-driven heading extraction.
 *
 * Grounded in the full API probe (AGENT-PITFALLS §34):
 *   - native ids: Bun.markdown.html(md, { headings: { ids: true } }) emits
 *     <h1 id="faster"> (GitHub-style slugs, duplicates -1/-2).
 *   - render callbacks: heading(children, { level, id }) fires per heading.
 *
 * So the heading TREE is captured through render() callbacks — Bun walks
 * the document for us; we only track levels + parent indices. No HTML
 * regex, no manual slug generation for our content.
 */
export type HeadingNode = {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  slug: string;
  parentIndex: number | null;
};

/**
 * GitHub-style anchor slug — kept for callers slugging arbitrary strings
 * (the renderer's ids are authoritative when available).
 */
export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

type RenderedHeading = { level: number; id?: string; text: string };

/**
 * Capture the heading tree through Bun.markdown.render callbacks.
 * heading(children, {level, id}) gives level + NATIVE id; the children
 * string is the heading text (strip inline markup via a text callback).
 * parentIndex = closest heading of a lower level (child tracking).
 */
export function markdownHeadings(markdown: string): HeadingNode[] {
  const headings: RenderedHeading[] = [];
  try {
    (Bun.markdown as unknown as {
      render(md: string, cbs: Record<string, (c: string, m?: Record<string, unknown>) => string>, opts?: Record<string, unknown>): string;
    }).render(markdown, {
      heading: (children, meta) => {
        headings.push({
          level: Number(meta?.level ?? 1),
          ...(meta?.id ? { id: String(meta.id) } : {}),
          text: children.trim(),
        });
        return children;
      },
    }, { headings: { ids: true } });
  } catch {
    return [];
  }
  const nodes: HeadingNode[] = [];
  for (const h of headings) {
    let parentIndex: number | null = null;
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (nodes[i]!.level < h.level) { parentIndex = i; break; }
    }
    nodes.push({
      level: h.level as HeadingNode["level"],
      text: h.text,
      slug: h.id ?? headingSlug(h.text),
      parentIndex,
    });
  }
  return nodes;
}

export type HeadingTree = { node: HeadingNode; children: HeadingTree[] };

export function headingTree(nodes: HeadingNode[]): HeadingTree[] {
  const roots: HeadingTree[] = [];
  const stack: HeadingTree[] = [];
  for (const node of nodes) {
    const t: HeadingTree = { node, children: [] };
    while (stack.length && stack[stack.length - 1]!.node.level >= node.level) stack.pop();
    if (stack.length) stack[stack.length - 1]!.children.push(t);
    else roots.push(t);
    stack.push(t);
  }
  return roots;
}