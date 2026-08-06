import {
  createKalshiEventsInventoryAdapter,
  type KalshiEventsAdapterOptions,
} from "./adapters/kalshi-events.ts";
import {
  createKalshiSeriesMetadataAdapter,
  type KalshiSeriesMetadataAdapterOptions,
} from "./adapters/kalshi-series-metadata.ts";
import {
  createPolymarketGammaInventoryAdapter,
  type PolymarketGammaAdapterOptions,
} from "./adapters/polymarket-gamma.ts";
import {
  createPolymarketSportsMetadataAdapter,
  type PolymarketSportsMetadataAdapterOptions,
} from "./adapters/polymarket-sports-metadata.ts";
import {
  runtimeMetadataSourceAdapter,
  type InventorySourceAdapter,
  type RuntimeMetadataSourceAdapter,
} from "./types.ts";

export type SportsSourceRuntimeOptions = {
  kalshiInventory?: KalshiEventsAdapterOptions;
  kalshiMetadata?: KalshiSeriesMetadataAdapterOptions;
  polymarketInventory?: PolymarketGammaAdapterOptions;
  polymarketMetadata?: PolymarketSportsMetadataAdapterOptions;
};

/** Canonical runtime composition for every operational source adapter. */
export function createSportsSourceRuntime(options: SportsSourceRuntimeOptions = {}): {
  inventoryAdapters: InventorySourceAdapter[];
  metadataAdapters: RuntimeMetadataSourceAdapter[];
} {
  return {
    inventoryAdapters: [
      createKalshiEventsInventoryAdapter(options.kalshiInventory),
      createPolymarketGammaInventoryAdapter(options.polymarketInventory),
    ],
    metadataAdapters: [
      runtimeMetadataSourceAdapter(createKalshiSeriesMetadataAdapter(options.kalshiMetadata)),
      runtimeMetadataSourceAdapter(
        createPolymarketSportsMetadataAdapter(options.polymarketMetadata),
      ),
    ],
  };
}
