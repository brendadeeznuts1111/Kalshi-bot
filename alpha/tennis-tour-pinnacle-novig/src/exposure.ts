/**
 * Per-event exposure — moneyline + spread + total aggregate before sizing.
 */
const exposureByEvent = new Map<string, number>();

export function eventExposureContracts(eventId: string): number {
  return exposureByEvent.get(eventId) ?? 0;
}

export function addEventExposure(eventId: string, contracts: number): void {
  exposureByEvent.set(eventId, eventExposureContracts(eventId) + contracts);
}

export function wouldExceedEventCap(
  eventId: string,
  addContracts: number,
  maxPerEvent: number,
): boolean {
  return eventExposureContracts(eventId) + addContracts > maxPerEvent;
}

export function resetExposureForTests(): void {
  exposureByEvent.clear();
}
