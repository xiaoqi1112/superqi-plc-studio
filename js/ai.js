/* ============================================================
 * ai.js — 可选大模型接入（OpenAI / DeepSeek 兼容）
 * 没有配置 Key 时完全离线，走 nlp.js 的规则引擎
 * ============================================================ */
(function (global) {
  'use strict';
  var PLC = (global.PLC = global.PLC || {});
  var core = PLC.core;
  var KEY = 'plc-studio-ai-cfg';

  var ai = {
    cfg: { endpoint: 'https://api.deepseek.com/v1/chat/completions', key: '', model: 'deepseek-chat' },

    load: function () {
      try {
        var s = localStorage.getItem(KEY);
        if (s) Object.assign(this.cfg, JSON.parse(s));
      } catch (e) { /* ignore */ }
      return this.cfg;
    },

    save: function (cfg) {
      Object.assign(this.cfg, cfg || {});
      try { localStorage.setItem(KEY, JSON.stringify(this.cfg)); } catch (e) { /* ignore */ }
    },

    enabled: function () { return !!(this.cfg.key && this.cfg.endpoint); },

    chat: function (messages, timeoutMs) {
      var self = this;
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs || 30000);
      return fetch(this.cfg.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this.cfg.key
        },
        body: JSON.stringify({
          model: this.cfg.model,
          messages: messages,
          temperature: 0.2,
          stream: false
        }),
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (res) {
        clearTimeout(timer);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function (data) {
        var c = data && data.choices && data.choices[0] && data.choices[0].message;
        if (!c || !c.content) throw new Error('返回内容为空');
        return c.content;
      }).catch(function (err) {
        clearTimeout(timer);
        throw err;
      });
    },

    stripFence: function (s) {
      return String(s || '').replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    },

    /** 自然语言 → 程序（结构化 JSON） */
    generate: function (text) {
      var sys = [
        '你是 PLC 梯形图编程助手，输出必须是严格的 JSON，不要任何解释文字。',
        'JSON 结构：{"title":"名称","rungs":[{"comment":"行注释","stages":[[ 分支 ], ... ]}]}',
        'stages 是串联的“段”数组；每个段是并联分支数组；每个分支是元素数组（串联）。',
        '元素类型：',
        '{"kind":"contact","addr":"I0.0","nc":false}  常开触点；nc=true 为常闭',
        '{"kind":"coil","addr":"Q0.0","mode":"out"}   mode 可为 out/set/reset',
        '{"kind":"TON","name":"T1","pt":3000}  毫秒',
        '{"kind":"CTU","name":"C1","pv":3}',
        '{"kind":"CTR","name":"C1"}',
        '{"kind":"CMP","a":"MW10","op":">=","b":"100"}',
        '{"kind":"MOVE","src":"100","dst":"MW10"}',
        '{"kind":"MATH","op":"ADD","a":"MW10","b":"MW12","dst":"MW14"}',
        '地址规则：I 为输入，Q 为输出，M 为中间位；字地址用 MW/MD。定时器输出写成 T1.Q，计数器输出写成 C1.Q。',
        '默认分配：启动 I0.0，停止 I0.1，输出 Q0.0。',
        '务必保证每个输出都有驱动它的线圈，禁止编造不存在的指令。'
      ].join('\n');
      return this.chat([
        { role: 'system', content: sys },
        { role: 'user', content: '控制要求：' + text + '\n只输出 JSON。' }
      ], 40000).then(function (raw) {
        var obj = JSON.parse(ai.stripFence(raw));
        var program = core.normalize({ name: obj.title || 'AI 生成程序', rungs: obj.rungs || [] });
        var errs = core.validate(program).filter(function (i) { return i.level === 'error'; });
        if (errs.length) throw new Error('AI 生成的程序校验失败：' + errs[0].msg);
        return program;
      });
    },

    /** 解释程序（可选，走大模型更自然） */
    explain: function (program, offlineText) {
      var json = JSON.stringify(program.rungs.map(function (r) {
        return { comment: r.comment, stages: r.stages.map(function (s) { return s.branches.map(function (b) { return b.map(function (el) { return el.kind + ':' + (el.addr || el.name || ''); }); }); }) };
      }));
      return this.chat([
        { role: 'system', content: '你是工业自动化讲师。用中文逐条解释梯形图的功能、关键结构和潜在风险，300 字以内，不要用 markdown 表格。' },
        { role: 'user', content: '梯形图结构 JSON：' + json + '\n离线解释参考：' + (offlineText || '') }
      ], 30000);
    }
  };

  PLC.ai = ai;
})(typeof window !== 'undefined' ? window : globalThis);
