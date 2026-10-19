/* ============================================================
 * core.js — 程序模型 / S7-1200 风格地址解析 / 校验
 * 全部挂到 window.PLC 下，无构建、无依赖，file:// 直接可用
 * ============================================================ */
(function (global) {
  'use strict';
  var PLC = (global.PLC = global.PLC || {});

  /* ---------------- 地址 ---------------- */

  var AREA_NAME = { I: '输入', Q: '输出', M: '位存储' };

  function parseAddr(raw) {
    var a = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!a) return null;
    var m = /^([IQM])(\d+)\.([0-7])$/.exec(a);
    if (m) return { type: 'bit', area: m[1], byte: +m[2], bit: +m[3] };
    m = /^([TC])(\d+)\.Q$/.exec(a);
    if (m) return { type: 'bit', area: m[1], name: m[1] + m[2], byte: 0, bit: 0 };
    m = /^(IB|QB|MB|IW|QW|MW|ID|QD|MD)(\d+)$/.exec(a);
    if (m) {
      var t = m[1][1] === 'B' ? 'byte' : m[1][1] === 'W' ? 'word' : 'dword';
      return { type: t, area: m[1][0], byte: +m[2] };
    }
    return null;
  }

  function isNumberToken(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return false;
    if (/^-?\d+$/.test(s)) return true;
    if (/^16#[0-9A-F]+$/i.test(s)) return true;
    if (/^(TRUE|FALSE)$/i.test(s)) return true;
    return false;
  }

  function numValue(v) {
    var s = String(v == null ? '' : v).trim();
    if (/^TRUE$/i.test(s)) return 1;
    if (/^FALSE$/i.test(s)) return 0;
    if (/^16#/i.test(s)) return parseInt(s.slice(3), 16);
    return parseInt(s, 10) || 0;
  }

  /** 校验一个操作数是位地址 / 数值 / 允许的字地址 */
  function operandKind(v) {
    if (isNumberToken(v)) return 'const';
    var p = parseAddr(v);
    if (!p) return 'bad';
    return p.type === 'bit' ? 'bit' : p.type;
  }

  /* ---------------- 元素定义 ---------------- */

  var ELEMENT_SPEC = {
    contact: { label: '常开触点', short: 'NO', icon: '⊣⊢' },
    coil: { label: '线圈', short: 'COIL', icon: '( )' },
    TON: { label: '接通延时 TON', short: 'TON', icon: 'TON' },
    TOF: { label: '断开延时 TOF', short: 'TOF', icon: 'TOF' },
    CTU: { label: '加计数器 CTU', short: 'CTU', icon: 'CTU' },
    CTR: { label: '计数器复位', short: 'R', icon: 'R' },
    CMP: { label: '比较指令', short: 'CMP', icon: '>=' },
    MOVE: { label: '移动 MOVE', short: 'MOVE', icon: 'MOVE' },
    MATH: { label: '算术运算', short: 'MATH', icon: '+−' }
  };

  var seq = 0;
  function uid(prefix) {
    seq += 1;
    return (prefix || 'e') + '_' + Date.now().toString(36).slice(-4) + seq.toString(36);
  }

  /** 新建元素，按类型给默认参数 */
  function makeElement(kind, opts) {
    opts = opts || {};
    var el = { id: uid(kind), kind: kind };
    if (kind === 'contact') {
      el.addr = opts.addr || 'I0.0';
      el.nc = !!opts.nc;
      el.edge = opts.edge || null; // 'P' | 'N' | null
    } else if (kind === 'coil') {
      el.addr = opts.addr || 'Q0.0';
      el.mode = opts.mode || 'out'; // out | set | reset
    } else if (kind === 'TON' || kind === 'TOF') {
      el.name = opts.name || nextTimerName();
      el.pt = opts.pt == null ? 2000 : opts.pt;
    } else if (kind === 'CTU') {
      el.name = opts.name || nextCounterName();
      el.pv = opts.pv == null ? 5 : opts.pv;
    } else if (kind === 'CTR') {
      el.name = opts.name || 'C1';
    } else if (kind === 'CMP') {
      el.op = opts.op || '>=';
      el.a = opts.a || 'MW10';
      el.b = opts.b == null ? '100' : opts.b;
    } else if (kind === 'MOVE') {
      el.src = opts.src || 'MW10';
      el.dst = opts.dst || 'MW12';
    } else if (kind === 'MATH') {
      el.op = opts.op || 'ADD';
      el.a = opts.a || 'MW10';
      el.b = opts.b || 'MW12';
      el.dst = opts.dst || 'MW14';
    }
    return el;
  }

  function nextTimerName() {
    var n = 1;
    var used = {};
    var p = PLC.state && PLC.state.program;
    if (p) {
      p.rungs.forEach(function (r) {
        r.stages.forEach(function (s) {
          s.branches.forEach(function (b) {
            b.forEach(function (el) {
              if (el.name && /^T\d+$/.test(el.name)) used[el.name] = 1;
            });
          });
        });
      });
    }
    while (used['T' + n]) n++;
    return 'T' + n;
  }

  function nextCounterName() {
    var n = 1;
    var used = {};
    var p = PLC.state && PLC.state.program;
    if (p) {
      p.rungs.forEach(function (r) {
        r.stages.forEach(function (s) {
          s.branches.forEach(function (b) {
            b.forEach(function (el) {
              if (el.name && /^C\d+$/.test(el.name)) used[el.name] = 1;
            });
          });
        });
      });
    }
    while (used['C' + n]) n++;
    return 'C' + n;
  }

  /* ---------------- 程序结构 ---------------- */

  function emptyRung(comment) {
    return {
      id: uid('r'),
      comment: comment || '',
      stages: [{ branches: [[]] }]
    };
  }

  function emptyProgram(name) {
    return {
      version: 1,
      name: name || '未命名项目',
      author: '',
      desc: '',
      scanMs: 20,
      symbols: {},
      rungs: [emptyRung('')]
    };
  }

  /** 遍历所有元素 */
  function eachElement(prog, fn) {
    prog.rungs.forEach(function (r, ri) {
      r.stages.forEach(function (s, si) {
        s.branches.forEach(function (b, bi) {
          b.forEach(function (el, ei) {
            fn(el, { rung: ri, stage: si, branch: bi, index: ei, rungObj: r, stageObj: s, branchArr: b });
          });
        });
      });
    });
  }

  /** 收集程序中用到的地址（位、字） */
  function collectAddresses(prog) {
    var bits = {}, words = {};
    function add(v) {
      var p = parseAddr(v);
      if (!p) return;
      if (p.type === 'bit') bits[v.toUpperCase().trim()] = 1;
      else words[v.toUpperCase().trim()] = 1;
    }
    eachElement(prog, function (el) {
      ['addr', 'a', 'b', 'src', 'dst'].forEach(function (k) {
        if (el[k]) add(el[k]);
      });
    });
    return { bits: Object.keys(bits).sort(addrSort), words: Object.keys(words).sort(addrSort) };
  }

  function addrSort(a, b) {
    var pa = parseAddr(a), pb = parseAddr(b);
    if (!pa || !pb) return 0;
    if (pa.area !== pb.area) return 'IQM'.indexOf(pa.area) - 'IQM'.indexOf(pb.area);
    if (pa.byte !== pb.byte) return pa.byte - pb.byte;
    return (pa.bit || 0) - (pb.bit || 0);
  }

  /** 结构校验：返回 [{level:'error'|'warn', msg, where}] */
  function validate(prog) {
    var issues = [];
    var coilUse = {};
    eachElement(prog, function (el, pos) {
      var where = '第' + (pos.rung + 1) + ' 行';
      if (el.kind === 'contact' || el.kind === 'coil') {
        if (operandKind(el.addr) !== 'bit') {
          issues.push({ level: 'error', where: where, msg: '地址「' + el.addr + '」不是有效的位地址（应为 I0.0 / Q0.0 / M0.0 形式）' });
        }
        if (el.kind === 'coil') {
          var k = (el.addr || '').toUpperCase();
          coilUse[k] = (coilUse[k] || 0) + 1;
        }
      }
      if (el.kind === 'TON' || el.kind === 'TOF') {
        if (!el.name) issues.push({ level: 'error', where: where, msg: '定时器缺少实例名' });
        if (!(el.pt > 0)) issues.push({ level: 'warn', where: where, msg: '定时器 ' + el.name + ' 的 PT 时间应大于 0' });
      }
      if (el.kind === 'CTU') {
        if (!el.name) issues.push({ level: 'error', where: where, msg: '计数器缺少实例名' });
        if (!(el.pv > 0)) issues.push({ level: 'warn', where: where, msg: '计数器 ' + el.name + ' 的 PV 应大于 0' });
      }
      if (el.kind === 'CMP') {
        ['a', 'b'].forEach(function (k) {
          var kd = operandKind(el[k]);
          if (kd === 'bad') issues.push({ level: 'error', where: where, msg: '比较操作数「' + el[k] + '」无法识别' });
        });
      }
      if (el.kind === 'MOVE') {
        if (operandKind(el.dst) === 'bit' || operandKind(el.dst) === 'bad') {
          issues.push({ level: 'error', where: where, msg: 'MOVE 的目标必须是 MW/MD/MB 之类的字地址' });
        }
      }
      if (el.kind === 'MATH') {
        if (operandKind(el.dst) === 'bit' || operandKind(el.dst) === 'bad') {
          issues.push({ level: 'error', where: where, msg: '算术结果的目标必须是字地址' });
        }
      }
    });
    Object.keys(coilUse).forEach(function (a) {
      if (coilUse[a] > 1) {
        issues.push({ level: 'warn', where: '全局', msg: '双线圈：' + a + ' 在程序中被赋值 ' + coilUse[a] + ' 次，只有最后一次有效' });
      }
    });
    prog.rungs.forEach(function (r, i) {
      var total = 0;
      r.stages.forEach(function (s) {
        s.branches.forEach(function (b) { total += b.length; });
      });
      if (total === 0) issues.push({ level: 'warn', where: '第' + (i + 1) + ' 行', msg: '空程序段，不影响运行，但建议删除' });
    });
    return issues;
  }

  /** 深拷贝 + 规整（用于导入） */
  function normalize(raw) {
    var p = emptyProgram(raw && raw.name);
    p.scanMs = +raw.scanMs || 20;
    p.symbols = raw.symbols && typeof raw.symbols === 'object' ? raw.symbols : {};
    p.desc = raw.desc || '';
    p.rungs = [];
    (raw.rungs || []).forEach(function (r) {
      var nr = { id: uid('r'), comment: r.comment || '', stages: [] };
      (r.stages || []).forEach(function (s) {
        var ns = { branches: [] };
        (s.branches || [[]]).forEach(function (b) {
          var nb = [];
          (b || []).forEach(function (el) {
            var copy = JSON.parse(JSON.stringify(el));
            copy.id = uid(el.kind || 'e');
            if (!ELEMENT_SPEC[copy.kind]) return;
            nb.push(copy);
          });
          ns.branches.push(nb);
        });
        if (!ns.branches.length) ns.branches = [[]];
        nr.stages.push(ns);
      });
      if (!nr.stages.length) nr.stages = [{ branches: [[]] }];
      p.rungs.push(nr);
    });
    if (!p.rungs.length) p.rungs = [emptyRung('')];
    return p;
  }

  function fmtTime(ms) {
    if (ms >= 1000) return (ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1) + ' s';
    return ms + ' ms';
  }

  PLC.core = {
    AREA_NAME: AREA_NAME,
    ELEMENT_SPEC: ELEMENT_SPEC,
    parseAddr: parseAddr,
    operandKind: operandKind,
    numValue: numValue,
    isNumberToken: isNumberToken,
    uid: uid,
    makeElement: makeElement,
    emptyRung: emptyRung,
    emptyProgram: emptyProgram,
    eachElement: eachElement,
    collectAddresses: collectAddresses,
    addrSort: addrSort,
    validate: validate,
    normalize: normalize,
    fmtTime: fmtTime,
    nextTimerName: nextTimerName,
    nextCounterName: nextCounterName
  };
})(typeof window !== 'undefined' ? window : globalThis);
