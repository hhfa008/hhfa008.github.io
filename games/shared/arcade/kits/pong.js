/* Arcade kit: 乒乓。state = { w, h, ball:{x,y,vx,vy}, left:{y}, right:{y}, score:[l,r], over } */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ArcadeKit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function create(params) {
    params = params || {};
    var speed = params.speed || 1;
    var ai = params.ai !== false;
    var W = 100, H = 60, PADDLE = 16, PH = PADDLE / 2, BALL = 2;

    function resetBall(state, toLeft, rng) {
      state.ball = {
        x: W / 2, y: H / 2,
        vx: (toLeft ? -1 : 1) * (1.1 + speed * 0.2),
        vy: (rng() < 0.5 ? -1 : 1) * (0.7 + speed * 0.1),
      };
    }

    function newGame(rng) {
      rng = rng || Math.random;
      var state = {
        w: W, h: H,
        ball: { x: W / 2, y: H / 2, vx: 0, vy: 0 },
        left: { y: H / 2 }, right: { y: H / 2 },
        score: [0, 0], over: false,
      };
      resetBall(state, rng() < 0.5, rng);
      return state;
    }

    function clampPaddle(y) {
      return Math.max(PH, Math.min(H - PH, y));
    }

    function act(state, action, rng) {
      rng = rng || Math.random;
      if (state.over) return { state: state, changed: false, gained: 0 };
      if (action === 'up' || action === 'down') {
        var dy = action === 'up' ? -6 : 6;
        var left = { y: clampPaddle(state.left.y + dy) };
        var next = {
          w: state.w, h: state.h, ball: { x: state.ball.x, y: state.ball.y, vx: state.ball.vx, vy: state.ball.vy },
          left: left, right: { y: state.right.y }, score: state.score.slice(), over: false,
        };
        return { state: next, changed: true, gained: 0 };
      }
      if (action !== 'tick') return { state: state, changed: false, gained: 0 };

      var ball = { x: state.ball.x + state.ball.vx, y: state.ball.y + state.ball.vy, vx: state.ball.vx, vy: state.ball.vy };
      if (ball.y < BALL) { ball.y = BALL; ball.vy = Math.abs(ball.vy); }
      if (ball.y > H - BALL) { ball.y = H - BALL; ball.vy = -Math.abs(ball.vy); }

      var leftY = state.left.y, rightY = state.right.y;
      if (ai) {
        var target = ball.y;
        var step = 2.2 * speed;
        rightY = clampPaddle(rightY + Math.max(-step, Math.min(step, target - rightY)));
      }
      // 左拍在 x≈4，右拍在 x≈96
      if (ball.vx < 0 && ball.x <= 4 + BALL && ball.x >= 2 && Math.abs(ball.y - leftY) <= PH) {
        ball.x = 4 + BALL; ball.vx = Math.abs(ball.vx);
      }
      if (ball.vx > 0 && ball.x >= W - 4 - BALL && ball.x <= W - 2 && Math.abs(ball.y - rightY) <= PH) {
        ball.x = W - 4 - BALL; ball.vx = -Math.abs(ball.vx);
      }

      var score = state.score.slice();
      var gained = 0;
      var resetTo = null;
      if (ball.x < 0) { score[1]++; gained = 1; resetTo = true; }
      else if (ball.x > W) { score[0]++; gained = 1; resetTo = false; }

      var next = {
        w: W, h: H, ball: ball, left: { y: leftY }, right: { y: rightY },
        score: score, over: score[0] >= 7 || score[1] >= 7,
      };
      if (resetTo !== null) resetBall(next, resetTo, rng);
      return { state: next, changed: true, gained: gained };
    }

    function status(state) {
      if (state.score[0] >= 7) return 'won';
      if (state.score[1] >= 7) return 'lost';
      return 'playing';
    }

    return {
      newGame: newGame,
      act: act,
      status: status,
      actions: function () { return ['up', 'down', 'tick']; },
    };
  }
  return { create: create };
});
