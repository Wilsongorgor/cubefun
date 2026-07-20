// Bridge: convert cube.js color state -> min2phase (cubing) solver -> move list.
// Exposes window.getCubeSolver() which returns { solve(cubeState), getStepText(...) }.
// Depends on js/min2phase.js (classic script) which sets window.Min2phase.
(function () {
  var TOSTD = [0, 3, 2, 5, 1, 4];
  var BLOCK = { U: 0, D: 9, F: 18, B: 27, R: 36, L: 45 };
  var ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];

  function toURFDLBint(cube) {
    var out = new Array(54);
    for (var fi = 0; fi < 6; fi++) {
      var src = BLOCK[ORDER[fi]];
      for (var p = 0; p < 9; p++) out[fi * 9 + p] = TOSTD[cube[src + p]];
    }
    return out;
  }

  var _ready = false;
  function ensureReady() {
    if (_ready) return true;
    if (!window.Min2phase || typeof window.Min2phase.initialize !== 'function') {
      return false;
    }
    window.Min2phase.initialize();
    _ready = true;
    return true;
  }

  function solve(cubeState) {
    if (!cubeState || cubeState.length !== 54) {
      return { error: '魔方数据无效，请重新输入颜色', solution: [] };
    }
    var counts = [0, 0, 0, 0, 0, 0];
    for (var i = 0; i < 54; i++) {
      if (cubeState[i] < 0 || cubeState[i] > 5) {
        return { error: '魔方颜色识别有误，请重新采集', solution: [] };
      }
      counts[cubeState[i]]++;
    }
    for (var c = 0; c < 6; c++) {
      if (counts[c] !== 9) {
        return { error: '每种颜色必须恰好 9 个，请检查输入', solution: [] };
      }
    }
    if (!ensureReady()) {
      return { error: '求解器未能正确加载，请刷新页面后重试', solution: [] };
    }
    var arr = toURFDLBint(cubeState);
    var str = '';
    for (var k = 0; k < 54; k++) str += 'URFDLB'[arr[k]];
    var res = window.Min2phase.solvePattern(str);
    if (typeof res === 'string' && res.indexOf('Error') === 0) {
      return { error: '无法求解该魔方，请检查颜色输入是否正确', solution: [] };
    }
    var moves = String(res).trim().split(/\s+/).filter(function (s) { return s.length > 0; });
    return { solution: moves, error: null };
  }

  function getStepText(move, i, total) {
    return '第 ' + i + ' / ' + total + ' 步：转动 ' + move;
  }

  window.getCubeSolver = function () {
    return { solve: solve, getStepText: getStepText };
  };
})();
