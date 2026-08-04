/**
 * Architecture view — renders the architecture-schema as an HTML dashboard page.
 */
import {
  ARCHITECTURE_STATS,
  CRON_JOBS,
  DATA_FLOWS,
  ENTRY_POINTS,
  ERROR_CONVENTIONS,
  EXTERNAL_SERVICES,
  MODULES,
  PROGRAM_LIFECYCLE,
  TYPE_CATEGORIES,
} from "./architecture-schema.ts";
import { pageLayout, escapeHtml } from "./views.ts";
import { badge, statCard, dataTable } from "../institutions/hq-ui.ts";
import { TOKENS } from "../institutions/design-tokens.ts";
import { ROUTES } from "./patterns.ts";

const c = TOKENS.color;

const ARCH_STYLES = `
  .arch-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(22rem, 1fr)); gap: 0.75rem; margin: 1rem 0; }
  .arch-card { background: ${c.panel}; border: 1px solid ${c.line}; border-radius: 8px; padding: 1rem; }
  .arch-card h3 { margin: 0 0 0.4rem; font-size: 1rem; }
  .arch-card p { margin: 0 0 0.5rem; color: ${c.dim}; font-size: 0.85rem; }
  .arch-card .meta { font-size: 0.8rem; color: ${c.dim}; }
  .arch-card .meta span { display: inline-block; margin-right: 0.75rem; }
  .flow-chart { background: ${c.panel2}; border: 1px solid ${c.line}; border-radius: 8px; padding: 1rem; margin: 0.75rem 0; font-family: ${TOKENS.font.mono}; font-size: 0.8rem; line-height: 1.6; }
  .flow-chart .arrow { color: ${c.acc}; }
  .flow-chart .label { color: ${c.dim}; }
  section { margin-bottom: 2rem; }
  section h2 { border-bottom: 1px solid ${c.line}; padding-bottom: 0.3rem; margin-bottom: 0.75rem; }
  .type-table td:first-child { font-family: ${TOKENS.font.mono}; font-size: 0.85rem; }
  .type-table td:nth-child(2) { font-size: 0.8rem; color: ${c.dim}; }
  .nav-arch { margin-bottom: 0; }
  .stats-bar { display: grid; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); gap: 0.5rem; margin: 1rem 0; }
  details { margin: 0.25rem 0; }
  details summary { cursor: pointer; font-weight: 600; font-size: 0.9rem; padding: 0.3rem 0; }
  details[open] summary { margin-bottom: 0.5rem; }
  .tag { display: inline-block; background: ${c.panel2}; border: 1px solid ${c.line}; border-radius: 3px; padding: 0.1rem 0.4rem; font-size: 0.75rem; font-family: ${TOKENS.font.mono}; margin: 0.15rem; }
  .err-table td:first-child { font-family: ${TOKENS.font.mono}; font-size: 0.8rem; }
`;

function navLinks(): string {
  return `<nav class="nav-arch">
    <a href="${ROUTES.home}">Home</a>
    · <a href="/hq">HQ</a>
    · <a href="/ops">Ops</a>
    · <strong>/architecture</strong>
  </nav>`;
}

function statsBar(): string {
  const s = ARCHITECTURE_STATS;
  const cards = [
    statCard({ title: "Modules", value: String(s.totalModules) }),
    statCard({ title: "Source Files", value: String(s.totalSourceFiles) }),
    statCard({ title: "Entry Points", value: String(s.totalEntryPoints), metrics: [
      { label: "Alpha Programs", value: String(s.totalAlphaPrograms) },
    ]}),
    statCard({ title: "Types", value: String(s.totalTypes), metrics: [
      { label: "DB Tables", value: String(s.totalTables) },
      { label: "Runtime", value: "Bun" },
    ]}),
    statCard({ title: "Ext. Services", value: String(s.totalExternalServices) }),
    statCard({ title: "DB Tables", value: String(s.totalTables)}),
    statCard({ title: "Alpha Programs", value: String(s.totalAlphaPrograms) }),
    statCard({ title: "Tests", value: String(s.totalTests), unit: "pass", metrics: [
      { label: "Files", value: "121" },
    ]}),
  ];
  return `<div class="stats-bar">${cards.join("\n")}</div>`;
}

function renderModuleCards(): string {
  const cards = MODULES.map((m) => {
    const types = m.keyTypes.length
      ? `<div class="meta">types: ${m.keyTypes.slice(0, 6).join(", ")}${m.keyTypes.length > 6 ? " …" : ""}</div>`
      : "";
    const entries = m.entryPoints.length
      ? `<div class="meta">entry: ${m.entryPoints.join(", ")}</div>`
      : "";
    const services = m.externalServices.length
      ? `<div class="meta">ext: ${m.externalServices.join(", ")}</div>`
      : "";
    const errors = (m as unknown as { errorClasses?: string[] }).errorClasses?.length
      ? `<div class="meta">errors: ${(m as unknown as { errorClasses: string[] }).errorClasses.join(", ")}</div>`
      : "";
    return `<div class="arch-card">
      <h3>${escapeHtml(m.name)}</h3>
      <p>${escapeHtml(m.purpose)}</p>
      <div class="meta"><code>${m.path}</code></div>
      ${types}${entries}${services}${errors}
    </div>`;
  });
  return `<div class="arch-grid">${cards.join("\n")}</div>`;
}

function renderDataFlows(): string {
  return DATA_FLOWS.map(
    (flow) => `<details open>
      <summary>${escapeHtml(flow.name)}</summary>
      <p>${escapeHtml(flow.description)}</p>
      <div class="flow-chart">
        ${flow.steps.map((s, i) => {
          const [file, desc] = s.split(" — ", 2);
          return `<div>${i > 0 ? `<span class="arrow">↓</span> ` : ""}<span class="tag">${escapeHtml(file)}</span> ${desc ? `<span class="label">— ${escapeHtml(desc)}</span>` : ""}</div>`;
        }).join("\n")}
      </div>
      <div class="meta">Storage: ${flow.storage.join(", ")}</div>
    </details>`,
  ).join("\n");
}

function renderTypeCategories(): string {
  return TYPE_CATEGORIES.map(
    (cat) => `<details>
      <summary>${escapeHtml(cat.category)}</summary>
      <p class="meta" style="margin: 0 0 0.5rem">${escapeHtml(cat.description)}</p>
      ${dataTable(
        [{ label: "Type" }, { label: "File" }, { label: "Purpose" }],
        cat.types.map((t) => [t.name, `<code>${t.file}</code>`, t.purpose]),
        "none",
      )}
    </details>`,
  ).join("\n");
}

function renderErrorConventions(): string {
  return `<table class="err-table">
    <tr><th>Layer</th><th>Mechanism</th><th>Thrown / Returned</th></tr>
    ${ERROR_CONVENTIONS.map(
      (e) => `<tr>
        <td>${escapeHtml(e.layer)}</td>
        <td>${escapeHtml(e.mechanism)}</td>
        <td>${badge(e.thrownOrReturned === "Throw" ? "warn" : "ok", e.thrownOrReturned)}</td>
      </tr>`,
    ).join("\n")}
  </table>`;
}

function renderEntryPoints(): string {
  return `${dataTable(
    [{ label: "Command" }, { label: "File" }, { label: "Purpose" }],
    ENTRY_POINTS.map((ep) => [`<code>${ep.command}</code>`, `<code>${ep.file}</code>`, ep.purpose]),
    "none",
  )}`;
}

function renderExternalServices(): string {
  return `<div class="arch-grid">${EXTERNAL_SERVICES.map(
    (svc) => `<div class="arch-card">
      <h3>${escapeHtml(svc.name)}</h3>
      <p>${escapeHtml(svc.purpose)}</p>
      <div class="meta">auth: <code>${svc.auth}</code></div>
      <div class="meta">used by: ${svc.usedBy.map((p) => `<code>${p}</code>`).join(", ")}</div>
    </div>`,
  ).join("\n")}</div>`;
}

function renderProgramLifecycle(): string {
  const programs = PROGRAM_LIFECYCLE.programs.map(
    (p) => `<tr>
      <td><code>${p.name}</code></td>
      <td>${badge(p.status === "shadow" ? "warn" : "ok", p.status)}</td>
      <td>${badge(p.role === "baseline" ? "warn" : "ok", p.role)}</td>
      <td><code>${p.baseline}</code></td>
    </tr>`,
  ).join("\n");

  const gradGates = PROGRAM_LIFECYCLE.gates.graduation.map((g) => `<li>${g}</li>`).join("\n");
  const killGates = PROGRAM_LIFECYCLE.gates.kill.map((g) => `<li>${g}</li>`).join("\n");

  return `<details open>
    <summary>Overview</summary>
    <p>Statuses: ${PROGRAM_LIFECYCLE.statuses.map((s) => badge("warn", s)).join(" → ")}</p>
    <p>${PROGRAM_LIFECYCLE.promotion}</p>
    <h4 style="margin: 0.5rem 0 0">Graduation gates</h4>
    <ul class="arch-checks">${gradGates}</ul>
    <h4 style="margin: 0.5rem 0 0">Kill gates</h4>
    <ul class="arch-checks">${killGates}</ul>
    <h4 style="margin: 0.5rem 0 0">Programs</h4>
    <table><tr><th>Name</th><th>Status</th><th>Role</th><th>Baseline</th></tr>${programs}</table>
  </details>`;
}

function renderCronJobs(): string {
  return dataTable(
    [{ label: "Job" }, { label: "Schedule" }, { label: "Entrypoint" }, { label: "Purpose" }],
    CRON_JOBS.map((j) => [j.name, `<code>${j.schedule}</code>`, `<code>${j.entrypoint}</code>`, j.purpose]),
    "none",
  );
}

function renderRuntimeInfo(): string {
  return `<div class="arch-grid">${
    [
      { label: "Runtime", value: ARCHITECTURE_STATS.runtime },
      { label: "Database", value: ARCHITECTURE_STATS.dbEngines.join("; ") },
    ].map(
      (item) => `<div class="arch-card"><h3>${item.label}</h3><p>${escapeHtml(item.value)}</p></div>`,
    ).join("\n")
  }</div>`;
}

/** Full architecture dashboard page. */
export function renderArchitecture(): string {
  const body = `
  ${navLinks()}
  <h1>Architecture</h1>
  ${statsBar()}

  <section>
    <h2>Modules</h2>
    ${renderModuleCards()}
  </section>

  <section>
    <h2>Entry Points</h2>
    ${renderEntryPoints()}
  </section>

  <section>
    <h2>External Services</h2>
    ${renderExternalServices()}
  </section>

  <section>
    <h2>Data Flows</h2>
    ${renderDataFlows()}
  </section>

  <section>
    <h2>Type System</h2>
    ${renderTypeCategories()}
  </section>

  <section>
    <h2>Error Conventions</h2>
    ${renderErrorConventions()}
  </section>

  <section>
    <h2>Program Lifecycle</h2>
    ${renderProgramLifecycle()}
  </section>

  <section>
    <h2>Cron Schedule</h2>
    ${renderCronJobs()}
  </section>

  <section>
    <h2>Runtime</h2>
    ${renderRuntimeInfo()}
  </section>
  `.trim();

  return pageLayout("Architecture", `<style>${ARCH_STYLES}</style>${body}`);
}
