/**
 * Desk book brands within a white-label skin.
 *
 * SkinId = white-label family (buckeye, ace, …)
 * BookId = concrete desk brand derived from SKINS[].hosts (fantasy402, parlay21, …)
 *
 * Host → BookId → SkinId. Discovery never invents books; hosts on SKINS own them.
 */

import {
  SKINS,
  apexHost,
  getSkinByHost,
  listSkinApexHosts,
  skinOffersLiveProduct,
  type SkinId,
} from './skins.ts';

export type BookId = string & { readonly __brand: 'BookId' };

export type BookRecord = {
  id: BookId;
  skinId: SkinId;
  /** Apex hosts that resolve to this book (www. collapsed). */
  hosts: readonly string[];
  /** Short display label (usually apex left-most label). */
  label: string;
};

function asBookId(raw: string): BookId {
  const t = raw.trim().toLowerCase();
  if (!t) throw new Error('BookId: empty');
  return t as BookId;
}

/**
 * Prefer short label (`fantasy402`) when the apex is `label.tld` and that label
 * uniquely claims one apex; otherwise use the full apex (`classic.lvaction.com`).
 */
function preferredBookId(apex: string, uniqueLabels: Map<string, string>): string {
  const parts = apex.split('.');
  if (parts.length === 2) {
    const label = parts[0]!;
    if (uniqueLabels.get(label) === apex) return label;
  }
  return apex;
}

type Built = {
  books: BookRecord[];
  byId: Map<BookId, BookRecord>;
  hostToBook: Record<string, BookId>;
  bookIds: BookId[];
};

function buildCatalog(): Built {
  // Count 2-part apex labels; only uniquely claimed labels become short BookIds.
  const labelOwners = new Map<string, string[]>();
  for (const skin of SKINS) {
    for (const apex of listSkinApexHosts(skin.id)) {
      const parts = apex.split('.');
      if (parts.length !== 2) continue;
      const label = parts[0]!;
      const list = labelOwners.get(label) ?? [];
      list.push(apex);
      labelOwners.set(label, list);
    }
  }
  const uniqueLabels = new Map<string, string>();
  for (const [label, apexes] of labelOwners) {
    if (apexes.length === 1) uniqueLabels.set(label, apexes[0]!);
  }

  const byKey = new Map<string, { skinId: SkinId; hosts: string[]; label: string }>();
  const hostToBook: Record<string, BookId> = {};

  for (const skin of SKINS) {
    for (const apex of listSkinApexHosts(skin.id)) {
      const id = preferredBookId(apex, uniqueLabels);
      const label = apex.split('.')[0] ?? id;
      const existing = byKey.get(id);
      if (existing) {
        if (existing.skinId !== skin.id) {
          throw new Error(`BookId collision ${id}: skins ${existing.skinId} and ${skin.id}`);
        }
        if (!existing.hosts.includes(apex)) existing.hosts.push(apex);
      } else {
        byKey.set(id, { skinId: skin.id, hosts: [apex], label });
      }
      hostToBook[apex] = asBookId(id);
      hostToBook[`www.${apex}`] = asBookId(id);
    }
  }

  const books: BookRecord[] = [...byKey.entries()]
    .map(([id, v]) => ({
      id: asBookId(id),
      skinId: v.skinId,
      hosts: [...v.hosts].sort(),
      label: v.label,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const byId = new Map(books.map(b => [b.id, b]));
  return {
    books,
    byId,
    hostToBook,
    bookIds: books.map(b => b.id),
  };
}

const CATALOG = buildCatalog();

export const BOOKS: readonly BookRecord[] = CATALOG.books;
export const BOOK_IDS: readonly BookId[] = CATALOG.bookIds;
export const HOST_TO_BOOK: Readonly<Record<string, BookId>> = CATALOG.hostToBook;

export function isBookId(value: string): value is BookId {
  return CATALOG.byId.has(value.trim().toLowerCase() as BookId);
}

export function getBook(id: string): BookRecord | undefined {
  return CATALOG.byId.get(id.trim().toLowerCase() as BookId);
}

export function listBooks(): readonly BookRecord[] {
  return BOOKS;
}

export function listBooksForSkin(skinId: SkinId): readonly BookRecord[] {
  return BOOKS.filter(b => b.skinId === skinId);
}

export function listBookIdsForSkin(skinId: SkinId): BookId[] {
  return listBooksForSkin(skinId).map(b => b.id);
}

/** Resolve BookId from URL or hostname via HOST_TO_BOOK / Skin host map. */
export function getBookByHost(hostOrUrl: string): BookId | undefined {
  const host = apexHost(hostOrUrl);
  if (!host) return undefined;
  if (HOST_TO_BOOK[host]) return HOST_TO_BOOK[host];
  if (host.startsWith('www.') && HOST_TO_BOOK[host.slice(4)]) {
    return HOST_TO_BOOK[host.slice(4)];
  }
  // Subdomain of a mapped apex (e.g. backend.parlay21.com → parlay21)
  const skin = getSkinByHost(hostOrUrl);
  if (!skin) return undefined;
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    const book = HOST_TO_BOOK[candidate];
    if (book) {
      const rec = getBook(book);
      if (rec?.skinId === skin) return book;
    }
  }
  return undefined;
}

/**
 * Resolve desk BookId from raw token (book id, alias-ish label, or host).
 * Does **not** treat SkinId as BookId — use resolveSkinId for white-labels.
 */
export function resolveBookId(raw: string): BookId | undefined {
  const t = raw.trim().toLowerCase();
  if (!t) return undefined;
  if (isBookId(t)) return t;
  return getBookByHost(t);
}

export function skinIdForBook(bookId: BookId | string): SkinId | undefined {
  return getBook(String(bookId))?.skinId;
}

/** Live-product offer check via BookId → SkinId (desk brand, not white-label). */
export function bookOffersLiveProduct(bookId: BookId | string, product: string): boolean {
  const skinId = skinIdForBook(bookId);
  if (!skinId) return false;
  return skinOffersLiveProduct(skinId, product);
}

/** @deprecated use bookOffersLiveProduct */
export const bookOffersSkin = bookOffersLiveProduct;
