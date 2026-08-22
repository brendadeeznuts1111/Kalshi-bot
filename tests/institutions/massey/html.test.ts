// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { extractRatingsTableFromHtml } from "../../../src/institutions/massey/html.ts";

const SAMPLE = [
  "<html><head><title>Massey Ratings - College Volleyball : NCAA D1 Ratings</title></head><body>",
  "<table><tr><td>legend</td></tr></table>",
  "<table>",
  "  <tr><th>Team</th><th>Rec</th><th>Δ</th><th>Rat</th></tr>",
  "  <tr><td><a href=\"/cvol2026/5105\">Nebraska</a>Big 10</td><td>0-0 0.000</td><td></td><td>19.25</td></tr>",
  "  <tr><td>Morehead St</td><td>0-0 0.000</td><td>-</td><td>-10.42</td></tr>",
  "  <tr><td>Texas &amp; A&amp;M</td><td>1-0 1.000</td><td>+0.5</td><td>29.05</td></tr>",
  "</table>",
  "</body></html>",
].join("\n");

describe("extractRatingsTableFromHtml", () => {
  test("picks the largest table and maps headers + rows", async () => {
    const t = await extractRatingsTableFromHtml(SAMPLE);
    expect(t).not.toBeNull();
    expect(t!.headers).toEqual(["Team", "Rec", "Δ", "Rat"]);
    expect(t!.rows).toHaveLength(3);
    // anchor text + trailing conference text concatenate
    expect(t!.rows[0]![0]).toBe("NebraskaBig 10");
    expect(t!.rows[0]![3]).toBe("19.25");
    // entities decode
    expect(t!.rows[2]![0]).toBe("Texas & A&M");
  });

  test("returns null on no table", async () => {
    const t = await extractRatingsTableFromHtml("<html><body><p>no table</p></body></html>");
    expect(t).toBeNull();
  });
});
