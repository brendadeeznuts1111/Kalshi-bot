#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/webview#new-bun-webview-options
// @see https://bun.com/blog/bun-v1.3.12#bun-webview-headless-browser-automation
// @see https://bun.com/docs/runtime/cron
// @see https://bun.com/blog/bun-v1.3.12#in-process-buncron-scheduler
// @see https://bun.com/docs/runtime/utils#bun-sleep
// @see https://bun.com/docs/guides/process/argv
import { parseArgs } from "node:util";
import { createDashboardServer } from "./dashboard-server.ts";
import { registerInProcessCron } from "./in-process-cron.ts";
import { warmGitHubApiNetwork } from "../research/github-network.ts";

export type DashboardCliOptions = {
  port?: number;
  webview: boolean;
  cron: boolean;
  cronResearch: boolean;
  open: boolean;
};

export function parseDashboardCli(argv: string[]): DashboardCliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: "string" },
      webview: { type: "boolean", default: false },
      cron: { type: "boolean", default: false },
      "cron-research": { type: "boolean", default: false },
      open: { type: "boolean", default: true },
    },
    strict: false,
  });

  return {
    port: values.port ? Number(values.port) : undefined,
    webview: values.webview === true,
    cron: values.cron === true,
    cronResearch: values["cron-research"] === true,
    open: values.open !== false,
  };
}

function openSystemBrowser(url: string): void {
  if (process.platform === "darwin") {
    Bun.spawn(["open", url]);
    return;
  }
  if (process.platform === "win32") {
    Bun.spawn(["cmd", "/c", "start", "", url]);
    return;
  }
  Bun.spawn(["xdg-open", url]);
}

async function runHeadlessWebView(url: string): Promise<void> {
  const backend = process.platform === "darwin" ? "webkit" : "chrome";
  await using view = new Bun.WebView({
    width: 1280,
    height: 900,
    backend,
    console: globalThis.console,
  });
  await view.navigate(url);
  console.error(`[dashboard] headless WebView at ${url} (Ctrl+C to stop)`);
  await new Promise<void>(() => {});
}

export async function startDashboard(opts: DashboardCliOptions): Promise<ReturnType<typeof createDashboardServer>> {
  warmGitHubApiNetwork();
  const server = createDashboardServer({ port: opts.port });
  const url = server.url.href;

  if (opts.cron || opts.cronResearch) {
    registerInProcessCron({
      pulse: opts.cron,
      research: opts.cronResearch,
    });
  }

  console.log(`Kalshi agent dashboard at ${url}`);
  console.error(`Rotor pulse log: ${Bun.env.ROTOR_ROOT?.trim() || "~/Projects"}/pulse.log`);

  if (opts.webview) {
    void runHeadlessWebView(url);
  } else if (opts.open) {
    openSystemBrowser(url);
  }

  return server;
}

if (import.meta.main) {
  const opts = parseDashboardCli(Bun.argv.slice(2));
  await startDashboard(opts);
}
