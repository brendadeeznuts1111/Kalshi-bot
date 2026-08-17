# Kalshi bot pattern report

Run: `2026-08-15T22-06-13-046Z`
Dimension: `market-making`
Generated: 2026-08-15T22:06:13.046Z

## Aggregate signals
- **auth**: trade-api-v2, api-key-file, kalshi-access-headers, rsa-pss-signing, env-secrets
- **orders**: create-order-call, order-fields, portfolio-orders-path, fee-aware-edge
- **dryRun**: dry-run-default
- **loop**: polling-loop, websocket
- **errors**: retry-backoff, try-catch, structured-logging
- **structure**: client-wrapper, config-module, strategy-module, odds-api
- **tests**: test-import

## Razzleberryss/AstroTick (89) — high-value

### `kalshi_client.py` (authApi, orderRealism)
- **auth**: trade-api-v2, api-key-file
- **orders**: create-order-call, order-fields, portfolio-orders-path
- **dryRun**: dry-run-default
- **loop**: polling-loop
- **errors**: retry-backoff, try-catch, structured-logging
- **structure**: client-wrapper

```
ost based on config.KALSHI_ENV. - prod -> https://api.elections.kalshi.com/trade-api/v2 - demo -> prefer the repo's existing demo host (config.BASE_URL) if it looks valid. """ env = (config.KALSHI_ENV or "prod").lower() if env == "prod": return "https://api.elections.kalshi.com/trade-api/v2" # Demo: keep centralized + easy to edit; prefer existing repo config if present demo_default = "https://demo-api.kalshi.co/trade-api/v2" base = ge
```
### `websocket_client.py` (authApi, orderRealism)
- **auth**: kalshi-access-headers, rsa-pss-signing, api-key-file
- **orders**: order-fields
- **loop**: websocket, polling-loop
- **errors**: retry-backoff, try-catch, structured-logging
- **structure**: client-wrapper

```
s, "GET", "/trade-api/ws/v2") headers = [ f"KALSHI-ACCESS-KEY: {self.api_key_id}", f"KALSHI-ACCESS-SIGNATURE: {signature}", f"KALSHI-ACCESS-TIMESTAMP: {ts}", ] self.ws = websocket.WebSocketApp( self.ws_url, header=headers, on_open=self._on_open, on_message=self._on_message,
```
### `config.py` (authApi, orderRealism)
- **auth**: trade-api-v2, env-secrets, api-key-file
- **orders**: order-fields, fee-aware-edge
- **dryRun**: dry-run-default
- **loop**: websocket, polling-loop
- **errors**: retry-backoff, try-catch, structured-logging
- **structure**: config-module, strategy-module

```
gelog if KALSHI_ENV == "prod": BASE_URL = "https://api.elections.kalshi.com/trade-api/v2" else: BASE_URL = "https://demo-api.kalshi.co/trade-api/v2" KALSHI_BASE_URL = BASE_URL # alias used in kalshi_client.py # ============================================================================= # Risk Controls # ============================================================================= MAX_TRADE_DOLLARS: float = float(os.getenv("MAX_TRADE_DOLLARS", "10")) MAX_OPEN_POSI
```
### `README.md` (authApi, orderRealism)
- **auth**: rsa-pss-signing, api-key-file
- **orders**: order-fields
- **dryRun**: dry-run-default
- **structure**: config-module, strategy-module

```
15-minute prediction markets. Trades using the official Kalshi REST API v2 with RSA-PSS authentication. Now integrates with **OpenClaw Agent Trading** for autonomous, AI-driven signal enrichment and trade execution. --- ## New Features ### 🤖 OpenClaw / Agent Trading Integration *(New)* The bot now natively integrates with **OpenClaw Agent Trading**, enabling autonomous AI-driven market analysis and trade execution on top of the existing rule-based strategy. - **AI-Powere
```
### `tests/test_kalshi_sdk_migration.py` (authApi, orderRealism)
- **auth**: trade-api-v2, env-secrets, api-key-file
- **orders**: order-fields
- **structure**: client-wrapper
- **tests**: test-import

```
lient.assert_called_once() self.assertTrue(cfg_instance.host.endswith("/trade-api/v2")) self.assertEqual(cfg_instance.api_key_id, config.KALSHI_API_KEY_ID) self.assertEqual(cfg_instance.private_key_pem, "---PEM---") class TestOrderPayloadConstruction(unittest.TestCase): def setUp(self): import kalshi_client as kc self.kc = kc # Make a client with SDK mocked to avoid touching network / keys. with patch.object(kc, "
```
### `kalshi_inprocess_orders.py` (orderRealism)
- **auth**: env-secrets
- **orders**: create-order-call, order-fields
- **dryRun**: dry-run-default
- **errors**: try-catch, structured-logging
- **structure**: client-wrapper

```
Allow tests / sandboxes to override the STOP_TRADING location. STOP_FILE = Path(os.environ.get("OPENCLAW_STOP_FILE", str(Path.home() / ".openclaw" / "workspace" / "STOP_TRADING"))) def _stop_file() -> Path: # Re-read env at call time so tests can set OPENCLAW_STOP_FILE even if this # module was imported earlier. return Path(os.environ.get("OPENCLAW_STOP_FILE", str(STOP_FILE))) def buy_envelope( client: "KalshiClient", ticker: str, side: str, co
```

## mbordash/DRADIS (83.25) — high-value

### `src/venues/kalshi/auth.rs` (authApi, orderRealism)
- **auth**: kalshi-access-headers, trade-api-v2, rsa-pss-signing, api-key-file
- **orders**: create-order-call, portfolio-orders-path
- **loop**: websocket

```
------------------------|----------------------------------------------| //! | `KALSHI-ACCESS-KEY` | API key id (UUID from account settings) | //! | `KALSHI-ACCESS-TIMESTAMP` | request timestamp in **milliseconds** | //! | `KALSHI-ACCESS-SIGNATURE` | base64( RSA-PSS-SHA256( ts + METHOD + path ))| //! //! The signed message is the concatenation of the millisecond timestamp, the //! uppercase HTTP method, and the request **path without query string** (e.g.
```
### `src/venues/kalshi/mod.rs` (authApi)
- **auth**: trade-api-v2, rsa-pss-signing, env-secrets, api-key-file
- **orders**: order-fields, portfolio-orders-path
- **loop**: websocket

```
---------------------------| //! | REST | `https://external-api.kalshi.com/trade-api/v2` | `https://external-api.demo.kalshi.co/trade-api/v2` | //! | WebSocket | `wss://external-api-ws.kalshi.com/trade-api/ws/v2` | `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` | //! //! Auth: RSA-PSS signed headers (see [`auth`]). Public market data (markets, //! series, orderbook) requires no auth. Orders use the V2 endpoint //! `/portfolio/events/orders` (bid/ask sides, fi
```
### `README.md` (authApi, orderRealism)
- **auth**: rsa-pss-signing, api-key-file
- **orders**: order-fields, portfolio-orders-path
- **dryRun**: dry-run-default
- **loop**: websocket, polling-loop
- **errors**: try-catch
- **structure**: strategy-module, odds-api

```
xchange.com` | | `kalshi` | Kalshi (custodial, CFTC) | RSA-PSS request signing | `external-api.kalshi.com` (demo: `external-api.demo.kalshi.co`) | ### Start locally ```bash # Polymarket Intl CLOB (default) ./start-local.sh # BTC ./start-local.sh eth # ETH # Polymarket US Retail VENUE=us ./start-local.sh # Kalshi VENUE=kalshi ./start-local.sh ``` ### Build manually ```bash # International CLOB (defaul
```
### `src/venues/kalshi/orders.rs` (orderRealism)
- **orders**: create-order-call, order-fields, portfolio-orders-path, fee-aware-edge
- **errors**: try-catch

```
are fixed-point dollar strings; counts are fractional contracts. //! Endpoint: `POST /portfolio/events/orders` (the legacy `/portfolio/orders` //! is deprecated). use anyhow::Result; use async_trait::async_trait; use rust_decimal::Decimal; use crate::venues::core::{ Execution, Fill, OpenOrder, OrderId, OrderIntent, MarketId, Position, Side, TimeInForce, }; use super::{split_market_id, types, KalshiVenue}; /// Largest gap tolerated between a reported average fill price
```
### `src/venues/kalshi/ws.rs` (authApi, orderRealism)
- **auth**: rsa-pss-signing, env-secrets
- **orders**: order-fields
- **loop**: websocket, polling-loop
- **errors**: retry-backoff

```
snapshot/delta engine + fill feed. //! //! Protocol (`wss://…/trade-api/ws/v2`, RSA-PSS-signed handshake): //! - Subscribe: `{"id":N,"cmd":"subscribe","params":{"channels":[…],"market_tickers":[…]}}` //! - `orderbook_snapshot` arrives first per market, then `orderbook_delta` //! increments; both carry `seq` — a gap means we lost a frame and must //! rebuild (we reconnect, which re-delivers snapshots). //! - The book is BIDS-ONLY (yes bids + no bids); the yes ask is derive
```
### `src/venues/kalshi/types.rs` (orderRealism)
- **orders**: create-order-call, order-fields, portfolio-orders-path, fee-aware-edge

```
elf.position.map(Decimal::from).unwrap_or_default() } } // ─── Orders (V2: POST /portfolio/events/orders) ────────────────────────────── #[derive(Debug, Clone, Default, Deserialize)] pub struct OrderResponse { #[serde(default)] pub order: KalshiOrder, } /// Pull the order out of a create-order response. /// /// `POST /portfolio/events/orders` returns the order's fields at the top level, /// not wrapped in `{"order": …}`. Deserialising the wrapper against a flat
```

## rodlaf/KalshiMarketMaker (60.75) — scored

### `kalshi_market_maker/core/kalshi_api.py` (authApi, orderRealism)
- **auth**: kalshi-access-headers, rsa-pss-signing, api-key-file
- **orders**: create-order-call, order-fields, portfolio-orders-path
- **loop**: polling-loop
- **errors**: retry-backoff, try-catch, structured-logging
- **structure**: client-wrapper

```
= self._create_signature(timestamp, method, path) return { "KALSHI-ACCESS-KEY": self.api_key_id, "KALSHI-ACCESS-SIGNATURE": signature, "KALSHI-ACCESS-TIMESTAMP": timestamp, "Content-Type": "application/json", } def make_request( self, method: str, path: str, params: Dict = None, data: Dict = None, max_retries: int = 5, ): url = f"{self.base_url}{pat
```
### `kalshi_market_maker/core/avellaneda.py` (orderRealism)
- **orders**: create-order-call, order-fields
- **errors**: try-catch, structured-logging

```
) if keep_order is None and should_place: self.api.place_order( action, self.trade_side, desired_price, desired_size, int(time.time()) + self.order_expiration, )
```
### `kalshi_market_maker/cli/cancel_all.py` (orderRealism)
- **auth**: env-secrets
- **orders**: create-order-call, order-fields
- **dryRun**: dry-run-default
- **errors**: try-catch, structured-logging

```
import argparse import time from typing import Dict, List from dotenv import load_dotenv from ..factories import create_api from ..logging_utils import build_logger def filter_orders(orders: List[Dict], side: str = None, action: str = None) -> List[Dict]: filtered = orders if side: filtered = [order for order in filtered if order.get("side") == side] if action: filtered = [order for order in filtered if order.get("action") == ac
```

## kuestcom/prediction-market (51.5) — scored

### `docs/api-reference/clients-sdks.mdx` (orderRealism)
- **auth**: env-secrets, api-key-file
- **orders**: create-order-call, order-fields
- **loop**: websocket
- **structure**: strategy-module

```
'viem/accounts' import { polygonAmoy } from 'viem/chains' const host = process.env.CLOB_URL! const chainId = 80002 const tokenID = process.env.CLOB_TOKEN_ID! const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`) const signer = createWalletClient({ account, chain: polygonAmoy, transport: http(process.env.RPC_URL), }) const bootstrap = new ClobClient(host, chainId, signer) const creds = await bootst
```
### `src/lib/db/queries/order.ts` (orderRealism)
- **orders**: create-order-call, portfolio-orders-path

```
y' import { db } from '@/lib/drizzle' export const OrderRepository = { async createOrder(args: { // begin blockchain data salt: bigint maker: string signer: string taker: string token_id: string maker_amount: bigint taker_amount: bigint expiration: bigint nonce: bigint fee_rate_bps: number side: OrderSide signature_type: number signature: string // end blockchain data type: ClobOrderType user_id: string
```
### `src/app/[locale]/(platform)/event/[slug]/_actions/store-order.ts` (orderRealism)
- **auth**: env-secrets, api-key-file
- **orders**: create-order-call, order-fields, portfolio-orders-path
- **errors**: try-catch, structured-logging

```
POST' const path = '/order' const { clobUrl } = resolvePublicRuntimeEnv(process.env) const body = JSON.stringify(clobPayload) const timestamp = Math.floor(Date.now() / 1000) const signature = buildClobHmacSignature(clobAuth.secret, timestamp, method, path, body) const clobStoreOrderResponse = await fetch(`${clobUrl}${path}`, { method, headers: { 'Content-Type': 'application/json', Accept: 'application/json', KUEST_A
```
### `src/lib/polymarket-orders-client.ts` (orderRealism)
- **orders**: create-order-call, order-fields
- **errors**: try-catch

```
nst negRisk = await client.getNegRisk(tokenId) const order = await client.createOrder(buildPolymarketLimitOrder({ tokenId, price, shares }), { tickSize, negRisk, }) const orderPayload = isV2Order(order) ? orderToJsonV2(order, creds.key, OrderType.FOK) : orderToJsonV1(order, creds.key, OrderType.FOK) return { post: async () => { const body = JSON.stringify(orderPayload) const headers = await c
```
### `docs/api-reference/schemas/openapi-clob.json` (orderRealism)
- _Could not fetch file via gh API_
### `src/lib/db/schema/index.ts` (orderRealism)
- **orders**: portfolio-orders-path

```
* from './events/tables' export * from './notifications/tables' export * from './orders/tables' export * from './settings/tables' export * from './subgraph/tables' export * from './sumsub/tables' // relations export * from './affiliates/relations' export * from './auth/relations' export * from './bookmarks/relations' export * from './events/relations' export * from './notifications/relations' export * from './orders/relations'
```
### `package.json` ()
- **orders**: order-fields

```
.6.3", "@types/canvas-confetti": "1.9.0", "@types/mdx": "2.0.14", "@types/node": "24.13.3", "@types/react": "19.2.18", "@types/react-dom": "19.2.4", "@vitest/coverage-v8": "4.1.10", "eslint-plugin-react-you-might-not-need-an-effect": "1.0.1", "husky": "9.1.7", "jsdom": "30.0.1", "knip": "6.32.0", "lint-staged": "17.3.0", "oxfmt": "0.62.0", "oxlint": "1.77.0", "oxlint-tsgolint": "7.0.2001", "tailwindcss": "4.3.3",
```
