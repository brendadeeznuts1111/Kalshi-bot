# tennis-graph-chebnet

Spectral graph model over the player dominance graph. Learnable Chebyshev
filters (K≤3) propagate form across K-hop rivalry neighborhoods; a logistic
head on spectral block differences scores P(A beats B). Graph membership is
gated by the Enrichment Lock (nationality + tournament country + tier);
training is walk-forward with no structural or feature leakage. Spec:
docs/CHEBNET_GRAPH_DOMINANCE.md.
