import '../../../shared/rules.js';

const RULES = globalThis.GameRules;
const gomoku = RULES.gomoku;
const connect4 = RULES.connect4;

const MAX_MEMBERS = 4;
const RECONNECT_GRACE_MS = 60 * 1000;

const KINDS = {
  ttt: { label: '井字棋', size: 9, cols: 3, rows: 3 },
  gomoku: { label: '五子棋', size: 225, cols: 15, rows: 15 },
  connect4: { label: '四子棋', size: 42, cols: 7, rows: 6 },
};
const DEFAULT_KIND = 'ttt';

const TTT_WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function cleanName(raw) {
  const s = String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 12);
  return s || '玩家';
}

function cleanPid(raw) {
  return String(raw == null ? '' : raw).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

function isIntIn(v, min, max) {
  return Number.isInteger(v) && v >= min && v <= max;
}

function sortMembers(members) {
  return [...members].sort(
    (a, b) => a.joinedAt - b.joinedAt || String(a.id).localeCompare(String(b.id)),
  );
}

function hostIdOf(members) {
  const s = sortMembers(members);
  return s.length ? s[0].id : null;
}

function seatsOf(members) {
  const s = sortMembers(members);
  return { xId: s[0] ? s[0].id : null, oId: s[1] ? s[1].id : null };
}

function publicMembers(members) {
  const hostId = hostIdOf(members);
  return sortMembers(members).map((m) => ({
    id: m.id,
    name: m.name,
    mic: !!m.mic,
    host: m.id === hostId,
    joinedAt: m.joinedAt,
  }));
}

function kindOf(game) {
  return game && KINDS[game.kind] ? game.kind : DEFAULT_KIND;
}

function emptyGame(kind, seats, round) {
  const spec = KINDS[kind] || KINDS[DEFAULT_KIND];
  return {
    kind: KINDS[kind] ? kind : DEFAULT_KIND,
    board: Array(spec.size).fill(null),
    turn: 'X',
    winner: null,
    line: null,
    xId: seats.xId || null,
    oId: seats.oId || null,
    scores: { X: 0, O: 0 },
    round: round || 1,
    updatedAt: Date.now(),
  };
}

function scoreNum(v) {
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

// Bring stored games (including the pre-multi-game tic-tac-toe shape) into
// the canonical {kind, board:null|'X'|'O', turn:'X'|'O'} form.
function normalizeGameShape(game) {
  if (!game || typeof game !== 'object' || Array.isArray(game)) return null;
  const kind = KINDS[game.kind] ? game.kind : DEFAULT_KIND;
  const spec = KINDS[kind];
  if (!Array.isArray(game.board) || game.board.length !== spec.size) return null;
  const board = game.board.map((v) => (v === 'X' || v === 'O' ? v : null));
  const winner = game.winner === 'X' || game.winner === 'O' ? game.winner
    : game.winner === 'draw' ? 'draw' : null;
  const line = Array.isArray(game.line)
    ? game.line.filter((n) => Number.isInteger(n) && n >= 0 && n < spec.size)
    : null;
  return {
    kind,
    board,
    turn: game.turn === 'O' ? 'O' : 'X',
    winner,
    line: line && line.length ? line : null,
    xId: typeof game.xId === 'string' ? game.xId : null,
    oId: typeof game.oId === 'string' ? game.oId : null,
    scores: {
      X: scoreNum(game.scores && game.scores.X),
      O: scoreNum(game.scores && game.scores.O),
    },
    round: Number.isInteger(game.round) && game.round > 0 ? game.round : 1,
    updatedAt: typeof game.updatedAt === 'number' ? game.updatedAt : Date.now(),
  };
}

function isEmptyBoard(board) {
  return board.every((v) => v == null);
}

function tttWinnerOf(board) {
  for (const line of TTT_WIN_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line };
    }
  }
  return { winner: null, line: null };
}

function toNumericBoard(board) {
  const out = new Uint8Array(board.length);
  for (let i = 0; i < board.length; i++) {
    out[i] = board[i] === 'X' ? 1 : board[i] === 'O' ? 2 : 0;
  }
  return out;
}

function fromNumericBoard(nums) {
  return Array.from(nums, (v) => (v === 1 ? 'X' : v === 2 ? 'O' : null));
}

function stoneCount(board) {
  let n = 0;
  for (const v of board) if (v) n++;
  return n;
}

// A game keeps its seats while a disconnected player is inside the reconnect
// grace window. Only when a seated id has really left the roster do we re-seat.
function alignGame(game, roster, activeRoster) {
  const norm = normalizeGameShape(game);
  if (!norm) return emptyGame(kindOf(game), seatsOf(activeRoster.length ? activeRoster : roster), 1);

  const ids = new Set(roster.map((m) => m.id));
  if ((norm.xId && !ids.has(norm.xId)) || (norm.oId && !ids.has(norm.oId))) {
    return emptyGame(norm.kind, seatsOf(activeRoster.length ? activeRoster : roster), 1);
  }

  const needsSeats = !norm.xId || (!norm.oId && roster.length >= 2);
  if (needsSeats && isEmptyBoard(norm.board)) {
    const seats = seatsOf(activeRoster.length ? activeRoster : roster);
    if (seats.xId !== norm.xId || seats.oId !== norm.oId) {
      norm.xId = seats.xId;
      norm.oId = seats.oId;
    }
  }
  return norm;
}

function roomState(room, roster, hostId) {
  return {
    type: 'room_state',
    room,
    hostId,
    members: publicMembers(roster),
  };
}

export class RoomDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.roomCode = null;
    this.alarmAt = null;
  }

  async init() {
    if (this.roomCode) return;
    const meta = await this.state.storage.get('meta');
    this.roomCode = meta && meta.room ? meta.room : null;
  }

  async loadStoredMembers() {
    const stored = await this.state.storage.get('members');
    return Array.isArray(stored) ? stored : [];
  }

  async saveMembers(members) {
    await this.state.storage.put('members', members);
  }

  async loadGame() {
    return (await this.state.storage.get('game')) || null;
  }

  async saveGame(game) {
    await this.state.storage.put('game', game);
  }

  // Every live socket, skipping sockets that were replaced by a reconnect.
  activeSockets() {
    const out = [];
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a && a.id && !a.replaced) out.push({ ws, a });
    }
    return out;
  }

  activeIds() {
    return new Set(this.activeSockets().map(({ a }) => a.id));
  }

  activeMembers(members, exclude) {
    const ids = this.activeIds();
    if (exclude) for (const id of exclude) ids.delete(id);
    return members.filter((m) => ids.has(m.id));
  }

  send(ws, msg) {
    if (!ws) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch (e) {
      // Socket already closed; close handlers will clean up.
    }
  }

  broadcast(msg) {
    const payload = JSON.stringify(msg);
    for (const { ws } of this.activeSockets()) {
      try {
        ws.send(payload);
      } catch (e) {
        // ignore
      }
    }
  }

  socketById(id) {
    for (const { ws, a } of this.activeSockets()) {
      if (a.id === id) return ws;
    }
    return null;
  }

  error(ws, code, message) {
    this.send(ws, { type: 'error', room: this.roomCode, code, message });
  }

  async ensureAlarm(roster) {
    let next = null;
    for (const m of roster) {
      if (m.leftAt != null) {
        const at = m.leftAt + RECONNECT_GRACE_MS + 50;
        if (next == null || at < next) next = at;
      }
    }
    if (next == null) {
      if (this.alarmAt != null) {
        try { await this.state.storage.deleteAlarm(); } catch (e) {}
        this.alarmAt = null;
      }
      return;
    }
    if (this.alarmAt === next) return;
    try {
      await this.state.storage.setAlarm(next);
      this.alarmAt = next;
    } catch (e) {}
  }

  // Mark members whose sockets vanished, drop members past the reconnect
  // grace window, and keep an alarm armed so a silent room is cleaned up.
  async normalizeRoster() {
    const stored = await this.loadStoredMembers();
    const active = this.activeIds();
    const now = Date.now();
    let dirty = false;
    const roster = [];
    for (const raw of stored) {
      if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') {
        dirty = true;
        continue;
      }
      let m = raw;
      if (active.has(m.id)) {
        if (m.leftAt != null) {
          m = { ...m, leftAt: null };
          dirty = true;
        }
      } else {
        if (m.leftAt == null) {
          m = { ...m, leftAt: now };
          dirty = true;
        }
        if (now - m.leftAt >= RECONNECT_GRACE_MS) {
          dirty = true;
          continue;
        }
      }
      roster.push(m);
    }
    if (dirty) await this.saveMembers(roster);
    await this.ensureAlarm(roster);
    return roster;
  }

  async fetch(request) {
    await this.init();
    const url = new URL(request.url);
    const room = url.searchParams.get('room') || '';
    if (!/^\d{4}$/.test(room)) {
      return new Response('bad room', { status: 400 });
    }
    if (this.roomCode && this.roomCode !== room) {
      return new Response('room mismatch', { status: 403 });
    }
    this.roomCode = room;

    const meta = await this.state.storage.get('meta');
    if (!meta) {
      await this.state.storage.put('meta', { room, createdAt: Date.now() });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }

    const rosterBefore = await this.normalizeRoster();
    const activeBefore = this.activeMembers(rosterBefore);
    const pid = cleanPid(url.searchParams.get('pid'));
    const name = cleanName(url.searchParams.get('name'));
    const existing = pid ? rosterBefore.find((m) => m.pid === pid) : null;
    const existingActive = existing ? this.activeIds().has(existing.id) : false;

    if (activeBefore.length >= MAX_MEMBERS && !existingActive) {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.state.acceptWebSocket(server);
      this.send(server, {
        type: 'error',
        room,
        code: 'room_full',
        message: '房间已满（最多 4 人）',
      });
      server.close(4001, 'room_full');
      return new Response(null, { status: 101, webSocket: client });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // A reload / reconnect that arrives before the old socket's close event is
    // processed takes over the same seat instead of becoming a 5th member.
    if (existingActive) {
      const old = this.socketById(existing.id);
      if (old) {
        try {
          old.serializeAttachment({ ...old.deserializeAttachment(), replaced: true });
          old.close(4003, 'replaced');
        } catch (e) {}
      }
    }

    const id = existing ? existing.id : crypto.randomUUID();
    const member = existing
      ? { ...existing, pid: pid || existing.pid, name: name || existing.name, leftAt: null }
      : { id, pid, name, mic: false, joinedAt: Date.now(), leftAt: null };

    const roster = existing
      ? rosterBefore.map((m) => (m.id === id ? member : m))
      : [...rosterBefore, member];

    server.serializeAttachment({ id, name: member.name, room, pid: member.pid });
    this.state.acceptWebSocket(server);
    await this.saveMembers(roster);

    const active = this.activeMembers(roster);
    const game = alignGame(await this.loadGame(), roster, active);
    await this.saveGame(game);

    this.send(server, {
      type: 'welcome',
      room,
      selfId: id,
      hostId: hostIdOf(active),
      members: publicMembers(active),
      game,
    });
    this.broadcast(roomState(room, active, hostIdOf(active)));
    this.broadcast({ type: 'game_state', room, game });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    await this.init();
    if (typeof raw !== 'string') return;
    if (raw.length > 40000) return;
    const attachment = ws.deserializeAttachment();
    if (!attachment || !attachment.id || attachment.replaced) return;
    const room = this.roomCode;

    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return this.error(ws, 'bad_json', '消息格式错误');
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
    // Every client message must name this room; cross-room traffic is refused.
    if (msg.room !== room) {
      return this.error(ws, 'room_mismatch', '房间号不匹配，消息已拒绝');
    }

    const roster = await this.normalizeRoster();
    const sender = roster.find((m) => m.id === attachment.id);
    if (!sender) {
      return this.error(ws, 'not_member', '你不在该房间');
    }

    switch (msg.type) {
      case 'ping':
        return this.send(ws, { type: 'pong', room, t: msg.t || Date.now() });
      case 'signal':
        return this.handleSignal(roster, sender, msg);
      case 'mic':
        return this.handleMic(roster, sender, msg);
      case 'game_move':
        return this.handleMove(roster, sender, msg);
      case 'game_reset':
        return this.handleReset(roster, sender, msg);
      case 'game_select':
        return this.handleSelect(roster, sender, msg);
      default:
        return this.error(ws, 'unknown_type', '未知消息类型');
    }
  }

  async handleSignal(members, sender, msg) {
    const ws = this.socketById(sender.id);
    if (!msg.data || typeof msg.data !== 'object' || Array.isArray(msg.data)) {
      return this.error(ws, 'bad_signal');
    }
    const keys = Object.keys(msg.data);
    if (keys.some((k) => k !== 'description' && k !== 'candidate')) {
      return this.error(ws, 'bad_signal');
    }
    if (msg.data.description) {
      const d = msg.data.description;
      if (!d || typeof d !== 'object' || !['offer', 'answer', 'rollback'].includes(d.type)) {
        return this.error(ws, 'bad_signal');
      }
    }
    if (msg.data.candidate) {
      const c = msg.data.candidate;
      if (typeof c !== 'object' || (c.candidate && String(c.candidate).length > 2000)) {
        return this.error(ws, 'bad_signal');
      }
    }
    if (JSON.stringify(msg.data).length > 32000) {
      return this.error(ws, 'signal_too_large');
    }
    const targetId = msg.to;
    if (typeof targetId !== 'string' || targetId === sender.id) return;
    const targetMember = members.find((m) => m.id === targetId);
    if (!targetMember || targetMember.leftAt != null) {
      return this.error(ws, 'no_peer', '目标成员不在房间');
    }
    const target = this.socketById(targetId);
    if (!target) return;
    this.send(target, {
      type: 'signal',
      room: this.roomCode,
      from: sender.id,
      data: msg.data,
    });
  }

  async handleMic(members, sender, msg) {
    const next = !!msg.on;
    if (sender.mic === next) return;
    sender.mic = next;
    await this.saveMembers(members);
    const active = this.activeMembers(members);
    this.broadcast(roomState(this.roomCode, active, hostIdOf(active)));
  }

  async handleMove(members, sender, msg) {
    const ws = this.socketById(sender.id);
    const active = this.activeMembers(members);
    let game = alignGame(await this.loadGame(), members, active);
    await this.saveGame(game);

    if (!game.oId) {
      return this.error(ws, 'waiting_peer', '等第二位玩家加入再开始');
    }
    if (game.winner) {
      return this.error(ws, 'game_over', '本局已结束，请开新局');
    }
    const turnId = game.turn === 'X' ? game.xId : game.oId;
    if (sender.id !== turnId) {
      return this.error(ws, 'not_your_turn', '还没轮到你');
    }

    const player = game.turn === 'X' ? 1 : 2;

    if (game.kind === 'gomoku') {
      if (!isIntIn(msg.x, 0, 14) || !isIntIn(msg.y, 0, 14)) {
        return this.error(ws, 'bad_move', '落子坐标不合法');
      }
      const index = msg.y * 15 + msg.x;
      if (game.board[index]) {
        return this.error(ws, 'cell_taken', '这个点已经有棋子');
      }
      const nums = toNumericBoard(game.board);
      nums[index] = player;
      const line = gomoku.lineAt(nums, msg.y, msg.x, player);
      game.board = fromNumericBoard(nums);
      if (line) {
        game.winner = game.turn;
        game.line = line;
        game.scores[game.turn] += 1;
      } else if (stoneCount(game.board) === KINDS.gomoku.size) {
        game.winner = 'draw';
        game.line = null;
      } else {
        game.turn = game.turn === 'X' ? 'O' : 'X';
      }
    } else if (game.kind === 'connect4') {
      if (!isIntIn(msg.x, 0, 6)) {
        return this.error(ws, 'bad_move', '列号不合法');
      }
      // Gravity and legality are handled by the shared Connect Four engine.
      const state = {
        b: new Int8Array(toNumericBoard(game.board)),
        turn: player,
        last: -1,
        plies: stoneCount(game.board),
      };
      const applied = connect4.applyMove(state, msg.x);
      if (!applied) {
        return this.error(ws, 'column_full', '这一列已经满了');
      }
      const result = connect4.status(applied);
      game.board = fromNumericBoard(applied.b);
      game.turn = applied.turn === 1 ? 'X' : 'O';
      if (result.over) {
        if (result.draw) {
          game.winner = 'draw';
          game.line = null;
        } else {
          game.winner = result.winner === 1 ? 'X' : 'O';
          game.line = result.line;
          game.scores[game.winner] += 1;
        }
      }
    } else {
      // Tic-tac-toe: accept {x,y} (preferred) or the legacy {index}.
      let index = -1;
      if (msg.x !== undefined || msg.y !== undefined) {
        if (!isIntIn(msg.x, 0, 2) || !isIntIn(msg.y, 0, 2)) {
          return this.error(ws, 'bad_move', '落子坐标不合法');
        }
        index = msg.y * 3 + msg.x;
      } else if (isIntIn(msg.index, 0, 8)) {
        index = msg.index;
      } else {
        return this.error(ws, 'bad_move', '落子坐标不合法');
      }
      if (game.board[index]) {
        return this.error(ws, 'cell_taken', '这一格已经有棋子');
      }
      game.board[index] = game.turn;
      const result = tttWinnerOf(game.board);
      if (result.winner) {
        game.winner = result.winner;
        game.line = result.line;
        game.scores[result.winner] += 1;
      } else if (game.board.every(Boolean)) {
        game.winner = 'draw';
        game.line = null;
      } else {
        game.turn = game.turn === 'X' ? 'O' : 'X';
      }
    }

    game.updatedAt = Date.now();
    await this.saveGame(game);
    this.broadcast({ type: 'game_state', room: this.roomCode, game });
  }

  async handleReset(members, sender, msg) {
    const ws = this.socketById(sender.id);
    const active = this.activeMembers(members);
    if (sender.id !== hostIdOf(active)) {
      return this.error(ws, 'host_only', '只有房主可以开新局');
    }
    const current = alignGame(await this.loadGame(), members, active);
    const next = emptyGame(current.kind, seatsOf(active.length ? active : members), (current.round || 1) + 1);
    next.scores = current.scores;
    await this.saveGame(next);
    this.broadcast({ type: 'game_state', room: this.roomCode, game: next });
  }

  async handleSelect(members, sender, msg) {
    const ws = this.socketById(sender.id);
    const active = this.activeMembers(members);
    if (sender.id !== hostIdOf(active)) {
      return this.error(ws, 'host_only', '只有房主可以换游戏');
    }
    const kind = String(msg.kind || '');
    if (!KINDS[kind]) {
      return this.error(ws, 'bad_game', '不支持的游戏');
    }
    const current = alignGame(await this.loadGame(), members, active);
    if (current.kind === kind) {
      return this.send(ws, { type: 'game_state', room: this.roomCode, game: current });
    }
    const next = emptyGame(kind, seatsOf(active.length ? active : members), (current.round || 1) + 1);
    await this.saveGame(next);
    this.broadcast({ type: 'game_state', room: this.roomCode, game: next });
  }

  // Sockets can disappear without webSocketClose (network loss, hibernation).
  // Keep the member for the reconnect grace window so the board survives.
  async markOffline(ws) {
    await this.init();
    if (!this.roomCode) return;
    const attachment = ws.deserializeAttachment();
    if (!attachment || !attachment.id || attachment.replaced) return;
    const stored = await this.loadStoredMembers();
    const idx = stored.findIndex((m) => m.id === attachment.id);
    if (idx === -1) return;
    stored[idx] = { ...stored[idx], leftAt: Date.now() };
    await this.saveMembers(stored);

    const roster = await this.normalizeRoster();
    if (!roster.length) return;
    // The closing socket can still be listed by getWebSockets() while this
    // handler runs, so exclude it explicitly from the "online now" view.
    const active = this.activeMembers(roster, new Set([attachment.id]));
    const game = alignGame(await this.loadGame(), roster, active);
    await this.saveGame(game);
    this.broadcast(roomState(this.roomCode, active, hostIdOf(active)));
    this.broadcast({ type: 'game_state', room: this.roomCode, game });
  }

  async webSocketClose(ws, code, reason, wasClean) {
    // Try to complete the closing handshake before doing async cleanup.
    try { ws.close(code || 1000, typeof reason === 'string' ? reason.slice(0, 120) : ''); } catch (e) {}
    await this.markOffline(ws);
  }

  async webSocketError(ws, error) {
    try { ws.close(1011, 'websocket error'); } catch (e) {}
    await this.markOffline(ws);
  }

  async alarm() {
    await this.init();
    this.alarmAt = null;
    if (!this.roomCode) {
      await this.state.storage.deleteAll();
      return;
    }
    const roster = await this.normalizeRoster();
    if (!roster.length) {
      await this.state.storage.deleteAll();
      this.roomCode = null;
      return;
    }
    const active = this.activeMembers(roster);
    const game = alignGame(await this.loadGame(), roster, active);
    await this.saveGame(game);
    this.broadcast(roomState(this.roomCode, active, hostIdOf(active)));
    this.broadcast({ type: 'game_state', room: this.roomCode, game });
  }
}
