/** SSRF guard for dashboard WebView capture — loopback + fixed paths only. */

export class DashboardScreenshotUrlError extends Error {
  override name = "DashboardScreenshotUrlError";
}

/** Paths WebView may navigate for audit capture (dashboard home only). */
export const ALLOWED_SCREENSHOT_PATHS = new Set<string>(["/"]);

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/** Reject file://, remote hosts, and non-dashboard paths before WebView.navigate. */
export function assertAllowlistedScreenshotUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DashboardScreenshotUrlError(`Invalid screenshot URL: ${raw}`);
  }

  if (url.protocol !== "http:") {
    throw new DashboardScreenshotUrlError(`Blocked screenshot protocol: ${url.protocol}`);
  }

  const host = url.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new DashboardScreenshotUrlError(`Blocked screenshot host: ${url.hostname}`);
  }

  if (!ALLOWED_SCREENSHOT_PATHS.has(url.pathname)) {
    throw new DashboardScreenshotUrlError(`Blocked screenshot path: ${url.pathname}`);
  }

  return url;
}

export function defaultDashboardScreenshotUrl(port = Number(Bun.env.DASHBOARD_PORT ?? 3457)): string {
  return `http://127.0.0.1:${port}/`;
}
