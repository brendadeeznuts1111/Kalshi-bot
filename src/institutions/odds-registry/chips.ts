/**
 * chips.ts — ANSI chips for the odds-heat terminal surface (the TUI
 * complement of the markdown report's Matches columns).
 *
 * Follows the venue-badge.ts conventions: paint() from the color kernel
 * (auto-TTY — plain in non-TTY harnesses/CI), single-line composition,
 * no layout assumptions. Chips:
 *
 *   weather   ☀ 22.0°C wind 15 km/h      (cluster.weather — event-keyed)
 *   venue     ⌖ Alpha Park, London      (venue store identity / coords)
 *   collision ⟨2 events⟩                 (>1 event sharing a venueKey)
 *   kickoff   ◷ 1 Sep 2026 at 20:00     (venue-local, from venue-store)
 *
 * The line renderer (`renderOddsEventLine`) keeps every segment optional:
 * missing location/weather/collisions collapse away instead of printing
 * dashes — terminal rows stay short and honest.
 */
import type { EventLocation, EventWeather, OddsEvent } from "../../alpha/odds-types.ts";
import { paint } from "../../lib/color/index.ts";
import { localKickoff, venueCollisionCounts, venueKeyFor, venueProfileFor, type VenueStore } from "./venue-store.ts";

/** Weather glyph per report condition (describeWeatherCode outputs). */
export function weatherIcon(condition?: string): string {
  switch (condition) {
    case "Clear": return "☀";
    case "Partly cloudy": return "⛅";
    case "Overcast": return "☁";
    case "Fog": return "≡";
    case "Drizzle":
    case "Rain":
    case "Showers": return "🌧";
    case "Snow":
    case "Snow showers": return "❄";
    case "Thunderstorm": return "⛈";
    default: return "◌";
  }
}

const dim = (s: string) => paint(s, "misc");

/**
 * Arbitrary-RGB styling for the temperature gradient — the one thing the
 * palette kernel can't do (it is key-based). Verified on 1.4.0:
 *
 * - Bun.color accepts the RGB tuple directly; out-of-range values silently
 *   clamp (999 -> 255).
 * - The "ansi" format reads the color ENVIRONMENT for depth: default and
 *   any TERM (even xterm) -> truecolor 38;2; TERM=dumb or NO_COLOR -> ""
 *   (render plain); FORCE_COLOR overrides both — FORCE_COLOR=3 keeps
 *   truecolor, FORCE_COLOR=1 DOWNGRADES to 16-color (91m etc.) and
 *   COLORTERM=truecolor does not rescue it. Under FORCE_COLOR=1 the
 *   gradient therefore collapses to coarse buckets: acceptable, documented
 *   degradation.
 * - No TTY detection happens on this path — chips keep the kernel
 *   convention (color unless the environment disables it), so styledRGB
 *   gates only on the empty escape.
 */
export function styledRGB(text: string, rgb: [number, number, number]): string {
  const esc = Bun.color(rgb, "ansi");
  return esc ? `${esc}${text}\x1b[0m` : text;
}

/** Continuous cold->hot temperature gradient, clamped to [-20, 40] °C. */
export function tempToRGB(tempC: number): [number, number, number] {
  const t = Math.max(-20, Math.min(40, tempC));
  if (t < 0) {
    const p = (t + 20) / 20;
    return [0, Math.round(100 + p * 155), 255];
  }
  if (t < 15) {
    const p = t / 15;
    return [0, 255, Math.round(255 - p * 155)];
  }
  if (t < 30) {
    const p = (t - 15) / 15;
    return [Math.round(p * 255), Math.round(255 - p * 60), 0];
  }
  const p = (t - 30) / 10;
  return [255, Math.round(195 - p * 150), 0];
}

/** `☀ 22°C Rain wind 24 km/h` — empty string when the event has no weather. */
export function weatherChip(w: EventWeather | undefined): string {
  if (!w) return "";
  const hasData = w.temperatureC !== undefined || w.condition !== undefined
    || w.windSpeedKmh !== undefined || w.precipitationMm !== undefined;
  if (!hasData) return "";
  const parts = [
    w.temperatureC !== undefined
      ? styledRGB(`${weatherIcon(w.condition)} ${Math.round(w.temperatureC * 10) / 10}°C`, tempToRGB(w.temperatureC))
      : `${weatherIcon(w.condition)}`.trim(),
    w.condition ?? "",
    w.windSpeedKmh !== undefined ? `wind ${Math.round(w.windSpeedKmh)} km/h` : "",
    w.precipitationMm !== undefined ? `${w.precipitationMm} mm` : "",
  ].filter(Boolean);
  return parts.join(" ");
}

/** Venue label truncated to visible width (Bun.sliceAnsi is ANSI-safe). */
function truncateVenue(label: string, max = 24): string {
  return Bun.stringWidth(label) <= max ? label : Bun.sliceAnsi(label, 0, max - 1) + "…";
}

/** `⌖ Alpha Park, London` (store) or `⌖ 51.5074, -0.1278` (coords) or "". */
export function venueChip(location: EventLocation | undefined, store: VenueStore | undefined): string {
  if (!location) return "";
  const profile = venueProfileFor(store, location);
  const label = profile
    ? (profile.city ? `${profile.name}, ${profile.city}` : profile.name)
    : `${location.lat}, ${location.long}`;
  return `${paint("⌖", "tennis")} ${paint(truncateVenue(label), "tennis")}`;
}

/** `◷ 1 Sep 2026 at 20:00` (venue-local) — empty for placeholder times. */
export function kickoffChip(commenceTime: string, timezone?: string): string {
  if (commenceTime === "" || commenceTime === "0") return "";
  return `${paint("◷", "misc")} ${paint(localKickoff(commenceTime, timezone), "misc")}`;
}

/**
 * `⟨2 events⟩` collision badge — silent at/below 1, yellow at 2, orange
 * through 5 (styledRGB — no palette key for orange), red past 5 (severe).
 */
export function collisionChip(count: number): string {
  if (count <= 1) return "";
  if (count <= 2) return paint(`⟨${count} events⟩`, "middleware");
  if (count <= 5) return styledRGB(`⟨${count} events⟩`, [255, 165, 0]);
  return paint(`⟨${count} events⟩`, "trading");
}

export type OddsEventLineOptions = {
  /** Venue identity store (name/city/timezone); coords fallback without it. */
  venueStore?: VenueStore;
  /** Force color on/off (default: paint()'s auto-TTY detection). */
  colors?: boolean;
};

/**
 * One ANSI line per event — the terminal Matches row:
 *   `Alpha FC vs Beta FC · ⌖ Alpha Park, London · ◷ 1 Sep 2026 at 20:00 · ☀ 22°C`
 * Collision chips are feed-wide, so they are appended by
 * {@link renderOddsReportAnsi}, not here (single-event context has none).
 */
export function renderOddsEventLine(ev: OddsEvent, options: OddsEventLineOptions = {}): string {
  const match = `${ev.homeTeam} vs ${ev.awayTeam}`;
  const profile = ev.location ? venueProfileFor(options.venueStore, ev.location) : undefined;
  const segments = [
    paint(match, "research"),
    venueChip(ev.location, options.venueStore),
    kickoffChip(ev.commenceTime, profile?.timezone),
    weatherChip(ev.weather),
  ].filter(Boolean);
  return segments.join(dim(" · "));
}

/**
 * ANSI report block — header + one line per event. The collision chip uses
 * feed-wide counts (an event shares its venue with the whole feed, not just
 * itself).
 */
export function renderOddsReportAnsi(events: OddsEvent[], options: OddsEventLineOptions = {}): string {
  const collisions = venueCollisionCounts(events);
  const lines = [
    paint(`Odds Heat — ${events.length} event(s)`, "research"),
    ...events.map((ev) => {
      const count = ev.location ? (collisions.get(venueKeyFor(ev.location)) ?? 0) : 0;
      const chip = collisionChip(count);
      return chip ? `${renderOddsEventLine(ev, options)} ${chip}` : renderOddsEventLine(ev, options);
    }),
  ];
  return lines.join("\n");
}
