'use strict';

/*
 * Contract vocabulary shared by the engine tests.
 *
 * Each list is ordered from the preferred name to tolerant aliases. A module
 * that exists but exposes none of the names in a list is a contract FAILURE,
 * not a SKIP: missing module = future work; wrong module = merge blocker.
 */

import { instantiate } from './probe.mjs';

export const AUDIO = {
  factory: ['createAudioManager', 'createAudio', 'AudioManager', 'audioManager'],
  init: ['init', 'initialize', 'ensureContext', '_ensureContext'],
  unlock: ['unlock', 'resume'],
  play: ['play', 'playSound', 'playSfx', 'playEffect'],
  mute: ['setMuted', 'setMute', 'mute'],
  volume: ['setVolume', 'setMasterVolume', 'volume'],
  isMuted: ['isMuted', 'muted', 'getMuted'],
  disable: ['setEnabled', 'setDisabled', 'disable', 'setSoundEnabled'],
  dispose: ['dispose', 'destroy', 'close']
};

export const PHYSICS = {
  collide: ['aabbOverlap', 'aabbIntersects', 'rectsOverlap', 'rectOverlap', 'collides', 'overlaps'],
  circle: ['circleRectOverlap', 'circleRectCollide', 'circleRect', 'circleAabbCircle', 'circleIntersects'],
  point: ['pointInRect', 'pointInRect2D', 'pointInsideRect', 'pointInAabb'],
  dealAnimation: ['createDealAnimation', 'DealAnimation', 'createDealState', 'dealAnimation', 'dealPlan'],
  move: ['moveCharacter', 'stepCharacter', 'integrateMovement', 'moveEntity', 'stepBody', 'createWorld', 'World']
};

export const CARD_BATTLE = {
  create: ['createBattle', 'createGame', 'newGame', 'createMatch'],
  draw: ['drawCard', 'draw'],
  play: ['playCard', 'play'],
  attachEnergy: ['attachEnergy', 'playEnergy', 'attach'],
  attack: ['attack', 'useAttack', 'declareAttack'],
  resolve: ['resolveAttack', 'resolve'],
  knockOut: ['knockOut', 'checkKnockOut', 'applyDamage'],
  prize: ['takePrize', 'takePrizeCard', 'awardPrize'],
  endTurn: ['endTurn', 'nextTurn', 'passTurn'],
  legal: ['legalActions', 'getLegalActions'],
  state: ['getState', 'state', 'snapshot', 'summarize']
};

export const ROOMS = {
  store: ['createRoomStore', 'createRoomService'],
  create: ['createRoom', 'roomCreate'],
  join: ['joinRoom', 'roomJoin'],
  leave: ['leaveRoom', 'roomLeave', 'kick', 'close'],
  reconnect: ['reconnectRoom', 'reconnect', 'resumeSession', 'verifyInvite'],
  password: ['verifyRoomPassword', 'verifyPassword', 'checkPassword'],
  voice: ['createVoiceChannel', 'voiceChannel', 'voice'],
  auth: ['authorizeVoice', 'canUseVoice', 'authorize']
};

export const MAHJONG = {
  wall: ['createWall', 'buildWall', 'makeWall'],
  kinds: ['TILE_KINDS', 'TILE_TYPES', 'KINDS'],
  deal: ['dealHands', 'deal', 'initialDeal', 'createGame', 'startRound'],
  draw: ['drawTile', 'draw'],
  discard: ['discardTile', 'discard'],
  win: ['canWin', 'isWinningHand', 'checkWin', 'isWin'],
  yaku: ['evaluateHand', 'scoreHand', 'detectYaku', 'yaku']
};

export const RETENTION = {
  config: ['createRetentionConfig', 'retentionConfig', 'DEFAULT_RETENTION', 'getRetentionConfig'],
  daily: ['recordDailyLogin', 'claimDaily', 'recordLogin', 'dailyCheckIn'],
  streak: ['updateStreak', 'recordStreak', 'getStreak', 'streak'],
  points: ['addPoints', 'awardPoints', 'getPoints', 'pointsFor'],
  level: ['levelForPoints', 'rankFor', 'getLevel', 'levelFor'],
  trophies: ['awardTrophy', 'trophiesFor', 'getTrophies', 'awardTrophies'],
  share: ['buildSharePayload', 'createSharePayload', 'sharePayload'],
  leaderboard: ['getLeaderboard', 'leaderboard', 'submitScore'],
  deviceId: ['getDeviceId', 'ensureDeviceId', 'deviceId'],
  antiCheat: ['validateScore', 'validateResult', 'checkRateLimit', 'sanitizeScore']
};

export const DSH = {
  activate: ['activate', 'onActivate', 'register'],
  deactivate: ['deactivate', 'onDeactivate', 'unregister'],
  invoke: ['invoke', 'callTool', 'handle', 'dispatch'],
  tools: ['tools', 'listTools', 'getTools']
};

export function buildManager(exported, options) {
  return instantiate(exported, options || {});
}

/*
 * Call a possibly-async function and await the result.
 * Kept here so every contract test normalises sync/async implementations.
 */
export async function call(fn, thisArg, args) {
  return await fn.apply(thisArg, args || []);
}
