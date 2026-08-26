#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/cron#bun-cron-path-schedule-title-os-level
/**
 * Register / remove / preview the managed agent CLI (OS Bun.cron, §203).
 *
 * Default: daily 06:00 local - runs the OFFLINE agent pipeline (discovery
 * ground over cache.db + agent report write). No live GitHub, no execution.
 */
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { previewFireTimes } from '../src/research/schedule-cli.ts';
import { AGENT_CRON_SCHEDULE, AGENT_CRON_TITLE } from '../src/agent/constants.ts';

export { AGENT_CRON_SCHEDULE, AGENT_CRON_TITLE } from '../src/agent/constants.ts';
export const AGENT_CRON_WORKER_PATH = join(import.meta.dir, '..', 'src', 'agent', 'scheduled.ts');

export type AgentScheduleCommand = 'register' | 'remove' | 'preview';

export function parseAgentScheduleCli(argv: string[]): {
  command: AgentScheduleCommand;
  schedule: string;
  title: string;
  count: number;
} | null {
  const positional = argv.filter((a) => !a.startsWith('-'));
  const command = positional[0] as AgentScheduleCommand | undefined;
  if (!command || !['register', 'remove', 'preview'].includes(command)) {
    return null;
  }

  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      schedule: { type: 'string' },
      title: { type: 'string' },
      count: { type: 'string', default: '3' },
    },
    strict: false,
  });

  const countRaw = values.count ? Number(values.count) : 3;
  const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.floor(countRaw) : 3;

  return {
    command,
    schedule:
      typeof values.schedule === 'string'
        ? values.schedule
        : Bun.env.AGENT_CRON_SCHEDULE?.trim() || AGENT_CRON_SCHEDULE,
    title:
      typeof values.title === 'string'
        ? values.title
        : Bun.env.AGENT_CRON_TITLE?.trim() || AGENT_CRON_TITLE,
    count,
  };
}

if (import.meta.main) {
  const opts = parseAgentScheduleCli(Bun.argv.slice(2));
  if (!opts) {
    console.error(
      "Usage: bun tools/agent-schedule-cli.ts <register|remove|preview> [--schedule='0 6 * * *']",
    );
    process.exit(1);
  }

  switch (opts.command) {
    case 'register': {
      await Bun.cron(AGENT_CRON_WORKER_PATH, opts.schedule, opts.title);
      console.log('Registered OS cron job "' + opts.title + '"');
      console.log('  worker: ' + AGENT_CRON_WORKER_PATH);
      console.log('  schedule: ' + opts.schedule + ' (system local time)');
      console.log('  logs (macOS): /tmp/bun.cron.' + opts.title + '.stdout.log');
      console.log('  manual: bun run agent ground && bun run agent report');
      break;
    }
    case 'remove': {
      await Bun.cron.remove(opts.title);
      console.log('Removed OS cron job "' + opts.title + '" (if present)');
      break;
    }
    case 'preview': {
      const times = previewFireTimes(opts.schedule, opts.count);
      if (!times.length) {
        console.error('No upcoming fires for: ' + opts.schedule);
        process.exit(1);
      }
      console.log('Schedule: ' + opts.schedule);
      console.log('Title: ' + opts.title);
      console.log('Next ' + times.length + ' fire(s) (UTC, Bun.cron.parse):');
      for (const [i, d] of times.entries()) {
        console.log('  ' + (i + 1) + '. ' + d.toISOString());
      }
      break;
    }
  }
}
