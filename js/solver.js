/*
 * 求解桥接层：把 cube.js 的 54 贴纸颜色状态交给 min2phase（Kociemba 两阶段算法），
 * 再把结果翻译成可展示的中文步骤。
 *
 * 依赖：js/cube.js（window.CubeEngine）、js/min2phase.js（window.Min2phase）
 * 暴露：window.CubeSolver = { solve, describeMove, getStepText, warmup }
 */
(function () {
  var E = window.CubeEngine;

  // 输出顺序必须是 Kociemba 的 U R F D L B
  var BLOCK = { U: 0, D: 9, F: 18, B: 27, R: 36, L: 45 };
  var ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];

  // 角块 / 棱块的贴纸分组（cube.js 索引空间 U:0-8 D:9-17 F:18-26 B:27-35 R:36-44 L:45-53）。
  // 这组常量不是手推的：由每个贴纸在立方体上的 3D 坐标自动聚类得到，
  // 并用"任一次转动都必须把整块搬到整块"逐条核对过（tests/cubies.test.js）。
  var CORNERS = [
    [0, 29, 45], [2, 27, 38], [6, 18, 47], [8, 20, 36],
    [9, 24, 53], [11, 26, 42], [15, 35, 51], [17, 33, 44]
  ];
  var EDGES = [
    [1, 28], [3, 46], [5, 37], [7, 19],
    [10, 25], [12, 52], [14, 43], [16, 34],
    [21, 50], [23, 39], [30, 41], [32, 48]
  ];
  var OPPOSITE = { U: 'D', D: 'U', F: 'B', B: 'F', R: 'L', L: 'R' };
  var FACE_CN = { U: '上面', D: '下面', F: '前面', B: '后面', R: '右面', L: '左面' };

  /**
   * 出错时尽量定位到具体位置，别只丢一句"填色有问题"。
   * 能查出来的：
   *   - 一个块里出现重复颜色
   *   - 一个块里出现了本该在对面的颜色（典型的"某一面整体填反/填错面"）
   * 查不出来的（整体奇偶、朝向错误）仍然只能交给 min2phase。
   */
  function diagnose(cube) {
    var ch = colorToFaceChar(cube);
    var hits = [], i, k;
    var at = function (g) { return g.map(function (x) { return E.FACE_SHORT[E.indexToFace(x)]; }); };
    var got = function (g) { return g.map(function (x) { return ch[cube[x]]; }); };

    for (i = 0; i < CORNERS.length; i++) {
      var col = got(CORNERS[i]);
      var bad = col[0] === col[1] || col[1] === col[2] || col[0] === col[2];
      for (k = 0; k < 3; k++) if (col.indexOf(OPPOSITE[col[k]]) >= 0) bad = true;
      if (bad) hits.push({ kind: '角块', at: at(CORNERS[i]) });
    }
    for (i = 0; i < EDGES.length; i++) {
      var e = got(EDGES[i]);
      if (e[0] === e[1] || e.indexOf(OPPOSITE[e[0]]) >= 0) hits.push({ kind: '棱块', at: at(EDGES[i]) });
    }
    return hits;
  }

  /** 把出错的块描述成中文，并汇总"最可能被填错的面" */
  function describeHits(hits) {
    // 出错的块集中在哪几个面附近，那几个面就是最可能被填错的
    var freq = {};
    hits.forEach(function (h) { h.at.forEach(function (f) { freq[f] = (freq[f] || 0) + 1; }); });
    var suspects = Object.keys(freq)
      .sort(function (a, b) { return freq[b] - freq[a]; })
      .slice(0, 3)
      .map(function (f) { return FACE_CN[f] || f; });

    var parts = hits.slice(0, 3).map(function (h) {
      return h.kind + '（' + h.at.map(function (f) { return FACE_CN[f] || f; }).join('·') + '）';
    });
    var detail = parts.join('、');
    if (hits.length > 3) detail += ' 等 ' + hits.length + ' 处';
    return { detail: detail, suspects: suspects };
  }

  // 注意：这里【不能】写死"白=U 黄=D 绿=F …"这类配色方案。
  // 市面上很多魔方不是标准西式配色（黄顶白底、蓝顶、日系配色都很常见），
  // 一旦写死，这些魔方的状态会被判成非法 —— 连一个已经复原的魔方都会报
  // "无法还原"。所以配色一律由用户填的六个中心块现场推导：
  // 哪个颜色出现在哪一面的中心，哪个颜色就代表那一面。
  function colorToFaceChar(cube) {
    var m = {};
    for (var f = 0; f < 6; f++) m[cube[E.FACE_CENTER[f]]] = E.FACE_SHORT[f];
    return m;
  }

  function toFaceletString(cube) {
    var ch = colorToFaceChar(cube);
    var out = '';
    for (var fi = 0; fi < 6; fi++) {
      var src = BLOCK[ORDER[fi]];
      for (var p = 0; p < 9; p++) out += ch[cube[src + p]] || '?';
    }
    return out;
  }

  /** 求解失败时统一走这里：先用块结构定位问题，定位不到再给兜底文案 */
  function fail(cube) {
    var hits = diagnose(cube);
    var err;
    if (hits.length) {
      var d = describeHits(hits);
      err = '这几个块的颜色凑不出来：' + d.detail +
        '。<br>重点检查 <b>' + d.suspects.join('、') + '</b> 这几面 —— 多半是某一面整体填反了，' +
        '或者填的时候魔方被整个翻过。';
    } else {
      err = '这个魔方状态无法还原（可能某一面的颜色填错了），请重新采集。' +
        '<br>提示：整个过程里魔方只能<b>按提示整体转动</b>，不能整个翻过来，否则步骤会对不上。';
    }
    return { solution: [], error: err, alreadySolved: false };
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

    if (typeof raw === 'string' && raw.indexOf('Error') === 0) return fail(cubeState);

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
    if (!E.isSolved(check)) return fail(cubeState);

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
