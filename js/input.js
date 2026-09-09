/*
 * 引导式 3D 魔方填色模块（手动填色 / 拍照识别两个页面共用）
 *
 * 交互：一次只填一个面。填完一整面后，提示"把 X 面转到正对自己"，
 * 同时提供一个可自由拖动的立体魔方 —— 用户既可以按提示走，
 * 也可以自己转着看、点任意一个面直接填那一面。
 *
 * ── 朝向约定（重要）────────────────────────────────
 * 贴纸下标沿用 Kociemba 标准 facelet 顺序：每面 0..8，从左上角按行读。
 * 这个顺序恰好等于"把该面转到正对自己、且摆正"时看到的样子，所以
 * 编辑器里的 3x3 格子可以直接对应 state[FS[f] + i]，不需要任何旋转。
 *
 * 让某个面正对镜头所需的立体旋转量（rotateX, rotateY）：
 *   F(0,0)  R(0,-90)  B(0,180)  L(0,90)  U(-90,0)  D(90,0)
 * 因为 CSS 的 .f-X 自带对应角度的反向旋转，两者相抵后正好是正面视图。
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

  // 让某一面正对镜头的 (rotateX, rotateY)
  var FACE_VIEW = [
    { rx: -90, ry: 0 },   // U
    { rx: 90, ry: 0 },    // D
    { rx: 0, ry: 0 },     // F
    { rx: 0, ry: 180 },   // B
    { rx: 0, ry: -90 },   // R
    { rx: 0, ry: 90 }     // L
  ];
  // 引导顺序：前 → 右 → 后 → 左 → 上 → 下（前四个都是绕竖轴同向转）
  var GUIDE_ORDER = [2, 4, 3, 5, 0, 1];

  var faces = [];
  var brush = 0;
  var activeFace = 2;          // 默认从「前面」开始
  var prevFace = -1;           // 上一个在填的面，用来生成"怎么转过去"的提示
  var hintFrom = null;         // 提示动作的起点姿态 {rx, ry}
  var rx = 0, ry = 0;          // 当前立体旋转量
  var els = {};

  // 求解失败后标出来的可疑格子：[[面下标, 格下标], ...]，以及给用户的提示语
  var bad = [];
  var badMsg = '';

  function emptyFace() { return [-1, -1, -1, -1, -1, -1, -1, -1, -1]; }
  function resetFaces() { faces = []; for (var f = 0; f < 6; f++) faces.push(emptyFace()); }
  function filledCount() { var n = 0; for (var f = 0; f < 6; f++) if (faces[f].indexOf(-1) < 0) n++; return n; }

  /* ---------------- 草稿 / 问题标记 ---------------- */

  function persist() {
    if (window.CubeInputStore) window.CubeInputStore.save({ faces: faces, active: activeFace, bad: bad, msg: badMsg });
  }

  function isBad(f, i) {
    for (var k = 0; k < bad.length; k++) if (bad[k][0] === f && bad[k][1] === i) return true;
    return false;
  }
  function faceBadCount(f) {
    var n = 0;
    for (var k = 0; k < bad.length; k++) if (bad[k][0] === f) n++;
    return n;
  }
  function removeBad(f, i) {
    var next = [];
    for (var k = 0; k < bad.length; k++) if (!(bad[k][0] === f && bad[k][1] === i)) next.push(bad[k]);
    bad = next;
  }
  function clearBad() { bad = []; badMsg = ''; }

  /** 可疑格子最多的那一面 —— 返回后直接跳过去 */
  function worstFace() {
    var best = -1, bestN = 0;
    for (var f = 0; f < 6; f++) {
      var n = faceBadCount(f);
      if (n > bestN) { bestN = n; best = f; }
    }
    return best;
  }

  /** 顶部那条"上次没算出来"的提示条 */
  function updateFixBanner() {
    var box = document.getElementById('fixBanner');
    if (!box) return;
    if (!bad.length && !badMsg) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.style.display = 'block';
    box.innerHTML =
      '<b>上次没能算出解法 —— 下面还是你填的那一版，直接改就行，不用重填。</b>' +
      (badMsg ? '<br>' + badMsg : '') +
      (bad.length
        ? '<br>标红的 <b>' + bad.length + '</b> 格最可疑，点上面的颜色再点格子就能改。'
        : '<br>暂时定位不到具体格子，建议照着六个面逐个核对一遍。') +
      '<button type="button" class="fix-clear" id="fixClearBtn">不用提示了，清除红框</button>';
    var btn = document.getElementById('fixClearBtn');
    if (btn) btn.addEventListener('click', function () { clearBad(); persist(); refresh(); });
  }

  /** 从 CubeInputStore 恢复上一次填的颜色（报错后返回 / 浏览器后退都会走到） */
  function restoreDraft() {
    var d = window.CubeInputStore && window.CubeInputStore.load();
    if (!d) return false;
    if (d.faces) {
      faces = [];
      for (var f = 0; f < 6; f++) faces.push(d.faces[f].slice());
      activeFace = d.active;
    }
    bad = d.bad || [];
    badMsg = d.msg || '';
    var w = worstFace();
    if (w >= 0) activeFace = w;
    return !!d.faces;
  }

  /** 取与 cur 最接近的等价角度，让动画走最短路径 */
  function unwrap(cur, target) {
    var t = target;
    while (t - cur > 180) t -= 360;
    while (cur - t > 180) t += 360;
    return t;
  }

  /* ---------------- 立体魔方 ---------------- */

  var FACE_CLASS = ['f-U', 'f-D', 'f-F', 'f-B', 'f-R', 'f-L'];

  function buildCube3D() {
    var cube = els.cube3d;
    cube.innerHTML = '';
    for (var f = 0; f < 6; f++) {
      (function (fi) {
        var faceEl = document.createElement('div');
        faceEl.className = 'cube-face ' + FACE_CLASS[fi];
        faceEl.setAttribute('data-face', fi);
        for (var i = 0; i < 9; i++) {
          var stk = document.createElement('div');
          stk.className = 'stk';
          faceEl.appendChild(stk);
        }
        faceEl.addEventListener('click', function () {
          if (dragMoved) return;          // 刚才是在拖动，不算点击
          setActiveFace(fi, true);
        });
        cube.appendChild(faceEl);
      })(f);
    }
  }

  function syncCube3D() {
    var faceEls = els.cube3d.querySelectorAll('.cube-face');
    for (var n = 0; n < faceEls.length; n++) {
      var f = parseInt(faceEls[n].getAttribute('data-face'), 10);
      var stks = faceEls[n].querySelectorAll('.stk');
      for (var i = 0; i < 9; i++) {
        var v = faces[f][i];
        stks[i].style.backgroundColor = v < 0 ? EMPTY : COLORS[v].hex;
      }
      faceEls[n].classList.toggle('is-done', faces[f].indexOf(-1) < 0);
      faceEls[n].classList.toggle('is-active', f === activeFace);
      faceEls[n].classList.toggle('has-error', faceBadCount(f) > 0);
    }
  }

  function applyTransform() {
    els.cube3d.style.transform = 'rotateX(' + rx + 'deg) rotateY(' + ry + 'deg)';
  }

  /** 平滑转到指定角度 */
  function animateTo(nrx, nry) {
    rx = nrx; ry = nry;
    els.cube3d.classList.add('animating');
    applyTransform();
    clearTimeout(animateTo._t);
    animateTo._t = setTimeout(function () { els.cube3d.classList.remove('animating'); }, 620);
  }

  /** 把某一面转到正对自己 */
  function faceToFront(f, animate) {
    var v = FACE_VIEW[f];
    var trx = unwrap(rx, v.rx), trry = unwrap(ry, v.ry);
    // rx 和 ry 同时变 = 复合转动（比如"从左面切到上面"），用户没法一步照做，
    // 会转错方向、把颜色填到别的面上。所以先回到"正面朝自己"的标准姿态，
    // 再做一个单轴动作转过去。
    var compound = Math.abs(trx - rx) > 1 && Math.abs(trry - ry) > 1;
    if (compound && animate) {
      animateTo(unwrap(rx, 0), unwrap(ry, 0));
      clearTimeout(faceToFront._t);
      faceToFront._t = setTimeout(function () {
        animateTo(unwrap(rx, v.rx), unwrap(ry, v.ry));
      }, 620);
    } else if (animate) {
      animateTo(trx, trry);
    } else {
      rx = trx; ry = trry; applyTransform();
    }
  }

  /* ---------------- 单面编辑器 ---------------- */

  function buildEditor() {
    var wrap = els.editor;
    wrap.innerHTML = '';
    for (var i = 0; i < 9; i++) {
      (function (idx) {
        var cell = document.createElement('div');
        cell.className = 'ed-cell' + (idx === 4 ? ' is-center' : '');
        cell.setAttribute('data-idx', idx);
        cell.addEventListener('click', function () { paint(idx); });
        wrap.appendChild(cell);
      })(i);
    }
  }

  function syncEditor() {
    var cells = els.editor.querySelectorAll('.ed-cell');
    for (var i = 0; i < cells.length; i++) {
      var v = faces[activeFace][i];
      cells[i].style.backgroundColor = v < 0 ? EMPTY : COLORS[v].hex;
      cells[i].classList.toggle('is-empty', v < 0);
      cells[i].classList.toggle('is-bad', isBad(activeFace, i));
    }
    if (els.editorTitle) els.editorTitle.textContent = '填写' + E.FACE_NAMES[activeFace];
  }

  function paint(idx) {
    faces[activeFace][idx] = brush;
    removeBad(activeFace, idx);      // 用户改过这一格了，不再当可疑
    syncCube3D();
    syncEditor();
    syncChips();
    updateStatus();
    updateFixBanner();
    persist();
    if (faces[activeFace].indexOf(-1) < 0) onFaceComplete();
  }

  function setActiveFace(f, animate) {
    if (f !== activeFace) prevFace = activeFace;
    activeFace = f;
    hintFrom = { rx: rx, ry: ry };      // 记下转动前的姿态，提示要据此算动作
    faceToFront(f, animate !== false);
    syncCube3D();
    syncEditor();
    syncChips();
    updateGuidance();
  }

  /** 重播一次"从上一个面转到当前面"的动作 */
  function demoRotation() {
    if (prevFace < 0) return;
    var v = FACE_VIEW[prevFace];
    rx = v.rx; ry = v.ry;
    els.cube3d.classList.remove('animating');
    applyTransform();
    // 强制回流后再加上过渡，动画才会真的播一遍
    void els.cube3d.offsetWidth;
    faceToFront(activeFace, true);
  }

  /* ---------------- 引导 ---------------- */

  function nextPendingFace(from) {
    var start = GUIDE_ORDER.indexOf(from);
    if (start < 0) start = 0;
    for (var k = 1; k <= 6; k++) {
      var f = GUIDE_ORDER[(start + k) % 6];
      if (faces[f].indexOf(-1) >= 0) return f;
    }
    return -1;
  }

  function onFaceComplete() {
    var nxt = nextPendingFace(activeFace);
    if (nxt < 0) { updateGuidance(); return; }
    setActiveFace(nxt, true);
    toast(E.FACE_NAMES[activeFace].split(' ')[0] + '填好了，接着填下一面');
  }

  /**
   * 生成"把某一面转到正对自己"要做的动作序列。
   *
   * 复合转动会拆成两步：先转回正面，再做一个单轴动作。
   * 不拆的话 —— 比如"从左面切到上面"其实要『转回正面 + 往下翻』两步 ——
   * 提示只说"往左转"，用户转完手里看到的是正面，却往"上面"的格子里填色，
   * 直接就把颜色填错面了。
   */
  function rotationSteps(fromRx, fromRy, to) {
    var a = { rx: fromRx, ry: fromRy }, b = FACE_VIEW[to];
    var steps = [];

    if (Math.abs(unwrap(a.rx, b.rx) - a.rx) > 1 && Math.abs(unwrap(a.ry, b.ry) - a.ry) > 1) {
      steps.push({ arrow: '↺', verb: '先转回正面' });
      a = { rx: unwrap(a.rx, 0), ry: unwrap(a.ry, 0) };
    }

    var drx = unwrap(a.rx, b.rx) - a.rx;
    var dry = unwrap(a.ry, b.ry) - a.ry;
    if (drx === 0 && dry === 0) return steps;

    if (Math.abs(drx) > Math.abs(dry)) {
      steps.push(drx < 0 ? { arrow: '⬇', verb: '往下翻' } : { arrow: '⬆', verb: '往上翻' });
    } else {
      steps.push(dry < 0 ? { arrow: '⬅', verb: '往左转' } : { arrow: '➡', verb: '往右转' });
    }
    return steps;
  }

  function updateGuidance() {
    var box = els.guide;
    if (!box) return;
    var nxt = nextPendingFace(activeFace);
    var done = filledCount();
    var curName = E.FACE_NAMES[activeFace].split(' ')[0];

    if (nxt < 0) {
      box.innerHTML = '<span class="guide-done">✅ 六面都填完了，点下面开始求解</span>';
      box.classList.add('is-done');
      return;
    }
    box.classList.remove('is-done');

    // 第一个面：本来就正对着自己，不需要转
    if (prevFace < 0 || prevFace === activeFace) {
      box.innerHTML =
        '<span class="guide-step">第一步</span>' +
        '<span class="guide-arrow">✋</span>' +
        '<span class="guide-text">先填正对着自己的这一面 —— <b>' + curName + '</b></span>' +
        '<span class="guide-left">还剩 ' + (6 - done) + ' 面</span>';
      return;
    }

    var steps = rotationSteps(
      hintFrom ? hintFrom.rx : FACE_VIEW[prevFace < 0 ? activeFace : prevFace].rx,
      hintFrom ? hintFrom.ry : FACE_VIEW[prevFace < 0 ? activeFace : prevFace].ry,
      activeFace
    );
    var arrow = steps.length ? steps[0].arrow : '✔';
    var verb = steps.map(function (s) { return '<b>' + s.verb + '</b>'; }).join('，再');

    box.innerHTML =
      '<span class="guide-step">下一步</span>' +
      '<span class="guide-arrow">' + arrow + '</span>' +
      '<span class="guide-text">整体' + verb + '，把<b>' + curName + '</b>转到正对自己</span>' +
      '<button type="button" class="guide-btn" id="guideGoBtn">看演示</button>' +
      '<span class="guide-left">还剩 ' + (6 - done) + ' 面</span>';
    var btn = document.getElementById('guideGoBtn');
    if (btn) btn.addEventListener('click', demoRotation);
  }

  /* ---------------- 面切换按钮 ---------------- */

  function buildChips() {
    var wrap = els.chips;
    if (!wrap) return;
    wrap.innerHTML = '';
    for (var f = 0; f < 6; f++) {
      (function (fi) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'face-chip';
        b.setAttribute('data-face', fi);
        b.textContent = E.FACE_NAMES[fi].split(' ')[0];
        b.addEventListener('click', function () { setActiveFace(fi, true); });
        wrap.appendChild(b);
      })(f);
    }
    syncChips();
  }

  function syncChips() {
    if (!els.chips) return;
    var chips = els.chips.querySelectorAll('.face-chip');
    for (var i = 0; i < chips.length; i++) {
      var f = parseInt(chips[i].getAttribute('data-face'), 10);
      chips[i].classList.toggle('is-done', faces[f].indexOf(-1) < 0);
      chips[i].classList.toggle('is-active', f === activeFace);
      chips[i].classList.toggle('has-error', faceBadCount(f) > 0);
    }
  }

  /* ---------------- 调色板 ---------------- */

  function buildPalette() {
    var p = els.palette;
    p.innerHTML = '';
    for (var i = 0; i < COLORS.length; i++) {
      (function (idx) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'swatch-btn';
        btn.setAttribute('data-color', idx);
        btn.innerHTML = '<span class="swatch-chip" style="background:' + COLORS[idx].hex + '"></span>' +
          '<span class="swatch-text">' + COLORS[idx].name + '</span>';
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

  /* ---------------- 状态 / 校验 ---------------- */

  function updateStatus() {
    var n = filledCount();
    if (els.progress) els.progress.textContent = '已填 ' + n + ' / 6 面';
    if (els.progressBar) els.progressBar.style.width = (n / 6 * 100) + '%';
    if (els.solveBtn) {
      els.solveBtn.disabled = n !== 6;
      els.solveBtn.classList.toggle('is-ready', n === 6);
    }
    if (els.hint) {
      var msg = '', seen = {}, dup = false;
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

  function refresh() {
    syncCube3D();
    syncEditor();
    syncChips();
    updateStatus();
    updateGuidance();
    updateFixBanner();
    persist();
  }

  function resetAll() {
    resetFaces();
    prevFace = -1;
    hintFrom = null;
    activeFace = 2;
    clearBad();
    faceToFront(2, true);
    refresh();
  }

  function randomScramble() {
    var names = ['U', "U'", 'U2', 'D', "D'", 'D2', 'F', "F'", 'F2', 'B', "B'", 'B2', 'R', "R'", 'R2', 'L', "L'", 'L2'];
    var alg = [];
    for (var i = 0; i < 25; i++) alg.push(names[Math.floor(Math.random() * names.length)]);
    var st = E.applyAlg(E.solvedCube(), alg.join(' '));
    for (var f = 0; f < 6; f++) for (var k = 0; k < 9; k++) faces[f][k] = st[E.FS[f] + k];
    clearBad();
    refresh();
    return alg.join(' ');
  }

  function setFaceColors(f, arr) {
    faces[f] = arr.slice();
    clearFaceBad(f);
    refresh();
  }

  /** 拍照识别用：把识别结果填进当前面，并自动前进到下一个未填的面 */
  function recognizeActive(arr) {
    faces[activeFace] = arr.slice();
    clearFaceBad(activeFace);
    refresh();
    if (faces[activeFace].indexOf(-1) < 0) onFaceComplete();
  }

  /** 重新采集/重填一整面后，这一面原来的红框就没意义了 */
  function clearFaceBad(f) {
    var next = [];
    for (var k = 0; k < bad.length; k++) if (bad[k][0] !== f) next.push(bad[k]);
    bad = next;
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

  /* ---------------- 拖动 ---------------- */

  var dragMoved = false;

  function initDrag() {
    var dragging = false, lx = 0, ly = 0;
    els.scene.addEventListener('pointerdown', function (e) {
      dragging = true; dragMoved = false;
      lx = e.clientX; ly = e.clientY;
      try { els.scene.setPointerCapture(e.pointerId); } catch (err) {}
      els.cube3d.classList.remove('animating');
      els.scene.classList.add('dragging');
    });
    els.scene.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - lx, dy = e.clientY - ly;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true;
      ry += dx * 0.5;
      rx -= dy * 0.5;
      if (rx > 90) rx = 90; if (rx < -90) rx = -90;
      lx = e.clientX; ly = e.clientY;
      applyTransform();
    });
    function end() { dragging = false; els.scene.classList.remove('dragging'); }
    els.scene.addEventListener('pointerup', end);
    els.scene.addEventListener('pointercancel', end);
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
      scene: document.getElementById('cubeScene'),
      cube3d: document.getElementById('cube3d'),
      editor: document.getElementById('faceEditor'),
      editorTitle: document.getElementById('editorTitle'),
      palette: document.getElementById('palette'),
      chips: document.getElementById('faceChips'),
      guide: document.getElementById('guideBox'),
      progress: document.getElementById('cubeProgress'),
      progressBar: document.getElementById('cubeProgressBar'),
      solveBtn: document.getElementById('solveBtn'),
      hint: document.getElementById('inputHint'),
      toast: document.getElementById('toast')
    };

    resetFaces();
    var restored = restoreDraft();      // 报错后返回 / 浏览器后退：把上次填的拿回来
    buildCube3D();
    buildEditor();
    buildPalette();
    buildChips();
    initDrag();

    var v = FACE_VIEW[activeFace];
    rx = v.rx; ry = v.ry;
    applyTransform();
    refresh();
    if (restored && filledCount() > 0) toast('已恢复上次填的颜色，直接改就行');

    if (els.solveBtn) els.solveBtn.addEventListener('click', function () { goSolve(opts.mode || 'manual'); });
    var rb = document.getElementById('resetBtn');
    if (rb) rb.addEventListener('click', function () { resetAll(); toast('已清空'); });
    var sb = document.getElementById('scrambleBtn');
    if (sb) sb.addEventListener('click', function () { randomScramble(); toast('已随机打乱，可以直接点求解试试'); });
    var cb = document.getElementById('centerBtn');
    if (cb) cb.addEventListener('click', function () { setActiveFace(activeFace, true); });
  }

  window.CubeInput = {
    init: init,
    reset: resetAll,
    refresh: refresh,
    scramble: randomScramble,
    setFaceColors: setFaceColors,
    recognizeActive: recognizeActive,
    advance: function () { if (faces[activeFace].indexOf(-1) < 0) onFaceComplete(); },
    getActiveFace: function () { return activeFace; },
    setActiveFace: setActiveFace,
    getFaces: function () { return faces; },
    getBad: function () { return bad; },
    clearBad: function () { clearBad(); refresh(); },
    toState: toState,
    filledCount: filledCount,
    toast: toast,
    goSolve: goSolve,
    COLORS: COLORS
  };
})();
