-- seeds/state_regulations.sql
-- Initial regulatory limits for multiple US states.
-- Run after migration 011_state_regulation.sql.

INSERT OR IGNORE INTO regulatory_limits
  (state_code, sport_id, market_id, max_wager, min_wager, allowed_bet_types, special_rules)
VALUES
  -- Massachusetts (MA)
  ('MA', 'soccer',      'match_winner', 5000,  0.5, '["straight","parlay"]',               '{"max_daily_total":25000}'),
  ('MA', 'basketball',  'over_under',   10000, 1,   '["straight"]',                        NULL),
  ('MA', 'tennis',      'match_winner', 2500,  0.5, '["straight"]',                        '{"max_daily_total":15000}'),
  ('MA', 'basketball',  'match_winner', 7500,  1,   '["straight","parlay"]',               NULL),

  -- New Jersey (NJ)
  ('NJ', 'soccer',      'match_winner', 10000, 1,   '["straight","parlay","teaser"]',      '{"require_identity_verification":true}'),
  ('NJ', 'basketball',  'over_under',   15000, 1,   '["straight","parlay"]',               NULL),
  ('NJ', 'tennis',      'match_winner', 5000,  1,   '["straight","parlay"]',               NULL),
  ('NJ', 'basketball',  'match_winner', 12000, 1,   '["straight","parlay","teaser"]',      NULL),
  ('NJ', 'baseball',    'moneyline',    8000,  1,   '["straight"]',                        NULL),

  -- New York (NY)
  ('NY', 'soccer',      'match_winner', 5000,  1,   '["straight","parlay"]',               '{"max_daily_total":20000,"require_identity_verification":true}'),
  ('NY', 'basketball',  'over_under',   10000, 1,   '["straight","parlay"]',               NULL),
  ('NY', 'tennis',      'match_winner', 3000,  1,   '["straight"]',                        '{"max_daily_total":12000}'),
  ('NY', 'basketball',  'match_winner', 10000, 1,   '["straight","parlay","teaser"]',      NULL),
  ('NY', 'baseball',    'moneyline',    6000,  1,   '["straight","parlay"]',               NULL),

  -- Pennsylvania (PA)
  ('PA', 'soccer',      'match_winner', 7500,  1,   '["straight","parlay"]',               NULL),
  ('PA', 'basketball',  'over_under',   12000, 1,   '["straight","parlay"]',               NULL),
  ('PA', 'tennis',      'match_winner', 4000,  1,   '["straight","parlay"]',               '{"cooling_off_minutes":30}'),
  ('PA', 'basketball',  'match_winner', 10000, 1,   '["straight","parlay","teaser"]',      NULL),
  ('PA', 'baseball',    'moneyline',    7000,  1,   '["straight"]',                        NULL),

  -- Illinois (IL)
  ('IL', 'soccer',      'match_winner', 6000,  1,   '["straight","parlay"]',               '{"max_daily_total":18000}'),
  ('IL', 'basketball',  'over_under',   10000, 1,   '["straight","parlay"]',               NULL),
  ('IL', 'tennis',      'match_winner', 3500,  1,   '["straight"]',                        NULL),
  ('IL', 'basketball',  'match_winner', 9000,  1,   '["straight","parlay","teaser"]',      NULL),

  -- Nevada (NV)
  ('NV', 'soccer',      'match_winner', 20000, 1,   '["straight","parlay","teaser"]',      NULL),
  ('NV', 'basketball',  'over_under',   25000, 1,   '["straight","parlay","teaser"]',      NULL),
  ('NV', 'tennis',      'match_winner', 10000, 1,   '["straight","parlay"]',               NULL),
  ('NV', 'basketball',  'match_winner', 20000, 1,   '["straight","parlay","teaser"]',      NULL),
  ('NV', 'baseball',    'moneyline',    15000, 1,   '["straight","parlay"]',               NULL);

-- Seed partner licenses (example)
INSERT OR IGNORE INTO partner_state_licenses
  (node_id, state_code, license_number, status)
VALUES
  ('partner-alpha', 'MA', 'MA-2024-001', 'active'),
  ('partner-alpha', 'NJ', 'NJ-2024-042', 'active'),
  ('partner-alpha', 'NY', 'NY-2024-015', 'active'),
  ('partner-alpha', 'PA', 'PA-2024-008', 'active'),
  ('partner-alpha', 'IL', 'IL-2024-022', 'active'),
  ('partner-alpha', 'NV', 'NV-2024-003', 'active'),
  ('partner-beta',  'MA', 'MA-2024-017', 'active'),
  ('partner-beta',  'NJ', 'NJ-2024-099', 'suspended'),
  ('partner-beta',  'NY', 'NY-2024-067', 'active'),
  ('partner-beta',  'PA', 'PA-2024-031', 'active'),
  ('partner-gamma', 'NJ', 'NJ-2024-101', 'active'),
  ('partner-gamma', 'NV', 'NV-2024-045', 'active'),
  ('partner-delta', 'IL', 'IL-2024-041', 'revoked');

-- Seed self-exclusions (example)
INSERT OR IGNORE INTO self_exclusions
  (user_id, node_id, reason, excluded_at, expires_at)
VALUES
  ('problem-gambler-1', 'partner-alpha', 'problem-gambling', unixepoch(), NULL),
  ('cooldown-user',     'partner-beta',  'temporary-cooldown', unixepoch(), unixepoch() + 86400);
