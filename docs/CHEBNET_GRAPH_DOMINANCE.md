# ChebNet Graph Dominance — Architecture Spec

Status: proposed · 2026-07-29
Depends on: Enrichment Lock (`src/research/player-profile-meta.ts`), event store SSOT

## Intent

Model the professional tennis player pool as a directed graph and learn
dominance embeddings with **learnable Chebyshev filters** (ChebNet,
Defferrard et al. 2016), so match-win probability features come from
spectral graph structure — dominance propagation, rivalry clustering, and
intransitivity cycles (A beats B beats C beats A) — rather than from
isolated pairwise statistics.

Kalshi/Polymarket are price engines, not metadata providers; graph
construction consumes **only** lock-passing events from our own store.

## Graph construction (from event store)

- **Nodes**: players in `player_profiles` (~3.2k today, growing toward the
  ~4.6k-node universe as history ingests). Node features: win_rate,
  surface splits, appearances, avg Kalshi volume, nationality (ISO3,
  one-hot), tour level mix.
- **Edges**: directed, weighted. Edge A→B from events where A defeated B;
  weight = decayed match count (recency-weighted), optionally split by
  surface/tier later. Self-loops excluded.
- **Eligibility gate (hard)**: a node enters the graph only if its
  nationality is known (passes the Enrichment Lock); an edge enters only
  if the underlying events carry tournament country + tier. Unknowns are
  `DATA_INCOMPLETE` and excluded — never imputed. The graph is rebuilt by
  a repeatable job; lock regressions shrink the graph rather than
  corrupting it.

## Spectral layer (why Chebyshev)

Naive spectral filtering on this graph needs the Laplacian eigendecomposition
— O(N³) at N≈4.6k is ~10¹¹ FLOPs per rebuild, and non-local. ChebNet
avoids both:

1. Rescale L: `L̃ = (2/λmax)L − I` (λmax ≈ 2 bound is fine — no
   eigendecomposition needed).
2. Filter: `y ≈ Σ_k θ_k T_k(L̃) x`, with θ_k **learnable** via
   backprop/gradient descent on historical outcomes.
3. Recursion `T_k = 2L̃T_{k-1} − T_{k-2}` → only sparse matrix-vector
   products; L has ≤ E≈O(matches) nonzeros. Cost O(E·K), trivially
   runnable in Bun/TS per nightly rebuild.
4. Degree K = strict K-hop locality: K=2 captures "beat someone who beat
   X"; K=3 surfaces intransitivity triangles — the explicit target of the
   dominance model.

Filter shape is learned, not fixed: the model can discover high-pass
(upset-heavy neighborhoods) vs low-pass (chalk neighborhoods) responses —
a fixed GCN (K=1 low-pass) cannot express that distinction.

## Training objective

- Labels: historical match outcomes from the events SSOT (winner/loser,
  plus Pinnacle close where present as a market-efficiency baseline).
- Loss: binary cross-entropy on P(A beats B) from the two node embeddings
  + edge context; time-ordered train/validation split (no leakage —
  embeddings for a match at time t are computed from edges with t_edge < t).
- Metrics: log-loss, Brier, calibration curve — same gates as the alpha
  programs (`shadowMinSignals`, Brier drift kill) so the graph model
  graduates through the existing shadow→pilot→live pipeline.

## Safeguards (known ChebNet failure modes)

- **Runge phenomenon / coefficient oscillation**: cap K≤3 initially;
  monitor θ_k magnitude; if edge-of-interval oscillation appears in the
  learned filter response, move to ChebNetII-style interpolation
  constraints before raising K.
- **Overfitting on sparse neighborhoods**: weight-decay on θ; dropout on
  node features; minimum-edge-count threshold before a node's embedding is
  trusted for signal generation.
- **Drift**: nightly rebuild + Brier drift kill gate, same as other
  programs.

## Integration points

- `src/research/player-profile-meta.ts` — eligibility source (already live).
- `src/institutions/event-store/` — edges from events/resolutions tables.
- New: `alpha/tennis-graph-chebnet/` program (program.json, shadow log,
  gates) following the existing alpha-program archetype; signals carry the
  model-suspect flag only for lock-passing events.
- HQ Events tab: later, per-player dominance percentile + K-hop rivalry
  view (read-only surface over the trained embeddings).

## Non-goals (v1)

- No doubles, no live in-play re-embedding, no Pinnacle/poly graph edges,
  no K>3, no GPU dependency (pure TS sparse ops are sufficient at this
  graph size).
