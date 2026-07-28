/**
 * Skills catalog — scan a skills directory for per-skill SKILL.md files and
 * expose a JSON summary.
 * Bun-native only (Bun.Glob, Bun.file). No yaml dependency: frontmatter is parsed
 * minimally for `name` / `description` (including `description: >` folded blocks).
 *
 *   PORTAL_SKILLS_DIR          — skills root (default: Kimi Work managed skills dir)
 *   PORTAL_SKILLS_PACKAGES_DIR — *.skill package drop dir (default: public/skills)
 *
 * Missing/inaccessible dirs never crash the route: they yield
 * `{ skills: [], count: 0, error, warning }` with HTTP 200.
 */

const DEFAULT_SKILLS_DIR =
  '/Users/nolarose/Library/Application Support/kimi-desktop/daimon-share/daimon/skills';
const DEFAULT_PACKAGES_DIR = 'public/skills';

export interface SkillEntry {
  name: string;
  description: string;
  /** ISO 8601 mtime of the SKILL.md file. */
  updatedAt: string;
  /** True when a matching `<name>.skill` archive exists in the packages dir. */
  hasPackage: boolean;
}

export interface SkillsCatalog {
  skills: SkillEntry[];
  count: number;
  /** Present when the skills dir could not be scanned (empty result, HTTP 200). */
  error?: string;
  /** Human-readable note for the portal banner. */
  warning?: string;
}

function skillsDir(): string {
  return (Bun.env.PORTAL_SKILLS_DIR || '').trim() || DEFAULT_SKILLS_DIR;
}

function packagesDir(): string {
  return (Bun.env.PORTAL_SKILLS_PACKAGES_DIR || '').trim() || DEFAULT_PACKAGES_DIR;
}

/**
 * Minimal YAML frontmatter reader — extracts `name` and `description` only.
 * Handles inline scalars, single/double quotes, and `>` / `|-` style block
 * scalars (continuation lines indented deeper than the key).
 */
function parseFrontmatter(text: string): { name: string; description: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out = { name: '', description: '' };
  if (!m) return out;
  const body = m[1]!;
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i]!.match(/^(name|description):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1] as 'name' | 'description';
    let value = kv[2]!.trim();
    if (value === '>' || value === '>-' || value === '|' || value === '|-') {
      // Folded/literal block: join following indented lines.
      const block: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const cont = lines[j]!;
        if (/^\s+\S/.test(cont)) block.push(cont.trim());
        else if (cont.trim() === '') block.push('');
        else break;
      }
      value = block
        .join(value.startsWith('|') ? '\n' : ' ')
        .replace(/\s+/g, ' ')
        .trim();
    } else {
      value = value.replace(/^(['"])([\s\S]*)\1$/, '$2').trim();
    }
    out[key] = value;
  }
  return out;
}

/** Scan the skills dir and build the catalog payload. Never throws. */
export async function buildSkillsCatalog(): Promise<SkillsCatalog> {
  const dir = skillsDir();
  const pkgs = packagesDir();
  try {
    // Bun.file(dir).exists() is false for directories — rely on Glob.scan,
    // which throws ENOENT for a missing/inaccessible skills root (caught below).
    const glob = new Bun.Glob('*/SKILL.md');
    const skills: SkillEntry[] = [];
    for await (const path of glob.scan({ cwd: dir, absolute: true, onlyFiles: true })) {
      try {
        const file = Bun.file(path);
        const text = await file.text();
        const fm = parseFrontmatter(text);
        const dirName = path.split('/').slice(-2, -1)[0] ?? '';
        const name = fm.name || dirName;
        if (!name) continue;
        const pkg = Bun.file(`${pkgs}/${name}.skill`);
        skills.push({
          name,
          description: fm.description,
          updatedAt: new Date(file.lastModified).toISOString(),
          hasPackage: await pkg.exists(),
        });
      } catch {
        // Unreadable file — skip, never abort the scan.
      }
    }
    skills.sort((a, b) => a.name.localeCompare(b.name));
    return { skills, count: skills.length };
  } catch (err) {
    return {
      skills: [],
      count: 0,
      error: err instanceof Error ? err.message : String(err),
      warning: `Skills directory unavailable (${dir}) — set PORTAL_SKILLS_DIR.`,
    };
  }
}
