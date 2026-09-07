/*
 * 求解桥接层：把 cube.js 的 54 贴纸颜色状态交给 min2phase（Kociemba 两阶段算法），
 * 再把结果翻译成可展示的中文步骤。
 *
 * 依赖：js/cube.js（window.CubeEngine）、js/min2phase.js（window.Min2phase）
 * 暴露：window.CubeSolver = { solve, describeMove, getStepText, warmup }
 */
(function () {
  var E = window.CubeEngine;

  // cube.js 的颜色下标 -> 标准 facelet 字符 URFDLB
  // cube.js:  0=白 1=黄 2=绿 3=蓝 4=红 5=橙
  // 标准配色：白=U 黄=D 绿=F 蓝=B 红=R 橙=L
  var TO_STD = [0, 3, 2, 5, 1, 4];
  var BLOCK = { U: 0, D: 9, F: 18, B: 27, R: 36, L: 45 };
  var ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];
  var STD_CHARS = 'URFDLB';

  function toFaceletString(cube) {
    var out = '';
    for (var fi = 0; fi < 6; fi++) {
      var src = BLOCK[ORDER[fi]];
      for (var p = 0; p < 9; p++) out += STD_CHARS[TO_STD[cube[src + p]]];
    }
    return out;
  }

  var _ready = false;
  function warmup() {
    if (_ready) return true;
    var M = window.Min2phase;
    if (!M || typeof M.initialize !== 'function' || typeof M.solvePattern !== 'function') return false;
    try { M.initialize(); } catch (e) { return false; }
    _ready = true;
    return true;
  }

  var MOVE_RE = /^[UDFBRL]('|2)?$/;

  /**
   * @param {number[]} cubeState 54 个 0..5
   * @returns {{solution:string[], error:string|null, alreadySolved:boolean}}
   */
  function solve(cubeState) {
    var v = E.validate(cubeState);
    if (!v.ok) return { solution: [], error: v.error, alreadySolved: false };

    if (E.isSolved(cubeState)) {
      return { solution: [], error: null, alreadySolved: true };
    }

    if (!warmup()) {
      return { solution: [], error: '求解器未能正确加载，请刷新页面后重试', alreadySolved: false };
    }

    var raw;
    try {
      raw = window.Min2phase.solvePattern(toFaceletString(cubeState));
    } catch (e) {
      return { solution: [], error: '求解时出错：' + (e && e.message ? e.message : '未知错误'), alreadySolved: false };
    }

    if (typeof raw === 'string' && raw.indexOf('Error') === 0) {
      return { solution: [], error: '这个魔方状态无法还原，请检查颜色是否填对', alreadySolved: false };
    }

    var moves = String(raw || '').trim().split(/\s+/).filter(function (s) { return s.length > 0; });
    for (var i = 0; i < moves.length; i++) {
      if (!MOVE_RE.test(moves[i])) {
        return { solution: [], error: '求解结果异常，请重新采集颜色', alreadySolved: false };
      }
    }

    // 关键兜底：把解法真的转一遍确认复原。
    // min2phase 遇到非法状态会静默返回空串，若不校验就会误报"已还原"。
    var check = E.cloneCube(cubeState);
    for (var k = 0; k < moves.length; k++) check = E.applyMove(check, moves[k]);
    if (!E.isSolved(check)) {
      return {
        solution: [],
        error: '这个魔方状态无法还原（可能某一面的颜色填错了），请重新采集',
        alreadySolved: false
      };
    }

    return { solution: moves, error: null, alreadySolved: false };
  }

  var DIR_TEXT = { '': '顺时针 90°', "'": '逆时针 90°', '2': '转 180°' };

  /** 把 "R'" 描述成 "右面 · 逆时针 90°" */
  function describeMove(move) {
    if (!move) return '';
    var face = E.FACE_SHORT.indexOf(move[0]);
    if (face < 0) return move;
    return E.FACE_NAMES[face] + ' · ' + (DIR_TEXT[move.slice(1)] || '');
  }

  function getStepText(move, i, total) {
    return '第 ' + i + ' / ' + total + ' 步：' + describeMove(move);
  }

  window.CubeSolver = {
    solve: solve,
    describeMove: describeMove,
    getStepText: getStepText,
    warmup: warmup
  };

  // 兼容旧调用
  window.getCubeSolver = function () { return window.CubeSolver; };
})();
