/**
 * weather provider tests — WMO code mapping, cache TTL behavior, and the
 * (coords, commence)->forecast contract via an injected fetch (no live
 * network in tests).
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  clearWeatherCache,
  describeWeatherCode,
  fetchEventWeather,
} from "../../../src/institutions/odds-registry/index.ts";

afterEach(() => clearWeatherCache());

const OPEN_METEO_BODY = {
  hourly: {
    time: ["2026-09-01T19:00"],
    temperature_2m: [18.4],
    precipitation: [0.2],
    weather_code: [63],
    wind_speed_10m: [22.1],
  },
};

describe("describeWeatherCode (WMO codes)", () => {
  test("buckets the Open-Meteo grid into condition text", () => {
    expect(describeWeatherCode(0)).toBe("Clear");
    expect(describeWeatherCode(2)).toBe("Partly cloudy");
    expect(describeWeatherCode(63)).toBe("Rain");
    expect(describeWeatherCode(71)).toBe("Snow");
    expect(describeWeatherCode(95)).toBe("Thunderstorm");
    expect(describeWeatherCode(99)).toBe("Thunderstorm");
  });

  test("garbage codes are Unknown, never thrown on", () => {
    expect(describeWeatherCode(-1)).toBe("Unknown");
    expect(describeWeatherCode(100)).toBe("Unknown");
    expect(describeWeatherCode(Number.NaN)).toBe("Unknown");
  });
});

describe("fetchEventWeather", () => {
  const loc = { lat: 51.5074, long: -0.1278 };
  const commence = "2026-09-01T19:00:00Z";

  test("maps the hourly slice at the commence hour onto EventWeather", async () => {
    const fetchImpl = (() => Promise.resolve(new Response(JSON.stringify(OPEN_METEO_BODY)))) as unknown as typeof fetch;
    const w = await fetchEventWeather(loc, commence, { fetchImpl });
    expect(w).toEqual({
      temperatureC: 18.4,
      condition: "Rain",
      windSpeedKmh: 22.1,
      precipitationMm: 0.2,
    });
  });

  test("caches per (coords, hour); same key hits cache not the network", async () => {
    let calls = 0;
    const fetchImpl = (() => {
      calls += 1;
      return Promise.resolve(new Response(JSON.stringify(OPEN_METEO_BODY)));
    }) as unknown as typeof fetch;
    await fetchEventWeather(loc, commence, { fetchImpl });
    await fetchEventWeather(loc, commence, { fetchImpl });
    // Different hour -> different key -> second network call.
    await fetchEventWeather(loc, "2026-09-01T20:00:00Z", { fetchImpl });
    expect(calls).toBe(2);
  });

  test("provider failure -> null (negative-cached), never a throw", async () => {
    let calls = 0;
    const fetchImpl = (() => {
      calls += 1;
      return Promise.reject(new Error("offline"));
    }) as unknown as typeof fetch;
    expect(await fetchEventWeather(loc, commence, { fetchImpl })).toBeNull();
    expect(await fetchEventWeather(loc, commence, { fetchImpl })).toBeNull();
    // Negative cache: the offline hour is not retried within TTL.
    expect(calls).toBe(1);
  });

  test("malformed response hour -> null", async () => {
    const fetchImpl = (() =>
      Promise.resolve(new Response(JSON.stringify({ hourly: { time: ["1999-01-01T00:00"] } })))) as unknown as typeof fetch;
    expect(await fetchEventWeather(loc, commence, { fetchImpl })).toBeNull();
  });

  test("unparseable commence -> null without touching the network", async () => {
    let calls = 0;
    const fetchImpl = (() => {
      calls += 1;
      return Promise.resolve(new Response("{}"));
    }) as unknown as typeof fetch;
    expect(await fetchEventWeather(loc, "garbage", { fetchImpl })).toBeNull();
    expect(calls).toBe(0);
  });
});
