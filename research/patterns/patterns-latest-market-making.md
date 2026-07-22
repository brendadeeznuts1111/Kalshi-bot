# Kalshi bot pattern report

Run: `2026-07-22T06-13-45-870Z`
Dimension: `market-making`
Generated: 2026-07-22T06:13:45.870Z

## Aggregate signals
- **auth**: kalshi-access-headers, rsa-pss-signing, api-key-file
- **orders**: create-order-call, order-fields, portfolio-orders-path
- **loop**: polling-loop
- **errors**: retry-backoff, try-catch, structured-logging
- **structure**: client-wrapper

## rodlaf/KalshiMarketMaker (67.75) — ✗ unverified

### `kalshi_market_maker/core/kalshi_api.py` (authApi)
- **auth**: kalshi-access-headers, rsa-pss-signing, api-key-file
- **orders**: create-order-call, order-fields, portfolio-orders-path
- **loop**: polling-loop
- **errors**: retry-backoff, try-catch, structured-logging
- **structure**: client-wrapper

```
= self._create_signature(timestamp, method, path) return { "KALSHI-ACCESS-KEY": self.api_key_id, "KALSHI-ACCESS-SIGNATURE": signature, "KALSHI-ACCESS-TIMESTAMP": timestamp, "Content-Type": "application/json", } def make_request( self, method: str, path: str, params: Dict = None, data: Dict = None, max_retries: int = 5, ): url = f"{self.base_url}{pat
```
