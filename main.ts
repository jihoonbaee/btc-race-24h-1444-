// Breakout rider: a long-only 1-minute CBBTC/USDC trend bot.
//
// Strategy (all BigInt arithmetic, fully deterministic):
//   * Wait until 240 closes of history exist, then only trade while the latest
//     close is above the 240-bar simple moving average (the 4-hour trend
//     filter). A flat, choppy market keeps the bot in cash.
//   * Entry: the latest close breaks above the highest high of the last 45
//     bars (a 45-minute Donchian breakout) while above the SMA. Buy with all
//     cash, up to the weight cap. One position at a time.
//   * Exit in two stages:
//       - Take-profit: once the position is worth at least 180 bps over its
//         cost (fees included), sell half of it.
//       - Trailing stop: once the close falls 80 bps or more below the highest
//         close seen since entry, sell the rest.
//   * Everything else is left to the replay: the final flatten at the last
//     close, and the rejection of any order decided on the last batch.
//
// Why this shape: a full-size round trip costs about 26-36 bps (4 bps fee
// each way, 2 bps slippage each way, plus constant-product impact against a
// ~$0.8-1.0M deep pool), so the bot only trades when a move of a few hundred
// bps is plausibly in progress. The 45-minute breakout plus the 4-hour trend
// filter kept it out of the dev window's choppy grind and let it ride the one
// real multi-hour rally; the two-stage exit banks part of a strong leg early
// and lets the rest run under a trailing stop.
//
// Only the standard library and the kit's vendored SDK shim are used.

import { runBars, type BarsState, type Batch, type BuyInput, type OrderInput, type SellInput } from './vendor/makefun-bars.ts';

// --- Strategy parameters (bars are 1 minute) ---
/** Donchian breakout window: highest high of the last N bars. */
const BREAKOUT_BARS = 45;
/** Trend filter: latest close must be above the N-bar SMA. */
const SMA_BARS = 240;
/** Sell half once the position is this far over its cost, in bps. */
const TAKE_PROFIT_BPS = 180n;
/** Sell the rest once the close is this far under its peak, in bps. */
const TRAIL_BPS = 80n;
/** 1% past the close the order was decided on. */
const MAX_SLIPPAGE_BPS = 100;

const BPS = 10000n;

let symbol = '';
/** Closes and highs as bigints, in bar order. */
const closes: bigint[] = [];
const highs: bigint[] = [];
/** Highest close seen since the current entry. */
let peakClose = 0n;
/** Whether the take-profit half-sale already happened for this entry. */
let halfSold = false;
/** Whether a position was held on the previous batch. */
let wasHolding = false;

/** Integer mean of the last n closes. */
function sma(n: number): bigint {
  const window = closes.slice(-n);
  let sum = 0n;
  for (const c of window) sum += c;
  return sum / BigInt(window.length);
}

/** Highest high of the N bars before the latest one (the latest bar's own
 *  high can never be beaten by its close, so it is left out). */
function highestHighBefore(n: number): bigint {
  const window = highs.slice(-n - 1, -1);
  let best = 0n;
  for (const h of window) if (h > best) best = h;
  return best;
}

await runBars({
  onHello(state: BarsState): void {
    symbol = state.hello.symbols[0].symbol;
  },

  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    for (const bar of batch.bars) {
      if (bar.symbol === symbol) {
        closes.push(BigInt(bar.c));
        highs.push(BigInt(bar.h));
      }
    }
    if (state.warmingUp) return [];
    if (closes.length < SMA_BARS) return [];

    const close = closes[closes.length - 1];
    const held = state.positions.get(symbol);

    if (held === undefined) {
      wasHolding = false;
      // Flat: look for a breakout above the 4-hour trend.
      if (close > highestHighBefore(BREAKOUT_BARS) && close > sma(SMA_BARS)) {
        let spend = state.cash;
        const room = state.weightRoom(symbol);
        if (room < spend) spend = room;
        if (spend < BigInt(state.hello.fees.min_notional_quote_units)) return [];
        const buy: BuyInput = { side: 'buy', symbol, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [buy];
      }
      return [];
    }

    // Holding: maintain the trailing peak and the two-stage exit.
    // A position that only just appeared (its buy filled on this batch)
    // starts its peak at this close and has not sold half yet.
    if (!wasHolding) {
      peakClose = close;
      halfSold = false;
      wasHolding = true;
    }
    if (close > peakClose) peakClose = close;
    const value = state.value(symbol, held.qty);
    const cost = held.cost;

    if (!halfSold && value * BPS >= cost * (BPS + TAKE_PROFIT_BPS)) {
      halfSold = true;
      const half = held.qty / 2n;
      if (half > 0n) {
        const sell: SellInput = { side: 'sell', symbol, qty: half, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [sell];
      }
      return [];
    }

    if (close * BPS <= peakClose * (BPS - TRAIL_BPS)) {
      const sell: SellInput = { side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
      return [sell];
    }
    return [];
  },
});
