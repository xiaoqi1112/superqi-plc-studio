/* ============================================================
 * app.js — 界面装配与交互
 * ============================================================ */
(function () {
  'use strict';

  var core = PLC.core;
  var R = PLC.render;
  var lib = PLC.lib;
  var nlp = PLC.nlp;
  var ai = PLC.ai;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return R.esc(s); }

  var AUTOKEY = 'plc-studio-project';
  var AIHIST = 'plc-studio-ai-cfg';

  var state = {
    program: null,
    machine: null,
    running: false,
    timer: null,
    lastTick: 0,
    insert: { kind: 'contact', opts: { nc: false }, label: '常开触点' },
    selected: null,
    selectedRung: 0,
    undo: [],
    redo: [],
    tab: 'monitor',
    completed: {},
    saveT: null,
    lastGen: null,
    lesson: null,
    noSave: false,
    compiled: false
  };
  PLC.state = state;

  /* ================= 工具 ================= */

  function findElement(id) {
    var found = null;
    core.eachElement(state.program, function (el, pos) {
      if (el.id === id) found = { el: el, pos: pos };
    });
    return found;
  }

  function removeElement(id) {
    var hit = findElement(id);
    if (!hit) return;
    var p = hit.pos;
    p.branchArr.splice(p.index, 1);
    if (!p.branchArr.length && p.stageObj.branches.length > 1) {
      p.stageObj.branches.splice(p.branch, 1);
    }
    if (p.rungObj.stages.length && p.rungObj.stages.every(function (s) {
      return s.branches.every(function (b) { return !b.length; });
    }) && p.rungObj.stages.length > 1) {
      var idx = p.rungObj.stages.indexOf(p.stageObj);
      if (idx >= 0) p.rungObj.stages.splice(idx, 1);
    }
  }

  function nextFreeBit(area) {
    var used = {};
    core.eachElement(state.program, function (el) {
      if (el.kind !== 'contact' && el.kind !== 'coil') return;
      var p = core.parseAddr(el.addr);
      if (p && p.area === area) used[p.byte * 8 + p.bit] = 1;
    });
    for (var i = 0; i < 64; i++) {
      if (!used[i]) return area + Math.floor(i / 8) + '.' + (i % 8);
    }
    return area + '0.0';
  }

  function setStatus(msg) {
    $('statusText').textContent = msg;
  }

  function toast(msg) {
    setStatus(msg);
  }

  /* ================= 启动 ================= */

  function boot() {
    var saved = loadSaved();
    state.program = saved ? saved.program : lib.getProgram('hold');
    state.completed = (saved && saved.completed) || {};
    state.machine = new PLC.Machine(state.program);

    // 深链接：?demo=star&tab=learn&lesson=l2
    var params = new URLSearchParams(location.search);
    if (params.get('demo')) {
      var demo = lib.getProgram(params.get('demo'));
      if (demo) { state.program = demo; state.noSave = true; }
    }

    buildPalette();
    buildFavorites();
    buildExamples();
    buildChips();
    buildLessons();
    bindEvents();
    setupDrag();

    if (params.get('lesson')) showLesson(params.get('lesson'));
    if (params.get('tab')) switchTab(params.get('tab'));
    if (params.get('page')) {
      var pb = document.querySelector('#ribbonTabs button[data-page="' + params.get('page') + '"]');
      if (pb) pb.click();
    }
    if (params.get('run')) setTimeout(start, 50);
    if (params.get('compile')) setTimeout(compileProgram, 120);

    $('projName').value = state.program.name;
    $('scanSel').value = String(state.program.scanMs || 20);
    $('scanSel2').value = String(state.program.scanMs || 20);
    ai.load();
    $('aiEndpoint').value = ai.cfg.endpoint || '';
    $('aiKey').value = ai.cfg.key || '';
    $('aiModel').value = ai.cfg.model || '';

    renderAll();
    setStatus('就绪 · 已载入「' + state.program.name + '」');
  }

  /* ================= 左侧：指令 / 示例 ================= */

  /* ---------- 指令图标（内联 SVG，避免字符图标换行/缺字形） ---------- */
  var IC_WIRE = '<line x1="0" y1="9" x2="7" y2="9"/><line x1="7" y1="3" x2="7" y2="15"/>' +
    '<line x1="12" y1="3" x2="12" y2="15"/><line x1="12" y1="9" x2="22" y2="9"/>';

  function boxIcon(t, fs) {
    return '<rect x="2.5" y="3" width="17" height="12" rx="1"/>' +
      '<text x="11" y="11.7" font-size="' + (fs || 7) + '" text-anchor="middle" stroke="none" fill="currentColor">' + t + '</text>';
  }

  var ICONS = {
    no: IC_WIRE,
    nc: IC_WIRE + '<line x1="8.2" y1="14.5" x2="12" y2="3.5"/>',
    p: IC_WIRE + '<path d="M8.2 1.2 L11 1.2 L9.6 3.8 Z" fill="currentColor" stroke="none"/>',
    n: IC_WIRE + '<path d="M8.2 16.8 L11 16.8 L9.6 14.2 Z" fill="currentColor" stroke="none"/>',
    coil: '<line x1="0" y1="9" x2="5" y2="9"/><path d="M6 3 Q3 9 6 15"/><path d="M16 3 Q19 9 16 15"/><line x1="17" y1="9" x2="22" y2="9"/>',
    set: '<line x1="0" y1="9" x2="5" y2="9"/><path d="M6 3 Q3 9 6 15"/><path d="M16 3 Q19 9 16 15"/><line x1="17" y1="9" x2="22" y2="9"/>' +
      '<text x="11" y="12" font-size="7" text-anchor="middle" stroke="none" fill="currentColor">S</text>',
    reset: '<line x1="0" y1="9" x2="5" y2="9"/><path d="M6 3 Q3 9 6 15"/><path d="M16 3 Q19 9 16 15"/><line x1="17" y1="9" x2="22" y2="9"/>' +
      '<text x="11" y="12" font-size="7" text-anchor="middle" stroke="none" fill="currentColor">R</text>',
    ton: boxIcon('T+'),
    tof: boxIcon('T−'),
    ctu: boxIcon('C+'),
    ctr: boxIcon('R'),
    cmp: boxIcon('≥'),
    move: boxIcon('→'),
    add: boxIcon('+', 9),
    sub: boxIcon('−', 9),
    mul: boxIcon('×', 9),
    div: boxIcon('÷', 9)
  };

  function iconSVG(key, extra) {
    if (key === 'cmp') return '<svg viewBox="0 0 22 18" aria-hidden="true">' + boxIcon(extra || '≥') + '</svg>';
    return '<svg viewBox="0 0 22 18" aria-hidden="true">' + (ICONS[key] || '') + '</svg>';
  }

  var PALETTE = [
    { group: '位逻辑', kind: 'contact', label: '常开触点', icon: 'no', desc: '常开触点（NO）', opts: {} },
    { group: '位逻辑', kind: 'contact', label: '常闭触点', icon: 'nc', desc: '常闭触点（NC）', opts: { nc: true } },
    { group: '位逻辑', kind: 'contact', label: '上升沿', icon: 'p', desc: '上升沿触点 P', opts: { edge: 'P' } },
    { group: '位逻辑', kind: 'contact', label: '下降沿', icon: 'n', desc: '下降沿触点 N', opts: { edge: 'N' } },
    { group: '位逻辑', kind: 'coil', label: '线圈', icon: 'coil', desc: '普通线圈 (=)', opts: { mode: 'out' } },
    { group: '位逻辑', kind: 'coil', label: '置位', icon: 'set', desc: '置位线圈 (S)', opts: { mode: 'set' } },
    { group: '位逻辑', kind: 'coil', label: '复位', icon: 'reset', desc: '复位线圈 (R)', opts: { mode: 'reset' } },

    { group: '定时器操作', kind: 'TON', label: 'TON', icon: 'ton', desc: '接通延时定时器', opts: {} },
    { group: '定时器操作', kind: 'TOF', label: 'TOF', icon: 'tof', desc: '断开延时定时器', opts: {} },

    { group: '计数器操作', kind: 'CTU', label: 'CTU', icon: 'ctu', desc: '加计数器', opts: {} },
    { group: '计数器操作', kind: 'CTR', label: '计数器复位', icon: 'ctr', desc: '复位计数器（R）', opts: {} },

    { group: '比较操作', kind: 'CMP', label: 'CMP ==', icon: 'cmp', desc: '比较：等于', opts: { op: '==' } },
    { group: '比较操作', kind: 'CMP', label: 'CMP <>', icon: 'cmp', desc: '比较：不等于', opts: { op: '<>' } },
    { group: '比较操作', kind: 'CMP', label: 'CMP >', icon: 'cmp', desc: '比较：大于', opts: { op: '>' } },
    { group: '比较操作', kind: 'CMP', label: 'CMP <', icon: 'cmp', desc: '比较：小于', opts: { op: '<' } },
    { group: '比较操作', kind: 'CMP', label: 'CMP >=', icon: 'cmp', desc: '比较：大于等于', opts: { op: '>=' } },
    { group: '比较操作', kind: 'CMP', label: 'CMP <=', icon: 'cmp', desc: '比较：小于等于', opts: { op: '<=' } },

    { group: '移动操作', kind: 'MOVE', label: 'MOVE', icon: 'move', desc: '移动值', opts: {} },

    { group: '数学函数', kind: 'MATH', label: 'ADD', icon: 'add', desc: '加法', opts: { op: 'ADD' } },
    { group: '数学函数', kind: 'MATH', label: 'SUB', icon: 'sub', desc: '减法', opts: { op: 'SUB' } },
    { group: '数学函数', kind: 'MATH', label: 'MUL', icon: 'mul', desc: '乘法', opts: { op: 'MUL' } },
    { group: '数学函数', kind: 'MATH', label: 'DIV', icon: 'div', desc: '除法', opts: { op: 'DIV' } }
  ];

  var FAVORITES = ['常开触点', '常闭触点', '线圈', 'TON', 'CTU', 'CMP >='];

  function setInsert(item, btn) {
    state.insert = { kind: item.kind, opts: Object.assign({}, item.opts), label: item.label };
    document.querySelectorAll('.pal,.fav').forEach(function (x) { x.classList.remove('active'); });
    if (btn) btn.classList.add('active');
    $('paletteHint').textContent = '已选「' + item.label + '」——鼠标移到导线上出现 + 时点击，或直接拖动';
  }

  function buildPalette() {
    var box = $('palette');
    box.innerHTML = '';
    var current = null;
    PALETTE.forEach(function (item, i) {
      if (item.group !== current) {
        current = item.group;
        var g = document.createElement('div');
        g.className = 'pal-group';
        g.textContent = item.group;
        box.appendChild(g);
      }
      var b = document.createElement('button');
      b.className = 'pal' + (i === 0 ? ' active' : '');
      b.dataset.idx = i;
      b.innerHTML = '<span class="ic">' + iconSVG(item.icon, item.opts && item.opts.op) + '</span><span>' + esc(item.label) + '</span>';
      b.title = item.desc || item.label;
      b.addEventListener('click', function () { setInsert(item, b); });
      box.appendChild(b);
    });
  }

  function buildFavorites() {
    var box = $('favorites');
    box.innerHTML = '';
    FAVORITES.forEach(function (label, n) {
      var item = PALETTE.filter(function (p) { return p.label === label; })[0];
      if (!item) return;
      var b = document.createElement('button');
      b.className = 'fav' + (n === 0 ? ' active' : '');
      b.dataset.idx = PALETTE.indexOf(item);
      b.innerHTML = '<span class="ic">' + iconSVG(item.icon, item.opts && item.opts.op) + '</span><span>' + esc(item.label) + '</span>';
      b.title = item.desc || item.label;
      b.addEventListener('click', function () { setInsert(item, b); });
      box.appendChild(b);
    });
  }

  function buildExamples() {
    var box = $('exampleList');
    box.innerHTML = '';
    var groups = {};
    lib.PROGRAMS.forEach(function (p) {
      (groups[p.group] = groups[p.group] || []).push(p);
    });
    Object.keys(groups).forEach(function (g) {
      var h = document.createElement('div');
      h.className = 'hint';
      h.style.margin = '6px 0 2px';
      h.textContent = '— ' + g + ' —';
      box.appendChild(h);
      groups[g].forEach(function (p) {
        var d = document.createElement('div');
        d.className = 'ex';
        d.innerHTML = '<b>' + esc(p.name) + '</b><span>' + esc(p.desc) + '</span>';
        d.addEventListener('click', function () {
          if (!confirm('载入示例「' + p.name + '」会替换当前程序，继续？')) return;
          pushUndo();
          state.program = lib.getProgram(p.id);
          state.selected = null;
          state.selectedRung = 0;
          afterProgramSwap('已载入示例：' + p.name);
        });
        box.appendChild(d);
      });
    });
  }

  function buildChips() {
    var list = [
      '按下启动按钮电机运行，按停止按钮停止',
      '正转反转要互锁，按停止都停',
      '按下启动后延时 3 秒电机启动',
      '指示灯每秒闪烁一次',
      '按 3 次按钮后输出报警',
      '什么是自锁？',
      '双线圈为什么危险？'
    ];
    var box = $('aiChips');
    box.innerHTML = '';
    list.forEach(function (t) {
      var c = document.createElement('button');
      c.className = 'chip';
      c.textContent = t;
      c.addEventListener('click', function () { $('aiInput').value = t; $('aiInput').focus(); });
      box.appendChild(c);
    });
  }

  /* ================= 渲染 ================= */

  function renderAll() {
    renderCanvas();
    buildMonitor();
    updateMonitorValues();
    renderProps();
    renderXref();
    $('projName').value = state.program.name;
    $('rungComment').value = (state.program.rungs[state.selectedRung] || {}).comment || '';
  }

  function viewOpts() {
    return {
      selected: state.selected,
      selectedRung: state.selectedRung,
      showComments: !$('chkComments') || $('chkComments').checked,
      showSymbols: !$('chkSymbols') || $('chkSymbols').checked
    };
  }

  function renderCanvas() {
    var res = R.render(state.program, viewOpts());
    var cv = $('canvas');
    cv.innerHTML = res.svg;
    if ($('chkGrid')) cv.classList.toggle('grid-on', $('chkGrid').checked);
    if (R.setMonitoring) R.setMonitoring(cv, monitoringOn());
    if (state.running || state.machine.scanCount) R.updatePower(cv, state.machine);
  }

  function monitoringOn() {
    if ($('chkValues') && !$('chkValues').checked) return false;
    return state.running || state.machine.scanCount > 0;
  }

  /* ================= 编辑 ================= */

  function pushUndo() {
    state.undo.push(JSON.stringify(state.program));
    if (state.undo.length > 80) state.undo.shift();
    state.redo.length = 0;
  }

  function afterEdit(msg) {
    var old = state.machine;
    state.machine = new PLC.Machine(state.program);
    if (old && old.mem) {
      state.machine.mem.I.set(old.mem.I);
    }
    state.selected = null;
    markDirty();
    renderAll();
    autosave();
    setStatus(msg || '已修改');
  }

  function afterProgramSwap(msg) {
    state.machine = new PLC.Machine(state.program);
    $('scanSel').value = String(state.program.scanMs || 20);
    if ($('scanSel2')) $('scanSel2').value = String(state.program.scanMs || 20);
    state.compiled = false;
    var cst = $('compileState');
    if (cst) { cst.textContent = '未编译'; cst.className = 'compile-state'; }
    renderAll();
    autosave();
    updateRunUI();
    setStatus(msg || '已载入');
  }

  function slotPos(s) {
    var p = String(s).split(':').map(Number);
    return { r: p[0], s: p[1], b: p[2], i: p[3] };
  }

  function insertAt(slot, item) {
    var ins = item || state.insert;
    var t = slotPos(slot);
    var rung = state.program.rungs[t.r];
    if (!rung || !rung.stages[t.s] || !rung.stages[t.s].branches[t.b]) return;
    var opts = Object.assign({}, ins.opts);
    if (ins.kind === 'contact') opts.addr = nextFreeBit('I');
    if (ins.kind === 'coil') opts.addr = nextFreeBit('Q');
    var el = core.makeElement(ins.kind, opts);

    pushUndo();
    rung.stages[t.s].branches[t.b].splice(t.i, 0, el);
    var newId = el.id;
    afterEdit('已插入' + ins.label + '，可在下方「属性」里改地址');
    state.selected = newId;
    renderCanvas();
    renderProps();
    switchTab('props');
  }

  /** 把已有元素移动到某个插入位（拖拽用） */
  function moveElementTo(id, slotStr) {
    var hit = findElement(id);
    if (!hit) return;
    var t = slotPos(slotStr);
    var src = hit.pos;
    var el = hit.el;
    var same = (src.rung === t.r && src.stage === t.s && src.branch === t.b);
    var idx = t.i;
    if (same && idx > src.index) idx -= 1;
    if (same && idx === src.index) { setStatus('位置没有变化'); return; }

    var rung = state.program.rungs[t.r];
    if (!rung || !rung.stages[t.s] || !rung.stages[t.s].branches[t.b]) return;

    pushUndo();
    src.branchArr.splice(src.index, 1);
    rung.stages[t.s].branches[t.b].splice(idx, 0, el);
    cleanupEmpties();
    afterEdit('已移动元素');
    state.selected = id;
    renderCanvas();
    renderProps();
  }

  /** 拖走后清掉空白分支/空白段，避免出现“空分支=直通”的逻辑错误 */
  function cleanupEmpties() {
    state.program.rungs.forEach(function (r) {
      r.stages.forEach(function (s) {
        if (s.branches.length > 1) {
          for (var i = s.branches.length - 1; i >= 0; i--) {
            if (!s.branches[i].length) s.branches.splice(i, 1);
          }
        }
        if (!s.branches.length) s.branches.push([]);
      });
      if (r.stages.length > 1) {
        for (var j = r.stages.length - 1; j >= 0; j--) {
          var allEmpty = r.stages[j].branches.every(function (b) { return !b.length; });
          if (allEmpty) r.stages.splice(j, 1);
        }
      }
      if (!r.stages.length) r.stages.push({ branches: [[]] });
    });
  }

  /* ================= 拖拽（指针事件，鼠标 / 触屏 / 手写笔通用） ================= */

  var dragState = null;
  var suppressUntil = 0;

  function markSuppressClick() { suppressUntil = Date.now() + 350; }

  var KEY_BY_KIND = { TON: 'ton', TOF: 'tof', CTU: 'ctu', CTR: 'ctr', CMP: 'cmp', MOVE: 'move' };

  function elementIconKey(el) {
    if (!el) return 'no';
    if (el.kind === 'contact') return el.edge === 'P' ? 'p' : el.edge === 'N' ? 'n' : (el.nc ? 'nc' : 'no');
    if (el.kind === 'coil') return el.mode === 'set' ? 'set' : el.mode === 'reset' ? 'reset' : 'coil';
    if (el.kind === 'MATH') return { ADD: 'add', SUB: 'sub', MUL: 'mul', DIV: 'div' }[el.op] || 'add';
    return KEY_BY_KIND[el.kind] || 'no';
  }

  function setupDrag() {
    document.addEventListener('pointerdown', dragDown);
    document.addEventListener('pointermove', dragMove, { passive: false });
    document.addEventListener('pointerup', dragUp);
    document.addEventListener('pointercancel', function () {
      if (dragState && dragState.active) { markSuppressClick(); endDrag(); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && dragState && dragState.active) {
        e.preventDefault();
        markSuppressClick();
        endDrag();
        setStatus('已取消拖动');
      }
    });
    // 拖动结束后吃掉紧随其后的那一次 click（只在画布内、350ms 内），
    // 避免松手时误选中元素，也不影响其它按钮
    document.addEventListener('click', function (e) {
      if (!suppressUntil || Date.now() > suppressUntil) return;
      suppressUntil = 0;
      if (!e.target.closest || !e.target.closest('#canvas')) return;
      e.stopPropagation();
      e.preventDefault();
    }, true);
  }

  function dragDown(e) {
    if (e.button != null && e.button !== 0) return;
    var palEl = e.target.closest('.pal,.fav');
    var elNode = e.target.closest('#canvas [data-el]');
    if (!palEl && !elNode) return;
    var payload = null;
    if (palEl && palEl.dataset.idx != null) {
      payload = { type: 'new', item: PALETTE[+palEl.dataset.idx] };
    } else if (elNode) {
      payload = { type: 'move', id: elNode.dataset.el };
    }
    if (!payload) return;
    dragState = { payload: payload, x0: e.clientX, y0: e.clientY, active: false, source: palEl || elNode };
  }

  function dragMove(e) {
    var d = dragState;
    if (!d) return;
    if (!d.active) {
      if (Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) < 6) return;
      startDrag(d);
    }
    if (e.cancelable) e.preventDefault();
    positionGhost(d, e.clientX, e.clientY);
    highlightNearest(d, e);
    autoScroll(d, e);
  }

  function startDrag(d) {
    d.active = true;
    var el = d.payload.type === 'new' ? null : (findElement(d.payload.id) || {}).el;
    var label = d.payload.type === 'new' ? d.payload.item.label : (core.ELEMENT_SPEC[el && el.kind] || {}).label || '指令';
    var key = d.payload.type === 'new' ? d.payload.item.icon : elementIconKey(el);
    var op = d.payload.type === 'new' ? (d.payload.item.opts && d.payload.item.opts.op) : (el && el.op);

    d.ghost = document.createElement('div');
    d.ghost.className = 'drag-ghost';
    d.ghost.innerHTML = iconSVG(key, op) + '<span>' + esc(label) + '</span>';
    document.body.appendChild(d.ghost);
    document.body.classList.add('dragging');
    $('canvas').classList.add('drag-over');
    refreshSlots(d);
  }

  function positionGhost(d, x, y) {
    if (!d.ghost) return;
    d.ghost.style.left = x + 'px';
    d.ghost.style.top = y + 'px';
  }

  function refreshSlots(d) {
    d.slots = Array.prototype.map.call(document.querySelectorAll('#canvas [data-slot]'), function (g) {
      var r = g.getBoundingClientRect();
      return { node: g, slot: g.dataset.slot, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    });
  }

  function highlightNearest(d, e) {
    var best = null, bestD = 95 * 95;
    var i, s, dx, dy, dist;
    for (i = 0; i < d.slots.length; i++) {
      s = d.slots[i];
      dx = s.cx - e.clientX;
      dy = s.cy - e.clientY;
      dist = dx * dx + dy * dy;
      if (dist < bestD) { bestD = dist; best = s; }
    }
    if (best === d.target) return;
    if (d.target) d.target.node.classList.remove('drop');
    d.target = best;
    if (best) best.node.classList.add('drop');
  }

  function autoScroll(d, e) {
    var cv = $('canvas');
    var r = cv.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right) return;
    var dy = 0;
    if (e.clientY < r.top + 42) dy = -18;
    else if (e.clientY > r.bottom - 42) dy = 18;
    if (!dy) return;
    var before = cv.scrollTop;
    cv.scrollTop += dy;
    if (cv.scrollTop !== before) refreshSlots(d);
  }

  function endDrag() {
    var d = dragState;
    if (d && d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
    if (d && d.target) d.target.node.classList.remove('drop');
    document.body.classList.remove('dragging');
    var cv = $('canvas');
    if (cv) cv.classList.remove('drag-over');
    dragState = null;
  }

  function dragUp() {
    var d = dragState;
    if (!d) return;
    if (!d.active) { dragState = null; return; }
    var payload = d.payload;
    var target = d.target;
    markSuppressClick();
    endDrag();
    if (target) {
      if (payload.type === 'new') insertAt(target.slot, payload.item);
      else moveElementTo(payload.id, target.slot);
    } else {
      setStatus('已取消拖动');
    }
  }

  function deleteSelected() {
    if (!state.selected) {
      toast('先选中画布上的元素，或点「删除」删整行');
      return;
    }
    pushUndo();
    removeElement(state.selected);
    afterEdit('已删除元素');
  }

  function deleteRung() {
    if (state.program.rungs.length <= 1) { toast('至少保留一个程序段'); return; }
    pushUndo();
    state.program.rungs.splice(state.selectedRung, 1);
    state.selectedRung = Math.max(0, state.selectedRung - 1);
    afterEdit('已删除程序段');
  }

  function addRung() {
    pushUndo();
    state.program.rungs.push(core.emptyRung(''));
    state.selectedRung = state.program.rungs.length - 1;
    afterEdit('已添加程序段');
  }

  function addParallel() {
    var hit = findElement(state.selected);
    if (!hit) { toast('先选中一个元素，再点「＋ 并联」'); return; }
    pushUndo();
    var el = core.makeElement('contact', { addr: nextFreeBit('I') });
    hit.pos.stageObj.branches.push([el]);
    afterEdit('已加并联分支（自动放了一个常开触点，改地址即可）');
    state.selected = el.id;
    renderCanvas();
    renderProps();
    switchTab('props');
  }

  function undo() {
    if (!state.undo.length) { toast('没有可撤销的操作'); return; }
    state.redo.push(JSON.stringify(state.program));
    state.program = core.normalize(JSON.parse(state.undo.pop()));
    afterEdit('已撤销');
  }

  function redo() {
    if (!state.redo.length) { toast('没有可重做的操作'); return; }
    state.undo.push(JSON.stringify(state.program));
    state.program = core.normalize(JSON.parse(state.redo.pop()));
    afterEdit('已重做');
  }

  /* ================= 监视 ================= */

  function buildMonitor() {
    var addrs = core.collectAddresses(state.program);
    var ins = addrs.bits.filter(function (a) { return /^I/.test(a); });
    for (var i = 0; i < 8; i++) {
      var a = 'I0.' + i;
      if (ins.indexOf(a) < 0) ins.push(a);
    }
    ins.sort(core.addrSort);
    var outs = addrs.bits.filter(function (a) { return /^Q/.test(a); });
    var flags = addrs.bits.filter(function (a) { return /^M/.test(a); });

    $('inputs').innerHTML = ins.map(function (a) { return ioHTML(a, false); }).join('') || '<p class="empty">无</p>';
    $('outputs').innerHTML = outs.length ? outs.map(function (a) { return ioHTML(a, true); }).join('') : '<p class="empty">程序里还没有输出点</p>';
    $('flags').innerHTML = flags.length ? flags.map(function (a) { return ioHTML(a, false); }).join('') : '<p class="empty">无</p>';

    // 定时器 / 计数器
    var tc = [];
    var seen = {};
    core.eachElement(state.program, function (el) {
      if (el.kind === 'TON' || el.kind === 'TOF') {
        if (!seen[el.name]) { seen[el.name] = 1; tc.push({ kind: 'T', name: el.name, pt: el.pt }); }
      }
      if (el.kind === 'CTU' || el.kind === 'CTR') {
        if (!seen[el.name]) { seen[el.name] = 1; tc.push({ kind: 'C', name: el.name, pv: el.pv }); }
      }
    });
    var tbox = $('timers');
    if (!tc.length) {
      tbox.innerHTML = '<p class="empty">程序里还没有定时器 / 计数器</p>';
    } else {
      tbox.innerHTML = tc.map(function (t) {
        return '<div class="tc" data-tc="' + t.kind + ':' + esc(t.name) + '" data-pt="' + (t.pt || t.pv || 1) + '">' +
          '<div class="tc-head"><b>' + esc(t.name) + '</b><span class="v">0</span></div>' +
          '<div class="tc-bar"><i></i></div></div>';
      }).join('');
    }

    // 字地址
    var words = addrs.words;
    $('words').innerHTML = words.length ? words.map(function (a) {
      return '<div class="word"><label>' + esc(a) + '</label><input data-word="' + esc(a) + '" value="0"></div>';
    }).join('') : '<p class="empty">程序里还没有字地址（MW / MD）</p>';

    // 绑定
    ['inputs', 'outputs', 'flags'].forEach(function (id) {
      $(id).onclick = function (e) {
        var b = e.target.closest('[data-bit]');
        if (!b || b.dataset.ro) return;
        var addr = b.dataset.bit;
        var v = state.machine.getBit(addr) ? 0 : 1;
        state.machine.setBit(addr, v);
        if (!state.running) state.machine.scan(0);
        updateMonitorValues();
        R.updatePower($('canvas'), state.machine);
        setStatus((v ? '置位 ' : '复位 ') + addr);
      };
    });
    // 点击行号选中
  }

  function ioHTML(addr, readonly) {
    var sym = state.program.symbols[addr] || {};
    return '<div class="io' + (readonly ? ' ro' : '') + '" data-bit="' + esc(addr) + '"' + (readonly ? ' data-ro="1"' : '') +
      ' title="' + esc(sym.comment || (readonly ? '输出点（只读）' : '点击切换 0/1')) + '">' +
      '<i class="dot"></i><span>' + esc(addr) + '</span>' +
      (sym.name ? '<span class="nm">' + esc(sym.name) + '</span>' : '') + '</div>';
  }

  function updateMonitorValues() {
    var m = state.machine;
    $('canvas').querySelectorAll('[data-bit],[data-el]');
    document.querySelectorAll('#inputs [data-bit], #outputs [data-bit], #flags [data-bit]').forEach(function (n) {
      var on = m.getBit(n.dataset.bit);
      n.classList.toggle('on', !!on);
    });

    document.querySelectorAll('#timers .tc').forEach(function (n) {
      var key = n.dataset.tc.split(':');
      var kind = key[0], name = key[1];
      var valNode = n.querySelector('.v');
      var bar = n.querySelector('.tc-bar i');
      if (kind === 'T') {
        var t = m.timers[name] || { et: 0, pt: +n.dataset.pt || 1, q: 0 };
        var pt = t.pt || +n.dataset.pt || 1;
        valNode.textContent = (t.et / 1000).toFixed(2) + ' / ' + (pt / 1000).toFixed(2) + ' s' + (t.q ? '  Q=1' : '');
        bar.style.width = Math.min(100, (t.et / pt) * 100) + '%';
        n.classList.toggle('on', !!t.q);
      } else {
        var c = m.counters[name] || { cv: 0, pv: +n.dataset.pt || 1, q: 0 };
        var pv = c.pv || +n.dataset.pt || 1;
        valNode.textContent = c.cv + ' / ' + pv + (c.q ? '  Q=1' : '');
        bar.style.width = Math.min(100, (c.cv / pv) * 100) + '%';
        n.classList.toggle('on', !!c.q);
      }
    });

    document.querySelectorAll('#words [data-word]').forEach(function (inp) {
      if (document.activeElement === inp) return;
      inp.value = m.readWord(inp.dataset.word);
    });
  }

  /* ================= 属性 ================= */

  function renderProps() {
    var body = $('propsBody');
    var hit = findElement(state.selected);
    if (!hit) {
      body.innerHTML = statsHTML();
      return;
    }
    var el = hit.el;
    var html = '<div class="prop-kind"><span class="ic">' + esc(el.kind) + '</span>' +
      esc(core.ELEMENT_SPEC[el.kind].label) + '</div>';
    html += '<div class="hint" style="margin:-6px 0 10px">位置：第 ' + (hit.pos.rung + 1) + ' 行 · 第 ' + (hit.pos.stage + 1) + ' 段 · 第 ' + (hit.pos.branch + 1) + ' 支路</div>';

    if (el.kind === 'contact') {
      html += field('地址', '<input data-prop="addr" value="' + esc(el.addr) + '">');
      html += field('状态', '<select data-prop="nc"><option value="0"' + (!el.nc ? ' selected' : '') + '>常开（NO）</option><option value="1"' + (el.nc ? ' selected' : '') + '>常闭（NC）</option></select>');
      html += field('边沿', '<select data-prop="edge"><option value=""' + (!el.edge ? ' selected' : '') + '>无</option><option value="P"' + (el.edge === 'P' ? ' selected' : '') + '>上升沿 P</option><option value="N"' + (el.edge === 'N' ? ' selected' : '') + '>下降沿 N</option></select>');
    } else if (el.kind === 'coil') {
      html += field('地址', '<input data-prop="addr" value="' + esc(el.addr) + '">');
      html += field('模式', '<select data-prop="mode">' +
        ['out', 'set', 'reset'].map(function (m) {
          var label = m === 'out' ? '线圈 (=)' : m === 'set' ? '置位 (S)' : '复位 (R)';
          return '<option value="' + m + '"' + (el.mode === m ? ' selected' : '') + '>' + label + '</option>';
        }).join('') + '</select>');
    } else if (el.kind === 'TON' || el.kind === 'TOF') {
      html += field('实例名', '<input data-prop="name" value="' + esc(el.name) + '">');
      html += field('设定时间 PT（ms）', '<input data-prop="pt" type="number" min="10" step="100" value="' + (+el.pt) + '">');
      html += '<div class="row">' + [500, 1000, 2000, 3000, 5000].map(function (v) {
        return '<button class="btn small" data-preset="pt:' + v + '">' + (v / 1000) + 's</button>';
      }).join('') + '</div>';
    } else if (el.kind === 'CTU') {
      html += field('实例名', '<input data-prop="name" value="' + esc(el.name) + '">');
      html += field('预设值 PV', '<input data-prop="pv" type="number" min="1" step="1" value="' + (+el.pv) + '">');
    } else if (el.kind === 'CTR') {
      html += field('实例名', '<input data-prop="name" value="' + esc(el.name) + '">');
    } else if (el.kind === 'CMP') {
      html += field('比较方式', '<select data-prop="op">' + ['>', '>=', '<', '<=', '==', '<>'].map(function (o) {
        return '<option' + (el.op === o ? ' selected' : '') + '>' + o + '</option>';
      }).join('') + '</select>');
      html += field('操作数 A', '<input data-prop="a" value="' + esc(el.a) + '">');
      html += field('操作数 B', '<input data-prop="b" value="' + esc(el.b) + '">');
    } else if (el.kind === 'MOVE') {
      html += field('源 IN', '<input data-prop="src" value="' + esc(el.src) + '">');
      html += field('目标 OUT', '<input data-prop="dst" value="' + esc(el.dst) + '">');
    } else if (el.kind === 'MATH') {
      html += field('运算', '<select data-prop="op">' + ['ADD', 'SUB', 'MUL', 'DIV'].map(function (o) {
        return '<option' + (el.op === o ? ' selected' : '') + '>' + o + '</option>';
      }).join('') + '</select>');
      html += field('操作数 1', '<input data-prop="a" value="' + esc(el.a) + '">');
      html += field('操作数 2', '<input data-prop="b" value="' + esc(el.b) + '">');
      html += field('结果 OUT', '<input data-prop="dst" value="' + esc(el.dst) + '">');
    }

    var sym = null;
    if (el.addr) sym = (state.program.symbols[el.addr] || null);
    if (sym) html += '<p class="hint">符号：<b>' + esc(sym.name) + '</b>' + (sym.comment ? ' · ' + esc(sym.comment) : '') + '</p>';

    html += '<div class="row"><button class="btn small danger" data-prop-act="del">删除该元素</button></div>';
    body.innerHTML = html;

    body.oninput = function (e) {
      var inp = e.target;
      var prop = inp.dataset.prop;
      if (!prop) return;
      var hit2 = findElement(state.selected);
      if (!hit2) return;
      var el2 = hit2.el;
      if (prop === 'nc') el2.nc = inp.value === '1';
      else if (prop === 'pt' || prop === 'pv') el2[prop] = Math.max(1, parseInt(inp.value, 10) || 0);
      else el2[prop] = inp.value;
      renderCanvas();
      autosave();
    };
    body.onchange = body.oninput;
    body.onclick = function (e) {
      var pre = e.target.closest('[data-preset]');
      if (pre) {
        var pair = pre.dataset.preset.split(':');
        var hit3 = findElement(state.selected);
        if (hit3) { hit3.el[pair[0]] = +pair[1]; renderCanvas(); renderProps(); autosave(); }
        return;
      }
      var act = e.target.closest('[data-prop-act]');
      if (act && act.dataset.propAct === 'del') deleteSelected();
    };
  }

  function field(label, input) {
    return '<div class="prop-row"><label>' + esc(label) + '</label>' + input + '</div>';
  }

  function statsHTML() {
    var n = 0, timers = 0, flags = 0;
    core.eachElement(state.program, function (el) {
      n++;
      if (el.kind === 'TON' || el.kind === 'TOF') timers++;
      if (el.kind === 'CTU') flags++;
    });
    var addrs = core.collectAddresses(state.program);
    var issues = core.validate(state.program);
    var errs = issues.filter(function (i) { return i.level === 'error'; }).length;
    var warns = issues.filter(function (i) { return i.level === 'warn'; }).length;

    var html = '<div class="stat-grid">' +
      '<div class="stat"><b>' + state.program.rungs.length + '</b><span>程序段</span></div>' +
      '<div class="stat"><b>' + n + '</b><span>元素</span></div>' +
      '<div class="stat"><b>' + addrs.bits.length + '</b><span>位地址</span></div>' +
      '<div class="stat"><b>' + (errs + warns) + '</b><span>检查提醒</span></div>' +
      '</div>';

    if (issues.length) {
      html += '<h4 style="font-size:12px;color:#64748b;margin:0 0 6px">程序检查</h4>';
      html += issues.slice(0, 6).map(function (i) {
        return '<div class="hint lv-' + i.level + '">· [' + i.where + '] ' + esc(i.msg) + '</div>';
      }).join('');
    } else {
      html += '<p class="hint">程序结构检查通过。选中元素可编辑地址与参数。</p>';
    }

    var syms = Object.keys(state.program.symbols || {});
    if (syms.length) {
      html += '<h4 style="font-size:12px;color:#64748b;margin:12px 0 6px">变量表</h4>';
      html += '<table class="sym-table">' + syms.map(function (a) {
        var s = state.program.symbols[a];
        return '<tr><td>' + esc(a) + '</td><td>' + esc(s.name || '') + '</td><td>' + esc(s.comment || '') + '</td></tr>';
      }).join('') + '</table>';
    }
    return html;
  }

  /* ================= 运行 ================= */

  function start() {
    if (state.running) return;
    state.running = true;
    state.lastTick = performance.now();
    var period = Math.max(4, +state.program.scanMs || 20);
    state.timer = setInterval(tick, period);
    updateRunUI();
    setStatus('运行中');
  }

  function pause() {
    state.running = false;
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
    updateRunUI();
    setStatus('已暂停');
  }

  function tick() {
    var now = performance.now();
    var dt = now - state.lastTick;
    state.lastTick = now;
    state.machine.scan(dt);
    R.updatePower($('canvas'), state.machine);
    updateMonitorValues();
    updateRunUI();
  }

  function stepOnce() {
    state.machine.scan(+state.program.scanMs || 20);
    R.updatePower($('canvas'), state.machine);
    updateMonitorValues();
    updateRunUI();
    setStatus('已执行 1 个扫描周期');
  }

  function resetSim() {
    state.machine.reset();
    renderCanvas();
    updateMonitorValues();
    updateRunUI();
    setStatus('已复位：I/Q/M 与定时器全部清零');
  }

  function updateRunUI() {
    var label = state.running ? '⏸ 停止监视' : '▶ 监视';
    ['btnRun', 'btnRun2'].forEach(function (id) {
      var b = $(id);
      if (!b) return;
      b.innerHTML = '<i>' + (state.running ? '⏸' : '▶') + '</i><span>' + (state.running ? '停止监视' : '监视') + '</span>';
      b.classList.toggle('active', state.running);
      b.title = label;
    });
    var conn = $('connState');
    if (conn) {
      conn.textContent = state.running ? '在线' : '离线';
      conn.classList.toggle('online', state.running);
    }
    var pill = $('simState');
    pill.textContent = state.running ? '在线 · 监视中' : '离线';
    pill.classList.toggle('run', state.running);
    $('scanInfo').textContent = '扫描 ' + state.machine.scanCount + ' 次 · 周期 ' + (+state.program.scanMs || 20) + ' ms';
    if (R.setMonitoring) R.setMonitoring($('canvas'), monitoringOn());
  }

  /* ================= 编译 / 交叉引用 / 信息 ================= */

  function jumpToRung(ri) {
    if (ri == null || !state.program.rungs[ri]) return;
    state.selectedRung = ri;
    state.selected = null;
    renderCanvas();
    renderProps();
    $('rungComment').value = (state.program.rungs[ri] || {}).comment || '';
    var g = document.querySelector('#canvas .net[data-rung="' + ri + '"]');
    if (g && g.scrollIntoView) {
      try { g.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { g.scrollIntoView(); }
    }
    setStatus('已定位到程序段 ' + (ri + 1));
  }

  function markDirty() {
    var n = $('compileState');
    if (!n || !state.compiled) return;
    state.compiled = false;
    n.textContent = '未编译（已修改）';
    n.className = 'compile-state';
  }

  function compileProgram() {
    var issues = nlp.diagnose(state.program);
    var errs = issues.filter(function (i) { return i.level === 'error'; });
    var warns = issues.filter(function (i) { return i.level === 'warn'; });
    var infos = issues.filter(function (i) { return i.level === 'info'; });
    state.compiled = true;

    var st = $('compileState');
    if (errs.length) {
      st.textContent = '编译未通过：' + errs.length + ' 个错误，' + warns.length + ' 个警告';
      st.className = 'compile-state bad';
    } else {
      st.textContent = '编译通过 · ' + warns.length + ' 个警告 · ' + infos.length + ' 条提示';
      st.className = 'compile-state good';
    }

    var ok = issues.filter(function (i) { return i.level === 'ok'; });
    var list = errs.concat(warns, infos, ok);
    var html = '<div class="info-sum">' +
      '<span class="badge err">' + errs.length + ' 错误</span>' +
      '<span class="badge warn">' + warns.length + ' 警告</span>' +
      '<span class="badge info">' + infos.length + ' 提示</span>' +
      '</div>';
    html += list.map(function (i) {
      var rung = /第\s*(\d+)\s*行/.exec(i.where || '');
      var idx = rung ? +rung[1] - 1 : '';
      return '<div class="info-row lv-' + i.level + '"' + (idx !== '' ? ' data-rung="' + idx + '"' : '') + '>' +
        '<span class="ic">' + (i.level === 'error' ? '✕' : i.level === 'warn' ? '!' : i.level === 'ok' ? '✓' : 'i') + '</span>' +
        '<span class="where">' + esc(i.where) + '</span>' +
        '<span class="msg">' + esc(i.msg) + '</span></div>';
    }).join('');
    $('infoBody').innerHTML = html;
    switchTab('info');
    setStatus(errs.length ? '编译失败：' + errs.length + ' 个错误' : '编译通过');
  }

  function renderXref() {
    var map = {};
    function add(addr, ri, use, kind) {
      if (!addr) return;
      var a = String(addr).trim().toUpperCase();
      if (!/^[IQM]\d/.test(a) && !/^(MW|MD|MB|IW|QW|ID|QD)\d/.test(a) && !/^[TC]\d+\.Q$/.test(a)) return;
      (map[a] = map[a] || []).push({ rung: ri, use: use, kind: kind });
    }
    state.program.rungs.forEach(function (r, ri) {
      r.stages.forEach(function (s) {
        s.branches.forEach(function (b) {
          b.forEach(function (el) {
            if (el.kind === 'contact') add(el.addr, ri, '读', '触点');
            else if (el.kind === 'coil') add(el.addr, ri, el.mode === 'out' ? '写' : (el.mode === 'set' ? '置位' : '复位'), '线圈');
            else if (el.kind === 'CMP') { add(el.a, ri, '读', '比较'); add(el.b, ri, '读', '比较'); }
            else if (el.kind === 'MOVE') { add(el.src, ri, '读', 'MOVE'); add(el.dst, ri, '写', 'MOVE'); }
            else if (el.kind === 'MATH') { add(el.a, ri, '读', '算术'); add(el.b, ri, '读', '算术'); add(el.dst, ri, '写', '算术'); }
            else if (el.kind === 'TON' || el.kind === 'TOF') add((el.name || '') + '.Q', ri, '输出', '定时器');
            else if (el.kind === 'CTU') add((el.name || '') + '.Q', ri, '输出', '计数器');
          });
        });
      });
    });

    var keys = Object.keys(map).sort(core.addrSort);
    var box = $('xrefBody');
    if (!box) return;
    if (!keys.length) {
      box.innerHTML = '<p class="empty">程序里还没有可交叉引用的操作数</p>';
      return;
    }
    var total = 0;
    var rows = '';
    keys.forEach(function (a) {
      var sym = state.program.symbols[a] || {};
      var label = (/^[IQM]\d/.test(a) || /^(MW|MD|MB|IW|QW|ID|QD)\d/.test(a)) ? '%' + a : a;
      map[a].forEach(function (u, i) {
        total++;
        rows += '<tr' + (i === 0 ? ' class="first"' : '') + ' data-rung="' + u.rung + '">' +
          '<td class="mono">' + (i === 0 ? esc(label) : '') + '</td>' +
          '<td class="sym">' + (i === 0 && sym.name ? '&quot;' + esc(sym.name) + '&quot;' : '') + '</td>' +
          '<td class="use ' + (u.use === '读' ? 'r' : 'w') + '">' + esc(u.use) + '</td>' +
          '<td class="kind">' + esc(u.kind) + '</td>' +
          '<td class="loc">程序段 ' + (u.rung + 1) + '</td></tr>';
      });
    });
    box.innerHTML = '<div class="xref-sum">共 ' + keys.length + ' 个操作数、' + total + ' 处引用（点某行跳到对应程序段）</div>' +
      '<table class="xref-table"><thead><tr><th>操作数</th><th>符号</th><th>用法</th><th>类别</th><th>位置</th></tr></thead><tbody>' +
      rows + '</tbody></table>';
  }

  /* ================= AI ================= */

  function aiOut(html) {
    $('aiOut').innerHTML = html;
  }

  function notesHTML(title, notes, extra) {
    return '<div class="ttl">' + esc(title) + '</div>' +
      notes.map(function (n) { return '<div class="note">' + n.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>') + '</div>'; }).join('') +
      (extra || '');
  }

  function loadGenerated(program, notes, title) {
    pushUndo();
    state.program = program;
    state.selected = null;
    state.selectedRung = 0;
    afterProgramSwap('已生成：' + (program.name || title || '程序'));
    aiOut(notesHTML(title || program.name || '已生成', notes || [], '<p class="hint">已经放进编辑器，可直接运行验证；不满意可 Ctrl+Z 撤销。</p>'));
  }

  function generate() {
    var text = ($('aiInput').value || '').trim();
    if (!text) { aiOut('<div class="err">请先写一句控制要求，或者问一个问题。</div>'); return; }

    // 先看是不是知识类提问
    var qa = nlp.ask(text);
    if (qa) {
      aiOut('<div class="ttl">' + esc(qa.title) + '</div>' + qa.body.split('\n').map(function (l) {
        return '<div class="note">' + esc(l).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>') + '</div>';
      }).join(''));
      setStatus('已从离线知识库作答');
      return;
    }

    if (ai.enabled()) {
      aiOut('<div class="note">正在调用大模型…</div>');
      ai.generate(text).then(function (program) {
        loadGenerated(program, ['已通过结构校验。', '生成结果务必逐行核对 I/O 地址与联锁条件。'], program.name);
      }).catch(function (err) {
        var r = nlp.nlToProgram(text);
        if (r.ok) {
          loadGenerated(r.program, r.notes, r.title);
          aiOut(notesHTML(r.title, r.notes, '<div class="err">大模型调用失败（' + esc(err.message) + '），已改用离线规则引擎生成。</div>'));
        } else {
          aiOut('<div class="err">大模型调用失败：' + esc(err.message) + '</div><div class="note">离线引擎也没能识别这句话。</div>');
        }
      });
      return;
    }

    var r = nlp.nlToProgram(text);
    if (!r.ok) {
      aiOut('<div class="err">' + esc(r.error) + '</div>' +
        (r.suggestions || []).map(function (s) { return '<div class="note">· ' + esc(s) + '</div>'; }).join(''));
      return;
    }
    loadGenerated(r.program, r.notes, r.title);
  }

  function explainProgram() {
    var txt = nlp.explain(state.program);
    if (ai.enabled()) {
      aiOut('<div class="note">离线解释：</div>' + txt.split('\n').map(function (l) { return '<div class="note">' + esc(l) + '</div>'; }).join(''));
      ai.explain(state.program, txt).then(function (more) {
        aiOut('<div class="note">离线解释：</div>' + txt.split('\n').map(function (l) { return '<div class="note">' + esc(l) + '</div>'; }).join('') +
          '<div class="ttl" style="margin-top:10px">大模型补充</div><div class="note">' + esc(more) + '</div>');
      }).catch(function () { /* 保持离线结果 */ });
      return;
    }
    aiOut(txt.split('\n').map(function (l) {
      return '<div class="note">' + l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>') + '</div>';
    }).join(''));
  }

  function diagnoseProgram() {
    var issues = nlp.diagnose(state.program);
    aiOut('<div class="ttl">程序体检</div>' + issues.map(function (i) {
      var icon = i.level === 'error' ? '✕' : i.level === 'warn' ? '!' : i.level === 'ok' ? '✓' : 'i';
      return '<div class="note lv-' + i.level + '"><b>' + icon + '</b> [' + esc(i.where) + '] ' + esc(i.msg) + '</div>';
    }).join(''));
  }

  /* ================= 学习 ================= */

  function buildLessons() {
    var box = $('lessonList');
    box.innerHTML = '';
    var doneCount = 0;
    lib.LESSONS.forEach(function (ls) {
      if (state.completed[ls.id]) doneCount++;
      var d = document.createElement('div');
      d.className = 'ls' + (state.completed[ls.id] ? ' done' : '');
      d.dataset.id = ls.id;
      d.innerHTML = '<span class="lv">' + (state.completed[ls.id] ? '✓' : ls.level) + '</span><span>' + esc(ls.title) + '</span>';
      d.addEventListener('click', function () { showLesson(ls.id); });
      box.appendChild(d);
    });
    var tip = document.createElement('p');
    tip.className = 'hint';
    tip.textContent = '已完成 ' + doneCount + ' / ' + lib.LESSONS.length + ' 关 · 判分会真正跑仿真';
    box.appendChild(tip);
  }

  function showLesson(id) {
    var ls = lib.LESSONS.filter(function (l) { return l.id === id; })[0];
    if (!ls) return;
    state.lesson = ls;
    document.querySelectorAll('.ls').forEach(function (n) { n.classList.toggle('active', n.dataset.id === id); });
    var html = '<h4>' + esc(ls.title) + '</h4>' +
      '<span class="lv" style="background:#0d9488;color:#fff;border-radius:4px;padding:1px 6px;font-size:10px">' + esc(ls.level) + '</span>' +
      '<div class="goal">' + esc(ls.goal) + '</div>' +
      '<b>要点</b><ul>' + ls.points.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' +
      '<p class="hint">提示：' + esc(ls.hint) + '</p>' +
      '<div class="row"><button class="btn small" data-lesson="demo">载入参考程序</button>' +
      '<button class="btn small primary" data-lesson="grade">判分</button></div>' +
      '<div id="lessonResult"></div>';
    $('lessonDetail').innerHTML = html;
    $('lessonDetail').onclick = function (e) {
      var b = e.target.closest('[data-lesson]');
      if (!b) return;
      if (b.dataset.lesson === 'demo') {
        pushUndo();
        state.program = lib.getProgram(ls.demo);
        afterProgramSwap('已载入参考程序');
        setStatus('已载入参考程序，按「运行」观察现象');
      } else {
        gradeLesson(ls);
      }
    };
  }

  function gradeLesson(ls) {
    var results = [];
    ls.tests.forEach(function (t) {
      var m = new PLC.Machine(state.program);
      m.reset();
      var detail = [];
      t.steps.forEach(function (st) {
        Object.keys(st.set || {}).forEach(function (a) { m.setBit(a, st.set[a]); });
        var remain = st.ms || 0;
        var guard = 0;
        do {
          var dt = Math.min(+state.program.scanMs || 20, remain) || (+state.program.scanMs || 20);
          m.scan(dt);
          remain -= dt;
          guard++;
        } while (remain > 0 && guard < 100000);
      });
      var bad = [];
      Object.keys(t.expect || {}).forEach(function (a) {
        var got = m.getBit(a);
        if ((got ? 1 : 0) !== (t.expect[a] ? 1 : 0)) bad.push(a + ' 期望' + t.expect[a] + '，实际' + got);
      });
      results.push({ name: t.name, ok: bad.length === 0, detail: bad.join('；') });
    });
    var passAll = results.every(function (r) { return r.ok; });
    var html = '<div class="test-result">' + results.map(function (r) {
      return '<div class="tr ' + (r.ok ? 'pass' : 'fail') + '"><span class="mk">' + (r.ok ? '✓' : '✕') + '</span><span>' +
        esc(r.name) + (r.ok ? '' : '<br><small>' + esc(r.detail) + '</small>') + '</span></div>';
    }).join('') + '</div>';
    html += passAll ? '<p class="hint" style="color:#15803d">全部通过！这一关达标了。</p>'
      : '<p class="hint">还有用例没过。按提示检查：地址是否用对、串联/并联位置是否正确、定时器 PT 是否合适。</p>';
    $('lessonResult').innerHTML = html;
    if (passAll) {
      state.completed[ls.id] = 1;
      buildLessons();
      autosave();
      setStatus('通过「' + ls.title + '」');
    } else {
      setStatus('判分未通过：' + results.filter(function (r) { return !r.ok; }).length + ' 项失败');
    }
  }

  /* ================= 文件 / 存储 ================= */

  function autosave() {
    if (state.noSave) return;
    clearTimeout(state.saveT);
    state.saveT = setTimeout(function () {
      try {
        localStorage.setItem(AUTOKEY, JSON.stringify({
          program: state.program,
          completed: state.completed,
          savedAt: Date.now()
        }));
      } catch (e) { /* 配额超了也无所谓 */ }
    }, 400);
  }

  function loadSaved() {
    try {
      var raw = localStorage.getItem(AUTOKEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.program) return null;
      return { program: core.normalize(obj.program), completed: obj.completed || {} };
    } catch (e) { return null; }
  }

  function saveNow() {
    try {
      localStorage.setItem(AUTOKEY, JSON.stringify({ program: state.program, completed: state.completed, savedAt: Date.now() }));
      setStatus('已保存到本机浏览器（下次打开自动恢复）');
    } catch (e) {
      setStatus('保存失败：' + e.message);
    }
  }

  function exportJSON() {
    var data = { app: 'plc-studio', version: 1, exportedAt: new Date().toISOString(), program: state.program };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (state.program.name || 'program').replace(/[\\/:*?"<>|]/g, '_') + '.plcstudio.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    setStatus('已导出 JSON');
  }

  function importJSON(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var obj = JSON.parse(String(reader.result));
        var prog = core.normalize(obj.program || obj);
        pushUndo();
        state.program = prog;
        afterProgramSwap('已导入：' + prog.name);
      } catch (e) {
        setStatus('导入失败：不是合法的程序文件');
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  function newProject() {
    if (!confirm('新建会清空当前程序（可撤销），继续？')) return;
    pushUndo();
    state.program = core.emptyProgram('未命名项目');
    state.selectedRung = 0;
    afterProgramSwap('已新建空白项目');
  }

  /* ================= 交互绑定 ================= */

  function switchTab(name) {
    state.tab = name;
    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === name);
    });
    document.querySelectorAll('.tab-body').forEach(function (b) {
      b.classList.toggle('active', b.id === 'tab-' + name);
    });
  }

  function bindEvents() {
    // 画布点击
    $('canvas').addEventListener('click', function (e) {
      var ghost = e.target.closest('[data-slot]');
      if (ghost) { insertAt(ghost.dataset.slot); return; }
      var elNode = e.target.closest('[data-el]');
      if (elNode) {
        state.selected = elNode.dataset.el;
        var hit = findElement(state.selected);
        if (hit) state.selectedRung = hit.pos.rung;
        renderCanvas();
        updateMonitorValues();
        renderProps();
        $('rungComment').value = (state.program.rungs[state.selectedRung] || {}).comment || '';
        switchTab('props');
        return;
      }
      var act = e.target.closest('[data-rung-act]');
      if (act) {
        var pair = act.dataset.rungAct.split(':');
        var idx = +pair[1];
        if (pair[0] === 'del') {
          state.selectedRung = idx;
          deleteRung();
        } else if (pair[0] === 'up' && idx > 0) {
          pushUndo();
          var tmp = state.program.rungs[idx - 1];
          state.program.rungs[idx - 1] = state.program.rungs[idx];
          state.program.rungs[idx] = tmp;
          state.selectedRung = idx - 1;
          afterEdit('已上移');
        } else if (pair[0] === 'down' && idx < state.program.rungs.length - 1) {
          pushUndo();
          var t2 = state.program.rungs[idx + 1];
          state.program.rungs[idx + 1] = state.program.rungs[idx];
          state.program.rungs[idx] = t2;
          state.selectedRung = idx + 1;
          afterEdit('已下移');
        }
        return;
      }
      var head = e.target.closest('[data-rung]');
      if (head) {
        state.selectedRung = +head.dataset.rung;
        $('rungComment').value = (state.program.rungs[state.selectedRung] || {}).comment || '';
        renderCanvas();
        setStatus('已选中程序段 ' + (state.selectedRung + 1));
      } else {
        state.selected = null;
        renderCanvas();
        renderProps();
      }
    });

    $('rungComment').addEventListener('change', function () {
      var r = state.program.rungs[state.selectedRung];
      if (!r) return;
      r.comment = this.value;
      renderCanvas();
      autosave();
      setStatus('行注释已更新');
    });

    $('btnAddRung').onclick = addRung;
    $('btnParallel').onclick = addParallel;
    $('btnUndo').onclick = undo;
    $('btnRedo').onclick = redo;
    $('btnDelete').onclick = function () { state.selected ? deleteSelected() : deleteRung(); };

    // 编译 / 下载
    if ($('btnCompile')) $('btnCompile').onclick = compileProgram;
    if ($('btnCompile2')) $('btnCompile2').onclick = compileProgram;
    if ($('btnDownload')) {
      $('btnDownload').onclick = function () { setStatus('本仿真器不连接真实 PLC，无法下载到设备'); };
    }
    if ($('infoBody')) {
      $('infoBody').onclick = function (e) {
        var row = e.target.closest('[data-rung]');
        if (row) jumpToRung(+row.dataset.rung);
      };
    }
    if ($('xrefBody')) {
      $('xrefBody').onclick = function (e) {
        var tr = e.target.closest('tr[data-rung]');
        if (tr) jumpToRung(+tr.dataset.rung);
      };
    }

    // 指令搜索
    if ($('palSearch')) {
      $('palSearch').oninput = function () {
        var q = this.value.trim().toLowerCase();
        var groups = [];
        var current = null;
        Array.prototype.forEach.call(document.querySelectorAll('#palette .pal-group, #palette .pal'), function (n) {
          if (n.classList.contains('pal-group')) {
            current = { node: n, hit: false };
            groups.push(current);
            return;
          }
          var txt = (n.textContent + ' ' + (n.title || '')).toLowerCase();
          var hit = !q || txt.indexOf(q) >= 0;
          n.style.display = hit ? '' : 'none';
          if (hit && current) current.hit = true;
        });
        groups.forEach(function (g) { g.node.style.display = g.hit ? '' : 'none'; });
      };
    }

    // 项目树展开 / 收起
    Array.prototype.forEach.call(document.querySelectorAll('.tnode[data-toggle]'), function (n) {
      n.onclick = function (e) {
        e.stopPropagation();
        var next = n.nextElementSibling;
        if (!next || !next.classList.contains('tchildren')) return;
        var open = next.classList.toggle('open');
        var tw = n.querySelector('.tw');
        if (tw) tw.textContent = open ? '▾' : '▸';
      };
    });

    if ($('treeVars')) $('treeVars').onclick = function () { switchTab('props'); setStatus('变量表：在「属性」页可查看符号表'); };
    if ($('treeWatch')) $('treeWatch').onclick = function () { switchTab('monitor'); setStatus('监控表：在「监视」页查看实时值'); };

    function toggleRun() { state.running ? pause() : start(); }
    $('btnRun').onclick = toggleRun;
    $('btnRun2').onclick = toggleRun;
    $('btnStep').onclick = stepOnce;
    $('btnStep2').onclick = stepOnce;
    $('btnReset').onclick = resetSim;
    $('btnReset2').onclick = resetSim;

    function changeScan(v) {
      state.program.scanMs = +v;
      $('scanSel').value = String(v);
      $('scanSel2').value = String(v);
      if (state.running) { pause(); start(); }
      updateRunUI();
      autosave();
      setStatus('扫描周期改为 ' + v + ' ms');
    }
    $('scanSel').onchange = function () { changeScan(this.value); };
    $('scanSel2').onchange = function () { changeScan(this.value); };

    // 功能区页签
    document.querySelectorAll('#ribbonTabs button').forEach(function (b) {
      b.onclick = function () {
        document.querySelectorAll('#ribbonTabs button').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        document.querySelectorAll('.ribbon-page').forEach(function (p) {
          p.classList.toggle('active', p.id === 'page-' + b.dataset.page);
        });
      };
    });

    // 视图选项
    ['chkComments', 'chkSymbols', 'chkGrid', 'chkValues'].forEach(function (id) {
      var n = $(id);
      if (n) n.onchange = function () { renderCanvas(); };
    });

    // 项目树中的块节点
    var block = $('treeBlock');
    if (block) block.onclick = function () { setStatus('正在编辑 Main [OB1]'); };

    // 巡视窗口拖动调整高度
    var rz = $('inspResizer');
    if (rz) {
      var dragging = false;
      rz.addEventListener('mousedown', function (e) {
        dragging = true; e.preventDefault();
        document.body.style.cursor = 'ns-resize';
      });
      window.addEventListener('mousemove', function (e) {
        if (!dragging) return;
        var h = window.innerHeight - e.clientY;
        h = Math.max(120, Math.min(h, window.innerHeight * 0.72));
        document.querySelector('.inspector').style.height = h + 'px';
      });
      window.addEventListener('mouseup', function () {
        if (!dragging) return;
        dragging = false;
        document.body.style.cursor = '';
      });
    }

    $('btnNew').onclick = newProject;
    $('btnSave').onclick = saveNow;
    $('btnExport').onclick = exportJSON;
    $('btnImport').onclick = function () { $('fileInput').click(); };
    $('fileInput').onchange = function () {
      if (this.files && this.files[0]) importJSON(this.files[0]);
      this.value = '';
    };

    $('projName').oninput = function () {
      state.program.name = this.value;
      autosave();
    };

    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.onclick = function () { switchTab(b.dataset.tab); };
    });

    $('aiGen').onclick = generate;
    $('aiExplain').onclick = explainProgram;
    $('aiDiag').onclick = diagnoseProgram;

    $('aiSettingsToggle').onclick = function (e) {
      e.preventDefault();
      $('aiSettings').classList.toggle('hidden');
    };
    $('aiSaveCfg').onclick = function () {
      ai.save({
        endpoint: $('aiEndpoint').value.trim(),
        key: $('aiKey').value.trim(),
        model: $('aiModel').value.trim() || 'deepseek-chat'
      });
      setStatus(ai.enabled() ? '已保存 API 配置，将优先用大模型生成' : '已保存（未填 Key，仍用离线引擎）');
    };
    $('aiClearCfg').onclick = function () {
      ai.save({ endpoint: $('aiEndpoint').value.trim() || 'https://api.deepseek.com/v1/chat/completions', key: '', model: 'deepseek-chat' });
      $('aiKey').value = '';
      setStatus('已清除 Key');
    };

    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (e.key === 'Escape') {
        state.selected = null;
        renderCanvas();
        renderProps();
        if (typing) e.target.blur();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !typing) {
        e.preventDefault();
        redo();
        return;
      }
      if (typing) return;
      if (e.key === ' ') {
        e.preventDefault();
        state.running ? pause() : start();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (state.selected) deleteSelected();
      }
    });

    window.addEventListener('beforeunload', function () {
      if (state.noSave) return;
      try {
        localStorage.setItem(AUTOKEY, JSON.stringify({ program: state.program, completed: state.completed, savedAt: Date.now() }));
      } catch (e) { /* ignore */ }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
