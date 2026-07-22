# Kalshi bot pattern report

Run: `2026-07-22T06-19-51-053Z`
Dimension: `arbitrage`
Generated: 2026-07-22T06:19:51.053Z

## Aggregate signals
- **auth**: kalshi-access-headers, rsa-pss-signing, api-key-file, trade-api-v2
- **orders**: create-order-call, order-fields, portfolio-orders-path
- **loop**: polling-loop
- **errors**: try-catch
- **structure**: client-wrapper

## RichardFeynmanEnthusiast/kalshi-polymarket-arbitrage-bot (69.5) — ⚠ watchlist

### `app/clients/kalshi/base.py` (authApi)
- **auth**: kalshi-access-headers, rsa-pss-signing, api-key-file
- **errors**: try-catch
- **structure**: client-wrapper

```
headers = { "Content-Type": "application/json", "KALSHI-ACCESS-KEY": self.key_id, "KALSHI-ACCESS-SIGNATURE": signature, "KALSHI-ACCESS-TIMESTAMP": timestamp_str, } return headers def sign_pss_text(self, text: str) -> str: """Signs the text using RSA-PSS and returns the base64 encoded signature.""" message = text.encode('utf-8') try: signature = self.private_key.sign
```
### `shared_libraries/shared_infra_pkg/shared_infra/kalshi_clients/kalshi_base.py` (authApi)
- **auth**: kalshi-access-headers, rsa-pss-signing, api-key-file
- **errors**: try-catch
- **structure**: client-wrapper

```
headers = { "Content-Type": "application/json", "KALSHI-ACCESS-KEY": self.key_id, "KALSHI-ACCESS-SIGNATURE": signature, "KALSHI-ACCESS-TIMESTAMP": timestamp_str, } return headers def sign_pss_text(self, text: str) -> str: """Signs the text using RSA-PSS and returns the base64 encoded signature.""" message = text.encode('utf-8') try: signature = self.private_key.sign
```
### `shared_libraries/shared_infra_pkg/build/lib/shared_infra/kalshi_clients/kalshi_base.py` (authApi)
- **auth**: kalshi-access-headers, rsa-pss-signing, api-key-file
- **errors**: try-catch
- **structure**: client-wrapper

```
headers = { "Content-Type": "application/json", "KALSHI-ACCESS-KEY": self.key_id, "KALSHI-ACCESS-SIGNATURE": signature, "KALSHI-ACCESS-TIMESTAMP": timestamp_str, } return headers def sign_pss_text(self, text: str) -> str: """Signs the text using RSA-PSS and returns the base64 encoded signature.""" message = text.encode('utf-8') try: signature = self.private_key.sign
```
### `app/clients/kalshi/kalshi_http_client.py` (authApi, orderRealism)
- **auth**: trade-api-v2, api-key-file
- **orders**: create-order-call, order-fields, portfolio-orders-path
- **loop**: polling-loop
- **structure**: client-wrapper

```
vironment) self.host = self.HTTP_BASE_URL self.exchange_url = "/trade-api/v2/exchange" self.markets_url = "/trade-api/v2/markets" self.portfolio_url = "/trade-api/v2/portfolio" self.events_url = "/trade-api/v2/events" def rate_limit(self) -> None: """Built-in rate limiter to prevent exceeding API rate limits.""" THRESHOLD_IN_MILLISECONDS = 100 now = datetime.now() threshold_in_microseconds = 1000 * T
```
### `shared_libraries/shared_infra_pkg/shared_infra/kalshi_clients/kalshi_http.py` (authApi, orderRealism)
- **auth**: trade-api-v2, api-key-file
- **orders**: create-order-call, order-fields, portfolio-orders-path
- **loop**: polling-loop
- **errors**: try-catch
- **structure**: client-wrapper

```
vironment) self.host = self.HTTP_BASE_URL self.exchange_url = "/trade-api/v2/exchange" self.markets_url = "/trade-api/v2/markets" self.portfolio_url = "/trade-api/v2/portfolio" self.events_url = "/trade-api/v2/events" def rate_limit(self) -> None: """Built-in rate limiter to prevent exceeding API rate limits.""" THRESHOLD_IN_MILLISECONDS = 100 now = datetime.now() threshold_in_microseconds = 1000 * T
```
### `shared_libraries/shared_infra_pkg/build/lib/shared_infra/kalshi_clients/kalshi_http.py` (authApi, orderRealism)
- **auth**: trade-api-v2, api-key-file
- **orders**: create-order-call, order-fields, portfolio-orders-path
- **loop**: polling-loop
- **errors**: try-catch
- **structure**: client-wrapper

```
vironment) self.host = self.HTTP_BASE_URL self.exchange_url = "/trade-api/v2/exchange" self.markets_url = "/trade-api/v2/markets" self.portfolio_url = "/trade-api/v2/portfolio" self.events_url = "/trade-api/v2/events" def rate_limit(self) -> None: """Built-in rate limiter to prevent exceeding API rate limits.""" THRESHOLD_IN_MILLISECONDS = 100 now = datetime.now() threshold_in_microseconds = 1000 * T
```
