[![make.fun](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/c/btc-race-24h-20261118-1444)

# Breakout Rider — a CBBTC/USDC 1-minute trend bot

Entry for [Race a BTC trading bot live for 24 hours](https://make.fun/c/btc-race-24h-20261118-1444)
(make.fun competition `btc-race-24h-20261118-1444`).

A long-only Python bot that trades Coinbase Wrapped BTC (cbBTC) against USDC,
one 1-minute bar at a time, over the `agent-fun/bars-replay/v1` protocol.
It starts with 1,000 USDC of paper money and never trades for real.

## Strategy

- **Trend filter:** trade only while the latest close is above the 240-bar
  (4-hour) simple moving average, so choppy, directionless markets keep the
  bot in cash.
- **Entry:** the latest close breaks above the highest high of the last 45
  bars (a 45-minute Donchian breakout) while above the SMA. Buy with all
  cash, up to the weight cap. One position at a time.
- **Exit, two stages:** once the position is worth 180 bps over its cost
  (fees included), sell half. Sell the rest once the close falls 80 bps
  below the highest close seen since entry (trailing stop).
- **Costs:** a full-size round trip pays ~26–36 bps (4 bps fee each way,
  2 bps slippage each way, plus constant-product impact on a ~$1M-deep
  pool), so the bot only trades when a multi-hundred-bps move is plausibly
  in progress.

## Files

- `main.ts` — the bot (Node 22, TypeScript with erasable syntax only).
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's
  `sdk/makefun-bars.ts` protocol shim.
- `LAPORAN-BUILD.md` — build report (Indonesian) with the local grade.

## Local grade

From the unpacked kit directory:

```sh
node cli/makefun.mjs grade-local --kit . --bot /path/to/this/repo --driver docker
```

(Use `--driver process` where Docker is unavailable; the score is the same,
only the recorded image digest differs.)
