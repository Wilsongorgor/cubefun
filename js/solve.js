/*
 * 解法演示页：把求解结果按步播放。
 *
 * 约定：第 i 步（0 <= i < N）展示的是「执行第 i 步之前」的魔方状态，
 * 这样用户看到的样子和手上真魔方一致，照着做就行；
 * i === N 是完成态，展示复原后的魔方。
 *
 * 依赖：js/cube.js、js/min2phase.js、js/solver.js、js/app.js
 */
(function () {
  var E = window.CubeEngine;
  var S = window.CubeSolver;

  var cubeState = null;
  var solution = [];
  var total = 0;
  var current = 0;
  var playTimer = null;
  var els = {};

  var FACE_CLASS = ['f-U', 'f-D', 'f-F', 'f-B', 'f-R', 'f-L'];

  function $(id) { return document.getElementById(id); }

  /** 出错后该回哪个填色页 —— 拍照来的就回拍照页，否则回手动页 */
  function inputUrl() {
    var m = (window.CubeState && window.CubeState.scanMode) || 'manual';
    return m === 'camera' ? 'camera.html' : 'manual.html';
  }

  function buildCube(cubeEl) {
    cubeEl.innerHTML = '';
    for (var f = 0; f < 6; f++) {
      var faceEl = document.createElement('div');
      faceEl.className = 'cube-face ' + FACE_CLASS[f];
      faceEl.setAttribute('data-face', f);
      for (var i = 0; i < 9; i++) {
        var stk = document.createElement('div');
        stk.className = 'stk';
        faceEl.appendChild(stk);
      }
      cubeEl.appendChild(faceEl);
    }
  }

  function renderCube(state, highlightFace) {
    var faceEls = els.cube3d.querySelectorAll('.cube-face');
    for (var n = 0; n < faceEls.length; n++) {
      var f = parseInt(faceEls[n].getAttribute('data-face'), 10);
      var stks = faceEls[n].querySelectorAll('.stk');
      for (var i = 0; i < 9; i++) {
        stks[i].style.backgroundColor = E.COLOR_HEX[state[E.FS[f] + i]];
      }
      faceEls[n].classList.toggle('is-highlight', f === highlightFace);
    }
  }

  /** 第 index 步之前的魔方状态 */
  function stateBefore(index) {
    var st = cubeState.slice();
    for (var i = 0; i < index && i < total; i++) st = E.applyMove(st, solution[i]);
    return st;
  }

  /**
   * 报错不能是死路：以前只有「重新填色」= 回到空白页，54 格全丢。
   * 现在这一屏会
   *   1) 把你填进去的魔方画出来，可疑面标红，可以拖着看；
   *   2) 把可疑格子的坐标写进填色草稿（CubeInputStore），
   *      点「返回修改」回到填色页时自动恢复颜色 + 标红。
   */
  function showError(msg, info) {
    stopPlay();
    els.solving.style.display = 'none';
    els.solution.style.display = 'none';
    els.error.style.display = 'block';
    $('errorText').innerHTML = msg;

    info = info || { bad: [], suspectFaces: [] };
    var suspects = info.suspectFaces || [];
    renderErrorCube(suspects);

    // 把可疑格子写回草稿，让填色页能标红。
    // 没有魔方数据时不写：那种情况下"返回修改"没有意义，别留个莫名其妙的红条。
    if (window.CubeInputStore && cubeState && cubeState.length === 54) {
      var cells = (info.bad || []).map(function (x) {
        var f = E.indexToFace(x);
        return [f, x - E.FS[f]];
      });
      window.CubeInputStore.save({ bad: cells, msg: msg });
    }
  }

  function renderErrorCube(suspects) {
    var cubeEl = $('errorCube3d');
    var scene = $('errorScene');
    var wrap = document.querySelector('.err-cube-wrap');
    if (!cubeEl || !scene) return;
    if (!cubeState || cubeState.length !== 54) {
      if (wrap) wrap.style.display = 'none';
      return;
    }
    if (wrap) wrap.style.display = 'block';
    buildCube(cubeEl);
    var faceEls = cubeEl.querySelectorAll('.cube-face');
    for (var n = 0; n < faceEls.length; n++) {
      var f = parseInt(faceEls[n].getAttribute('data-face'), 10);
      var stks = faceEls[n].querySelectorAll('.stk');
      for (var i = 0; i < 9; i++) {
        var v = cubeState[E.FS[f] + i];
        stks[i].style.backgroundColor = v >= 0 && v <= 5 ? E.COLOR_HEX[v] : '#3a3f55';
      }
      faceEls[n].classList.toggle('has-error', suspects.indexOf(f) >= 0);
    }
    initDragOn(scene, cubeEl);
  }

  function goTo(index) {
    current = Math.max(0, Math.min(total, index));
    render();

    els.prevBtn.disabled = current <= 0;
    els.nextBtn.disabled = current >= total;

    var done = current >= total;
    els.navButtons.style.display = done ? 'none' : 'block';
    els.solved.style.display = done ? 'flex' : 'none';
    if (done) stopPlay();
  }

  function render() {
    var pct = total === 0 ? 100 : (current / total * 100);
    els.progressFill.style.width = pct.toFixed(1) + '%';

    if (total === 0) {
      els.stepText.textContent = '这个魔方本来就是复原的 🎉';
      els.moveHighlight.style.display = 'none';
      renderCube(cubeState, -1);
      $('stepPill').textContent = '0 / 0';
      return;
    }

    var done = current >= total;
    var move = done ? null : solution[current];
    var face = -1;

    if (!done) {
      face = E.FACE_SHORT.indexOf(move[0]);
      els.stepText.textContent = '第 ' + (current + 1) + ' 步 · ' + S.describeMove(move);
      els.moveHighlight.textContent = '👉 转动' + E.FACE_NAMES[face].split(' ')[0] + '（图中高亮的一面）';
      els.moveHighlight.style.display = 'block';
      $('stepPill').textContent = (current + 1) + ' / ' + total;
    } else {
      els.stepText.textContent = '全部完成，魔方已复原 🎉';
      els.moveHighlight.style.display = 'none';
      $('stepPill').textContent = total + ' / ' + total;
    }

    // 完成态用 stateBefore(total)：把最后一步也转完后的复原状态
    renderCube(stateBefore(current), face);
  }

  function next() { if (current < total) goTo(current + 1); }
  function prev() { if (current > 0) goTo(current - 1); }

  function togglePlay() {
    if (playTimer) { stopPlay(); return; }
    if (current >= total) goTo(0);
    els.playBtn.textContent = '⏸ 暂停';
    els.playBtn.classList.add('is-playing');
    playTimer = setInterval(function () {
      if (current >= total) { stopPlay(); return; }
      goTo(current + 1);
    }, 1000);
  }

  function stopPlay() {
    if (playTimer) { clearInterval(playTimer); playTimer = null; }
    if (els.playBtn) {
      els.playBtn.textContent = '▶ 自动播放';
      els.playBtn.classList.remove('is-playing');
    }
  }

  /** 拖动查看：解法区和报错区各有一个魔方，所以按元素传参 */
  function initDragOn(scene, cube) {
    var rx = -24, ry = -34, dragging = false, lx = 0, ly = 0;
    function apply() { cube.style.transform = 'rotateX(' + rx + 'deg) rotateY(' + ry + 'deg)'; }
    scene.addEventListener('pointerdown', function (e) {
      dragging = true; lx = e.clientX; ly = e.clientY;
      try { scene.setPointerCapture(e.pointerId); } catch (err) {}
      scene.classList.add('dragging');
    });
    scene.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      ry += (e.clientX - lx) * 0.5;
      rx -= (e.clientY - ly) * 0.5;
      if (rx > 88) rx = 88; if (rx < -88) rx = -88;
      lx = e.clientX; ly = e.clientY; apply();
    });
    function end() { dragging = false; scene.classList.remove('dragging'); }
    scene.addEventListener('pointerup', end);
    scene.addEventListener('pointercancel', end);
    apply();
  }
  function initDrag() { initDragOn(els.scene, els.cube3d); }

  function init() {
    els = {
      solving: $('solvingSection'),
      error: $('errorSection'),
      solution: $('solutionSection'),
      solved: $('solvedSection'),
      scene: $('solveScene'),
      cube3d: $('solveCube3d'),
      progressFill: $('progressFill'),
      stepText: $('stepText'),
      moveHighlight: $('moveHighlight'),
      navButtons: $('navButtons'),
      prevBtn: $('prevStepBtn'),
      nextBtn: $('nextStepBtn'),
      playBtn: $('playBtn')
    };

    var data = window.CubeState && window.CubeState.cubeData;

    // 「‹ 返回」回到填色页，而不是首页 —— 报错后第一反应就是退回去改
    var back = document.querySelector('.nav-back');
    if (back) back.setAttribute('href', inputUrl());

    var backBtn = $('backEditBtn');
    if (backBtn) backBtn.addEventListener('click', function () { window.location.href = inputUrl(); });
    var restartBtn2 = $('restartInputBtn');
    if (restartBtn2) restartBtn2.addEventListener('click', function () {
      if (window.CubeInputStore) window.CubeInputStore.clear();
      window.CubeState.cubeData = null;
      window.location.href = 'manual.html';
    });

    if (!data || data.length !== 54) {
      showError('没有读到魔方数据。<br>请先回到首页，用拍照或手动方式把六面颜色填好。');
      return;
    }

    cubeState = data.slice();     // 报错时要画给用户看，先存下来
    buildCube(els.cube3d);
    initDrag();

    els.prevBtn.addEventListener('click', function () { stopPlay(); prev(); });
    els.nextBtn.addEventListener('click', function () { stopPlay(); next(); });
    els.playBtn.addEventListener('click', togglePlay);
    var restartBtn = $('restartBtn');
    if (restartBtn) restartBtn.addEventListener('click', function () { stopPlay(); goTo(0); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { stopPlay(); next(); }
      else if (e.key === 'ArrowLeft') { stopPlay(); prev(); }
      else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    });

    // 让"正在求解"这一屏有机会渲染出来，再做同步计算
    setTimeout(function () {
      try {
        var res = S.solve(data);
        if (res.error) { showError(res.error, res); return; }
        // 求出来了：清掉上一次留在草稿里的红框
        if (window.CubeInputStore) window.CubeInputStore.save({ bad: [], msg: '' });
        cubeState = data.slice();
        solution = res.solution;
        total = solution.length;
        els.solving.style.display = 'none';
        els.solution.style.display = 'block';
        goTo(0);
      } catch (err) {
        showError('求解失败：' + (err && err.message ? err.message : '未知错误'));
      }
    }, 60);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
