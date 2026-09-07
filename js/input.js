/*
 * 魔方颜色输入模块（手动填色 / 拍照识别两个页面共用）
 *
 * 提供：
 *   - 六面展开图（主输入区，朝向无歧义）
 *   - 3D 立体预览（可拖动，与展开图实时同步）
 *   - 调色板「画笔」填色、清除、重置、随机打乱
 *
 * 展开图布局（标准魔方展开，可直接折叠成立体）：
 *
 *         ┌───┐
 *         │ U │          上面
 *     ┌───┼───┼───┬───┐
 *     │ L │ F │ R │ B │  左 / 前 / 右 / 后
 *     └───┼───┼───┴───┘
 *         │ D │          下面
 *         └───┘
 *
 * 依赖：js/cube.js（window.CubeEngine）、js/app.js（window.CubeState）
 * 暴露：window.CubeInput
 */
(function () {
  var E = window.CubeEngine;

  var COLORS = [
    { hex: '#ffffff', name: '白' },
    { hex: '#ffd500', name: '黄' },
    { hex: '#00b16a', name: '绿' },
    { hex: '#0051ba', name: '蓝' },
    { hex: '#b71234', name: '红' },
    { hex: '#ff5800', name: '橙' }
  ];
  var EMPTY = '#3a3f55';

  // 展开图布局：面索引 -> {col,row}
  var NET_POS = [
    { c: 2, r: 1 }, // U
    { c: 2, r: 3 }, // D
    { c: 2, r: 2 }, // F
    { c: 4, r: 2 }, // B
    { c: 3, r: 2 }, // R
    { c: 1, r: 2 }  // L
  ];

  var faces = [];
  var brush = 0;          // 当前画笔颜色下标，-1 表示橡皮
  var focusFace = -1;
  var els = {};
  var onSolve = null;

  function emptyFace() { return [-1, -1, -1, -1, -1, -1, -1, -1, -1]; }
  function resetFaces() { faces = []; for (var f = 0; f < 6; f++) faces.push(emptyFace()); }

  function filledCount() {
    var n = 0;
    for (var f = 0; f < 6; f++) if (faces[f].indexOf(-1) < 0) n++;
    return n;
  }

  /* ---------------- 展开图 ---------------- */

  function buildNet() {
    var net = els.net;
    net.innerHTML = '';
    for (var f = 0; f < 6; f++) {
      (function (fi) {
        var pos = NET_POS[fi];
        var box = document.createElement('div');
        box.className = 'net-face';
        box.style.gridColumn = pos.c;
        box.style.gridRow = pos.r;
        box.setAttribute('data-face', fi);

        var label = document.createElement('div');
        label.className = 'net-label';
        label.textContent = E.FACE_NAMES[fi].split(' ')[0];
        box.appendChild(label);

        var grid = document.createElement('div');
        grid.className = 'net-grid';
        for (var i = 0; i < 9; i++) {
          (function (idx) {
            var cell = document.createElement('div');
            cell.className = 'net-cell' + (idx === 4 ? ' is-center' : '');
            cell.setAttribute('data-face', fi);
            cell.setAttribute('data-idx', idx);
            cell.addEventListener('click', function () { paint(fi, idx); });
            grid.appendChild(cell);
          })(i);
        }
        box.appendChild(grid);
        net.appendChild(box);
      })(f);
    }
    syncNet();
  }

  function syncNet() {
    var cells = els.net.querySelectorAll('.net-cell');
    for (var i = 0; i < cells.length; i++) {
      var f = parseInt(cells[i].getAttribute('data-face'), 10);
      var idx = parseInt(cells[i].getAttribute('data-idx'), 10);
      var v = faces[f][idx];
      cells[i].style.backgroundColor = v < 0 ? EMPTY : COLORS[v].hex;
      cells[i].classList.toggle('is-empty', v < 0);
    }
    var boxes = els.net.querySelectorAll('.net-face');
    for (var j = 0; j < boxes.length; j++) {
      var bf = parseInt(boxes[j].getAttribute('data-face'), 10);
      boxes[j].classList.toggle('is-done', faces[bf].indexOf(-1) < 0);
      boxes[j].classList.toggle('is-focus', bf === focusFace);
    }
  }

  /* ---------------- 3D 预览 ---------------- */

  function buildCube3D() {
    var cube = els.cube3d;
    if (!cube) return;
    cube.innerHTML = '';
    var cls = ['f-U', 'f-D', 'f-F', 'f-B', 'f-R', 'f-L'];
    for (var f = 0; f < 6; f++) {
      (function (fi) {
        var faceEl = document.createElement('div');
        faceEl.className = 'cube-face ' + cls[fi];
        faceEl.setAttribute('data-face', fi);
        for (var i = 0; i < 9; i++) {
          var stk = document.createElement('div');
          stk.className = 'stk';
          faceEl.appendChild(stk);
        }
        faceEl.addEventListener('click', function () {
          if (dragMoved) return;   // 刚才是拖动，不当作点击
          focusOnFace(fi);
        });
        cube.appendChild(faceEl);
      })(f);
    }
    syncCube3D();
  }

  function syncCube3D() {
    var cube = els.cube3d;
    if (!cube) return;
    var faceEls = cube.querySelectorAll('.cube-face');
    for (var n = 0; n < faceEls.length; n++) {
      var f = parseInt(faceEls[n].getAttribute('data-face'), 10);
      var stks = faceEls[n].querySelectorAll('.stk');
      for (var i = 0; i < 9; i++) {
        var v = faces[f][i];
        stks[i].style.backgroundColor = v < 0 ? EMPTY : COLORS[v].hex;
      }
      faceEls[n].classList.toggle('is-done', faces[f].indexOf(-1) < 0);
      faceEls[n].classList.toggle('is-focus', f === focusFace);
    }
  }

  function focusOnFace(f) {
    focusFace = (focusFace === f) ? -1 : f;
    syncNet();
    syncCube3D();
  }

  /* ---------------- 调色板 ---------------- */

  function buildPalette() {
    var p = els.palette;
    if (!p) return;
    p.innerHTML = '';
    for (var i = 0; i < COLORS.length; i++) {
      (function (idx) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'swatch-btn';
        btn.setAttribute('data-color', idx);
        var chip = document.createElement('span');
        chip.className = 'swatch-chip';
        chip.style.backgroundColor = COLORS[idx].hex;
        var nm = document.createElement('span');
        nm.className = 'swatch-text';
        nm.textContent = COLORS[idx].name;
        btn.appendChild(chip);
        btn.appendChild(nm);
        btn.addEventListener('click', function () { setBrush(idx); });
        p.appendChild(btn);
      })(i);
    }
    var er = document.createElement('button');
    er.type = 'button';
    er.className = 'swatch-btn eraser';
    er.setAttribute('data-color', '-1');
    er.innerHTML = '<span class="swatch-chip eraser-chip">✕</span><span class="swatch-text">清除</span>';
    er.addEventListener('click', function () { setBrush(-1); });
    p.appendChild(er);
    setBrush(0);
  }

  function setBrush(idx) {
    brush = idx;
    var btns = els.palette.querySelectorAll('.swatch-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('is-active', parseInt(btns[i].getAttribute('data-color'), 10) === brush);
    }
  }

  /* ---------------- 交互 ---------------- */

  function paint(f, idx) {
    faces[f][idx] = brush;
    focusFace = f;
    syncNet();
    syncCube3D();
    updateStatus();
  }

  function setFaceColors(f, arr) {
    faces[f] = arr.slice();
    syncNet();
    syncCube3D();
    updateStatus();
  }

  function updateStatus() {
    var n = filledCount();
    if (els.progress) els.progress.textContent = '已填 ' + n + ' / 6 面';
    if (els.progressBar) els.progressBar.style.width = (n / 6 * 100) + '%';
    if (els.solveBtn) {
      var ready = n === 6;
      els.solveBtn.disabled = !ready;
      els.solveBtn.classList.toggle('is-ready', ready);
    }
    // 中心块重复提示
    if (els.hint) {
      var msg = '';
      var seen = {}, dup = false;
      for (var f = 0; f < 6; f++) {
        var c = faces[f][4];
        if (c < 0) continue;
        if (seen[c]) { dup = true; break; }
        seen[c] = 1;
      }
      if (dup) msg = '⚠️ 有两个面的中心块颜色相同，这样是拼不回去的';
      els.hint.textContent = msg;
      els.hint.style.display = msg ? 'block' : 'none';
    }
  }

  function resetAll() {
    resetFaces();
    focusFace = -1;
    syncNet();
    syncCube3D();
    updateStatus();
  }

  /** 生成一个随机打乱的合法状态，方便体验与调试 */
  function randomScramble() {
    var names = ['U', "U'", 'U2', 'D', "D'", 'D2', 'F', "F'", 'F2', 'B', "B'", 'B2', 'R', "R'", 'R2', 'L', "L'", 'L2'];
    var alg = [];
    for (var i = 0; i < 25; i++) alg.push(names[Math.floor(Math.random() * names.length)]);
    var st = E.applyAlg(E.solvedCube(), alg.join(' '));
    for (var f = 0; f < 6; f++) {
      for (var k = 0; k < 9; k++) faces[f][k] = st[E.FS[f] + k];
    }
    syncNet();
    syncCube3D();
    updateStatus();
    return alg.join(' ');
  }

  function toState() {
    var st = new Array(54);
    for (var f = 0; f < 6; f++) for (var i = 0; i < 9; i++) st[E.FS[f] + i] = faces[f][i];
    return st;
  }

  function goSolve(mode) {
    if (filledCount() !== 6) { toast('六面都要填满才能求解'); return; }
    var st = toState();
    var v = E.validate(st);
    if (!v.ok) { toast(v.error); return; }
    window.CubeState.cubeData = st;
    window.CubeState.scanMode = mode || 'manual';
    window.location.href = 'solve.html';
  }

  /* ---------------- 3D 拖动 ---------------- */

  var dragMoved = false;

  function initDrag() {
    if (!els.scene || !els.cube3d) return;
    var rx = -24, ry = -34, dragging = false, lx = 0, ly = 0, downX = 0, downY = 0;
    function apply() { els.cube3d.style.transform = 'rotateX(' + rx + 'deg) rotateY(' + ry + 'deg)'; }
    els.scene.addEventListener('pointerdown', function (e) {
      dragging = true; dragMoved = false;
      lx = e.clientX; ly = e.clientY; downX = e.clientX; downY = e.clientY;
      try { els.scene.setPointerCapture(e.pointerId); } catch (err) {}
      els.scene.classList.add('dragging');
    });
    els.scene.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      if (Math.abs(e.clientX - downX) > 5 || Math.abs(e.clientY - downY) > 5) dragMoved = true;
      ry += (e.clientX - lx) * 0.5;
      rx -= (e.clientY - ly) * 0.5;
      if (rx > 88) rx = 88; if (rx < -88) rx = -88;
      lx = e.clientX; ly = e.clientY; apply();
    });
    function end() { dragging = false; els.scene.classList.remove('dragging'); }
    els.scene.addEventListener('pointerup', end);
    els.scene.addEventListener('pointercancel', end);
    apply();
  }

  /* ---------------- toast ---------------- */

  var toastTimer = null;
  function toast(msg) {
    var t = els.toast || document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }

  /* ---------------- 初始化 ---------------- */

  function init(opts) {
    opts = opts || {};
    els = {
      net: document.getElementById('net'),
      scene: document.getElementById('cubeScene'),
      cube3d: document.getElementById('cube3d'),
      palette: document.getElementById('palette'),
      progress: document.getElementById('cubeProgress'),
      progressBar: document.getElementById('cubeProgressBar'),
      solveBtn: document.getElementById('solveBtn'),
      hint: document.getElementById('inputHint'),
      toast: document.getElementById('toast')
    };
    resetFaces();
    buildNet();
    buildCube3D();
    buildPalette();
    initDrag();
    updateStatus();

    if (els.solveBtn) {
      els.solveBtn.addEventListener('click', function () { goSolve(opts.mode || 'manual'); });
    }
    var rb = document.getElementById('resetBtn');
    if (rb) rb.addEventListener('click', resetAll);
    var sb = document.getElementById('scrambleBtn');
    if (sb) sb.addEventListener('click', function () { randomScramble(); toast('已随机打乱，可直接点求解试试'); });
  }

  window.CubeInput = {
    init: init,
    reset: resetAll,
    scramble: randomScramble,
    setFaceColors: setFaceColors,
    getFaces: function () { return faces; },
    toState: toState,
    filledCount: filledCount,
    toast: toast,
    goSolve: goSolve,
    COLORS: COLORS,
    refresh: function () { syncNet(); syncCube3D(); updateStatus(); }
  };
})();
