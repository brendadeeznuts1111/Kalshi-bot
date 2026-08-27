/**
 * weather.ts — event weather provider: (venue coords, commence) -> forecast.
 *
 * Weather is tied to BOTH fields — a forecast exists for a place at a time —
 * so the provider takes exactly those two inputs and returns the optional
 * EventWeather that rides on the event. Provider: Open-Meteo (no API key,
 * no account). Results cache per (coords, hour) with a short TTL; failures
 * are negatively cached briefly so an offline route render does not retry
 * the network per row.
 */
import type { EventLocation, EventWeather } from "../../alpha/odds-types.ts";

/** WMO weather interpretation codes (Open-Meteo contract) -> condition text. */
export function describeWeatherCode(code: number): string {
  if (!Number.isInteger(code) || code < 0 || code > 99) return "Unknown";
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorm";
}

export type FetchEventWeatherOptions = {
  /** Injectable fetch (tests); defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Cache TTL ms (default 10 min). */
  ttlMs?: number;
  /** Per-request timeout ms (default 3s). */
  timeoutMs?: number;
};

const cache = new Map<string, { at: number; value: EventWeather | null }>();
const DEFAULT_TTL_MS = 10 * 60_000;
const NEGATIVE_TTL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 3_000;

const cacheKey = (loc: EventLocation, commenceIso: string) =>
  `${loc.lat.toFixed(4)},${loc.long.toFixed(4)}@${commenceIso.slice(0, 13)}`;

/**
 * Forecast for (coords, commence). Null when the provider is unreachable,
 * times out, or returns nothing usable — callers degrade to no weather.
 */
export async function fetchEventWeather(
  loc: EventLocation,
  commenceIso: string,
  options: FetchEventWeatherOptions = {},
): Promise<EventWeather | null> {
  if (!Number.isFinite(Date.parse(commenceIso))) return null;
  const key = cacheKey(loc, commenceIso);
  const hit = cache.get(key);
  const ttl = options.ttlMs ?? (hit?.value !== null ? DEFAULT_TTL_MS : NEGATIVE_TTL_MS);
  if (hit && Date.now() - hit.at < ttl) return hit.value;

  const hour = `${commenceIso.slice(0, 13)}:00`;
  const url = "https://api.open-meteo.com/v1/forecast"
    + `?latitude=${loc.lat}&longitude=${loc.long}`
    + `&hourly=temperature_2m,precipitation,weather_code,wind_speed_10m`
    + `&start_hourly=${encodeURIComponent(hour)}&end_hourly=${encodeURIComponent(hour)}`
    + "&timezone=UTC";
  try {
    const doFetch = options.fetchImpl ?? fetch;
    const res = await doFetch(url, { signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`weather HTTP ${res.status}`);
    const body = (await res.json()) as {
      hourly?: {
        time?: string[];
        temperature_2m?: (number | null)[];
        precipitation?: (number | null)[];
        weather_code?: (number | null)[];
        wind_speed_10m?: (number | null)[];
      };
    };
    const hourly = body.hourly;
    const idx = hourly?.time?.indexOf(hour) ?? -1;
    if (idx < 0) throw new Error("weather: requested hour missing from response");
    const pick = (arr: (number | null)[] | undefined): number | undefined => {
      const v = arr?.[idx];
      return typeof v === "number" && Number.isFinite(v) ? v : undefined;
    };
    const code = pick(hourly?.weather_code);
    const temperatureC = pick(hourly?.temperature_2m);
    const windSpeedKmh = pick(hourly?.wind_speed_10m);
    const precipitationMm = pick(hourly?.precipitation);
    const value: EventWeather = {
      ...(temperatureC !== undefined ? { temperatureC } : {}),
      ...(code !== undefined ? { condition: describeWeatherCode(code) } : {}),
      ...(windSpeedKmh !== undefined ? { windSpeedKmh } : {}),
      ...(precipitationMm !== undefined ? { precipitationMm } : {}),
    };
    const usable = Object.keys(value).length > 0 ? value : null;
    cache.set(key, { at: Date.now(), value: usable });
    return usable;
  } catch {
    cache.set(key, { at: Date.now(), value: null });
    return null;
  }
}

/** Test seam: drop every cached forecast. */
export function clearWeatherCache(): void {
  cache.clear();
}
