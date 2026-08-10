/**
 * Canonical sports matrix (provider-/skin-agnostic).
 *
 * Skin coverage bindings live in skin-sport-bindings.ts.
 * Books only declare which skins they offer — they do not own this list.
 */

export const SPORT_CATEGORIES = [
  'major',
  'team',
  'individual',
  'combat',
  'racing',
  'other',
] as const;
export type SportCategory = (typeof SPORT_CATEGORIES)[number];

export type SportRecord = {
  id: string;
  displayName: string;
  category?: SportCategory;
};

/**
 * Sport ids from observed stream-list / ticket maps (snake_case).
 * Display names are UI-only.
 */
export const SPORTS = [
  { id: 'soccer', displayName: 'Soccer', category: 'major' },
  { id: 'tennis', displayName: 'Tennis', category: 'major' },
  { id: 'basketball', displayName: 'Basketball', category: 'major' },
  { id: 'table_tennis', displayName: 'Table Tennis', category: 'individual' },
  { id: 'ice_hockey', displayName: 'Ice Hockey', category: 'major' },
  { id: 'volleyball', displayName: 'Volleyball', category: 'team' },
  { id: 'handball', displayName: 'Handball', category: 'team' },
  { id: 'baseball', displayName: 'Baseball', category: 'major' },
  { id: 'bandy', displayName: 'Bandy', category: 'team' },
  { id: 'snooker', displayName: 'Snooker', category: 'individual' },
  { id: 'billiards', displayName: 'Billiards', category: 'individual' },
  { id: 'badminton', displayName: 'Badminton', category: 'individual' },
  { id: 'cricket', displayName: 'Cricket', category: 'team' },
  { id: 'golf', displayName: 'Golf', category: 'individual' },
  { id: 'cycling', displayName: 'Cycling', category: 'racing' },
  { id: 'boxing', displayName: 'Boxing', category: 'combat' },
  { id: 'formula_1', displayName: 'Formula 1', category: 'racing' },
  { id: 'rugby', displayName: 'Rugby', category: 'team' },
  { id: 'hurling', displayName: 'Hurling', category: 'team' },
  { id: 'gaelic_football', displayName: 'Gaelic Football', category: 'team' },
  { id: 'floorball', displayName: 'Floorball', category: 'team' },
  { id: 'motorsport', displayName: 'Motorsport', category: 'racing' },
  { id: 'american_football', displayName: 'American Football', category: 'major' },
  { id: 'australian_rules', displayName: 'Australian Rules', category: 'team' },
  { id: 'darts', displayName: 'Darts', category: 'individual' },
  { id: 'futsal', displayName: 'Futsal', category: 'team' },
  { id: 'ufc', displayName: 'UFC', category: 'combat' },
  { id: 'martial_arts', displayName: 'Martial Arts', category: 'combat' },
  { id: 'horse_racing', displayName: 'Horse Racing', category: 'racing' },
  { id: 'sports_channels', displayName: 'Sports Channels', category: 'other' },
] as const satisfies readonly SportRecord[];

export type SportId = (typeof SPORTS)[number]['id'];

const byId = new Map<string, (typeof SPORTS)[number]>(SPORTS.map(s => [s.id, s]));

export function isSportId(value: string): value is SportId {
  return byId.has(value.trim().toLowerCase());
}

export function getSport(id: string): (typeof SPORTS)[number] | undefined {
  return byId.get(id.trim().toLowerCase());
}

export function listSports(): readonly (typeof SPORTS)[number][] {
  return SPORTS;
}

export function getSportsByCategory(category: SportCategory): readonly (typeof SPORTS)[number][] {
  return SPORTS.filter(s => s.category === category);
}
