/* ============================================================
 * library.js — 示例程序库 + 教学关卡（含自动判分用例）
 * 所有程序都由函数现建，避免互相污染
 * ============================================================ */
(function (global) {
  'use strict';
  var PLC = (global.PLC = global.PLC || {});
  var core = PLC.core;

  function C(addr, nc) { return core.makeElement('contact', { addr: addr, nc: !!nc }); }
  function EDGE(addr, dir) { return core.makeElement('contact', { addr: addr, edge: dir || 'P' }); }
  function CO(addr, mode) { return core.makeElement('coil', { addr: addr, mode: mode || 'out' }); }
  function TON(name, pt) { return core.makeElement('TON', { name: name, pt: pt }); }
  function TOF(name, pt) { return core.makeElement('TOF', { name: name, pt: pt }); }
  function CTU(name, pv) { return core.makeElement('CTU', { name: name, pv: pv }); }
  function CTR(name) { return core.makeElement('CTR', { name: name }); }
  function CMP(a, op, b) { return core.makeElement('CMP', { a: a, op: op, b: b }); }
  function MOVE(src, dst) { return core.makeElement('MOVE', { src: src, dst: dst }); }
  function MATH(op, a, b, dst) { return core.makeElement('MATH', { op: op, a: a, b: b, dst: dst }); }

  /** 一行：stages = [ [ [元素...], [元素...] ], ... ] 外层 stage，内层分支 */
  function rung(comment, stages) {
    return {
      id: core.uid('r'),
      comment: comment || '',
      stages: stages.map(function (st) {
        return { branches: st.map(function (br) { return br.slice(); }) };
      })
    };
  }

  /** 串联一行（每个元素一个 stage，等价于一条直线） */
  function series(comment, els) {
    return rung(comment, els.map(function (e) { return [[e]]; }));
  }

  function prog(name, desc, rungs, symbols) {
    var p = core.emptyProgram(name);
    p.desc = desc || '';
    p.rungs = rungs;
    p.symbols = symbols || {};
    return p;
  }

  /* ============================================================
   * 示例程序
   * ============================================================ */
  var PROGRAMS = [
    {
      id: 'point',
      name: '01 点动控制',
      group: '入门',
      desc: '按住启动按钮电机转，松开即停。最基础的“有触点无自锁”电路。',
      build: function () {
        return prog('点动控制', '按住 I0.0，Q0.0 输出；松开立即停止。', [
          series('按下 SB1，KM1 吸合', [C('I0.0'), CO('Q0.0')])
        ], { 'I0.0': { name: 'SB1', comment: '启动按钮(点动)' }, 'Q0.0': { name: 'KM1', comment: '电机接触器' } });
      }
    },
    {
      id: 'hold',
      name: '02 启保停（自锁）',
      group: '入门',
      desc: '按一下启动，电机自保持运行；按停止才断开。工控第一课。',
      build: function () {
        return prog('启保停控制', '经典自锁：Q0.0 常开触点与启动按钮并联，实现松手后继续运行。', [
          rung('启动 I0.0 或 自锁 Q0.0，经停止 I0.1 常闭，驱动 Q0.0', [
            [[C('I0.0')], [C('Q0.0')]],
            [[C('I0.1', true)]],
            [[CO('Q0.0')]]
          ])
        ], { 'I0.0': { name: 'SB1', comment: '启动' }, 'I0.1': { name: 'SB2', comment: '停止(常闭)' }, 'Q0.0': { name: 'KM1', comment: '电机' } });
      }
    },
    {
      id: 'fwdrev',
      name: '03 正反转 + 互锁',
      group: '入门',
      desc: '两个接触器互相封锁，杜绝同时吸合造成短路。',
      build: function () {
        return prog('正反转互锁', '正转 Q0.0 与反转 Q0.1 互相用常闭触点封锁，并可自锁。', [
          rung('正转：启动 I0.0 / 自锁 Q0.0 / 停止 I0.2 / 反转互锁 Q0.1', [
            [[C('I0.0')], [C('Q0.0')]],
            [[C('I0.2', true)]],
            [[C('Q0.1', true)]],
            [[CO('Q0.0')]]
          ]),
          rung('反转：启动 I0.1 / 自锁 Q0.1 / 停止 I0.2 / 正转互锁 Q0.0', [
            [[C('I0.1')], [C('Q0.1')]],
            [[C('I0.2', true)]],
            [[C('Q0.0', true)]],
            [[CO('Q0.1')]]
          ])
        ], {
          'I0.0': { name: 'SB1', comment: '正转启动' }, 'I0.1': { name: 'SB2', comment: '反转启动' },
          'I0.2': { name: 'SB3', comment: '停止' }, 'Q0.0': { name: 'KM1', comment: '正转接触器' },
          'Q0.1': { name: 'KM2', comment: '反转接触器' }
        });
      }
    },
    {
      id: 'delay',
      name: '04 延时启动',
      group: '定时器',
      desc: '按下启动后等 2 秒电机才运行，用于避免多台设备同时启动冲击电网。',
      build: function () {
        return prog('延时启动', 'I0.0 闭合后 TON 计时 2s，时间到 Q0.0 输出。', [
          rung('启动后经 T1 延时 2s 输出', [
            [[C('I0.0')], [C('Q0.0')]],
            [[C('I0.1', true)]],
            [[TON('T1', 2000)]],
            [[CO('Q0.0')]]
          ]),
          series('运行指示 M0.0 可直接观察', [C('Q0.0'), CO('M0.0')])
        ], { 'I0.0': { name: 'SB1', comment: '启动' }, 'I0.1': { name: 'SB2', comment: '停止' }, 'Q0.0': { name: 'KM1', comment: '电机' } });
      }
    },
    {
      id: 'flash',
      name: '05 闪烁（双定时器振荡）',
      group: '定时器',
      desc: '用两个 TON 互相复位，产生 1s 亮 / 1s 灭的方波。经典面试题。',
      build: function () {
        return prog('闪烁控制', 'T1 与 T2 首尾相接：T1 到时启动 T2，T2 到时反过来复位 T1。', [
          series('T2 未到时 T1 计时', [C('T2.Q', true), TON('T1', 1000)]),
          series('T1 到时启动 T2', [C('T1.Q'), TON('T2', 1000)]),
          series('T1 到时点亮指示灯', [C('T1.Q'), CO('Q0.0')])
        ], { 'Q0.0': { name: 'HL1', comment: '指示灯' } });
      }
    },
    {
      id: 'counter',
      name: '06 计数与复位',
      group: '计数器',
      desc: '按 3 次按钮输出信号，另一个按钮复位计数。',
      build: function () {
        return prog('计数控制', 'I0.0 每闭合一次 CV 加 1，达到 PV=3 时 Q0.0 输出；I0.1 复位。', [
          series('计数输入', [C('I0.0'), CTU('C1', 3)]),
          series('计数到位点亮', [C('C1.Q'), CO('Q0.0')]),
          series('复位按钮', [C('I0.1'), CTR('C1')])
        ], { 'I0.0': { name: 'SB1', comment: '计数脉冲' }, 'I0.1': { name: 'SB2', comment: '复位' }, 'Q0.0': { name: 'HL1', comment: '到位指示' } });
      }
    },
    {
      id: 'star',
      name: '07 星三角降压启动',
      group: '综合',
      desc: '主接触器 + 星形 5 秒 + 切换三角形，带互锁。电气面试高频。',
      build: function () {
        return prog('星三角启动', 'KM1 主接触器先吸合，KM3 星形运行 5s，再断开星形、吸合 KM2 三角形。', [
          rung('主接触器 KM1 自锁', [
            [[C('I0.0')], [C('Q0.0')]],
            [[C('I0.1', true)]],
            [[CO('Q0.0')]]
          ]),
          series('主接触器吸合后开始延时', [C('Q0.0'), TON('T1', 5000)]),
          rung('星形 KM3：延时未到且三角形未吸合', [
            [[C('Q0.0'), C('T1.Q', true), C('Q0.2', true)]],
            [[CO('Q0.1')]]
          ]),
          rung('三角形 KM2：延时到且星形已断开', [
            [[C('Q0.0'), C('T1.Q'), C('Q0.1', true)]],
            [[CO('Q0.2')]]
          ])
        ], {
          'I0.0': { name: 'SB1', comment: '启动' }, 'I0.1': { name: 'SB2', comment: '停止' },
          'Q0.0': { name: 'KM1', comment: '主接触器' }, 'Q0.1': { name: 'KM3', comment: '星形' },
          'Q0.2': { name: 'KM2', comment: '三角形' }
        });
      }
    },
    {
      id: 'conveyor',
      name: '08 传送带顺序启动',
      group: '综合',
      desc: '皮带 1 先转，3 秒后皮带 2 跟着转；停止时一起停。顺序启停是产线基本要求。',
      build: function () {
        return prog('顺序启动', '启动后 Q0.0 立即运行，T1 计时 3s 后 Q0.1 运行。', [
          rung('皮带1 自锁运行', [
            [[C('I0.0')], [C('Q0.0')]],
            [[C('I0.1', true)]],
            [[CO('Q0.0')]]
          ]),
          series('皮带1 运行后延时 3s', [C('Q0.0'), TON('T1', 3000)]),
          rung('皮带2：皮带1 在转且延时到', [
            [[C('Q0.0'), C('T1.Q')]],
            [[C('I0.1', true)]],
            [[CO('Q0.1')]]
          ])
        ], {
          'I0.0': { name: 'SB1', comment: '启动' }, 'I0.1': { name: 'SB2', comment: '停止' },
          'Q0.0': { name: 'M1', comment: '皮带1' }, 'Q0.1': { name: 'M2', comment: '皮带2' }
        });
      }
    },
    {
      id: 'math',
      name: '09 数据处理（MOVE / 算术 / 比较）',
      group: '进阶',
      desc: '把 MW10 的数值做加法、比较，演示模拟量处理的基本套路。',
      build: function () {
        return prog('数据处理', 'I0.0 时把 100 送入 MW10；I0.1 时 MW10 + MW12 送入 MW14；MW14 ≥ 300 输出。', [
          series('I0.0 载入初值', [C('I0.0'), MOVE('100', 'MW10')]),
          series('I0.1 执行加法', [C('I0.1'), MATH('ADD', 'MW10', 'MW12', 'MW14')]),
          rung('比较：MW14 ≥ 300 点亮', [
            [[CMP('MW14', '>=', '300')]],
            [[CO('Q0.0')]]
          ])
        ], { 'Q0.0': { name: 'HL1', comment: '超限指示' } });
      }
    }
  ];

  /* ============================================================
   * 教学关卡（判分用例）
   * step: { set:{addr:0|1}, ms:毫秒 } —— 设置输入后保持 ms 毫秒
   * expect: {addr:0|1} 在本步结束时检查
   * ============================================================ */
  var LESSONS = [
    {
      id: 'l1',
      title: '第 1 关 · 点动控制',
      level: '入门',
      goal: '按住 I0.0 时 Q0.0 输出，松开后输出立即消失。',
      points: [
        '一个常开触点 + 一个线圈，就是最基本的“点动”。',
        '触点不通 = 能流断 = 线圈失电，中间没有任何保持环节。',
        '这类电路常用于调试、点动对刀、手动进退。'
      ],
      hint: '第 1 行放一个 I0.0 常开触点，后面接一个 Q0.0 线圈。',
      demo: 'point',
      tests: [
        { name: '按下 I0.0 应输出', steps: [{ set: { 'I0.0': 1 }, ms: 100 }], expect: { 'Q0.0': 1 } },
        { name: '松开 I0.0 应停止', steps: [{ set: { 'I0.0': 1 }, ms: 100 }, { set: { 'I0.0': 0 }, ms: 100 }], expect: { 'Q0.0': 0 } }
      ]
    },
    {
      id: 'l2',
      title: '第 2 关 · 启保停（自锁）',
      level: '入门',
      goal: '按一下 I0.0 启动，松手后 Q0.0 保持；按 I0.1 停止。',
      points: [
        '关键是把 Q0.0 的常开触点并联在启动按钮两边 —— 这就是“自锁”。',
        '停止按钮用常闭触点，串在回路中；断开即失电。',
        '自锁点的位置错了就变成“按着才转”，一定要并联在启动触点旁。'
      ],
      hint: '第 1 个环节：I0.0 与 Q0.0 并联。然后串 I0.1 常闭，最后接 Q0.0 线圈。',
      demo: 'hold',
      tests: [
        { name: '点一下启动后应保持', steps: [{ set: { 'I0.0': 1 }, ms: 100 }, { set: { 'I0.0': 0 }, ms: 200 }], expect: { 'Q0.0': 1 } },
        { name: '按停止应断开', steps: [{ set: { 'I0.0': 1 }, ms: 100 }, { set: { 'I0.0': 0 }, ms: 100 }, { set: { 'I0.1': 1 }, ms: 100 }], expect: { 'Q0.0': 0 } },
        { name: '未启动时不能自锁', steps: [{ set: { 'I0.1': 0 }, ms: 100 }], expect: { 'Q0.0': 0 } }
      ]
    },
    {
      id: 'l3',
      title: '第 3 关 · 正反转互锁',
      level: '入门',
      goal: 'I0.0 正转 Q0.0，I0.1 反转 Q0.1，I0.2 停止；两者不得同时输出。',
      points: [
        '在正转回路里串反转接触器的常闭触点，反之亦然 —— 硬件互锁之外再加软件互锁。',
        '互锁触点要放在自锁点之后、线圈之前，才能起到封锁作用。',
        '真实设备上还必须加按钮互锁（机械互锁），软件互锁不能替代硬件。'
      ],
      hint: '两行结构对称：启动+自锁并联，串停止常闭，再串对方的常闭。',
      demo: 'fwdrev',
      tests: [
        { name: '正转可自锁', steps: [{ set: { 'I0.0': 1 }, ms: 100 }, { set: { 'I0.0': 0 }, ms: 100 }], expect: { 'Q0.0': 1, 'Q0.1': 0 } },
        { name: '正转时按反转不能吸合', steps: [{ set: { 'I0.0': 1 }, ms: 100 }, { set: { 'I0.0': 0 }, ms: 50 }, { set: { 'I0.1': 1 }, ms: 100 }], expect: { 'Q0.0': 1, 'Q0.1': 0 } },
        { name: '停止后反转可用', steps: [{ set: { 'I0.0': 1 }, ms: 100 }, { set: { 'I0.0': 0, 'I0.2': 1 }, ms: 100 }, { set: { 'I0.2': 0, 'I0.1': 1 }, ms: 100 }], expect: { 'Q0.1': 1, 'Q0.0': 0 } }
      ]
    },
    {
      id: 'l4',
      title: '第 4 关 · 延时启动',
      level: '定时器',
      goal: 'I0.0 闭合后，等待 2 秒 Q0.0 才输出；断开 I0.0 立即停止并复位计时。',
      points: [
        'TON 的 IN 由前面的触点供电，PT 是设定时间。',
        'IN 一旦断开，ET 立即清零，Q 复位 —— 这就是“断电不保持”。',
        '需要累计计时要用 RTO（保持型），不要用 TON。'
      ],
      hint: 'I0.0 → TON(2000ms) → Q0.0。',
      demo: 'delay',
      tests: [
        { name: '1 秒时还未输出', steps: [{ set: { 'I0.0': 1 }, ms: 1000 }], expect: { 'Q0.0': 0 } },
        { name: '2.5 秒时已输出', steps: [{ set: { 'I0.0': 1 }, ms: 2500 }], expect: { 'Q0.0': 1 } },
        { name: '中途断开应复位', steps: [{ set: { 'I0.0': 1 }, ms: 1500 }, { set: { 'I0.0': 0 }, ms: 200 }, { set: { 'I0.0': 1 }, ms: 800 }], expect: { 'Q0.0': 0 } }
      ]
    },
    {
      id: 'l5',
      title: '第 5 关 · 计数到位',
      level: '计数器',
      goal: 'I0.0 每按 3 次，Q0.0 输出；I0.1 复位后重新计数。',
      points: [
        'CTU 在 CU 的上升沿加 1，CV ≥ PV 时 Q 置位。',
        '上升沿很关键：按住不放只算 1 次。',
        '复位要用 R 端（本模拟器用独立的计数复位指令）。'
      ],
      hint: 'I0.0 → CTU(C1, PV=3)；C1.Q → Q0.0；I0.1 → CTR(C1)。',
      demo: 'counter',
      tests: [
        { name: '两次不动作', steps: [{ set: { 'I0.0': 1 }, ms: 60 }, { set: { 'I0.0': 0 }, ms: 60 }, { set: { 'I0.0': 1 }, ms: 60 }, { set: { 'I0.0': 0 }, ms: 60 }], expect: { 'Q0.0': 0 } },
        { name: '三次后输出', steps: [{ set: { 'I0.0': 1 }, ms: 60 }, { set: { 'I0.0': 0 }, ms: 60 }, { set: { 'I0.0': 1 }, ms: 60 }, { set: { 'I0.0': 0 }, ms: 60 }, { set: { 'I0.0': 1 }, ms: 60 }], expect: { 'Q0.0': 1 } },
        { name: '复位后清零', steps: [{ set: { 'I0.0': 1 }, ms: 60 }, { set: { 'I0.0': 0 }, ms: 60 }, { set: { 'I0.0': 1 }, ms: 60 }, { set: { 'I0.0': 0 }, ms: 60 }, { set: { 'I0.0': 1 }, ms: 60 }, { set: { 'I0.1': 1 }, ms: 100 }], expect: { 'Q0.0': 0 } }
      ]
    },
    {
      id: 'l6',
      title: '第 6 关 · 顺序启动',
      level: '综合',
      goal: '按 I0.0 后 Q0.0 先运行，3 秒后 Q0.1 自动运行；按 I0.1 全部停止。',
      points: [
        '顺序启动的核心是“前级运行”作为后级的启动条件。',
        '延时用 TON，其 IN 取前级输出，而不是取启动按钮。',
        '停止要一刀切：后级的停止条件里必须包含总停止。'
      ],
      hint: 'Q0.0 自锁后，用 Q0.0 驱动 TON(3000)，T1.Q 与 Q0.0 一起驱动 Q0.1。',
      demo: 'conveyor',
      tests: [
        { name: '启动瞬间只有皮带1', steps: [{ set: { 'I0.0': 1 }, ms: 200 }], expect: { 'Q0.0': 1, 'Q0.1': 0 } },
        { name: '3.5 秒后皮带2 也运行', steps: [{ set: { 'I0.0': 1 }, ms: 3500 }], expect: { 'Q0.0': 1, 'Q0.1': 1 } },
        { name: '停止全部断开', steps: [{ set: { 'I0.0': 1 }, ms: 3500 }, { set: { 'I0.0': 0, 'I0.1': 1 }, ms: 200 }], expect: { 'Q0.0': 0, 'Q0.1': 0 } }
      ]
    }
  ];

  function getProgram(id) {
    var item = PROGRAMS.filter(function (p) { return p.id === id; })[0];
    return item ? item.build() : null;
  }

  PLC.lib = {
    PROGRAMS: PROGRAMS,
    LESSONS: LESSONS,
    getProgram: getProgram,
    C: C, EDGE: EDGE, CO: CO, TON: TON, TOF: TOF, CTU: CTU, CTR: CTR, CMP: CMP, MOVE: MOVE, MATH: MATH,
    rung: rung, series: series, prog: prog
  };
})(typeof window !== 'undefined' ? window : globalThis);
