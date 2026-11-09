// Rules engine: parsing "NOUN IS PROPERTY/NOUN" sentences, movement, and interactions.
// Pure logic, no DOM. Works in the browser (window.Engine) and in Node (module.exports).
(function (global) {
  'use strict';

  const NOUNS = ['baba', 'wall', 'rock', 'flag', 'water', 'lava', 'skull', 'key', 'door', 'grass', 'text'];
  const PROPS = ['you', 'win', 'stop', 'push', 'sink', 'defeat', 'hot', 'melt', 'open', 'shut', 'move'];
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

  // Map characters. Lowercase = objects, uppercase/symbols = text tiles.
  const OBJECT_CHARS = {
    b: 'baba', w: 'wall', r: 'rock', f: 'flag', '~': 'water',
    l: 'lava', s: 'skull', k: 'key', d: 'door', g: 'grass',
  };
  const TEXT_CHARS = {
    B: 'baba', W: 'wall', R: 'rock', F: 'flag', A: 'water', L: 'lava', S: 'skull',
    K: 'key', D: 'door', G: 'grass', T: 'text',
    '=': 'is', '&': 'and',
    Y: 'you', V: 'win', X: 'stop', P: 'push', N: 'sink', E: 'defeat',
    H: 'hot', M: 'melt', O: 'open', C: 'shut', Z: 'move',
  };

  const isNoun = (w) => NOUNS.includes(w);
  const isComplement = (w) => NOUNS.includes(w) || PROPS.includes(w);

  function createState(level) {
    const objs = [];
    let nextId = 0;
    const facing = level.facing || {};
    level.map.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        if (ch === '.') return;
        if (OBJECT_CHARS[ch]) {
          const kind = OBJECT_CHARS[ch];
          objs.push({ id: nextId++, kind, x, y, dir: facing[kind] || 'right' });
        } else if (TEXT_CHARS[ch]) {
          objs.push({ id: nextId++, kind: 'text', word: TEXT_CHARS[ch], x, y, dir: 'right' });
        } else {
          throw new Error(`Level "${level.name}": unknown map character "${ch}" at ${x},${y}`);
        }
      });
    });
    const state = {
      width: Math.max(...level.map.map((r) => r.length)),
      height: level.map.length,
      objs,
      nextId,
      rules: [],
      props: new Map(),
      activeText: new Set(),
      won: false,
    };
    refreshRules(state);
    state.won = checkWin(state);
    return state;
  }

  function parseRules(state) {
    const grid = new Map();
    for (const o of state.objs) {
      if (o.kind !== 'text') continue;
      const k = o.x + ',' + o.y;
      if (!grid.has(k)) grid.set(k, o);
    }
    const at = (x, y) => grid.get(x + ',' + y);
    const seen = new Set();
    const rules = [];
    const active = new Set();

    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      for (const start of grid.values()) {
        const used = [];
        const subjects = [];
        let x = start.x;
        let y = start.y;
        let ok = false;
        // NOUN (AND NOUN)*
        for (;;) {
          const t = at(x, y);
          if (!t || !isNoun(t.word)) break;
          subjects.push(t.word);
          used.push(t);
          x += dx; y += dy;
          const a = at(x, y);
          if (a && a.word === 'and') { used.push(a); x += dx; y += dy; continue; }
          ok = true;
          break;
        }
        if (!ok) continue;
        const is = at(x, y);
        if (!is || is.word !== 'is') continue;
        used.push(is);
        x += dx; y += dy;
        // (NOUN|PROP) (AND (NOUN|PROP))*
        const complements = [];
        for (;;) {
          const t = at(x, y);
          if (!t || !isComplement(t.word)) break;
          complements.push(t.word);
          used.push(t);
          x += dx; y += dy;
          const a = at(x, y);
          const n = at(x + dx, y + dy);
          if (a && a.word === 'and' && n && isComplement(n.word)) { used.push(a); x += dx; y += dy; continue; }
          break;
        }
        if (!complements.length) continue;
        for (const t of used) active.add(t.id);
        for (const s of subjects) {
          for (const c of complements) {
            const key = s + ' is ' + c;
            if (seen.has(key)) continue;
            seen.add(key);
            rules.push({ subject: s, complement: c });
          }
        }
      }
    }

    state.rules = rules;
    state.activeText = active;
    state.props = new Map();
    for (const r of rules) {
      if (!PROPS.includes(r.complement)) continue;
      if (!state.props.has(r.subject)) state.props.set(r.subject, new Set());
      state.props.get(r.subject).add(r.complement);
    }
  }

  // NOUN IS NOUN turns every matching object into the target ("X IS X" protects X).
  function applyTransforms(state) {
    const targets = new Map();
    const locked = new Set();
    for (const r of state.rules) {
      if (!isNoun(r.complement)) continue;
      if (r.complement === r.subject) { locked.add(r.subject); continue; }
      if (!targets.has(r.subject)) targets.set(r.subject, []);
      targets.get(r.subject).push(r.complement);
    }
    if (!targets.size) return false;
    let changed = false;
    const out = [];
    for (const o of state.objs) {
      const into = !locked.has(o.kind) && targets.get(o.kind);
      if (!into) { out.push(o); continue; }
      changed = true;
      for (const t of into) {
        if (t === 'text') out.push({ id: state.nextId++, kind: 'text', word: o.kind, x: o.x, y: o.y, dir: o.dir });
        else out.push({ id: state.nextId++, kind: t, x: o.x, y: o.y, dir: o.dir });
      }
    }
    state.objs = out;
    return changed;
  }

  function refreshRules(state) {
    parseRules(state);
    if (applyTransforms(state)) parseRules(state);
  }

  function hasProp(state, o, p) {
    if (o.kind === 'text' && p === 'push') return true;
    const s = state.props.get(o.kind);
    return !!s && s.has(p);
  }

  const objsAt = (state, x, y) => state.objs.filter((o) => o.x === x && o.y === y);

  function opensShut(state, a, b) {
    return (hasProp(state, a, 'open') && hasProp(state, b, 'shut')) ||
      (hasProp(state, a, 'shut') && hasProp(state, b, 'open'));
  }

  function canMove(state, o, dx, dy) {
    const nx = o.x + dx;
    const ny = o.y + dy;
    if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height) return false;
    for (const t of objsAt(state, nx, ny)) {
      if (hasProp(state, t, 'push')) {
        if (canMove(state, t, dx, dy)) continue;
      } else if (!hasProp(state, t, 'stop')) {
        continue;
      }
      // Blocked, unless an OPEN thing walks into a SHUT thing (both get destroyed afterwards).
      if (!opensShut(state, o, t)) return false;
    }
    return true;
  }

  // Collect the whole push chain against the pre-move board, then shift each object exactly once.
  function doMove(state, o, dx, dy) {
    const chain = new Set();
    const collect = (m) => {
      if (chain.has(m)) return;
      chain.add(m);
      for (const t of objsAt(state, m.x + dx, m.y + dy)) {
        if (hasProp(state, t, 'push') && canMove(state, t, dx, dy)) collect(t);
      }
    };
    collect(o);
    for (const m of chain) { m.x += dx; m.y += dy; }
  }

  function resolveInteractions(state) {
    const cells = new Map();
    for (const o of state.objs) {
      const k = o.x + ',' + o.y;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(o);
    }
    const has = (o, p) => hasProp(state, o, p);
    const dead = new Set();
    for (const g of cells.values()) {
      if (g.length > 1 && g.some((o) => has(o, 'sink'))) g.forEach((o) => dead.add(o));
      if (g.some((o) => has(o, 'defeat'))) g.filter((o) => has(o, 'you')).forEach((o) => dead.add(o));
      if (g.some((o) => has(o, 'hot'))) g.filter((o) => has(o, 'melt')).forEach((o) => dead.add(o));
      const opens = g.filter((o) => !dead.has(o) && has(o, 'open'));
      const shuts = g.filter((o) => !dead.has(o) && has(o, 'shut') && !has(o, 'open'));
      for (let i = 0; i < Math.min(opens.length, shuts.length); i++) {
        dead.add(opens[i]);
        dead.add(shuts[i]);
      }
    }
    if (!dead.size) return false;
    state.objs = state.objs.filter((o) => !dead.has(o));
    return true;
  }

  function checkWin(state) {
    for (const y of state.objs) {
      if (!hasProp(state, y, 'you')) continue;
      for (const o of state.objs) {
        if (o.x === y.x && o.y === y.y && hasProp(state, o, 'win')) return true;
      }
    }
    return false;
  }

  const hasYou = (state) => state.objs.some((o) => hasProp(state, o, 'you'));

  // Serialized board; `withFacing` false ignores facing except for MOVE objects (used by solvers).
  function serialize(state, withFacing = true) {
    return state.objs
      .map((o) => {
        const d = withFacing || hasProp(state, o, 'move') ? o.dir : '';
        return (o.word || o.kind) + (o.kind === 'text' ? '!' : '') + o.x + ',' + o.y + d;
      })
      .sort()
      .join(';');
  }

  // Advance one turn. dir = 'up'|'down'|'left'|'right', or null to wait. Returns true if anything changed.
  function step(state, dir) {
    if (state.won) return false;
    const before = serialize(state);
    if (dir) {
      const [dx, dy] = DIRS[dir];
      const yous = state.objs.filter((o) => hasProp(state, o, 'you'));
      for (const o of yous) o.dir = dir;
      // Front-most first so a line of YOU objects moves together.
      yous.sort((a, b) => (b.x * dx + b.y * dy) - (a.x * dx + a.y * dy));
      for (const o of yous) if (canMove(state, o, dx, dy)) doMove(state, o, dx, dy);
    }
    // Front-most first along each mover's facing, so a line of movers travels as one block.
    const ahead = (o) => o.x * DIRS[o.dir][0] + o.y * DIRS[o.dir][1];
    const movers = state.objs.filter((m) => hasProp(state, m, 'move')).sort((a, b) => ahead(b) - ahead(a));
    for (const o of movers) {
      let [dx, dy] = DIRS[o.dir];
      if (!canMove(state, o, dx, dy)) {
        o.dir = OPPOSITE[o.dir];
        [dx, dy] = DIRS[o.dir];
        if (!canMove(state, o, dx, dy)) continue;
      }
      doMove(state, o, dx, dy);
    }
    refreshRules(state);
    // Destruction can break rules; re-read them, but transformations happen only once per turn.
    if (resolveInteractions(state)) parseRules(state);
    state.won = checkWin(state);
    return serialize(state) !== before;
  }

  function snapshot(state) {
    return { objs: state.objs.map((o) => ({ ...o })), nextId: state.nextId };
  }

  function restore(state, snap) {
    state.objs = snap.objs.map((o) => ({ ...o }));
    state.nextId = snap.nextId;
    parseRules(state);
    state.won = false;
  }

  const api = {
    NOUNS, PROPS, DIRS, OBJECT_CHARS, TEXT_CHARS,
    createState, step, snapshot, restore, hasProp, hasYou, serialize,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
