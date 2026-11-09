/* TCG adapter — reuses games/shared/tcg.js (createMatch / legalActions / apply).
 *
 * The generic engine is already a pure, seeded state machine. This adapter
 * supplies a compact built-in card pool (no dependence on tcg-sample), wraps
 * the engine in the GameAgent session shape, gives every engine action a
 * stable id, and maps engine seats 0/1 to p1/p2.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../../shared/agent-api.js'), require('../../shared/tcg.js'));
  } else {
    factory(root.GameAgent, root.TCG);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (GA, TCG) {
  'use strict';

  // Small original pool: vanilla bodies, one removal spell, one heal spell.
  var CARDS = {
    ember: {
      id: 'ember', type: 'unit', cost: 1, atk: 1, hp: 2,
      name: { en: 'Ember' }
    },
    sprout: {
      id: 'sprout', type: 'unit', cost: 1, atk: 1, hp: 1,
      name: { en: 'Sprout' }
    },
    guardian: {
      id: 'guardian', type: 'unit', cost: 2, atk: 2, hp: 3,
      name: { en: 'Guardian' }
    },
    colossus: {
      id: 'colossus', type: 'unit', cost: 4, atk: 4, hp: 5,
      name: { en: 'Colossus' }
    },
    flare: {
      id: 'flare', type: 'spell', cost: 1,
      name: { en: 'Flare' },
      effects: [{
        trigger: 'onPlay',
        target: { kind: 'unit', side: 'enemy', mode: 'single' },
        ops: [{ op: 'damage', amount: 2 }]
      }]
    },
    renew: {
      id: 'renew', type: 'spell', cost: 2,
      name: { en: 'Renew' },
      effects: [{
        trigger: 'onPlay',
        target: { kind: 'core', side: 'self' },
        ops: [{ op: 'heal', amount: 3 }]
      }]
    }
  };

  var COUNTS = {
    ember: 10, sprout: 8, guardian: 8, colossus: 6, flare: 4, renew: 4
  };

  var DECK = [];
  (function () {
    Object.keys(COUNTS).forEach(function (id) {
      for (var i = 0; i < COUNTS[id]; i++) DECK.push(id);
    });
  })();

  var RULES = {
    startingCore: 20,
    startingHand: 5,
    drawPerTurn: 1,
    firstTurnDraw: 0,
    startingResource: 3,
    resourceGrowth: 1,
    maxResource: 8,
    firstTurnResourcePenalty: 0,
    secondPlayerResourceBonus: 1,
    secondPlayerBonusCards: 0,
    maxTurns: 60,
    allowDirectCoreAttack: true,
    resourceName: 'energy'
  };

  function actionId(action) {
    return action.type + ':' + GA.canonicalJSON(action);
  }

  function describe(action) {
    if (action.type === 'playCard') {
      return 'play ' + action.cardId + (action.target ? ' -> ' + action.target : '');
    }
    if (action.type === 'attack') {
      return action.attacker + ' attacks ' + action.target;
    }
    if (action.type === 'activate') {
      return 'activate ' + action.unitId + '#' + action.abilityIndex +
        (action.target ? ' -> ' + action.target : '');
    }
    return 'end turn';
  }

  function makeSession(seed) {
    var match = TCG.createMatch({
      players: [{ deck: DECK.slice() }, { deck: DECK.slice() }],
      cardPool: CARDS,
      rules: RULES,
      seed: seed === undefined ? 1 : seed
    });

    function legal() { return match.legalActions(); }

    return {
      slug: 'tcg',
      version: '1.0.0',
      seats: ['p1', 'p2'],

      state: function () { return match.state; },

      legalActions: function () {
        var actions = legal(), out = [];
        for (var i = 0; i < actions.length; i++) {
          out.push({
            id: actionId(actions[i]),
            type: actions[i].type,
            payload: GA.cloneJSON(actions[i]),
            desc: describe(actions[i])
          });
        }
        return out;
      },

      apply: function (id) {
        var actions = legal(), found = null, i;
        for (i = 0; i < actions.length; i++) {
          if (actionId(actions[i]) === id) { found = actions[i]; break; }
        }
        if (!found) {
          return { ok: false, error: match.state.phase === 'over' ? 'game_over' : 'illegal_action' };
        }
        try {
          match.apply(found);
        } catch (e) {
          return { ok: false, error: 'illegal_action' };
        }
        return { ok: true, state: match.state };
      },

      status: function () {
        var st = match.state;
        if (st.phase !== 'over') return { phase: 'playing', winner: null };
        var w = st.winner;
        return { phase: 'over', winner: w === 0 ? 'p1' : (w === 1 ? 'p2' : 'draw') };
      },

      player: function () {
        return match.state.activePlayer === 0 ? 'p1' : 'p2';
      },

      hash: function () { return GA.hashState(match.state); }
    };
  }

  function create(opts) {
    opts = opts || {};
    return makeSession(opts.seed);
  }

  create.players = 2;
  create.moves = 'card-play/attack/activate/end-turn';
  create.source = 'games/shared/tcg.js (createMatch) + built-in card pool';
  if (GA) GA.register('tcg', create);

  return { create: create };
});
