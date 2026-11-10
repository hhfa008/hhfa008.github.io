#!/usr/bin/env node
/* Gate 5/5 — 联机: single-player pages carry a visible 「单人」 badge;
 * multiplayer pages carry room/invite/reconnect/leaderboard + dual-client
 * same-game settlement E2E evidence. Missing evidence => draft. */
import { runGate } from './gate-run.mjs';
runGate('online');
