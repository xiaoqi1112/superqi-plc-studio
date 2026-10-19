/* ============================================================
 * render.js — TIA Portal 风格梯形图渲染器（纯函数）
 * 对照博途：黑色细线、青色地址、黑色符号名、紧凑间距、
 *          程序段标题 + 注释行
 * ============================================================ */
(function (global) {
  'use strict';
  var PLC = (global.PLC = global.PLC || {});
  var core = PLC.core;

  var RAIL_X = 20;
  var ROW_H = 64;
  var GAP = 18;
  var HEADER = 46;
  var RUNG_GAP = 8;
  var RIGHT_PAD = 84;

  var W_CONTACT = 46;
  var W_COIL = 46;
  var W_BOX = 128;
  var BAR = 11;      // 触点竖线半高

  var index = {};

  function widthFor(el) {
    if (el.kind === 'contact') return W_CONTACT;
    if (el.kind === 'coil') return W_COIL;
    return W_BOX;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function symOf(program, addr) {
    var s = program.symbols && program.symbols[String(addr).toUpperCase()];
    return s && s.name ? s.name : '';
  }

  function addrText(a) {
    var s = String(a || '');
    if (/^[IQM]\d/.test(s) || /^(MW|MD|MB|IW|QW|ID|QD)/.test(s)) return '%' + s;
    return s;
  }

  function symText(name) {
    return name ? '"' + name + '"' : '';
  }

  /* ---------- 元素 ---------- */

  function valueBadge(el, x, cy) {
    return '<text class="val" data-val="' + el.id + '" x="' + (x + widthFor(el) - 1) + '" y="' + (cy - 30) + '">0</text>';
  }

  function drawContact(el, x, cy, program, opts) {
    var w = W_CONTACT;
    var mid = x + w / 2;
    var b1 = mid - 5, b2 = mid + 5;
    var p = [];
    p.push('<line class="wire" x1="' + x + '" y1="' + cy + '" x2="' + b1 + '" y2="' + cy + '"/>');
    p.push('<line class="wire" x1="' + b2 + '" y1="' + cy + '" x2="' + (x + w) + '" y2="' + cy + '"/>');
    p.push('<line class="sym" x1="' + b1 + '" y1="' + (cy - BAR) + '" x2="' + b1 + '" y2="' + (cy + BAR) + '"/>');
    p.push('<line class="sym" x1="' + b2 + '" y1="' + (cy - BAR) + '" x2="' + b2 + '" y2="' + (cy + BAR) + '"/>');
    if (el.nc) p.push('<line class="sym" x1="' + (b2 - 7) + '" y1="' + (cy + 8) + '" x2="' + (b2 + 7) + '" y2="' + (cy - 8) + '"/>');
    if (el.edge) p.push('<text class="edge" x="' + (b2 + 3) + '" y="' + (cy - 13) + '">' + el.edge + '</text>');
    p.push('<text class="addr" x="' + mid + '" y="' + (cy - 16) + '">' + esc(addrText(el.addr)) + '</text>');
    if (opts.showSymbols !== false) {
      var nm = symOf(program, el.addr);
      if (nm) p.push('<text class="sym-name" x="' + mid + '" y="' + (cy + 24) + '">' + esc(symText(nm)) + '</text>');
    }
    p.push(valueBadge(el, x, cy));
    return p.join('');
  }

  function drawCoil(el, x, cy, program, opts) {
    var w = W_COIL;
    var mid = x + w / 2;
    var lx = mid - 5, rx = mid + 5;
    var p = [];
    p.push('<line class="wire" x1="' + x + '" y1="' + cy + '" x2="' + (lx - 7) + '" y2="' + cy + '"/>');
    p.push('<line class="wire" x1="' + (rx + 7) + '" y1="' + cy + '" x2="' + (x + w) + '" y2="' + cy + '"/>');
    p.push('<path class="sym" d="M ' + lx + ' ' + (cy - 11) + ' Q ' + (lx - 8) + ' ' + cy + ' ' + lx + ' ' + (cy + 11) + '"/>');
    p.push('<path class="sym" d="M ' + rx + ' ' + (cy - 11) + ' Q ' + (rx + 8) + ' ' + cy + ' ' + rx + ' ' + (cy + 11) + '"/>');
    var tag = el.mode === 'set' ? 'S' : el.mode === 'reset' ? 'R' : '';
    if (tag) p.push('<text class="tag" x="' + mid + '" y="' + (cy + 4) + '">' + tag + '</text>');
    p.push('<text class="addr" x="' + mid + '" y="' + (cy - 16) + '">' + esc(addrText(el.addr)) + '</text>');
    if (opts.showSymbols !== false) {
      var nm = symOf(program, el.addr);
      if (nm) p.push('<text class="sym-name" x="' + mid + '" y="' + (cy + 24) + '">' + esc(symText(nm)) + '</text>');
    }
    p.push(valueBadge(el, x, cy));
    return p.join('');
  }

  function roundRect(x, y, w, h) {
    return '<rect class="box" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '"/>';
  }

  function drawBox(el, x, cy, program, opts) {
    var w = W_BOX, h = 48, y = cy - h / 2 + 2;
    var p = [];
    p.push(roundRect(x, y, w, h));

    var title = '', inst = '', l1 = '', l2 = '', r1 = '', r2 = '';
    switch (el.kind) {
      case 'TON': title = 'TON'; inst = el.name; l1 = 'IN'; r1 = 'Q'; l2 = 'PT  T#' + fmtT(el.pt); r2 = 'ET'; break;
      case 'TOF': title = 'TOF'; inst = el.name; l1 = 'IN'; r1 = 'Q'; l2 = 'PT  T#' + fmtT(el.pt); r2 = 'ET'; break;
      case 'CTU': title = 'CTU'; inst = el.name; l1 = 'CU'; r1 = 'Q'; l2 = 'PV  ' + el.pv; r2 = 'CV'; break;
      case 'CTR': title = 'R'; inst = el.name; l1 = 'R'; r1 = ''; l2 = '复位计数器'; r2 = ''; break;
      case 'CMP': title = 'CMP'; l1 = 'EN'; r1 = 'ENO'; l2 = esc(el.a) + ' ' + esc(el.op) + ' ' + esc(el.b); r2 = ''; break;
      case 'MOVE': title = 'MOVE'; l1 = 'EN'; r1 = 'ENO'; l2 = esc(el.src) + ' → ' + esc(el.dst); r2 = ''; break;
      case 'MATH': title = el.op; l1 = 'EN'; r1 = 'ENO'; l2 = esc(el.a) + opSym(el.op) + esc(el.b) + ' → ' + esc(el.dst); r2 = ''; break;
    }

    if (inst) p.push('<text class="box-inst" x="' + (x + 2) + '" y="' + (cy - 28) + '">' + esc(inst) + '</text>');
    p.push('<text class="box-title" x="' + (x + 7) + '" y="' + (cy - 12) + '">' + esc(title) + '</text>');
    if (l1) p.push('<text class="box-pin" x="' + (x + 7) + '" y="' + (cy + 2) + '">' + l1 + '</text>');
    if (r1) p.push('<text class="box-pin" x="' + (x + w - 7) + '" y="' + (cy + 2) + '" text-anchor="end">' + r1 + '</text>');
    if (l2) p.push('<text class="box-sub" x="' + (x + 7) + '" y="' + (cy + 15) + '">' + l2 + '</text>');
    if (r2) p.push('<text class="box-sub" x="' + (x + w - 7) + '" y="' + (cy + 15) + '" text-anchor="end">' + r2 + '</text>');

    if (el.kind === 'TON' || el.kind === 'TOF' || el.kind === 'CTU') {
      p.push('<text class="box-val" data-boxval="' + el.id + '" x="' + (x + w - 7) + '" y="' + (cy + 24) + '" text-anchor="end"></text>');
    }
    return p.join('');
  }

  function opSym(op) {
    return { ADD: '+', SUB: '−', MUL: '×', DIV: '÷' }[op] || '+';
  }

  function fmtT(ms) {
    ms = +ms || 0;
    if (ms >= 1000) return (ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1) + 's';
    return ms + 'ms';
  }

  function drawElement(el, x, cy, program, opts) {
    index[el.id] = { kind: el.kind, addr: el.addr, name: el.name };
    var g = '<g class="el' + (opts.selected === el.id ? ' sel' : '') + '" data-el="' + el.id + '">';
    if (opts.selected === el.id) {
      g += '<rect class="sel-box" x="' + (x - 4) + '" y="' + (cy - 34) + '" width="' + (widthFor(el) + 8) + '" height="64"/>';
    }
    if (el.kind === 'contact') g += drawContact(el, x, cy, program, opts);
    else if (el.kind === 'coil') g += drawCoil(el, x, cy, program, opts);
    else g += drawBox(el, x, cy, program, opts);
    g += '</g>';
    return g;
  }

  /* ---------- 程序段 ---------- */

  function drawRung(r, ri, program, opts) {
    var maxBranches = 1;
    r.stages.forEach(function (s) { maxBranches = Math.max(maxBranches, s.branches.length); });
    var height = maxBranches * ROW_H;
    var cy0 = HEADER + height / 2;
    var p = [];
    var x = RAIL_X;

    if (opts.selectedRung === ri) {
      p.push('<rect class="net-sel" x="-6" y="-2" width="' + ((opts.dividerWidth || 600) + 12) + '" height="' + (HEADER + height + RUNG_GAP) + '"/>');
    }

    // 程序段标题 + 注释行（博途格式）
    p.push('<line class="net-div" x1="0" y1="0" x2="' + (opts.dividerWidth || 600) + '" y2="0"/>');
    p.push('<path class="net-caret" d="M5 9 h8 l-4 6 z"/>');
    p.push('<text class="net-title" x="16" y="17">程序段 ' + (ri + 1) + '：</text>');
    if (r.comment && opts.showComments !== false) {
      p.push('<text class="net-comment" x="30" y="34">' + esc(r.comment) + '</text>');
    } else if (opts.showComments !== false) {
      p.push('<text class="net-placeholder" x="30" y="34">注释</text>');
    }

    // 左侧母线
    p.push('<line class="rail" x1="' + RAIL_X + '" y1="' + (HEADER - 12) + '" x2="' + RAIL_X + '" y2="' + (HEADER + height + 4) + '"/>');

    r.stages.forEach(function (stage, si) {
      var n = stage.branches.length;
      var centers = [];
      for (var i = 0; i < n; i++) centers.push(cy0 + (i - (n - 1) / 2) * ROW_H);

      var branchWidths = [];
      var branchLayout = [];
      stage.branches.forEach(function (br) {
        var bx = x + GAP;
        var items = [];
        br.forEach(function (el) {
          var w = widthFor(el);
          items.push({ el: el, x: bx, w: w });
          bx += w + GAP;
        });
        branchWidths.push(bx - x);
        branchLayout.push(items);
      });
      var stageW = Math.max.apply(null, branchWidths.concat([GAP * 2]));

      stage.branches.forEach(function (br, bi) {
        var cy = centers[bi];
        p.push('<line class="wire" x1="' + x + '" y1="' + cy + '" x2="' + (x + stageW) + '" y2="' + cy + '"/>');
      });
      if (n > 1) {
        p.push('<line class="wire" x1="' + x + '" y1="' + centers[0] + '" x2="' + x + '" y2="' + centers[n - 1] + '"/>');
        p.push('<line class="wire" x1="' + (x + stageW) + '" y1="' + centers[0] + '" x2="' + (x + stageW) + '" y2="' + centers[n - 1] + '"/>');
      }

      stage.branches.forEach(function (br, bi) {
        var cy = centers[bi];
        branchLayout[bi].forEach(function (it) {
          p.push(drawElement(it.el, it.x, cy, program, opts));
        });
      });

      // 插入位
      stage.branches.forEach(function (br, bi) {
        var cy = centers[bi];
        var lay = branchLayout[bi];
        var slots = [];
        if (!lay.length) slots.push({ x: x + GAP * 0.55, i: 0 });
        else {
          slots.push({ x: x + GAP / 2, i: 0 });
          lay.forEach(function (it, idx) { slots.push({ x: it.x + it.w + GAP / 2, i: idx + 1 }); });
          if (lay[lay.length - 1].el.kind === 'coil') slots.pop();
        }
        slots.forEach(function (s) {
          p.push('<g class="ghost" data-slot="' + ri + ':' + si + ':' + bi + ':' + s.i + '">' +
            '<circle class="hit" cx="' + s.x + '" cy="' + cy + '" r="12" fill="transparent"/>' +
            '<circle cx="' + s.x + '" cy="' + cy + '" r="6"/>' +
            '<text x="' + s.x + '" y="' + (cy + 3) + '">+</text></g>');
        });
      });

      if (si < r.stages.length - 1) {
        p.push('<line class="wire" x1="' + (x + stageW) + '" y1="' + cy0 + '" x2="' + (x + stageW + GAP) + '" y2="' + cy0 + '"/>');
      }
      x += stageW + GAP;
    });

    var endX = r.stages.length ? x - GAP : RAIL_X;
    var outX = opts.outX || endX;
    if (outX > endX) p.push('<line class="wire" x1="' + endX + '" y1="' + cy0 + '" x2="' + outX + '" y2="' + cy0 + '"/>');
    if (!r.stages.length || r.stages.every(function (s) { return s.branches.every(function (b) { return !b.length; }); })) {
      p.push('<line class="wire" x1="' + RAIL_X + '" y1="' + cy0 + '" x2="' + outX + '" y2="' + cy0 + '"/>');
    }
    // 右侧母线
    p.push('<line class="rail" x1="' + outX + '" y1="' + (HEADER - 12) + '" x2="' + outX + '" y2="' + (HEADER + height + 4) + '"/>');

    // 行操作
    function raBtn(act, dx, txt, tip) {
      return '<g class="ra" data-rung-act="' + act + ':' + ri + '"><title>' + tip + '</title>' +
        '<circle class="hit" cx="' + (outX + dx) + '" cy="' + (HEADER + 2) + '" r="10" fill="transparent"/>' +
        '<circle cx="' + (outX + dx) + '" cy="' + (HEADER + 2) + '" r="6"/>' +
        '<text x="' + (outX + dx) + '" y="' + (HEADER + 5) + '">' + txt + '</text></g>';
    }
    p.push('<g class="rung-actions">' + raBtn('up', 12, '↑', '上移程序段') + raBtn('down', 30, '↓', '下移程序段') + raBtn('del', 48, '×', '删除程序段') + '</g>');

    return { svg: p.join(''), width: x + RIGHT_PAD, height: HEADER + height + RUNG_GAP };
  }

  function rungWidth(r) {
    var x = RAIL_X;
    r.stages.forEach(function (s) {
      var maxW = GAP * 2;
      s.branches.forEach(function (b) {
        var w = GAP;
        b.forEach(function (el) { w += widthFor(el) + GAP; });
        maxW = Math.max(maxW, w);
      });
      x += maxW + GAP;
    });
    return x + RIGHT_PAD;
  }

  /** 渲染整个程序 */
  function render(program, opts) {
    opts = opts || {};
    index = {};
    var body = [];
    var y = 0;
    var maxW = 620;
    program.rungs.forEach(function (r) { maxW = Math.max(maxW, rungWidth(r)); });
    var railRight = maxW - RIGHT_PAD + 8;

    program.rungs.forEach(function (r, ri) {
      var res = drawRung(r, ri, program, {
        selected: opts.selected,
        selectedRung: opts.selectedRung,
        showSymbols: opts.showSymbols,
        showComments: opts.showComments,
        dividerWidth: maxW,
        outX: railRight
      });
      body.push('<g class="net' + (opts.selectedRung === ri ? ' sel-net' : '') + '" data-rung="' + ri + '" transform="translate(0,' + y + ')">' + res.svg + '</g>');
      y += res.height;
    });

    var h = Math.max(y + 26, 240);
    var svg = '<svg class="ladder" width="' + maxW + '" height="' + h + '" viewBox="0 0 ' + maxW + ' ' + h + '" xmlns="http://www.w3.org/2000/svg">' +
      body.join('') + '</svg>';
    return { svg: svg, width: maxW, height: h };
  }

  /* ---------- 在线值刷新 ---------- */

  function valText(m, info) {
    if (!info) return '';
    switch (info.kind) {
      case 'contact':
      case 'coil':
        return m.getBit(info.addr) ? 'TRUE' : 'FALSE';
      case 'TON':
      case 'TOF': {
        var t = m.timers[info.name];
        return t ? (t.et / 1000).toFixed(1) + 's' : '0.0s';
      }
      case 'CTU': {
        var c = m.counters[info.name];
        return c ? String(c.cv) : '0';
      }
      default: return '';
    }
  }

  function updatePower(container, machine) {
    var nodes = container.querySelectorAll('[data-el]');
    for (var i = 0; i < nodes.length; i++) {
      var id = nodes[i].getAttribute('data-el');
      nodes[i].classList.toggle('live', !!(machine.power && machine.power[id]));
    }
    var vals = container.querySelectorAll('[data-val]');
    for (var j = 0; j < vals.length; j++) {
      var vid = vals[j].getAttribute('data-val');
      var info = index[vid];
      var txt = valText(machine, info);
      if (vals[j].textContent !== txt) vals[j].textContent = txt;
      var isOn = txt === 'TRUE' ||
        (info && (info.kind === 'TON' || info.kind === 'TOF') && machine.timers[info.name] && machine.timers[info.name].q);
      vals[j].classList.toggle('on', !!isOn);
    }
    var bvals = container.querySelectorAll('[data-boxval]');
    for (var k = 0; k < bvals.length; k++) {
      var bi = index[bvals[k].getAttribute('data-boxval')];
      if (!bi) continue;
      if (bi.kind === 'CTU') {
        var c2 = machine.counters[bi.name];
        bvals[k].textContent = c2 ? String(c2.cv) : '';
      } else {
        var t2 = machine.timers[bi.name];
        bvals[k].textContent = t2 ? (t2.et / 1000).toFixed(1) + 's' : '';
      }
    }
  }

  PLC.render = {
    render: render,
    updatePower: updatePower,
    esc: esc,
    ROW_H: ROW_H,
    GAP: GAP,
    setMonitoring: function (container, on) { container.classList.toggle('monitoring', !!on); }
  };
})(typeof window !== 'undefined' ? window : globalThis);

