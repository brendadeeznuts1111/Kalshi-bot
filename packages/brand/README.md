# @kalshi/brand — validated Kalshi HQ brand assets

Public brand assets + design tokens, generated from the repo design system and
**validated** before publish: `brand-card.png` is verified exactly 1200x630 PNG,
and every swatch is a 64x64 solid PNG.

## Contents

- `assets/brand-card.png` — the verified 1200x630 brand card raster
- `assets/swatches/*.png` — solid color swatches from the design tokens (64x64)
- `tokens.json` — `{ designSystemVersion, brand, tokens, swatches }`
- `bin/kalshi-brand.ts` — self-contained validation CLI (`validate` / `info`)

## Use

```sh
bunx kalshi-brand validate    # re-verify the bundled assets
import tokens from "@kalshi/brand/tokens.json" with { type: "json" };
```

## Regenerate (repo-side)

```sh
bun run brand:pkg:generate    # regen tokens.json + swatches + re-verify brand-card
bun run brand:pkg:check       # pack --dry-run + publish --dry-run
```

## Publish

```sh
cd packages/brand && bun run publish:public
```

| Variable | Purpose |
| --- | --- |
| `NPM_CONFIG_TOKEN` | registry auth token (CI/automation; `bunx npm login` interactively otherwise) |
| `NPM_OTP` | one-time password for 2FA when required (passed as `--otp`) |
| `NPM_TAG` | release tag override (default `latest` from `publishConfig.tag`) |

Registry: `https://registry.npmjs.org/` (constant in the repo `bunfig.toml`
`[install] registry`). `publishConfig.access` is `public` — scoped packages must
publish publicly or with `--access public`.
