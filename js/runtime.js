/* ============================================================
 * runtime.js — IEC 61131-3 风格扫描引擎（S7-1200 语义简化版）
 * 扫描顺序：自上而下逐行、行内自左向右；指令全部执行（不短路），
 * 触点断开只是把能流（RLO）置 0 —— 与真实 PLC 的扫描行为一致。
 * ============================================================ */
(function (global) {
  'use strict';
  var PLC = (global.PLC = global.PLC || {});
  var core = PLC.core;

  var AREA_SIZE = { I: 64, Q: 64, M: 1024 };

  function Machine(program) {
    this.mem = { I: new Uint8Array(AREA_SIZE.I), Q: new Uint8Array(AREA_SIZE.Q), M: new Uint8Array(AREA_SIZE.M) };
    this.program = program || core.emptyProgram();
    this.timers = {};
    this.counters = {};
    this.edges = {};
    this.scanCount = 0;
    this.totalMs = 0;
    this.lastRungPower = [];
    this.power = {};
    this.dt = 0;
  }

  Machine.prototype.reset = function () {
    Object.keys(this.mem).forEach(function (k) { this.mem[k].fill(0); }, this);
    this.timers = {};
    this.counters = {};
    this.edges = {};
    this.scanCount = 0;
    this.totalMs = 0;
  };

  /* ------- 位操作 ------- */
  Machine.prototype.getBit = function (addr) {
    var p = core.parseAddr(addr);
    if (!p || p.type !== 'bit') return 0;
    if (p.area === 'T') {
      var t = this.timers[p.name];
      return t && t.q ? 1 : 0;
    }
    if (p.area === 'C') {
      var c = this.counters[p.name];
      return c && c.q ? 1 : 0;
    }
    var arr = this.mem[p.area];
    if (!arr || p.byte >= arr.length) return 0;
    return (arr[p.byte] >> p.bit) & 1;
  };

  Machine.prototype.setBit = function (addr, v) {
    var p = core.parseAddr(addr);
    if (!p || p.type !== 'bit') return;
    if (p.area === 'T' || p.area === 'C') return; // 定时器/计数器输出只读
    var arr = this.mem[p.area];
    if (!arr || p.byte >= arr.length) return;
    if (v) arr[p.byte] |= (1 << p.bit);
    else arr[p.byte] &= ~(1 << p.bit);
  };

  /* ------- 字操作（S7 为大端） ------- */
  Machine.prototype.readWord = function (addr, type) {
    var p = core.parseAddr(addr);
    if (!p || p.type === 'bit') return 0;
    var arr = this.mem[p.area];
    if (!arr || p.byte + 1 >= arr.length) return 0;
    if (p.type === 'byte') return arr[p.byte];
    if (p.type === 'word') {
      var u = (arr[p.byte] << 8) | arr[p.byte + 1];
      return u > 0x7fff ? u - 0x10000 : u;
    }
    if (p.byte + 3 >= arr.length) return 0;
    var d = ((arr[p.byte] << 24) | (arr[p.byte + 1] << 16) | (arr[p.byte + 2] << 8) | arr[p.byte + 3]) >>> 0;
    return d | 0;
  };

  Machine.prototype.writeWord = function (addr, value) {
    var p = core.parseAddr(addr);
    if (!p || p.type === 'bit') return;
    var arr = this.mem[p.area];
    if (!arr) return;
    value = value | 0;
    if (p.type === 'byte') {
      arr[p.byte] = value & 0xff;
    } else if (p.type === 'word') {
      if (p.byte + 1 >= arr.length) return;
      arr[p.byte] = (value >> 8) & 0xff;
      arr[p.byte + 1] = value & 0xff;
    } else {
      if (p.byte + 3 >= arr.length) return;
      arr[p.byte] = (value >> 24) & 0xff;
      arr[p.byte + 1] = (value >> 16) & 0xff;
      arr[p.byte + 2] = (value >> 8) & 0xff;
      arr[p.byte + 3] = value & 0xff;
    }
  };

  /** 读取一个操作数的数值（常量返回常量值） */
  Machine.prototype.value = function (token) {
    if (token == null) return 0;
    if (core.isNumberToken(token)) return core.numValue(token);
    var p = core.parseAddr(token);
    if (!p) return 0;
    if (p.type === 'bit') return this.getBit(token);
    return this.readWord(token, p.type);
  };

  /* ------- 定时器 / 计数器 ------- */
  Machine.prototype.timer = function (name) {
    var t = this.timers[name];
    if (!t) t = this.timers[name] = { et: 0, q: 0, in: 0, pt: 0 };
    return t;
  };

  Machine.prototype.counter = function (name) {
    var c = this.counters[name];
    if (!c) c = this.counters[name] = { cv: 0, q: 0, pv: 0, prev: 0 };
    return c;
  };

  /* ------- 元素求值 ------- */

  function evalElement(m, el, pin, dt) {
    m.power[el.id] = pin ? 1 : 0;
    switch (el.kind) {
      case 'contact': {
        var bit = m.getBit(el.addr);
        if (el.nc) bit = bit ? 0 : 1;
        if (el.edge) {
          var prev = m.edges[el.id] || 0;
          var cur = m.getBit(el.addr);
          var rise = cur && !prev;
          var fall = !cur && prev;
          m.edges[el.id] = cur;
          bit = el.edge === 'P' ? (rise ? 1 : 0) : (fall ? 1 : 0);
          if (el.nc) bit = bit ? 0 : 1;
        }
        return pin && bit ? 1 : 0;
      }
      case 'coil': {
        if (el.mode === 'set') {
          if (pin) m.setBit(el.addr, 1);
        } else if (el.mode === 'reset') {
          if (pin) m.setBit(el.addr, 0);
        } else {
          m.setBit(el.addr, pin ? 1 : 0);
        }
        return pin;
      }
      case 'TON': {
        var t = m.timer(el.name);
        t.pt = +el.pt || 0;
        if (pin) {
          t.et += dt;
          if (t.et >= t.pt) { t.et = t.pt; t.q = 1; } else { t.q = 0; }
        } else {
          t.et = 0;
          t.q = 0;
        }
        t.in = pin ? 1 : 0;
        return t.q;
      }
      case 'TOF': {
        var t2 = m.timer(el.name);
        t2.pt = +el.pt || 0;
        if (pin) { t2.q = 1; t2.et = 0; }
        else {
          if (t2.q) {
            t2.et += dt;
            if (t2.et >= t2.pt) { t2.et = t2.pt; t2.q = 0; }
          }
        }
        t2.in = pin ? 1 : 0;
        return t2.q;
      }
      case 'CTU': {
        var c = m.counter(el.name);
        c.pv = +el.pv || 1;
        var riseC = pin && !c.prev;
        c.prev = pin ? 1 : 0;
        if (riseC) c.cv += 1;
        c.q = c.cv >= c.pv ? 1 : 0;
        return c.q;
      }
      case 'CTR': {
        var c2 = m.counter(el.name);
        if (pin) { c2.cv = 0; c2.q = 0; c2.prev = 0; }
        return pin;
      }
      case 'CMP': {
        var a = m.value(el.a), b = m.value(el.b), ok = false;
        switch (el.op) {
          case '>': ok = a > b; break;
          case '>=': ok = a >= b; break;
          case '<': ok = a < b; break;
          case '<=': ok = a <= b; break;
          case '==': ok = a === b; break;
          case '<>': ok = a !== b; break;
          default: ok = false;
        }
        return pin && ok ? 1 : 0;
      }
      case 'MOVE': {
        if (pin) m.writeWord(el.dst, m.value(el.src));
        return pin;
      }
      case 'MATH': {
        if (pin) {
          var x = m.value(el.a), y = m.value(el.b), r = 0;
          switch (el.op) {
            case 'ADD': r = x + y; break;
            case 'SUB': r = x - y; break;
            case 'MUL': r = x * y; break;
            case 'DIV': r = y === 0 ? 0 : Math.trunc(x / y); break;
          }
          m.writeWord(el.dst, r);
        }
        return pin;
      }
      default:
        return pin;
    }
  }

  Machine.prototype.evalStage = function (stage, powerIn, dt) {
    var any = 0;
    for (var i = 0; i < stage.branches.length; i++) {
      var branch = stage.branches[i];
      var p = powerIn;
      for (var j = 0; j < branch.length; j++) {
        p = evalElement(this, branch[j], p, dt) ? 1 : 0;
      }
      if (p) any = 1;
    }
    return any;
  };

  Machine.prototype.evalRung = function (rung, dt) {
    var p = 1; // 左侧母线
    for (var i = 0; i < rung.stages.length; i++) {
      p = this.evalStage(rung.stages[i], p, dt);
    }
    return p;
  };

  /**
   * 执行一个扫描周期
   * @param {number} dtMs 距上次扫描的真实毫秒数
   */
  Machine.prototype.scan = function (dtMs) {
    var dt = Math.max(0, Math.min(+dtMs || 0, 500));
    this.dt = dt;
    this.scanCount++;
    this.totalMs += dt;
    this.lastRungPower = [];
    this.power = {};
    for (var i = 0; i < this.program.rungs.length; i++) {
      this.lastRungPower.push(this.evalRung(this.program.rungs[i], dt));
    }
  };

  /** 读取某元素的实时状态文本，用于监视表 */
  Machine.prototype.elementState = function (el) {
    switch (el.kind) {
      case 'TON':
      case 'TOF': {
        var t = this.timers[el.name];
        return t ? { q: t.q, et: t.et, pt: t.pt } : { q: 0, et: 0, pt: +el.pt || 0 };
      }
      case 'CTU':
      case 'CTR': {
        var c = this.counters[el.name];
        return c ? { cv: c.cv, pv: c.pv, q: c.q } : { cv: 0, pv: +el.pv || 0, q: 0 };
      }
      default:
        return null;
    }
  };

  PLC.Machine = Machine;
})(typeof window !== 'undefined' ? window : globalThis);
