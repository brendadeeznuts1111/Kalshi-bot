// @see https://bun.com/blog/bun-v1.3.4#urlpattern-api — URLPattern.hash / exec
// @see https://bun.com/docs/runtime/file-io#reading-files-bun-file
// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  GLOSSARY_CONCEPT_PATTERN,
  glossaryHash,
  parseHqHashRoute,
  scrollToHqHashTarget,
} from '../../src/research/hq-app/hash-routes.ts';

describe('HQ URLPattern hash routes', () => {
  test('captures glossary concepts after an escaped literal colon', () => {
    expect(GLOSSARY_CONCEPT_PATTERN.hash).toBe('glossary\\::concept');
    expect(parseHqHashRoute('https://hq.example/#glossary:kpi.board_volume')).toEqual({
      kind: 'glossary',
      concept: 'kpi.board_volume',
    });
    expect(glossaryHash('kpi.board_volume')).toBe('#glossary:kpi.board_volume');
  });

  test('maps surface aliases before generic component mounts', () => {
    expect(parseHqHashRoute('https://hq.example/#live')).toEqual({
      kind: 'surface',
      alias: 'live',
      target: 'live-board',
    });
    expect(parseHqHashRoute('https://hq.example/#volume-liquidity-panel')).toEqual({
      kind: 'component',
      component: 'volume-liquidity-panel',
      target: 'volume-liquidity-panel',
    });
  });

  test('leaves events filter fragments to their existing state machine', () => {
    expect(parseHqHashRoute('https://hq.example/#events?when=live')).toBeNull();
    expect(parseHqHashRoute('https://hq.example/#q=tennis')).toBeNull();
  });

  test('reveals the owning tab and scrolls to a matched target', () => {
    let clicked = false;
    let scrolled = false;
    const target = {
      id: 'live-board',
      dataset: {} as Record<string, string>,
      closest: () => ({ id: 'tab-events' }),
      scrollIntoView: (options: ScrollIntoViewOptions) => {
        expect(options).toEqual({ block: 'start', behavior: 'smooth' });
        scrolled = true;
      },
    };
    const doc = {
      getElementById: (id: string) => (id === 'live-board' ? target : null),
      querySelector: (selector: string) => {
        expect(selector).toBe('nav.tabs button[data-tab="events"]');
        return { click: () => (clicked = true) };
      },
    };

    expect(
      scrollToHqHashTarget(parseHqHashRoute('https://hq.example/#live'), doc as unknown as Document)
    ).toBe(true);
    expect(clicked).toBe(true);
    expect(scrolled).toBe(true);
    expect(target.dataset.hashRouteActive).toBe('true');
  });

  test('is wired to stable HQ mounts after asynchronous rendering', async () => {
    const app = await Bun.file(new URL('../../src/research/hq-app/app.js', import.meta.url)).text();

    expect(app).toContain('id="live-board"');
    expect(app).toContain('id="volume-liquidity-panel"');
    expect(app).toContain('await renderEvents()');
    // hashchange: Events deep links first, then glossary/surface routes
    expect(app).toContain('window.addEventListener("hashchange"');
    expect(app).toContain('if (openEventsFromHash()) return');
    expect(app).toContain('applyHashRoute()');
    expect(app).not.toContain('function parseGlossaryHash');
  });

  test('events board wires desk liquidity badges and filter toggles', async () => {
    const app = await Bun.file(new URL('../../src/research/hq-app/app.js', import.meta.url)).text();
    expect(app).toContain('function liquidityBadge');
    expect(app).toContain('data-liq-mode');
    expect(app).toContain('desk.tradable');
    expect(app).toContain('"tradable"');
    expect(app).toContain('"liq_ok"');
    expect(app).toContain('"quoted"');
  });

  test('overview desk chips jump to filtered Events board', async () => {
    const app = await Bun.file(new URL('../../src/research/hq-app/app.js', import.meta.url)).text();
    expect(app).toContain('function jumpToEventsLiquidity');
    expect(app).toContain('data-liq-jump');
    expect(app).toContain('function openEventsFromHash');
    expect(app).toContain('desk-chip-jump');
  });
});
