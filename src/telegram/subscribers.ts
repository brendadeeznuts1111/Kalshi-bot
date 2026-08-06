/**
 * Telegram subscriber list — simple JSON persistence.
 * Path: research/telegram-subscribers.json (gitignored)
 */
import { joinPath } from "../research/paths.ts";

const SUBSCRIBERS_FILE = joinPath(
  import.meta.dir,
  "../../research/telegram-subscribers.json",
);

export type Subscriber = {
  chatId: number;
  username?: string;
  firstName?: string;
  subscribedAt: string;
};

async function readSubscribers(): Promise<Subscriber[]> {
  const file = Bun.file(SUBSCRIBERS_FILE);
  if (!(await file.exists())) return [];
  try {
    return (await file.json()) as Subscriber[];
  } catch {
    return [];
  }
}

async function writeSubscribers(subs: Subscriber[]): Promise<void> {
  await Bun.write(SUBSCRIBERS_FILE, JSON.stringify(subs, null, 2) + "\n");
}

export async function listSubscribers(): Promise<Subscriber[]> {
  return readSubscribers();
}

export async function addSubscriber(sub: Subscriber): Promise<boolean> {
  const subs = await readSubscribers();
  if (subs.some((s) => s.chatId === sub.chatId)) return false;
  subs.push(sub);
  await writeSubscribers(subs);
  return true;
}

export async function removeSubscriber(chatId: number): Promise<boolean> {
  const subs = await readSubscribers();
  const idx = subs.findIndex((s) => s.chatId === chatId);
  if (idx === -1) return false;
  subs.splice(idx, 1);
  await writeSubscribers(subs);
  return true;
}
