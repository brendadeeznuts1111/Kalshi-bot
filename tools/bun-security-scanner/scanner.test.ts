import { expect, test, describe } from "bun:test";
import { scanner } from "./src/index.ts";

describe("kalshi-bot security scanner", () => {
  test("blocks known malicious event-stream 3.3.6", async () => {
    const advisories = await scanner.scan({
      packages: [
        {
          name: "event-stream",
          version: "3.3.6",
          requestedRange: "^3.3.0",
          tarball: "https://registry.npmjs.org/event-stream/-/event-stream-3.3.6.tgz",
        },
      ],
    });

    expect(advisories.length).toBe(1);
    expect(advisories[0]).toMatchObject({
      level: "fatal",
      package: "event-stream",
      url: expect.any(String),
      description: expect.any(String),
    });
  });

  test("safe event-stream 4.0.0 passes", async () => {
    const advisories = await scanner.scan({
      packages: [
        {
          name: "event-stream",
          version: "4.0.0",
          requestedRange: "^4.0.0",
          tarball: "https://registry.npmjs.org/event-stream/-/event-stream-4.0.0.tgz",
        },
      ],
    });
    expect(advisories.length).toBe(0);
  });

  test("blocks protestware colors >=1.4.1", async () => {
    const advisories = await scanner.scan({
      packages: [
        {
          name: "colors",
          version: "1.4.2",
          requestedRange: "^1.4.0",
          tarball: "https://registry.npmjs.org/colors/-/colors-1.4.2.tgz",
        },
      ],
    });

    expect(advisories.length).toBe(1);
    expect(advisories[0]).toMatchObject({
      level: "warn",
      package: "colors",
    });
  });

  test("blocks typosquatting candidates", async () => {
    const advisories = await scanner.scan({
      packages: [
        {
          name: "lodashs",
          version: "1.0.0",
          requestedRange: "^1.0.0",
          tarball: "https://registry.npmjs.org/lodashs/-/lodashs-1.0.0.tgz",
        },
      ],
    });

    expect(advisories.length).toBe(1);
    expect(advisories[0]?.level).toBe("fatal");
  });

  test("safe packages return no advisories", async () => {
    const advisories = await scanner.scan({
      packages: [
        {
          name: "zod",
          version: "4.4.3",
          requestedRange: "^4.4.0",
          tarball: "https://registry.npmjs.org/zod/-/zod-4.4.3.tgz",
        },
        {
          name: "drizzle-orm",
          version: "0.45.2",
          requestedRange: "^0.45.0",
          tarball: "https://registry.npmjs.org/drizzle-orm/-/drizzle-orm-0.45.2.tgz",
        },
      ],
    });
    expect(advisories.length).toBe(0);
  });

  test("handles scoped packages", async () => {
    const advisories = await scanner.scan({
      packages: [
        {
          name: "@types/bun",
          version: "1.2.0",
          requestedRange: "^1.2.0",
          tarball: "https://registry.npmjs.org/@types/bun/-/bun-1.2.0.tgz",
        },
      ],
    });
    expect(advisories.length).toBe(0);
  });

  test("handles empty package list", async () => {
    const advisories = await scanner.scan({ packages: [] });
    expect(advisories.length).toBe(0);
  });

  test("blocks multiple threats in one scan", async () => {
    const advisories = await scanner.scan({
      packages: [
        {
          name: "event-stream",
          version: "3.3.6",
          requestedRange: "^3.3.0",
          tarball: "https://registry.npmjs.org/event-stream/-/event-stream-3.3.6.tgz",
        },
        {
          name: "lodashs",
          version: "1.0.0",
          requestedRange: "^1.0.0",
          tarball: "https://registry.npmjs.org/lodashs/-/lodashs-1.0.0.tgz",
        },
        {
          name: "zod",
          version: "4.4.3",
          requestedRange: "^4.4.0",
          tarball: "https://registry.npmjs.org/zod/-/zod-4.4.3.tgz",
        },
      ],
    });

    expect(advisories.length).toBe(2);
    expect(advisories.some((a) => a.package === "event-stream")).toBe(true);
    expect(advisories.some((a) => a.package === "lodashs")).toBe(true);
  });
});
