# Color Palette

> Generated from `src/lib/color/` — Bun-native kernel SSOT
> Terminal swatches use `Bun.color(hex, "ansi-16m")` for true-color output

## Venue Colors

| Name | Hex | Swatch | Lum. | Contrast (white) | Contrast (black) | On-color |
|------|-----|--------|------|------------------|------------------|----------|
| **kalshi** | `#7DD3FC` | [48;2;125;211;252m████████████████████[0m | 0.58 | 1.7:1 | 12.6:1 ✅✅ | `#000000` |
| **polymarket** | `#2E5CFF` | [48;2;46;92;255m████████████████████[0m | 0.15 | 5.1:1 ✅ | 4.1:1 | `#ffffff` |
| **pinnacle** | `#1A73E8` | [48;2;26;115;232m████████████████████[0m | 0.18 | 4.5:1 ✅ | 4.7:1 ✅ | `#000000` |
| **betfair** | `#F5B942` | [48;2;245;185;66m████████████████████[0m | 0.55 | 1.8:1 | 11.9:1 ✅✅ | `#000000` |
| **unknown** | `#8B949E` | [48;2;139;148;158m████████████████████[0m | 0.29 | 3.1:1 | 6.8:1 ✅ | `#000000` |

## Domain Colors

| Name | Hex | Swatch | Lum. | Contrast (white) | Contrast (black) | On-color |
|------|-----|--------|------|------------------|------------------|----------|
| **trading** | `#E74C3C` | [48;2;231;76;60m████████████████████[0m | 0.22 | 3.8:1 | 5.5:1 ✅ | `#000000` |
| **middleware** | `#F1C40F` | [48;2;241;196;15m████████████████████[0m | 0.58 | 1.7:1 | 12.6:1 ✅✅ | `#000000` |
| **tennis** | `#27AE60` | [48;2;39;174;96m████████████████████[0m | 0.32 | 2.9:1 | 7.3:1 ✅✅ | `#000000` |
| **research** | `#E67E22` | [48;2;230;126;34m████████████████████[0m | 0.32 | 2.8:1 | 7.4:1 ✅✅ | `#000000` |
| **env** | `#9B59B6` | [48;2;155;89;182m████████████████████[0m | 0.17 | 4.7:1 ✅ | 4.5:1 | `#ffffff` |
| **misc** | `#95A5A6` | [48;2;149;165;166m████████████████████[0m | 0.36 | 2.6:1 | 8.2:1 ✅✅ | `#000000` |

## Semver / `bun update -i`

| Name | Hex | Swatch | Lum. | Contrast (white) | Contrast (black) | On-color |
|------|-----|--------|------|------------------|------------------|----------|
| **semverMajor** | `#EF4444` | [48;2;239;68;68m████████████████████[0m | 0.23 | 3.8:1 | 5.6:1 ✅ | `#000000` |
| **semverMinor** | `#EAB308` | [48;2;234;179;8m████████████████████[0m | 0.50 | 1.9:1 | 11.0:1 ✅✅ | `#000000` |
| **semverPatch** | `#22C55E` | [48;2;34;197;94m████████████████████[0m | 0.41 | 2.3:1 | 9.2:1 ✅✅ | `#000000` |
| **selected** | `#A78BFA` | [48;2;167;139;250m████████████████████[0m | 0.34 | 2.7:1 | 7.7:1 ✅✅ | `#000000` |

- ✅ Meets WCAG AA for normal text (4.5:1) on white or black background.
- ✅✅ Meets WCAG AAA (7:1).
- `luminance` and `contrast` calculated per WCAG 2.1 sRGB.
- Sample contrast(trading, misc) = 1.5

## Usage

```typescript
import { cssColor, foregroundCss, paint } from "../src/lib/color/index.ts";

cssColor("trading")           // → "#e74c3c"
foregroundCss("trading")      // → "#ffffff"
paint("risk", "trading")      // → ANSI-colored text
```

