#!/usr/bin/env bun
/**
 * Release-watch Worker: runs the RSS->blog->probe pipeline and broadcasts
 * the result on the fan-out channel. Spawned by the cron master as a
 * Worker so the master can receive the event IN-PROCESS via BroadcastChannel
 * (verified: BroadcastChannel bridges worker threads and main, but NOT
 * separate processes - so the sender and receiver must share a process).
 */
import { createFanout, RELEASE_FANOUT_CHANNEL } from '../src/lib/fanout.ts';
import {
  extractCodeBlocks,
  identifiersFromCodeBlocks,
  latestRelease,
  parseRssEntries,
} from '../src/lib/release-blog.ts';

const bus = createFanout<{ type: string; version?: string; title?: string; present?: number; absent?: number }>(RELEASE_FANOUT_CHANNEL);

try {
  const rss = await (await fetch('https://bun.com/rss.xml')).text();
  const release = latestRelease(parseRssEntries(rss));
  if (!release) throw new Error('no versioned release in RSS');
  const html = await (await fetch(release.link)).text();
  const ids = [...identifiersFromCodeBlocks(extractCodeBlocks(html))].sort();
  const bun = Bun as unknown as Record<string, unknown>;
  const present = ids.filter((id) => typeof bun[id] !== 'undefined').length;
  const absent = ids.length - present;
  bus.post({ type: 'bun-release', version: release.version, title: release.title, present, absent });
  console.log('[worker] analyzed ' + release.title + ': ' + present + ' present / ' + absent + ' absent');
} catch (err) {
  console.error('[worker] failed:', err);
  bus.post({ type: 'bun-release-error', version: '?', title: String(err) });
} finally {
  bus.close();
}
