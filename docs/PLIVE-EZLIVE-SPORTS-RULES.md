# Plive / EZLive Sports Rules (shell SSOT)

**Status:** operator + model reference for **weighting lines, odds, and movement**.  
**Scope:** SportsWidgets GS Live rules panel. **Not** seat capital, inventory schema, or Kalshi settlement.  
**Products:** `plive` ≡ `ezlive` on settlement (shared shell).

## Contents

1. [Provenance](#provenance)
2. [Quick reference — action thresholds](#quick-reference--action-thresholds)
3. [Weighting playbook (lines · odds · movement)](#weighting-playbook-lines--odds--movement)
4. [Primary sports cards](#primary-sports-cards)
5. [General / settling / bet types](#general-betting)
6. [Full by-sport rules](#by-sport)
7. [Tennis desk cheat sheet](#tennis--desk-cheat-sheet-lines--movement)
8. [Re-pull](#re-pull)

## Provenance

| Field | Value |
| ----- | ----- |
| Shell | SportsWidgets GS Live |
| UI | Rules (`component: Rules` / `standalone-rules`) |
| Source | https://plive.sportswidgets.pro/live/ |
| Payload | `LANGUAGES[en].rules.tabs` embedded in live HTML |
| Captured | 2026-08-10 |
| Human doc | this file |
| Machine snapshot | [`artifacts/plive-ezlive-sports-rules.json`](artifacts/plive-ezlive-sports-rules.json) |
| Weighting index | JSON key `weighting` (v2) |
| Code SSOT | [`src/settlement/`](../src/settlement/) — weighting · void EV · **edge patterns** |
| Edge patterns (sport/market/line) | [`EDGE-PATTERNS.md`](EDGE-PATTERNS.md) · `scanEdgePatterns` · `bun live-tracker.ts patterns` |
| Live-tracker | `bun live-tracker.ts analyze --sport=tennis --phase=live` |
| Shadow outcomes | `0 \| 1 \| "void"` — voids **excluded** from Brier (`src/institutions/shadow-line.ts`) |
| **plive** | Live product + inventory shell owner |
| **ezlive** | Same shell, **same rules** (capacity / session only) |

> Snapshot only — re-pull before settlement disputes. Placeholder `{{companyName}}` → “the book”.

### plive vs ezlive

| Dimension | plive | ezlive | Diff for odds weighting? |
| --------- | ----- | ------ | ------------------------ |
| Rules text | This document | Identical | **No** |
| Inventory feed | Shell owner | Shared rows | No |
| Capacity / session | `plive` | `ezlive` | Routing only |
| Settlement fork | — | — | **None** |

---

## Quick reference — action thresholds

Use this table **before** sizing a move. “Official minutes” rows are **prematch-only** unless noted.

| Sport | Match / game ML action | Totals / spreads | Period props | Special |
| ----- | ---------------------- | ---------------- | ------------ | ------- |
| **Tennis** | **Prematch:** 1st set done · **Live:** full match | Period must complete | Set/game once unit done; completed sets survive retirement | Tie-break = **1 game** for game H/T |
| **Table tennis** | Unsettled void if not resumed in **24h** | Points | Completed markets stand | Short match density |
| **Soccer** | Reg time default; abandon **≥85′** → action | Same; already determined stand | 1H needs break | WC/Euro/Copa: complete in **72h** |
| **Basketball** | Prematch: **NBA 43′** / **NCAA+intl 35′** (not live) | Game+2H **incl OT**; Q4 **excl OT** | Period complete | Home designation stands on venue change |
| **Baseball** | Prematch ML: **5 inn** (4.5 home ahead) | Full game needs scheduled innings | Inning(s) must complete | **Listed pitchers** default MLB prematch |
| **Hockey** | Prematch official **55′** NHL/NCAA (not live) | Game+period **incl OT/SO**; reg-only markets exclude | Period complete | SO winner = **1 goal** |
| **Football** | Prematch suspend rules + OT on game/2H | Game+2H **incl OT**; Q4 **excl OT** | — | **Venue change → no action**; props must-play |
| **Golf** | Outright: trophy / playoff | Round/hole markets own rules | Tee-off = action on player | Shortened event voids score/margin class |
| **Volleyball** | Incomplete match → void unsettled | Points | Settled markets stand | — |
| **Snooker** | Both start **and** complete | — | — | Strict full-match |

### Global defaults (all sports unless sport chapter overrides)

| Rule | Effect on EV / movement |
| ---- | ----------------------- |
| Interrupted, not resumed **same local calendar day** | Unsettled → no action; already-determined stand |
| Postponed to **next calendar day** | Typically void |
| Forfeit / walkover / unplayed “complete” | Fixture bets **void** (futures multiway: forfeit = loss) |
| Offering undetermined **24h** | Cancel |
| Dead heat (outrights / top-N) | Pro-rata win/lose split |
| Official site **day of event** | Settlement SSOT; later amendments ignored |
| Scoreboard / live stats on site | **Guide only** — not grade truth |
| Odds change after accept | Ticket keeps original price |
| Secondary confirmation (in-play) | Score during countdown → leg cancel / parlay reprice |
| Match-fix suspicion | Book may hold/cancel |

---

## Weighting playbook (lines · odds · movement)

### Decision loop

```text
1. Identify market class     ML | spread | total | period | prop | outright
2. Identify phase            prematch | live
3. Load action threshold     table above + sport card
4. Attach void branch        p_void → refund (not lose)
5. Attach period definition  OT/ET/SO/reg-only
6. Size move                 only on residual risk that still has action path
```

### Fair value with void

Binary ticket at decimal odds `o`, stake `s`, outcomes win / lose / void:

| Outcome | Cash |
| ------- | ---- |
| Win | `s * o` |
| Lose | `0` |
| Void | `s` (refund) |

```text
EV = p_win * (s * o) + p_void * s + p_lose * 0 - s
```

**Implication:** injury or abandon news that raises `p_void` can **look** like a free “fade” if you model only win/lose. Live tennis ML is the textbook case.

### When a line moves — what changed?

| Signal | More often means | Check rule |
| ------ | ---------------- | ---------- |
| Injury / retirement risk | `p_void` or progressor lock | Tennis prematch vs live ML |
| Red card / starter scratch | True `p_win` shift | Soccer reg-time; baseball listed pitcher |
| Weather delay | Abandon / next-day void risk | Global interrupt + sport window |
| OT/SO game state | Period definition | Hockey/basketball/football OT flags |
| Soft live fill | Secondary confirmation cancel | General Betting |
| Scoreboard lag | Do not reprice off widget score alone | Scoreboard disclaimer |

### Parlay / multi legs

- Secondary confirmation cancel on one leg → remaining legs reprice **without** canceled leg (not always full void).
- Already-determined legs can stand when event abandons (global interrupt rule).
- Do not assume same action threshold across sports in a multi.

### Prematch vs live (cross-cutting)

| Topic | Prematch | Live |
| ----- | -------- | ---- |
| Tennis ML retirement | 1st set complete → action | Full match required |
| Basketball min minutes | 43′ NBA / 35′ NCAA+intl | **Does not apply** |
| Hockey 55′ official | Applies | **Does not apply** |
| Baseball 5-inning ML | Applies (and pitcher lists) | Sport text notes prematch framing — treat live carefully |
| Bet Builder | Prematch only; closes when PM board down | N/A |

---

## Primary sports cards

Condensed **weighting context**. Full shell text is under [By Sport](#by-sport).

### Tennis

| | |
| --- | --- |
| Prematch ML | Action if **first set completed**; else void on retire/DQ |
| Live ML | Match must be **completed** |
| Other markets | Action only if **period completed** before stop |
| Survival | Venue/surface/indoor-outdoor/schedule change; **completed set bets** on retirement; resume ≤**24h** |
| Grading | Tie-break set winner = **1 game** for game handicap/totals |
| Move sizing | Live injury → void branch; post–set-1 prematch → progressor |

### Table tennis

| | |
| --- | --- |
| Interrupt | Not resumed ≤**24h** → unsettled void |
| Units | Spreads/totals in **points** unless stated |
| Move sizing | Short matches → higher secondary-confirm + abandon density |

### Soccer

| | |
| --- | --- |
| Full match / 2H | **Regulation only** unless labeled |
| 1H | Needs **break** reached |
| Abandon | Unsettled void unless **≥85′** then action |
| Goalscorer | 90′+injury; **no** ET / own goals / pens |
| Fouls player markets | Include ET if played |
| WC / Euro / Copa | Complete within **72h** of original schedule |
| Move sizing | Late abandon vs 85′ threshold; card/injury on reg-time markets |

### Basketball

| | |
| --- | --- |
| Game + 2H | **Include OT** unless stated |
| Q4 | **Exclude OT** unless stated |
| Prematch official | NBA **43′** · NCAA/intl **35′** (not live) |
| Venue | Stand if original home designation kept; flip home/away → void |
| Move sizing | OT games break naive Q4↔game models |

### Baseball

| | |
| --- | --- |
| Full game / 2H | **Include extras** unless stated |
| Prematch ML official | **5 inn** (4.5 if home ahead) |
| Other full-game markets | Need **scheduled innings** (unless already determined) |
| Inning markets | Specified innings must complete |
| Pitchers | MLB prematch ML/RL/totals often **listed**; Action / List One / List Both |
| Postseason | Not official until winner declared |
| Move sizing | Starter scratches and rain are first-class void drivers |

### Hockey

| | |
| --- | --- |
| Game + period | **Include OT + SO** |
| Regulation-only | **Exclude** OT + SO |
| Shootout | Winner awarded **1 goal** |
| Prematch official | NHL/NCAA **55′** (not live) |
| Player props | OT yes, SO no (unless stated) |
| Move sizing | 2-way vs 3-way and SO definition dominate tight prices |

### Football (NFL / NCAAF shell text)

| | |
| --- | --- |
| Game + 2H | **Include OT** |
| Q4 | **Exclude OT** |
| Venue change | **No action** |
| Player props | Compete in ≥1 down (QB **must start**; receiving props special-cased) |
| Futures | Team markets often need full regular season |
| Move sizing | Inactives hit props harder than ML under must-play |

### Golf

| | |
| --- | --- |
| Player action | After **tee-off** |
| Outright | Trophy (playoff included); dead heat if unresolved ties on top-X |
| Shortened event | Outright can stand; void **correct scores / handicaps / points / margins** |
| Move sizing | WD after tee-off ≠ free void |

---

## General Betting

- All bets will be accepted in accordance with the current LINE - a list of events with the fixed odds and winning coefficients established by the book. The odds can be changed by the book after the bets are placed, but conditions of bets remain intact. Clients should check for all possible changes in the odds prior to placing the bet.

- A client cannot change or cancel a bet after registration on the server and after receiving the acceptance message and ticket number assignment. However, the book reserves the right to cancel a bet at any time for technical reasons or human error, without previous notice. Any failure in communication is not a valid reason for the extent of the funds in his account. When the bet has been placed and registered, the bet risk amount will be deducted from the client's deposit account. After the bet calculation, all winnings are added to the client's balance.

- ****Scoreboard:**** — Although we make every effort to ensure all live in-play information displayed is correct, information (such as score and time of game and other) is intended to be used as a guide and we assume no liability in the event that any information is incorrect.

### Secondary Confirmation

- When an in-play wager leg added to the bet slip is marked as "subject to secondary confirmation" that means that after the price and line are validated, a secondary confirmation period will be counted down on the bet slip. If during the secondary confirmation period there are no scores registered by either team, then the wager will be marked as accepted. Otherwise, the wager leg will be marked as canceled and in the case of a straight bet will be marked as no action.
- If one or more in-play legs of a parlay are deemed canceled due to secondary confirmation failure, the remainder of the parlay will have action at payout odds determined by excluding the canceled leg or legs from the odds calculation. If all parlay legs are so rejected then the entire parlay will be marked no action.
- We reserve the right to void any wager if it was placed during or immediately prior to a significant event that could affect the outcome.

---

## Settling Bets

- All event dates and times published by the book are tentative. Bets on events listed with incorrect dates or times or with other inaccuracies in their descriptions (e.g. the status or stage of a tournament, the score of an earlier related match, etc.) will be deemed valid for all in-play wagers without exception and for pre-match provided they were placed prior to the actual start of the event.

- The away team is indicated in the first place in a line. With the exception of pre-match soccer where the home team will be indicated in the first place in a line. If the game took place on the visitor team field (except matches between teams from the same city), all bets for the event will be considered void. The change of location to a neutral field is not a basis for cancelling bets. Bets will be considered valid if the host participant's location is listed in the tournament title, but the host participant is not listed first in the betting line. If there is a display discrepancy affecting the ordering of the home/away teams this will not be a valid reason for wager cancelation and all bets will stand.

- Interrupted events
  1. Interrupted events not resumed within the same calendar day (at midnight in the local time zone where the event is played) will be cancelled. In the case of such a cancellation, all bets are considered no action, except bets where the outcome has already been unambiguously determined (for example, if the score has already surpassed the total, then all bets on that over and under will be settled as winners and losers, respectively).
  2. Please see the correspondent chapters of these rules for additional rules relating to different sports.

- Only statistics and scores recorded on the official league website on the day of the event will be counted for settlement purposes. If after the day of the final of the event the primary result is changed for any major reason, this change does not affect the bet settlement. In addition, bets are considered to be settled according to the primary result of an official protocol or other source immediately after the event is finished. In the case that there is no information on official sources, the book has the right to use other sources of information, including information from its own representative at the match. The source stated in the betting line will prevail. If the event was interrupted and recommenced the next day from the start, for calculation purposes the first match is considered as an interrupted event and is calculated according 2.3.

- In case of human errors by the book staff or computer malfunctions during the acceptance of bets (such as: obvious mistakes in odds, non-corresponding odds in depending positions, etc.), and in the case where the game is suspected of being rigged, or in other cases of violation of the Rules, the book has a right to cancel such a bet. Should international anti match fixing organizations EWS-FIFA, Federbet and Tennis Integrity Unit, suspect of any match fixing or other such manipulation of the sporting event, the book has the right to block the account of the client who placed bets on the event until a final conclusion is drawn by the anti match fixing organizations. If the final conclusion results in a match being fixed, then all bets placed will be cancelled. Administration is not required to submit proof of the suspected rigging or manipulation with the result of the event.

- All in-play statistics displayed on the book’s site are for informational purposes only. While the book always tries to display the correct current score, an error in the score display will not be considered an acceptable reason for changing bet results. Please use alternative sources of information while placing live bets (for example, television, etc.).

- Any change in the score or any change in the details of the match decided on by the official referee, (for example cancelling a goal because of an offside, after examining the video or the cancelling or review of a point play in tennis, volleyball, etc.), or the mutual agreement of the participants (for example playing in equal teams after the player has been sent off, etc.) is not a valid reason to cancel bets.

- When an event is postponed and rescheduled for a later calendar day (after midnight in the local time zone where the event is played) all bets on that event will be void.

- If the results for an offering cannot be determined within 24 hours, then all wagers on that offering will be cancelled.

- For outright winner and top participant markets, dead heat rules may be applied. A dead heat is when multiple participants tie for a position in a contest such that the number of those finishing-in-the money is greater than would normally be expected. When this happens, wagers on any participant that is not fully in-the-money is proportionately divided into a winning portion and a losing portion in proportion to the number of available in-the-money spots.
  For example, if when wagering on a “Top 20” market your chosen participant finishes in a 5-way tie for 19th place, your wager would be a two-fifths winner (sharing the 19th and 20th places with 4 other participants) and a three-fifths loser (sharing 21st, 22nd, and 23rd place with 4 other participants).

- In any fixture involving a forfeit, walkover, or any other event where the fixture is considered complete without having been played, all bets will be void, regardless of how the governing body of its league scores it.
  For multiway or futures type markets, where the wager is not associated with any single event fixture, forfeits and the like will be treated as losses for the forfeiting team.

- In the event of a situation not specifically addressed in these rules, the book reserves the right to determine a final decision and will attempt to do so in a manner consistent with industry standards.

- Bet Builder wagers are based exclusively on Prematch markets. Bet Builder betting closes when the corresponding Prematch markets are taken off the board.


---

## Bet Types

- **2-Way Money Lines (Draw No Bet)**
  Predict which side will win outright. If the final result is a draw, then the wager will be refunded.

- **3-Way Money Lines**
  3-way money line betting are home, away, and draw. The outcome of the wager will be determined by the winner at the end of the specified period. In the case of a drawn outcome, wagers on both home and away are graded as losers.

- **Handicaps (Spreads)**
  A handicap is a type of wager where the specified number of points are added or subtracted from the side wagered on. A handicap of 0 is displayed on the screen as a line of ‘PK’. The outcome is determined by adding the handicap line to the chosen side’s score.
  1. Asian Spreads
These are Spreads displayed by an X number followed by either “.25” or a “.75”. For scoring purposes, they work the same as regular spreads, but your risk amount will be allocated to 2 different spread values. For example, If you choose a spread of +1.25, half of your wager will go to +1 and the other half to +1.5.
  2. Examples

- **Totals**
  You have 2 options: Over or Under. Predict the total goals (points on other sports) scored in the full game or in the specified period. For live wagers, goals are considered regardless of whether they are scored before or after the bets are placed. If a game is abandoned, bets will be void unless settlement has already been unconditionally determined.
  1. Asian Totals
These are Totals displayed by an X number followed by either “.25” or a “.75”. For scoring purposes, they work the same as regular totals, but your risk amount will be divided into 2 different totals. For example you bet a total to go under 3.75, in which half of your wager will go to under 3.5 and the other half to under 4. This can be selected for the full match or for a specific half/quarter/period.

Depending on the strength of each team, a handicap is issued for the game. This enables the odds for each side to be more similar, allowing more competitive betting opportunities. All bets on the Asian Handicap in live betting (including 1st/2nd half bets) are settled according to the score line. If a game is abandoned, bets will be void.
  2. Examples

- **Team Totals**
  This is the same as a total wager but it is based on the score of just one team and not both.

- **Double Chance**
  This offering displays 3 possible outcomes to wager on:
  - **Home team and draw:** If the home team wins or draws the match, your wager will graded a winner.
  - **Away team and draw:** If the away team wins or draws the match, your wager will be graded a winner.
  - **No draw:** If the match is not drawn, your wager will be graded a winner.

- **Odd or Even**
  This option allows you to wager on whether a score will be an odd or even number. All such wagers are based on total point scores (as opposed to a set, map, or frame score), unless specifically indicated otherwise.
  Full match odd/even tennis wagers refer to the total number of games won, unless specifically indicated otherwise.

- **Exact Total**
  This option allows you to predict what the exact total will be by adding both teams’ final score together. Your betting options will be:
  - **Exactly ’N’:** Predicting that final scores added together will be ’N’.
  - **Anything but ’N’:** Predicting that the final scores added together will not be ’N’.

- **Exact Team Total**
  This option allows you to predict what the exact total will be at the end of the game/period for a specific team. Your betting options will be:
  - **Exactly ’N’:** Predicting that the score of your team will be exactly ’N’.
  - **Anything but ’N’:** Predicting that the score of your team will not be ’N’.

- **To Qualify / To Win Series / Lift the cup**
  These are wagers on a certain team to advance to the next round of a specific competition, or, to win the competition and lift the cup. Wagers are graded after the referee’s final whistle, including extra time and Penalty Shootouts if applicable. The outcome of the wager will be a win if the team you chose to wager on qualifies to the next stage of the competition being played or if they win the competition completely. If the team you chose wins the match, but does not advance to the next stage of the competition, or win the cup, the wager will be a loss.

- **Exact Margin**
  Wager on a side to win by the exact amount of points specified in the wager.

- **Half Time/Full Time**
  This is a combination wager, where you choose both the outcome of the 1st half and the outcome after the end of the game. Please check the market description carefully to determine whether or not the wager includes overtime.

- **Correct Score**
  This is a wager on the exact final score for both teams.

- **Race To**
  This is a wager on which team will first reach or exceed a specified number of whatever unit is specified in the wager (e.g., goals, points, soccer corner kicks, etc.) Please check the market description carefully to determine whether or not the wager includes overtime.

- **First to Score**
  This is a 2-way wager on which first team to score in the match. If neither team scores, the wager will be refunded.

- **Will there be a Draw ?**
  This is a 2-way wager on whether the final result of the match or the specified period will be a draw.

- **Team X Win No Bet**
  This is a 2-way wager on whether the match will draw or the team specified in the wager selection will win. If Team X (the team specified in the bet header) wins then the wager is no action.

- **Will there be an own goal ?**
  This is a wager on whether either team will score an own goal. Regulation time only, unless otherwise specified.

- **Win to Nil**
  This is a wager on whether the selected team will win the event without any score by the opposing team. In the case of a draw, “No” is the winner.

- **Highest Scoring Half Or Period**
  This is a wager based on the highest amount scored in each of the halves or periods. If there is a “tie” or a “multiple periods the same” wagering option provided, then unless you have chosen that option, your bet will be a loser under such circumstances. Please check the market and sport descriptions carefully to determine whether or not the wager includes overtime.

- **First Score Method**
  This is a wager on the method of the first score of the game. In the event of no score, wager will be voided.

- **Will there be Overtime / Extra Innings ?**
  This is a wager on whether or not a particular game will go to overtime or extra innings.

- **Total Touchdowns (Football)**
  This is a wager based on the total number of touchdowns scored during the specified period.

- **Will There Be a Safety? (Football)**
  This is a wager on whether or not a safety will be scored.

- **Either Team to Score 3 Unanswered Times**
  This is a wager on whether or not either team will score three or more consecutive times (on football, this excludes points after touchdown and two-point conversions).

- **Longest / Shortest Touchdown / Field Goal (Football)**
  These are over/under wagers on the distance of the longest / shortest touchdown / field goal scored. If no such score is made, all wagers will be voided.

- **Special Teams or Defensive Touchdown (Football)**
  This is a wager on whether or not a touchdown will be scored by a team’s special teams or defensive touchdown.

- **Total Field Goals (Football)**
  This is a wager based on the total amount of field goals scored during the specified period.

- **2-Ball / 3-Ball 18 Hole Match-Ups (Golf)**
  This wager type is a match-up between two or three players over 18 holes. The players will not necessarily tee off together and there is no such requirement for the wager to have action. However should any of the players in the group not tee off at all, all wagers will be cancelled.

- **Leader After Round (Golf)**
  The winner will be the player with the best overall aggregate score at the end of the round.

- **Corners Result (Soccer)**
  This is a 3-way wager on the team predicted to take the most corner kicks in a soccer match.

- **Total Corners (Soccer)**
  This is an over/under wager on the total number of corners taken by both teams in a soccer match.

- **Corners Handicap (Soccer)**
  This is a handicap wager on the number of corners taken by each team.

- **First Corner of the Match (Soccer)**
  This is a 2-way wager on which team will take the first corner of the match.

- **To Keep a Clean Sheet (Soccer)**
  This is a 2-way wager on whether the specified team will allow a goal.

- **Total Cards (Soccer)**
  For settlement purposes, bets referring to the total number of cards shown by the referee will be counted as follows:
  Second yellows are ignored for settlement purposes (e.g. maximum card count per player is 3).Cards shown to non-players (e.g manager, substitutes, or substituted players who play no subsequent part in the game) do not count towards total.
  - Yellow card = 1
  - Red card = 2
  - 2 or more cards = 3

- **Outright Winner / Top Players / Top Nationality Players**
  This is a wager on the winner or top winners of a particular competition or tournament (or on the winner within a particular subset, such as nationality, of the competition or tournament). Results are determined by the official results on the day the competition completes. Later disqualifications or amendments will not be considered. Dead heat rules apply.

- **Player Props**
  This is a wager based on statistics for a specific player. The player must play (although not necessarily start) for wagers to have action. For Baseball and Prematch Soccer the player must start for wagers to have action. For Live Soccer the player must play for action. Player props offered include:
  1. First / Last / Anytime Player to Score
This is a wager on whether or not a particular player will score first, last or anytime during the game. Quarterbacks or any player that score an official passing TD do not count for grading purposes.
  2. Player Total Rush + Rec Yards (Football)
This wager is on whether a particular player’s rushing yards plus receiving yards will go over or under the given total.
  3. Player Double Double / Triple Double (Basketball)
This is a wager on whether or not a particular player will score a “double double” or a “triple double”.

A double double (or triple double) is defined as reaching double digits (i.e., ten or more) in two (three for a triple double) of the following five statistical categories: points, rebounds, assists, steals, and blocked shots.
  4. Player to Score First Basket (Basketball)
The market is settled on the player who scores the first Basket. Free Throws do count for settlement purposes.
  5. Player to be Booked (Soccer)
Both yellow and red cards counts towards the settlement of this market.

- 10 Minute
  - Score must happen between 0:00 and 09:59

- **X Minute**
  This rule applies to any given X minute market. To find the exact second a market opens and closes, use this standard formula:
  Start Time: Minute X : 00
  End Time: (Minute Y minus 1) : 59.
  For example in a 60 Minute market, the score must happen between 0:00 and 59:59.


---

## Wagering Options

- **Straight**
  This is a single wager on one of the wager types listed above.

- **Parlays**
  This wager option combines multiple straight bets into a single wager such that for the parlay to win the stated amount, all components bets must also win.
  If any component bets push (or are canceled) then those bets are excluded when calculating the final payout.
  A parlay could also be a net winner of a lesser amount if the only losing parlay legs were partial losers and did not result in a complete loss of stake (e.g., half losers on quarter or three-quarter point handicaps or totals, or after some dead heat adjustments).
  The percentage returns on each component bet of the parlay are multiplied together to determine the final payout.
  Any push in a parlay with 3 teams or more will go to the next lowest number of teams. A push in a 2 team parlay will result in a straight wager.

- **Teasers and Pleasers**
  A teaser is a special kind of parlay bet where the player can adjust the point spread or the total points (over/under) in their favor for multiple all parlay legs. By shifting the point spread or totals, the player increases their chances of winning the teaser. However, this advantage comes with the trade-off of receiving lower potential payouts.
  On the other hand, a pleaser is the opposite of a teaser. In a pleaser, the player moves the point spread or totals against their favor, making it harder to win. But if they do win, they get a higher payout due to the increased odds.
  In simple terms:
  * Teasers adjust lines to make it easier to win, but at the cost of lower payouts.
  * Pleasers adjust lines to make it harder to win, but with the benefit of higher payouts.

- **Round Robins**
  This option combines multiple combinations of the component legs of a parlay or teaser into a single wager.
  The player chooses between 2 and 15 selections and the desired parlay sizes that are created from the selection.
  For example, a player could make 8 selections and then combine them into parlays of sizes 2, 4, 7, and 8.
  In addition to parlays, round robins may also include straight bets.

- **Cash Outs**
  Alternative to get funds back from a bet at any point during the event wagered on, based on the current odds.
  This option is restricted on all contests and multi-way exotic betting.


---

## By Sport

### australian rules (`australian-rules`)

- Bets on matches are accepted on:
  - Regular time including overtime (OT).
- We aren't liable for any match duration discrepancies. Date and time of the beginning of an event given in the “Sports” and “Live” sections are approximate. All match regulations are to be specified using official sources.
- If a match is abandoned before 80 minutes are played, all bets on that match are void, except for those bets of which the outcome have been determined at the moment of a match interruption.
- If a match venue is changed then bets already placed will stand provided that the home team is still designated as such.
- A goal (6 points) is scored when a football is propelled through the goal posts by a way of kick from the attacking team without touching any other player. The attacking team is awarded 6 points.
- A behind (1 point) is scored when the football is propelled between a goal post and a behind post or if the ball hits a goal post and passes through.

### badminton (`badminton`)

- All bets will be void if a match has not been completed due to a player's retirement or disqualification.

### bandy (`bandy`)

- All markets are based on the result at the end of regulation time, unless specifically detailed otherwise.

### baseball (`baseball`)

- Full game and second half wagers include extra innings, unless otherwise specified.
- Prematch moneyline wagers will have action after five innings of play (four and a half if the home team is winning). If a game is canceled or called early, the winner is determined by the score after the last full inning of play. If the home team scores to tie or takes the lead in the bottom half of the inning, the winner is then determined by the score at the time the game is canceled. Please note that this applies only to prematch and NOT to live betting.**
- For all other full game wagers, the scheduled number of innings must be played for action. If these conditions are not met, all full game wagers will be void, unless the outcome of the market has already been unambiguously determined (see section 2.1.3 for more information).
- If the event is interrupted before the 5th inning is completed, and/or four and a half if the home team is winning, all wagers will be void (Please note that this applies only to prematch and NOT to live betting.)
- For all single inning and 1st 5 inning wagers, the specified inning(s) must be played to completion for the wager to have action.
- When wagering on MLB full game moneylines wagers may optionally be placed specifying that either or both listed pitchers must start for the wager to have action.
  - List One Pitcher: If the listed pitcher specified on the wager does not start the game, the wager will be settled as No Action.
  - List Both Pitchers: If either of the listed pitchers specified on the wager does not start the game, the wager will be settled as No Action.
  - Action: Regardless of whether or not either of the listed pitchers specified on the wager start the game, the wager will have action.
- Prematch wagers on MLB moneylines, run lines, totals, and team totals for the full game, first half, and first inning are always on listed pitchers (with the exception of full game moneylines as described in 5.1.5 above). If the listed pitcher does not start, the wager will be settled as No Action.
- MLB postseason games (Wild Card, Divisional Series, Championship Series, World Series) are not considered official until a winner is declared. If a postseason game begins and then is delayed to a later date, all wagers will have action with the final score being graded as the official result.
- MLB Regular Season Series: Wagers on baseball series are based on the first three games played of each series. At least two of the first three series games must be played for wagers to have action. A called game will count toward a series wager provided it is officially declared a regulation game.
- Games ending early as a result of a mercy rule will still have action.

### basketball (`basketball`)

- If the match venue is changed, wagers will stand provided that the original home team remains designated as such. If the home team and the away team are flipped, then wagers on the original listing will be graded as NO ACTION.
- Only statistics and scores recorded on the official league website on the day of the game will be counted for settlement purposes. Subsequent amendments do not count.
- Game lines and 2nd half wagers include overtime unless stated otherwise. 4th quarter wagers exclude overtime unless stated otherwise.
- For prematch wagering purposes the game must go at least 43 minutes of play for NBA and 35 minutes of play for College and International Basketball. Please note that this applies only to prematch and NOT to live betting.

### beach volleyball (`beach-volleyball`)

- In the event of a match starting but not being completed, all bets are void, except for those markets which have been settled.

### chess (`chess`)

- Match results will be settled based on the result of all games comprising that match.
- In the event of a match starting but not being completed, bets will be void unless the outcome has already been determined.

### cricket (`cricket`)

- Match Winner:
  - If an event is terminated early due to weather, then the match winner, if any, will be determined by official contest rules.
  - Should an event be officially declared a draw, 2-way wagers will be graded No Action.
  - In competitions where a bowl out or super over determines a winner then bets will be settled on the official result.
- **Total Runs in Match:**
  The following number of Overs must be completed for wagers on totals that have not already gone over to have action:
  - Twenty20 Matches: the full 20 overs for each team.
  - One Day Matches: at least 40 overs for each team.
  - Test Cricket: at least 50 overs for each team.
- **Total Runs in Over:**
  If the Over is terminated early due to inclement weather, all wagers that have not already gone over will be deemed no action.
- **Odd or Even Runs in Over:**
  If the Over is terminated early due to inclement weather, all wagers will be deemed no action.
- If an event is postponed by fewer than 24 hours or interrupted and resumed within 24 hours wagers will have action.

### curling (`curling`)

- All matches will be settled on the final score. For betting purposes extra ends will count.

### cycling (`cycling`)

- If a tournament is affected by weather, bets will be settled as long as a tournament winner has been declared.
- In 2 way lines (head to head) both cyclists must start for action.

### darts (`darts`)

- Both competitors must start and must complete the match for bets to stand. If either competitor fails to complete the match, bets are void.

### Fighting (`boxing`)

- A fight is defined as having started once the bell is sounded for the beginning of the first round.
- In the event of a no contest being declared, or a fight being abandoned for any reason before the completion of the contest, all bets will be void. If the result of the market has already been determined, bets will be settled according to the result.
- If the number of rounds has been changed, the bets on the outcome of the fight will stand and the bets on the number of rounds will be void.
- The *Duration of the fight* bet is designated in the Sports line as *Total rounds*. To win this bet it is necessary to predict the number of rounds in a fight. The round in which the outcome of a bout is determined (i.e. when a bout is finished) is also taken into account when calculating the number of rounds.
- In case a boxer does not come out after a gong has rung a new round, it is considered that the match is finished in the previous round.
- The *Victory of the first (second) sportsman* bet. It is designated in the Sports line as 1 (2) and includes the following items:
  - Victory on the points
  - Victory by a knock-out
  - Victory by a technical knockout
  - Disqualification of the opponent or his refusal during the fight
- The *Draw* bet. It is designated in the Sports line as X, it is determined by a decision of judges if the number of points scored by boxers is equal when all rounds of the bout are over.
- The *Victory on the points* bet. The winner is determined by the judge's decision when all rounds are over.
- The *Win inside distance* bet. It includes knockout, technical knockout, and disqualification of an opponent or his refusal during a bout.
- The *Win 2 in 3rd Round* bet. The bet will be calculated as a win if the second wins by KO in the 3rd round.
- The *Bout Ends In 10-12 Rounds* bet. This bet will be calculated as a win if the boxer wins by KO from 10 to 12 Round.
- Total Rounds. For settlement purposes a half round on a total refers to an official round time up to but not including 1 minute and 30 seconds (2 minutes and 30 seconds for MMA) for the under and 1 minute 30 seconds (2 minutes and 31 seconds for MMA) or later for the over.

### E-Sports (`e-sports`)

- Unless otherwise stated, all bets are settled on the official result of the match, including any additional rounds, with the exception of e-soccer where the results are based on Regulation + Injury time.
- If a match is interrupted due to one or more competitors failing to continue or being disqualified, bets on all markets will be void unless the market has already been determined.
- Unless otherwise indicated each team must start the match with a full contingent of players.
- ****Simulated NFL (Played with Madden 2020)****
  Games will be played on All-Pro difficulty with 8 minute quarters. 20 second accelerated clock. Weather conditions are clear unless otherwise noted.
  Wagers still have action even if there are problems with the Twitch (or any other) stream.
- ****Simulated NBA (played with NBA 2K)****
  Games will be played CPU vs. CPU with 12 minute quarters and realistic settings.
  Wagers still have action even if there are problems with the Twitch (or any other) stream.

### floorball (`floorball`)

- All markets are based on the result at the end of regulation time, unless specifically detailed otherwise.

### football (`football`)

- All game and second half lines include overtime unless stated otherwise. Fourth quarter lines exclude overtime. For prematch wagering purposes if play is suspended before the completion of 55 minutes and not resumed the same day all bets on unsettled markets will be graded as NO ACTION.
- Prematch: Bets will no longer have action when an event is postponed and rescheduled for a later calendar day (after midnight in the local time zone where the event is played).
  Live Betting: If the event is not resumed within the next 24 hours, wagers will be void, except bets where the outcome has already been unambiguously determined (for example, if the score has already surpassed the total, then all bets on that over and under will be settled as winners and losers, respectively).
- When the Mercy Rule and Shortened game is applied in live betting, wagers will be settled with the official final score determined at the venue.
- If the match venue is changed, wagers will have no action.
- Only statistics and scores recorded on the official league website on the day of the game will be counted for settlement purposes. Subsequent amendments do not count.
- **NFL Draft**
  Draft details listed on www.nfl.com will be used for settlement purposes, including official draft orders and player positions published. For the purpose of over/under markets, undrafted players will be assigned a number, one above that of the last draft pick.
- **Player Props / Performances**
  Bets are action if the player competes in one Down (with the exception of Quarterbacks who must start and for any receiving prop that player must be at least in one offensive snap for action). Player match-ups are action if both players compete in one Down. Push rules apply. Markets will be settled according to game stats from the respective official competition site published on the day of the game. Subsequent amendments do not affect settlement.
- **Multiple selection player props**
  Wagers will have action if player participates in at least one play, if the prop is for an offensive stat must play in an offensive play, the same for Defensive and Special teams. The exception to this is Player Kicking Points/Longest Punt that are action if player is active/dressed.
- **Regular Season Futures**
  Unless stated otherwise, for NFL regular season Team markets (including Regular Season Wins) to have action, teams must complete all 17 regular season games, and for CFL all 18 regular season games, unless the remaining games during the course of the season do not affect the result.
  NFL / CFL Divisional winners are determined by games won during the regular season (NFL tie-breaker rules apply)
  AFC/NFC Conference winners are determined by the team progressing to the Superbowl. NCAAF regular season wins are based on all teams listed, playing their full schedule; unless the remaining games during the course of the season do not affect the result.
- **Season Player Awards**
  The winner is deemed the player who receives the Associated Press award for the respective category. Bets are placed on an all-in basis. Dead heat rules apply.
- **Passing Yards Markets (Most, total, longest)**
  For settlement purposes, the complete amount of yards thrown (gross) are included.
- **Rushing Yards Markets (Most, total, longest)**
  Settlement is based on the total rushing yards gained (includes negative yardage).
- **Team to Punt First**
  If there is no punt in the game, bets will be voided.
- **First Offensive Player Pass/Run**
  This market is determined by the first offensive play from scrimmage (excluding Penalties). In the event of the kick-off being returned for a touchdown then bets will stand for the following kick-off. Incomplete or intercepted passes and QB Sack or Fumble will stand as a Pass Play. A fumble on exchange to the RB will stand as a Run Play.
- **Team to call 1st timeout**
  Forecast which team will call the 1st timeout. Timeouts lost by any other means, e.g Coaches Challenges, Injuries etc, do not count.
- **Team to Commit First Accepted Penalty / Total Penalties Accepted**
  Markets are based on the Penalty being accepted. Declined Penalties do not count.
- **Total Turnovers / Player Total Turnovers**
  For settling purposes, the Turnover on Downs (failed 4th Down attempts) are included.
- **To Reach (or not) Playoffs**
  NCAAF to Make Playoffs - Winners are the 4 teams who qualify for the Championship Semi-Final games.

### futsal (`futsal`)

- All markets are based on the result at the end of regulation time, unless specifically detailed otherwise.

### golf (`golf`)

- Final leaderboard positions are determined by first considering the highest number of holes completed and then considering the lowest stroke total over those holes. This means that a player who has completed more holes than another will always be ranked higher on the leaderboard than a player who has completed fewer.
- The outright tournament winner and any other applicable market such as tournament matchups are determined by the player awarded the trophy, which takes into account the result of any playoff holes.
- If an outright winner, or player to finish in the top X market, or leader after round ends in a tie that is not resolved by a playoff, dead heat rules will apply.
- Once a player has teed off, all bets on that player will be deemed to have action.
- If a tournament is played over a shorter format than previously scheduled, bets on the tournament outright winner or outright player markets will be settled on the officially declared result. However, the following bets will be declared void:
  - Correct scores
  - Handicaps
  - Individual player points
  - Winning margins
- Irrespective of any changes to the order of play or format and so long as a result can be determined all bets on correct scores, winning margins, top players, and other markets, based on the conclusion of the tournament.
- Group Betting
  - The winner will be the player achieving the highest placing at the end of the tournament. Any player missing the cut will be considered a loser. If all players miss the cut then the lowest score (or highest points score, for tournaments using the Stableford scoring system) after the cut has been made will determine settlement. Dead-heat rules apply except where the winner is determined by a playoff.
- Round handicap
  - The handicap is applied to the specified players’ Round Scores, with the lowest score being the winner. e.g. Player A +1.5 scores 74, Player B -1.5 scores 75, Player B is settled as the winner once the handicap has been applied.
Bets will be void if either named player in a specified Round Handicap match-up does not complete the Round. Official tour site scores recorded on the day will count for settlement (subsequent disqualification after this time does not count).
- Fourballs
  - Bets stand once both pairings have teed-off the first hole. Official tour site scores recorded on the day will count for settlement (subsequent disqualification after this time does not count).
- Hole Score
  - A player is deemed to have played once they have teed off. In the event of a player withdrawing after having teed off on a specified hole, bets will be settled as ‘Over Par’. If a player withdraws before teeing off on a given hole, bets on that hole will be void. Official tour site scores recorded on the day will count for settlement (subsequent disqualification after this time does not count).
- Round Score
  - Bets will be void if specified groups of holes are not completed, unless settlement is already determined. Official tour site scores recorded on the day will count for settlement (subsequent disqualification after this time does not count).
- To Win Hole
  - Bets stand once all nominated players tee-off the designated hole. If a player subsequently withdraws during the hole then bets on that player will be settled as a loser. Official tour site scores recorded on the day will count for settlement (subsequent disqualification after this time does not count).
- Highest / Lowest Scoring Team
  - Dead-heat rules apply. Official tour site scores recorded on the day will count for settlement (subsequent disqualification after this time does not count).
- Foursomes
  - Bets stand once both pairings have teed-off the first hole.
- Correct Score
  - All scheduled matches must be completed in full for bets to stand regardless if matches are carried over.
- Top Points / Team / Nationality
  - Markets will be settled on the whole tournament. Dead-heat rules apply. Bets will stand once the player has teed-off.
- To Hit Fairway with Teeshot
  - This market is settled on the finishing position of the golf ball after the tee shot. Official sources will be used for settlement. If no official result can be determined via these sources or TV pictures, bets will be void.
- Will There Be A Hole In One
  - Relates to a hole in one being recorded in the designated Rounds of a specified tournament. In the event of adverse weather affecting the tournament then bets will stand as long as a minimum of 36 holes of a tournament are played. In the event of a hole in one being recorded, but 36 holes not being played then the Yes option - To Make a Hole in One - will be deemed the winner.
- To Make Cut
  - A tournament cut must be applied for bets to stand. In the case of a Tournament where a multiple cut system is in place, settlement will be defined by a player playing or not playing in the next Round following the 1st official cut.

### handball (`handball`)

- All markets are based on the result at the end of regulation time, unless specifically detailed otherwise.

### hockey (`hockey`)

- Full match and period markets INCLUDE overtime and shootouts.
- Regulation time only markets EXCLUDE overtime and shootouts.
- The winner of a shootout will be awarded 1 goal regardless of the final shootout score. Goals scored during overtime are included for wagers on the game, but are not included on wagers for the 3rd period.
- For NHL and NCAA the game becomes official (action) after 55 minutes of play. Please note that this applies only to prematch and NOT to live betting.
- Player prop markets Include Overtime but exclude Shootouts unless stated otherwise.

### horse racing (`horse-racing`)

- If a race is canceled, all bets on this race will be deemed void. If a race is postponed to a later time on the same day, all bets will stand.
- All outright bets are settled according to the official site results at the end of each race. Disqualifications after this time do not count.

### lacrosse (`lacrosse`)

- Games must go full 60 minutes for bets to have action. Overtime is included unless stated otherwise.

### motor racing (`motor-racing`)

- In the instance of a race or qualifier postponement for any reason, all wagers will be upheld for a period of 48 hours. Following this timeframe, all bets will be canceled, and the funds will be returned.
- For 2 way lines (head to head) both drivers must start for action.
- **Formula 1:** Bets on the top driver for the season are settled based on the official Drivers' Championship standings as specified by the FIA. A minimum of 16 races must take place during the season for bets to stand.

### rugby (`rugby`)

- All markets are based on the result at the end of regulation time, unless specifically detailed otherwise.
- Full game and 2nd half wagers on events that do not reach the end of regulation time will be deemed no action.
- 1st half wagers on events that do not reach break time will be deemed no action.

### snooker (`snooker`)

- Both competitors must start and must complete the match for bets to stand. If either competitor fails to complete the match, bets are void.

### soccer (`soccer`)

- Full match and 2nd half wagers are based on the results of regulation time only, unless specifically detailed otherwise.
- 1st half wagers on events that do not reach break time will be deemed no action.
- If a match is finished early, abandoned, or is interrupted or postponed, all unsettled markets will be void unless the match has reached the 85th minute in which case all markets will have action as normal. In the case of games that are previously scheduled to last less than 90 minutes of regulation time, all wagers will have action when the game is completed.
- For Goalscorer markets: goals scored in 90 minutes + injury time count. Goals in extra-time, own goals, and penalty shootout goals do not count.
- Player markets: Fouls Committed and Fouls Won for the match include Extra Time (if played) for settlement purposes.
- All bets on World Cup, Euro Cup and Copa America Fixtures have action as long as the Fixture is completed within 72 hours of when it was originally scheduled to play.

### table tennis (`table-tennis`)

- If a match is interrupted or postponed and not resumed within 24 hours, all unsettled markets will be void.
- Spreads and totals are specified in terms of points, unless stated otherwise.

### tennis (`tennis`)

- **Survival of Wagers**
  Wagers will still have action under the following circumstances:
  - A change of venue.
  - A change of surface, either before or during the match.
  - A change from indoor court to outdoor court (or vice-versa).
  - A change of the scheduled time or day of the match.
  - All set wagers on fully completed sets on retirements.
- **Cancellation of Wagers**
  Wagers on unsettled markets will be void under the following circumstances:
  - For Prematch in the case of a player retires or is disqualified bets on the Match moneyline will have action as long as the first set is completed, otherwise bets will be void. Bets on other markets will have action only if the specific period was completed before retirement or disqualification. For Live Betting match must be completed for ML to have action.
- If an event is postponed by fewer than 24 hours or interrupted and resumed within 24 hours wagers will have action.
- **Tie Break**
  The winner of a tie break set will be awarded a single game for the purposes of grading game handicap and game total markets.

### volleyball (`volleyball`)

- In the event of a match starting but not being completed, all bets are void, except for those markets which have been settled.
- Spreads, totals are specified in points, unless stated otherwise.

### waterpolo (`water-polo`)

- All markets are based on the result at the end of regulation time, unless specifically detailed otherwise.


---

## Tennis — desk cheat sheet (lines & movement)

### Match moneyline matrix

| Phase | Before set 1 complete | After set 1 · match unfinished | Match completed |
| ----- | --------------------- | ------------------------------ | --------------- |
| **Prematch ticket** | **Void** on retire/DQ | **Action** (progressor) | Action |
| **Live ticket** | **Void** (match incomplete) | **Void** (match incomplete) | Action |

### Other markets

| Market | Stands when |
| ------ | ----------- |
| Set winner / set props | That set completed before stop |
| Game props | That game completed |
| Completed set wagers after later retirement | **Action** (survival) |
| Game handicap / game total | Tie-break set = **+1 game** to TB winner |

### Worked void/EV sketch

Live ML on favorite, injury rumor mid–set 2, score 1–0 sets:

1. Under **live** rules, retirement → **void**, not auto-win for underdog.
2. Market may still shorten favorite (recreational flow) while `p_void` rises.
3. Desk should quote **three-way** outcome (win / lose / void), not two-way.

Prematch ML same score state:

1. First set already complete → retirement grades **progressor**.
2. Move is mostly true `p_win` / path length, not void.

---

## Related repo docs

| Doc | Role |
| --- | ---- |
| [FANTASY-ULTRA.md](FANTASY-ULTRA.md) | Book adapter + live products |
| [INVENTORY.md](INVENTORY.md) | plive/ezlive inventory shell |
| [SEAT-OPS.md](SEAT-OPS.md) | Seat capacity / execution |
| [KIMI_DISCOVERY_MAP.md](KIMI_DISCOVERY_MAP.md) | Kalshi ITF (different venue) |

## Re-pull

```bash
curl -sL -A 'Mozilla/5.0' 'https://plive.sportswidgets.pro/live/' -o /tmp/plive-live.html
# Extract LANGUAGES[en].rules.tabs → docs/artifacts/plive-ezlive-sports-rules.json
# Refresh weighting.sports keys if sport text changes
```

### Integrity check after re-pull

- [ ] Tennis still splits **prematch 1st set** vs **live full match**
- [ ] Soccer abandon still cites **85** minutes
- [ ] Basketball OT flags (game/2H vs Q4) unchanged
- [ ] Baseball 5-inning + listed pitchers unchanged
- [ ] Hockey SO = 1 goal + 55′ prematch note unchanged

