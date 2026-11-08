const MAX_MEMBERS = 4;
const WIN_LINES = [
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

function emptyGame(seats, round) {
  return {
    board: Array(9).fill(null),
    turn: 'X',
    winner: null,
    line: null,
    xId: seats.xId,
    oId: seats.oId,
    scores: { X: 0, O: 0 },
    round: round || 1,
    updatedAt: Date.now(),
  };
}

// Seat changes invalidate the board (a player left / host was transferred).
function alignGame(game, seats) {
  const prev = game || emptyGame(seats, 1);
  if (prev.xId !== seats.xId || prev.oId !== seats.oId) {
    return emptyGame(seats, (prev.round || 1) + 1);
  }
  return prev;
}

function winnerOf(board) {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line };
    }
  }
  return { winner: null, line: null };
}

export class RoomDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.roomCode = null;
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

  async loadMembers() {
    const members = await this.loadStoredMembers();
    // Drop members whose sockets vanished (e.g. a platform-side disconnect
    // that never reached webSocketClose).
    const active = new Set();
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a && a.id) active.add(a.id);
    }
    return members.filter((m) => active.has(m.id));
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

  send(ws, msg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch (e) {
      // Socket already closed; close handlers will clean up.
    }
  }

  broadcast(msg) {
    const payload = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(payload);
      } catch (e) {
        // ignore
      }
    }
  }

  socketById(id) {
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a && a.id === id) return ws;
    }
    return null;
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

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const name = cleanName(url.searchParams.get('name'));

    const members = await this.loadMembers();
    if (members.length >= MAX_MEMBERS) {
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

    const id = crypto.randomUUID();
    const member = { id, name, mic: false, joinedAt: Date.now() };
    server.serializeAttachment({ id, name, room });
    this.state.acceptWebSocket(server);
    members.push(member);
    await this.saveMembers(members);

    const seats = seatsOf(members);
    const game = alignGame(await this.loadGame(), seats);
    await this.saveGame(game);

    this.send(server, {
      type: 'welcome',
      room,
      selfId: id,
      hostId: hostIdOf(members),
      members: publicMembers(members),
      game,
    });
    this.broadcast({
      type: 'room_state',
      room,
      hostId: hostIdOf(members),
      members: publicMembers(members),
    });
    this.broadcast({ type: 'game_state', room, game });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    await this.init();
    if (typeof raw !== 'string') return;
    if (raw.length > 40000) return;
    const attachment = ws.deserializeAttachment();
    if (!attachment || !attachment.id) return;
    const room = this.roomCode;

    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return this.send(ws, { type: 'error', room, code: 'bad_json', message: '消息格式错误' });
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
    // Every client message must name this room; cross-room traffic is refused.
    if (msg.room !== room) {
      return this.send(ws, {
        type: 'error',
        room,
        code: 'room_mismatch',
        message: '房间号不匹配，消息已拒绝',
      });
    }

    const members = await this.loadMembers();
    const sender = members.find((m) => m.id === attachment.id);
    if (!sender) {
      return this.send(ws, { type: 'error', room, code: 'not_member', message: '你不在该房间' });
    }

    switch (msg.type) {
      case 'ping':
        return this.send(ws, { type: 'pong', room, t: msg.t || Date.now() });
      case 'signal':
        return this.handleSignal(ws, members, sender, msg);
      case 'mic':
        return this.handleMic(members, sender, msg);
      case 'game_move':
        return this.handleMove(members, sender, msg);
      case 'game_reset':
        return this.handleReset(members, sender, msg);
      default:
        return this.send(ws, {
          type: 'error',
          room,
          code: 'unknown_type',
          message: '未知消息类型',
        });
    }
  }

  async handleSignal(ws, members, sender, msg) {
    if (!msg.data || typeof msg.data !== 'object' || Array.isArray(msg.data)) {
      return this.send(ws, { type: 'error', room: this.roomCode, code: 'bad_signal' });
    }
    const keys = Object.keys(msg.data);
    if (keys.some((k) => k !== 'description' && k !== 'candidate')) {
      return this.send(ws, { type: 'error', room: this.roomCode, code: 'bad_signal' });
    }
    if (msg.data.description) {
      const d = msg.data.description;
      if (!d || typeof d !== 'object' || !['offer', 'answer', 'rollback'].includes(d.type)) {
        return this.send(ws, { type: 'error', room: this.roomCode, code: 'bad_signal' });
      }
    }
    if (msg.data.candidate) {
      const c = msg.data.candidate;
      if (typeof c !== 'object' || (c.candidate && String(c.candidate).length > 2000)) {
        return this.send(ws, { type: 'error', room: this.roomCode, code: 'bad_signal' });
      }
    }
    if (JSON.stringify(msg.data).length > 32000) {
      return this.send(ws, { type: 'error', room: this.roomCode, code: 'signal_too_large' });
    }
    const targetId = msg.to;
    if (typeof targetId !== 'string' || targetId === sender.id) return;
    if (!members.some((m) => m.id === targetId)) {
      return this.send(ws, {
        type: 'error',
        room: this.roomCode,
        code: 'no_peer',
        message: '目标成员不在房间',
      });
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
    this.broadcast({
      type: 'room_state',
      room: this.roomCode,
      hostId: hostIdOf(members),
      members: publicMembers(members),
    });
  }

  async handleMove(members, sender, msg) {
    const game = alignGame(await this.loadGame(), seatsOf(members));
    const index = msg.index;
    const senderSocket = this.socketById(sender.id);
    if (!Number.isInteger(index) || index < 0 || index > 8) {
      return this.send(senderSocket, {
        type: 'error', room: this.roomCode, code: 'bad_move',
      });
    }
    if (!game.oId) {
      return this.send(senderSocket, {
        type: 'error', room: this.roomCode, code: 'waiting_peer',
        message: '等第二位玩家加入再开始',
      });
    }
    if (game.winner || game.line) {
      return this.send(senderSocket, {
        type: 'error', room: this.roomCode, code: 'game_over',
        message: '本局已结束，请开新局',
      });
    }
    const turnId = game.turn === 'X' ? game.xId : game.oId;
    if (sender.id !== turnId) {
      return this.send(senderSocket, {
        type: 'error', room: this.roomCode, code: 'not_your_turn',
        message: '还没轮到你',
      });
    }
    if (game.board[index]) return;

    game.board[index] = game.turn;
    const result = winnerOf(game.board);
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
    game.updatedAt = Date.now();
    await this.saveGame(game);
    this.broadcast({ type: 'game_state', room: this.roomCode, game });
  }

  async handleReset(members, sender, msg) {
    const game = alignGame(await this.loadGame(), seatsOf(members));
    if (sender.id !== game.xId) {
      return this.send(this.socketById(sender.id), {
        type: 'error', room: this.roomCode, code: 'host_only',
        message: '只有房主可以开新局',
      });
    }
    const next = emptyGame(seatsOf(members), (game.round || 1) + 1);
    next.scores = game.scores;
    await this.saveGame(next);
    this.broadcast({ type: 'game_state', room: this.roomCode, game: next });
  }

  async removeMember(ws) {
    await this.init();
    if (!this.roomCode) return;
    const attachment = ws.deserializeAttachment();
    if (!attachment || !attachment.id) return;
    // Use the stored list, not the active-socket filtered list: the closing
    // socket may already be gone from getWebSockets() when this fires.
    const members = await this.loadStoredMembers();
    const idx = members.findIndex((m) => m.id === attachment.id);
    if (idx === -1) return;
    const oldHost = hostIdOf(members);
    members.splice(idx, 1);
    await this.saveMembers(members);

    if (members.length === 0) {
      await this.state.storage.deleteAll();
      this.roomCode = null;
      return;
    }

    const game = alignGame(await this.loadGame(), seatsOf(members));
    await this.saveGame(game);
    const hostId = hostIdOf(members);
    this.broadcast({
      type: 'room_state',
      room: this.roomCode,
      hostId,
      members: publicMembers(members),
      hostChanged: hostId !== oldHost,
    });
    this.broadcast({ type: 'game_state', room: this.roomCode, game });
  }

  async webSocketClose(ws, code, reason, wasClean) {
    // Try to complete the closing handshake before doing async cleanup.
    try { ws.close(code || 1000, typeof reason === 'string' ? reason.slice(0, 120) : ''); } catch (e) {}
    await this.removeMember(ws);
  }

  async webSocketError(ws, error) {
    try { ws.close(1011, 'websocket error'); } catch (e) {}
    await this.removeMember(ws);
  }
}
