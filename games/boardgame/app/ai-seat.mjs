/**
 * Shared solo-AI-fill helpers for boardgame online servers.
 *
 * `makeAiStep(engine, applyMove)` returns a function that turns one engine AI
 * decision into the next state. It is IMPORTANT that aiMove-style engines
 * return a move, not a state: we always apply it.
 *
 * `SOLO_AI_FILL` is the single source of truth for "one human may start; empty
 * seats are AI". Servers should pass `minHumanPlayers: SOLO_AI_FILL.minHumanPlayers`
 * instead of hard-coding 2.
 *
 * `startRoomWithAiFill` wraps the app/rooms.js store.start call: the store
 * requires two members, so a solo room is marked playing only in the live room
 * object (the same pattern already used by lost-cities-premium).
 */

export const SOLO_AI_FILL = Object.freeze({ minHumanPlayers: 1 });

export function makeAiStep(engine, applyMove) {
  if (!engine) throw new Error('ai-seat: engine is required');
  const apply = typeof applyMove === 'function'
    ? applyMove
    : (state, move) => engine.applyMove(state, move);
  return function aiStep(state) {
    if (!state || state.over) return state;
    const choose = engine.chooseAIMove || engine.aiMove;
    if (typeof choose !== 'function') {
      throw new Error('ai-seat: engine has no chooseAIMove/aiMove');
    }
    const move = choose(state);
    if (!move) return state;
    return apply(state, move);
  };
}

export function soloAiOptions(engine, applyMove) {
  return {
    minHumanPlayers: SOLO_AI_FILL.minHumanPlayers,
    aiStep: makeAiStep(engine, applyMove),
  };
}

/**
 * Returns a store.start-compatible result. For one human, the room store's
 * two-member requirement is bypassed and the caller marks its live room as
 * playing.
 */
export function startRoomWithAiFill(store, roomId, actorId, humanCount, minHumans) {
  const min = Math.max(1, Number(minHumans == null ? SOLO_AI_FILL.minHumanPlayers : minHumans) || 1);
  if (humanCount < min) {
    return {
      ok: false,
      code: 'E_PLAYERS',
      message: 'need at least ' + min + ' human player' + (min > 1 ? 's' : '') + '; empty seats are AI',
    };
  }
  if (humanCount >= 2) {
    const started = store.start(roomId, actorId);
    if (!started || !started.ok) {
      return started || { ok: false, code: 'E_START', message: 'cannot start' };
    }
    return started;
  }
  return { ok: true, solo: true };
}
