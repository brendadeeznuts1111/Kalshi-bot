/** Dashboard view route SSOT — shared by layout and server. */
export const DASHBOARD_ROUTES = {
  home: "/",
  overview: "/overview",
  report: "/report",
  diff: "/diff",
  blueprint: "/blueprint",
  pulse: "/pulse",
  status: "/api/status",
  runResearch: "/api/research/run",
  verify: "/api/verify",
  pulseApi: "/api/pulse",
  screenshot: "/api/screenshot",
  evidencePrefix: "/evidence/",
} as const;

export type DashboardViewId = "overview" | "report" | "diff" | "blueprint" | "pulse";

export const DASHBOARD_VIEW_IDS: DashboardViewId[] = [
  "overview",
  "report",
  "diff",
  "blueprint",
  "pulse",
];

export function dashboardViewFromPath(pathname: string): DashboardViewId {
  switch (pathname) {
    case DASHBOARD_ROUTES.report:
      return "report";
    case DASHBOARD_ROUTES.diff:
      return "diff";
    case DASHBOARD_ROUTES.blueprint:
      return "blueprint";
    case DASHBOARD_ROUTES.pulse:
      return "pulse";
    default:
      return "overview";
  }
}
