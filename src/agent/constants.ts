/**
 * Agent cron defaults (managed agent CLI, §203) - OS-level Bun.cron.
 * The scheduled worker runs the OFFLINE agent pipeline (ground over cache.db
 * + report write to research/reports/) - no live GitHub, no execution.
 */
export const AGENT_CRON_TITLE = 'kalshi-agent-daily-ground';
export const AGENT_CRON_SCHEDULE = '0 6 * * *'; // daily 06:00 local
