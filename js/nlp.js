/* ============================================================
 * nlp.js — 离线「自然语言 → 梯形图」与「程序解释 / 诊断」
 * 不依赖任何网络与大模型；接上 API 后由 ai.js 覆盖同样的输出结构
 * ============================================================ */
(function (global) {
  'use strict';
  var PLC = (global.PLC = global.PLC || {});
  var core = PLC.core;
  var lib = PLC.lib;

  var C = lib.C, CO = lib.CO, TON = lib.TON, CTU = lib.CTU, CTR = lib.CTR, CMP = lib.CMP, rung = lib.rung, series = lib.series, prog = lib.prog;

  /* ---------------- 从文本里抠信息 ---------------- */

  var ROLE_WORDS = [
    { role: 'start', re: /(启动|起动|开始|运行|正转|合闸|开启)/ },
    { role: 'stop', re: /(停止|停机|急停|断开|关断|复位)/ },
    { role: 'rev', re: /(反转|反向|倒转)/ },
    { role: 'out', re: /(电机|接触器|泵|阀|灯|输出|风机|皮带|气缸)/ }
  ];

  function extractAddresses(text) {
    var found = [];
    var re = /([IQM]\d+\.[0-7])\s*([^\s,，。;；、]{0,6})/g;
    var m;
    while ((m = re.exec(text))) {
      var addr = m[1].toUpperCase();
      var label = m[2] || '';
      var role = null;
      for (var i = 0; i < ROLE_WORDS.length; i++) {
        if (ROLE_WORDS[i].re.test(label)) { role = ROLE_WORDS[i].role; break; }
      }
      if (!role && /(计数|脉冲|按钮)/.test(label)) role = 'count';
      found.push({ addr: addr, label: label, role: role });
    }
    return found;
  }

  function pick(list, role, fallback) {
    for (var i = 0; i < list.length; i++) if (list[i].role === role) return list[i];
    return null;
  }

  function secondsOf(text, def) {
    var m = /(\d+(?:\.\d+)?)\s*(ms|毫秒|s|秒)/i.exec(text);
    if (!m) return def;
    var v = parseFloat(m[1]);
    return /ms|毫秒/i.test(m[2]) ? v : v * 1000;
  }

  function timesOf(text, def) {
    var m = /(\d+)\s*次/.exec(text);
    return m ? parseInt(m[1], 10) : def;
  }

  /* ---------------- 模板 ---------------- */

  function tplPoint(list) {
    var s = pick(list, 'start') || { addr: 'I0.0' };
    var o = pick(list, 'out') || { addr: 'Q0.0' };
    return {
      kind: 'point',
      title: '点动控制',
      program: prog('点动控制', '按住启动按钮输出，松开即停。', [
        series('按下 ' + s.addr + '，' + o.addr + ' 得电', [C(s.addr), CO(o.addr)])
      ]),
      notes: [
        '这是“点动”：没有自锁，手一松就停。',
        '调试、对刀、手动进退常用这种电路。',
        '如果现场需要“按一下就持续运行”，要改用启保停（自锁）。'
      ]
    };
  }

  function tplHold(list, withStop) {
    var s = pick(list, 'start') || { addr: 'I0.0' };
    var st = pick(list, 'stop') || { addr: 'I0.1' };
    var o = pick(list, 'out') || { addr: 'Q0.0' };
    var stages = [[[C(s.addr)], [C(o.addr)]]];
    if (withStop) stages.push([[C(st.addr, true)]]);
    stages.push([[CO(o.addr)]]);
    return {
      kind: 'hold',
      title: '启保停（自锁）',
      program: prog('启保停控制', '启动后自锁保持，按停止断开。', [
        rung('启动 ' + s.addr + ' 或自锁 ' + o.addr + (withStop ? '，串停止 ' + st.addr + ' 常闭' : '') + '，驱动 ' + o.addr, stages)
      ]),
      notes: [
        '关键点：' + o.addr + ' 的常开触点与启动按钮 ' + s.addr + ' **并联** —— 这就是自锁。',
        '停止按钮用常闭触点串在回路里，按下即断开。',
        withStop ? '注意：真实设备上急停必须走硬件回路，不能只靠程序里的常闭点。' : '你没有提到停止按钮，这里先不串停止；实际项目必须加。'
      ]
    };
  }

  function tplFwdRev(list) {
    var f = pick(list, 'start') || { addr: 'I0.0' };
    var r = pick(list, 'rev') || { addr: 'I0.1' };
    var st = pick(list, 'stop') || { addr: 'I0.2' };
    var o1 = { addr: 'Q0.0' }, o2 = { addr: 'Q0.1' };
    var outs = list.filter(function (x) { return x.role === 'out'; });
    if (outs.length >= 2) { o1 = outs[0]; o2 = outs[1]; }
    return {
      kind: 'fwdrev',
      title: '正反转互锁',
      program: prog('正反转互锁', '正转与反转互相封锁。', [
        rung('正转：' + f.addr + ' 或自锁，串停止 ' + st.addr + '、反转互锁 ' + o2.addr, [
          [[C(f.addr)], [C(o1.addr)]],
          [[C(st.addr, true)]],
          [[C(o2.addr, true)]],
          [[CO(o1.addr)]]
        ]),
        rung('反转：' + r.addr + ' 或自锁，串停止 ' + st.addr + '、正转互锁 ' + o1.addr, [
          [[C(r.addr)], [C(o2.addr)]],
          [[C(st.addr, true)]],
          [[C(o1.addr, true)]],
          [[CO(o2.addr)]]
        ])
      ]),
      notes: [
        '互锁的本质：把对方接触器的常闭触点串进自己的回路，对方吸合时自己就不可能得电。',
        '软件互锁不能替代硬件互锁 —— 接触器有释放延时，实际柜子里必须再加机械互锁。',
        '换向还应加“先停后启”的死区时间，避免电弧短路。'
      ]
    };
  }

  function tplDelay(list, ms) {
    var s = pick(list, 'start') || { addr: 'I0.0' };
    var st = pick(list, 'stop') || { addr: 'I0.1' };
    var o = pick(list, 'out') || { addr: 'Q0.0' };
    return {
      kind: 'delay',
      title: '延时启动',
      program: prog('延时启动', '启动后延时 ' + core.fmtTime(ms) + ' 输出。', [
        rung('启动自锁 + 停止，经 T1 延时 ' + core.fmtTime(ms) + ' 后输出', [
          [[C(s.addr)], [C(o.addr)]],
          [[C(st.addr, true)]],
          [[TON('T1', ms)]],
          [[CO(o.addr)]]
        ])
      ]),
      notes: [
        'TON 的 IN 接在停止触点之后：一按停止，计时立即清零，不会“记住”已等待的时间。',
        '要让时间可调，把 PT 改成变量（如 MW10），用触摸屏写入毫秒数。',
        '需要累计计时用 RTO（保持型定时器），TON 断电即复位。'
      ]
    };
  }

  function tplFlash(list, ms) {
    var o = pick(list, 'out') || { addr: 'Q0.0' };
    var half = ms;
    return {
      kind: 'flash',
      title: '闪烁振荡',
      program: prog('闪烁控制', '两个 TON 首尾相接，' + core.fmtTime(half) + ' 亮 / ' + core.fmtTime(half) + ' 灭。', [
        series('T2 未到时 T1 计时', [C('T2.Q', true), TON('T1', half)]),
        series('T1 到时启动 T2', [C('T1.Q'), TON('T2', half)]),
        series('T1 到时点亮 ' + o.addr, [C('T1.Q'), CO(o.addr)])
      ]),
      notes: [
        '原理：T1 计时到 → 启动 T2；T2 计时到 → 用常闭点把 T1 的 IN 断开 → T1 复位 → T2 跟着复位 → 循环。',
        '两个定时器的时间决定占空比，相等就是 1:1 方波。',
        '这种写法不依赖特殊指令，任何 PLC 都能实现，是经典面试题。'
      ]
    };
  }

  function tplCounter(list, pv) {
    var s = pick(list, 'count') || pick(list, 'start') || { addr: 'I0.0' };
    var rst = pick(list, 'stop') || { addr: 'I0.1' };
    var o = pick(list, 'out') || { addr: 'Q0.0' };
    return {
      kind: 'counter',
      title: '计数到位',
      program: prog('计数控制', '每按一次计数 +1，达到 ' + pv + ' 次输出。', [
        series('计数输入', [C(s.addr), CTU('C1', pv)]),
        series('到位输出', [C('C1.Q'), CO(o.addr)]),
        series('复位', [C(rst.addr), CTR('C1')])
      ]),
      notes: [
        'CTU 只在上升沿加 1，按住不放不会连续计数。',
        'CV ≥ PV 时 Q 置位，并保持到复位为止。',
        '要断电保持计数，真实 PLC 需把计数器实例放到保持性数据块里。'
      ]
    };
  }

  function tplSequence(list, ms) {
    var s = pick(list, 'start') || { addr: 'I0.0' };
    var st = pick(list, 'stop') || { addr: 'I0.1' };
    return {
      kind: 'sequence',
      title: '顺序启动',
      program: prog('顺序启动', '第一台先运行，' + core.fmtTime(ms) + ' 后第二台自动运行。', [
        rung('第 1 台自锁', [
          [[C(s.addr)], [C('Q0.0')]],
          [[C(st.addr, true)]],
          [[CO('Q0.0')]]
        ]),
        series('第 1 台运行后延时', [C('Q0.0'), TON('T1', ms)]),
        rung('第 2 台：第 1 台在转且延时到', [
          [[C('Q0.0'), C('T1.Q')]],
          [[C(st.addr, true)]],
          [[CO('Q0.1')]]
        ])
      ]),
      notes: [
        '顺序启动的要点：后一级的启动条件取“前一级的输出”，不是取启动按钮。',
        '停止要一刀切 —— 每行的停止条件都要串进去，否则会出现“停了主机副机还在转”。',
        '真实产线还要加“前级未运行则后级禁止启动”的联锁。'
      ]
    };
  }

  function tplStar(list, ms) {
    var s = pick(list, 'start') || { addr: 'I0.0' };
    var st = pick(list, 'stop') || { addr: 'I0.1' };
    return {
      kind: 'star',
      title: '星三角启动',
      program: prog('星三角启动', '星形运行 ' + core.fmtTime(ms) + ' 后切换到三角形。', [
        rung('主接触器 KM1 自锁', [
          [[C(s.addr)], [C('Q0.0')]],
          [[C(st.addr, true)]],
          [[CO('Q0.0')]]
        ]),
        series('主接触器吸合后计时', [C('Q0.0'), TON('T1', ms)]),
        rung('星形 KM3：延时未到', [
          [[C('Q0.0'), C('T1.Q', true), C('Q0.2', true)]],
          [[CO('Q0.1')]]
        ]),
        rung('三角形 KM2：延时到且星形已断开', [
          [[C('Q0.0'), C('T1.Q'), C('Q0.1', true)]],
          [[CO('Q0.2')]]
        ])
      ]),
      notes: [
        '星形阶段把绕组接成 Y，启动电流降到 1/3；切到 △ 才是全压运行。',
        '切换必须先断星形再合三角形（本程序靠 Q0.1 常闭互锁实现），否则相当于相间短路。',
        '切换瞬间会有二次冲击，实际工程常用软启动器或变频器替代。'
      ]
    };
  }

  function tplAlarm(list, ms) {
    var s = pick(list, 'start') || { addr: 'I0.0' }; // 故障信号
    var o = pick(list, 'out') || { addr: 'Q0.0' };
    return {
      kind: 'alarm',
      title: '延时报警',
      program: prog('延时报警', '故障持续 ' + core.fmtTime(ms) + ' 后报警并自锁。', [
        rung('故障持续 ' + core.fmtTime(ms) + ' 触发报警并保持', [
          [[C(s.addr)]],
          [[TON('T1', ms)]],
          [[CO(o.addr, 'set')]]
        ]),
        series('I0.1 复位报警', [C('I0.1'), CO(o.addr, 'reset')])
      ]),
      notes: [
        '加延时的目的是滤掉抖动和瞬时干扰，避免误报警。',
        '报警要自锁：故障消失后仍需人工确认，否则操作工看不见。',
        '真实系统还要记录首出故障（第一故障）以便排查。'
      ]
    };
  }

  /* ---------------- 主入口 ---------------- */

  function nlToProgram(text) {
    var t = String(text || '').trim();
    if (!t) return { ok: false, error: '请先描述你想要的控制要求。' };
    var list = extractAddresses(t);
    var ms = secondsOf(t, 3000);
    var n = timesOf(t, 3);

    var has = function (re) { return re.test(t); };

    if (has(/星.{0,2}三角|降压启动|Y-?△/)) return wrap(tplStar(list, ms));
    if ((has(/正转/) && has(/反转/)) || has(/互锁/)) return wrap(tplFwdRev(list));
    if (has(/闪|振荡|一亮一灭|交替/) ) return wrap(tplFlash(list, ms));
    if (has(/计数|数到|次数|\d+\s*次/)) return wrap(tplCounter(list, n));
    if (has(/顺序|依次|先.*(再|后)/)) return wrap(tplSequence(list, ms));
    if (has(/延时|延迟|秒后|等.*秒|\d+\s*(秒|s)/)) return wrap(tplDelay(list, ms));
    if (has(/点动|按住|一直按/)) return wrap(tplPoint(list));
    if (has(/报警|故障/)) return wrap(tplAlarm(list, ms));
    if (has(/自锁|保持|启保停|启停|启动/) && has(/停止|停/)) return wrap(tplHold(list, true));
    if (has(/自锁|保持|启保停/)) return wrap(tplHold(list, false));

    return {
      ok: false,
      error: '没能识别出控制类型。可以试试这些说法：',
      suggestions: [
        '按下启动按钮电机运行，按停止按钮停止（启保停）',
        '按住按钮电机转，松开就停（点动）',
        '正转反转要互锁，按停止都停',
        '按下启动后延时 3 秒电机启动',
        '指示灯每秒闪一次',
        '按 3 次按钮后输出报警'
      ]
    };
  }

  function wrap(r) {
    r.ok = true;
    r.program.name = r.title;
    return r;
  }

  /* ---------------- 程序解释 ---------------- */

  function elText(el) {
    switch (el.kind) {
      case 'contact': {
        var base = el.addr + (el.nc ? ' 常闭触点' : ' 常开触点');
        if (el.edge === 'P') base = el.addr + ' 上升沿';
        if (el.edge === 'N') base = el.addr + ' 下降沿';
        return base;
      }
      case 'coil':
        if (el.mode === 'set') return el.addr + ' 置位(S)';
        if (el.mode === 'reset') return el.addr + ' 复位(R)';
        return el.addr + ' 线圈';
      case 'TON': return 'TON ' + el.name + '（延时 ' + core.fmtTime(+el.pt || 0) + '）';
      case 'TOF': return 'TOF ' + el.name + '（断开延时 ' + core.fmtTime(+el.pt || 0) + '）';
      case 'CTU': return 'CTU ' + el.name + '（计到 ' + el.pv + '）';
      case 'CTR': return 'CTU ' + (el.name || '') + ' 复位';
      case 'CMP': return '比较 ' + el.a + ' ' + el.op + ' ' + el.b;
      case 'MOVE': return 'MOVE ' + el.src + ' → ' + el.dst;
      case 'MATH': return el.op + ' ' + el.a + ', ' + el.b + ' → ' + el.dst;
      default: return el.kind;
    }
  }

  function branchText(br) {
    if (!br.length) return '（空）';
    return br.map(elText).join(' 串联 ');
  }

  function stageText(st) {
    if (st.branches.length === 1) return branchText(st.branches[0]);
    return '(' + st.branches.map(branchText).join(' 或 ') + ')';
  }

  function isOutput(el) {
    return el.kind === 'coil' || el.kind === 'MOVE' || el.kind === 'MATH' || el.kind === 'TON' || el.kind === 'TOF' || el.kind === 'CTU';
  }

  function analyze(program) {
    var flags = { selfHold: [], interlock: [], timers: [], counters: [], math: [], outputs: {} };
    program.rungs.forEach(function (r, ri) {
      var coilAddrs = [];
      var contacts = [];
      r.stages.forEach(function (s) {
        s.branches.forEach(function (b) {
          b.forEach(function (el) {
            if (el.kind === 'coil') coilAddrs.push(el.addr.toUpperCase());
            if (el.kind === 'contact') contacts.push({ el: el, stage: s });
            if (el.kind === 'TON' || el.kind === 'TOF') flags.timers.push({ name: el.name, pt: el.pt, rung: ri + 1 });
            if (el.kind === 'CTU' || el.kind === 'CTR') flags.counters.push({ name: el.name, pv: el.pv, rung: ri + 1 });
            if (el.kind === 'MOVE' || el.kind === 'MATH' || el.kind === 'CMP') flags.math.push({ rung: ri + 1, el: el });
            if (el.kind === 'coil') flags.outputs[el.addr.toUpperCase()] = true;
          });
        });
      });
      // 自锁：某个 stage 的并联分支里同时有 启动触点和本行线圈地址的触点
      r.stages.forEach(function (s) {
        if (s.branches.length > 1) {
          var hasCoilRef = s.branches.some(function (b) {
            return b.some(function (el) { return el.kind === 'contact' && coilAddrs.indexOf(el.addr.toUpperCase()) >= 0; });
          });
          if (hasCoilRef) {
            coilAddrs.forEach(function (a) {
              if (flags.selfHold.indexOf(a) < 0) flags.selfHold.push(a);
            });
          }
        }
      });
      // 互锁：常闭触点引用了别的输出
      contacts.forEach(function (c) {
        var a = c.el.addr.toUpperCase();
        if (c.el.nc && /^Q/.test(a) && coilAddrs.indexOf(a) < 0) {
          if (flags.interlock.indexOf(a) < 0) flags.interlock.push(a);
        }
      });
    });
    return flags;
  }

  function explain(program) {
    var lines = [];
    var f = analyze(program);
    lines.push('这段程序共 ' + program.rungs.length + ' 个程序段。');
    program.rungs.forEach(function (r, i) {
      var conds = [], acts = [];
      r.stages.forEach(function (s) {
        s.branches.forEach(function (b) {
          b.forEach(function (el) { if (isOutput(el)) acts.push(el); });
        });
      });
      var condStages = r.stages.filter(function (s) {
        return !s.branches.every(function (b) { return b.length && b.every(isOutput); });
      });
      var condTxt = condStages.map(stageText).join('，然后 ');
      var actTxt = acts.map(elText).join('；');
      var line = '第 ' + (i + 1) + ' 行：' + (condTxt || '（无触点条件）') + ' → ' + (actTxt || '（无输出）') + '。';
      if (r.comment) line = '第 ' + (i + 1) + ' 行（' + r.comment + '）：' + (condTxt || '（无条件）') + ' → ' + (actTxt || '无输出') + '。';
      lines.push(line);
    });

    var summary = [];
    if (f.selfHold.length) summary.push('**自锁**：' + f.selfHold.join('、') + ' 用自己的常开触点把自己“撑住”，所以按一下就能松手。');
    if (f.interlock.length) summary.push('**互锁**：' + f.interlock.join('、') + ' 的常闭触点被串进别的回路，用来禁止同时动作。');
    if (f.timers.length) summary.push('**定时**：' + f.timers.map(function (t) { return t.name + ' 设定 ' + core.fmtTime(+t.pt || 0) + '（第 ' + t.rung + ' 行）'; }).join('；') + '。');
    if (f.counters.length) summary.push('**计数**：' + f.counters.map(function (c) { return c.name + ' 计到 ' + c.pv; }).join('；') + '。');
    if (f.math.length) summary.push('**数据处理**：共 ' + f.math.length + ' 条指令，用于模拟量/参数运算。');
    if (summary.length) {
      lines.push('');
      lines.push('关键结构：');
      summary.forEach(function (s) { lines.push('· ' + s); });
    }
    return lines.join('\n');
  }

  /* ---------------- 程序诊断 ---------------- */

  function diagnose(program) {
    var out = [];
    core.validate(program).forEach(function (v) {
      out.push({ level: v.level, where: v.where, msg: v.msg });
    });

    var f = analyze(program);
    // 有输出但没有停止条件
    program.rungs.forEach(function (r, i) {
      var addrs = [], hasStop = false, hasStart = false;
      r.stages.forEach(function (s) {
        s.branches.forEach(function (b) {
          b.forEach(function (el) {
            if (el.kind === 'coil') addrs.push(el.addr);
            if (el.kind === 'contact' && el.nc && /^[IQM]/.test(el.addr)) hasStop = true;
            if (el.kind === 'contact' && !el.nc && /^I/.test(el.addr)) hasStart = true;
          });
        });
      });
      if (addrs.length && hasStart && !hasStop) {
        out.push({ level: 'warn', where: '第' + (i + 1) + ' 行', msg: '这一行有启动按钮但没有常闭的停止/联锁条件，一旦启动就只能断电才能停。' });
      }
    });

    // 定时器 PT 过小
    f.timers.forEach(function (t) {
      if (+t.pt > 0 && +t.pt < 20) out.push({ level: 'info', where: '第' + t.rung + ' 行', msg: t.name + ' 的设定时间小于一个扫描周期（' + (+t.pt) + ' ms），实际会立即动作。' });
    });

    // 输出了但从未被读取
    var readBits = {};
    core.eachElement(program, function (el) {
      if (el.kind === 'contact') readBits[String(el.addr).toUpperCase()] = 1;
    });
    Object.keys(f.outputs).forEach(function (a) {
      if (!readBits[a]) out.push({ level: 'info', where: '全局', msg: a + ' 只被写入、没有被任何触点读取 —— 如果它要参与联锁，记得加触点。' });
    });

    if (!out.length) out.push({ level: 'ok', where: '全局', msg: '没有发现明显问题。仍然建议逐条对照工艺要求做一次人工复核。' });
    return out;
  }

  /* ---------------- 问答（离线知识库） ---------------- */

  var FAQ = [
    {
      keys: ['自锁', '保持'], title: '什么是自锁（保持）？',
      body: '把**本线圈的常开触点**并联在启动按钮两端，线圈得电后自己给自己供电，松开按钮仍继续运行，这就是自锁。\n要点：① 触点地址必须是被驱动的那一个输出；② 停止按钮用常闭触点串在回路里；③ 自锁靠程序保持，断电即失效 —— 要断电保持得用置位(S)或保持性存储。'
    },
    {
      keys: ['互锁', '联锁'], title: '什么是互锁？为什么必须做？',
      body: '把**对方动作的常闭触点**串进自己的回路：对方一吸合，自己就永远不可能得电。\n正反转必须互锁，否则两个接触器同时吸合等于相间短路。注意：软件互锁不能替代硬件互锁 —— 接触器有释放延时，实际柜子里要用辅助触点或机械互锁。'
    },
    {
      keys: ['双线圈'], title: '双线圈为什么危险？',
      body: '同一个输出地址被多个线圈驱动时，PLC 按扫描顺序执行，**只有最后一个有效**，前面的逻辑等于白写，而且现象会随程序顺序变化，极难排查。\n正确做法：合并成一个线圈，或者用置位(S)/复位(R)分别控制。'
    },
    {
      keys: ['扫描周期', '扫描'], title: '扫描周期是怎么影响程序的？',
      body: 'PLC 不停地循环：读输入 → 逐行执行程序 → 写输出，一圈叫一个扫描周期（通常几毫秒到几十毫秒）。\n三个后果：① 输入信号若比一个周期还短，可能采不到；② 定时器精度受周期限制；③ 同一周期内前面的线圈改了状态，后面的触点立刻能看到（这就是双线圈问题的根源）。'
    },
    {
      keys: ['上升沿', '下降沿', '边沿'], title: '上升沿 / 下降沿有什么用？',
      body: '沿指令只在信号 **0→1（上升沿）** 或 **1→0（下降沿）** 的那一个扫描周期导通，之后即使信号一直保持，也只算一次。\n典型用途：按钮计一次数、启动只触发一次、检测脉冲。没有沿，按住按钮会每个周期都触发。'
    },
    {
      keys: ['ton', 'tof', '定时器'], title: 'TON 和 TOF 的区别？',
      body: '**TON（通电延时）**：IN 为 1 后开始计时，到 PT 时 Q 置 1；IN 一断开立即复位、ET 清零。\n**TOF（断电延时）**：IN 为 1 时 Q 立即为 1；IN 断开后才开始计时，到 PT 才复位。\n要累计计时（断电不清零）用保持型定时器（RTO）。'
    },
    {
      keys: ['星三角', '星-三角', '降压启动'], title: '星三角启动的原理和坑',
      body: '启动时把电机绕组接成 **Y**，每相电压降到 1/√3，启动电流约为直接启动的 1/3；延时几秒后切换成 **△** 全压运行。\n最大的坑：**必须先断开星形接触器，再吸合三角形接触器**，两者之间要有互锁和死区时间，否则相当于相间短路。切换瞬间还有二次冲击电流。'
    },
    {
      keys: ['常开', '常闭', 'no', 'nc'], title: '常开与常闭该怎么选？',
      body: '常开(NO)：未动作时断开；常闭(NC)：未动作时闭合。\n工程惯例：**停止按钮、急停、热继电器、限位保护一律用常闭**。因为断线或接线松脱时回路断开，设备停在安全侧（故障安全）；用常开的话断线就等于"没有保护"。'
    },
    {
      keys: ['模拟量', '4-20', '量程', 'ad值'], title: '模拟量 4–20mA 怎么换算？',
      body: '4mA 对应量程下限、20mA 对应上限，中间线性。\n工程值 = (采样值 − 4mA 对应值) ÷ (20mA 对应值 − 4mA 对应值) × (量程上限 − 量程下限) + 量程下限。\n用 4mA 作零点而不是 0mA，是为了能区分"信号为 0"和"断线"：读数接近 0 就说明断线或传感器故障。'
    },
    {
      keys: ['急停', '安全'], title: '急停能只靠程序实现吗？',
      body: '**不能。** 急停必须是硬件回路：急停按钮直接切断安全继电器/主接触器线圈，不经过 PLC 程序。\n程序里的急停输入只用于"记录状态、报警、复位流程"。另外急停按钮要用常闭、双通道，并定期做功能测试。'
    },
    {
      keys: ['modbus'], title: 'Modbus 通讯最常见的问题',
      body: '① **寄存器地址偏移**：手册写 40001，实际报文里是 0，差 1 是重灾区；② **字节序**：32 位数据高低字顺序各家不同；③ **物理层**：A/B 线接反、没加终端电阻、屏蔽层没单端接地、波特率/校验不一致。\n排查顺序永远是：先确认物理层能通（能读到任意寄存器），再查地址映射。'
    },
    {
      keys: ['pnp', 'npn', '源型', '漏型'], title: 'PNP 和 NPN 传感器怎么接？',
      body: 'PNP 输出高电平（源型），NPN 输出低电平（漏型）。\n必须和 PLC 输入模块的公共端匹配：漏型输入（公共端接 0V）配 PNP；源型输入（公共端接 24V）配 NPN。接反了要么一直亮，要么完全不亮。'
    }
  ];

  /** 判断是不是“问问题”，命中则返回离线答疑 */
  function ask(text) {
    var t = String(text || '').trim();
    if (!t) return null;
    var questionLike = /[?？]|什么是|为什么|怎么|如何|区别|原理|能不能|可不可以|要不要|有什么|常见|要点|注意/.test(t);
    var wantsProgram = /(生成|画一|画个|画个图|写一|写个|编一|编个|程序|梯形图|实现)/.test(t);
    var low = t.toLowerCase();
    var hit = null;
    for (var i = 0; i < FAQ.length; i++) {
      for (var j = 0; j < FAQ[i].keys.length; j++) {
        if (low.indexOf(FAQ[i].keys[j].toLowerCase()) >= 0) { hit = FAQ[i]; break; }
      }
      if (hit) break;
    }
    if (hit && !wantsProgram && questionLike) return { title: hit.title, body: hit.body };
    if (questionLike && !wantsProgram) {
      return {
        title: '这个问题我还没收录',
        body: '离线知识库目前覆盖：自锁、互锁、双线圈、扫描周期、边沿、TON/TOF、星三角、常开常闭、模拟量换算、急停安全、Modbus、PNP/NPN。\n点上面的示例按钮可以直接生成对应的梯形图；接上大模型 API 后这类问题会由模型回答。'
      };
    }
    return null;
  }

  PLC.nlp = {
    nlToProgram: nlToProgram,
    explain: explain,
    diagnose: diagnose,
    analyze: analyze,
    ask: ask,
    FAQ: FAQ,
    elText: elText
  };
})(typeof window !== 'undefined' ? window : globalThis);
