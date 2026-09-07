/*
 * 拍照识别：打开摄像头，用九宫格取景，采样 9 格中心区域的颜色并归类到魔方六色。
 * 识别结果直接写入共享输入模块（CubeInput）的对应面，之后仍可手动修正。
 *
 * 依赖：js/cube.js、js/input.js
 */
(function () {
  var E = window.CubeEngine;

  var stream = null;
  var video = null;
  var gridEl = null;
  var sampler = null;        // 离屏 canvas
  var currentFace = 0;       // 当前正在拍的面
  var lastTick = 0;
  var rafId = null;

  /* ---------- 颜色归类：优先用色相，受光照影响小 ---------- */
  function classify(r, g, b) {
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var v = max / 255;
    var d = max - min;
    var s = max === 0 ? 0 : d / max;

    // 很暗的像素没有有效色相，按亮度给白/灰
    if (v < 0.12) return 0;

    var h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
      else if (max === g) h = ((b - r) / d + 2) * 60;
      else h = ((r - g) / d + 4) * 60;
    }

    if (s < 0.20 && v > 0.45) return 0;   // 白
    if (h >= 330 || h < 12) return 4;     // 红
    if (h < 45) return 5;                 // 橙
    if (h < 75) return 1;                 // 黄
    if (h < 170) return 2;                // 绿
    if (h < 265) return 3;                // 蓝
    return 4;                             // 品红 / 紫 → 归红
  }

  function sampleCell(sx, sy, sw, sh) {
    var ctx = sampler.getContext('2d');
    var data = ctx.getImageData(Math.round(sx), Math.round(sy), Math.max(1, Math.round(sw)), Math.max(1, Math.round(sh))).data;
    var r = 0, g = 0, b = 0, n = 0;
    // 隔点取样，够快也够稳
    for (var i = 0; i < data.length; i += 16) {
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    if (!n) return 0;
    return classify(r / n, g / n, b / n);
  }

  /** 计算九宫格每一格在视频原始像素中的取样区域（取格子中心 46%） */
  function sampleGrid() {
    var vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    if (!sampler) sampler = document.createElement('canvas');
    sampler.width = vw;
    sampler.height = vh;
    sampler.getContext('2d').drawImage(video, 0, 0, vw, vh);

    var vRect = video.getBoundingClientRect();
    var scaleX = vw / vRect.width, scaleY = vh / vRect.height;
    var cells = gridEl.children;
    var out = [];
    for (var i = 0; i < 9 && i < cells.length; i++) {
      var cr = cells[i].getBoundingClientRect();
      var x = (cr.left - vRect.left) * scaleX;
      var y = (cr.top - vRect.top) * scaleY;
      var w = cr.width * scaleX, h = cr.height * scaleY;
      var pad = 0.27; // 只取中心 46%，避开格子边缘与黑边
      out.push(sampleCell(x + w * pad, y + h * pad, w * (1 - pad * 2), h * (1 - pad * 2)));
    }
    return out.length === 9 ? out : null;
  }

  /* ---------- 实时预览：把识别到的颜色染到取景格上 ---------- */
  function tick(ts) {
    rafId = requestAnimationFrame(tick);
    if (!video || !video.videoWidth) return;
    if (ts - lastTick < 150) return;
    lastTick = ts;
    var res = sampleGrid();
    if (!res) return;
    var cells = gridEl.children;
    for (var i = 0; i < 9; i++) {
      cells[i].style.backgroundColor = window.CubeInput.COLORS[res[i]].hex;
      cells[i].style.opacity = '0.55';
    }
  }

  /* ---------- 相机 ---------- */
  function start() {
    video = document.getElementById('video');
    gridEl = document.getElementById('overlayGrid');
    if (!video) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      fallback('这个浏览器不支持调用摄像头，请改用手动填色');
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } } })
      .then(function (s) {
        stream = s;
        video.srcObject = s;
        var p = video.play();
        if (p && p.catch) p.catch(function () {});
        rafId = requestAnimationFrame(tick);
      })
      .catch(function (err) {
        fallback('打不开摄像头（' + (err && err.name ? err.name : '未知') + '）。<br>请检查权限，或改用手动填色。');
      });
  }

  function fallback(html) {
    var area = document.getElementById('cameraArea');
    if (!area) return;
    area.innerHTML = '<div class="camera-fallback"><div class="camera-icon-big">📷</div><div>' + html + '</div></div>';
    var btn = document.getElementById('captureBtn');
    if (btn) btn.disabled = true;
  }

  function stop() {
    if (rafId) cancelAnimationFrame(rafId);
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
  }

  /* ---------- 面切换 ---------- */
  function renderFaceChips() {
    var wrap = document.getElementById('faceChips');
    if (!wrap) return;
    wrap.innerHTML = '';
    for (var f = 0; f < 6; f++) {
      (function (fi) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'face-chip';
        b.setAttribute('data-face', fi);
        b.innerHTML = '<span class="chip-name">' + E.FACE_NAMES[fi].split(' ')[0] + '</span>';
        b.addEventListener('click', function () { currentFace = fi; renderFaceChips(); });
        wrap.appendChild(b);
      })(f);
    }
    syncFaceChips();
  }

  function syncFaceChips() {
    var wrap = document.getElementById('faceChips');
    if (!wrap) return;
    var faces = window.CubeInput.getFaces();
    var chips = wrap.querySelectorAll('.face-chip');
    for (var i = 0; i < chips.length; i++) {
      var f = parseInt(chips[i].getAttribute('data-face'), 10);
      var done = faces[f].indexOf(-1) < 0;
      chips[i].classList.toggle('is-done', done);
      chips[i].classList.toggle('is-current', f === currentFace);
    }
    var t = document.getElementById('captureFaceName');
    if (t) t.textContent = E.FACE_NAMES[currentFace];
  }

  function nextPendingFace() {
    var faces = window.CubeInput.getFaces();
    for (var k = 1; k <= 6; k++) {
      var f = (currentFace + k) % 6;
      if (faces[f].indexOf(-1) >= 0) return f;
    }
    return currentFace;
  }

  /* ---------- 识别 ---------- */
  function capture() {
    if (!video || !video.videoWidth) {
      window.CubeInput.toast('摄像头还没准备好，稍等一下');
      return;
    }
    var res = sampleGrid();
    if (!res) { window.CubeInput.toast('取样失败，请让魔方完整出现在取景框里'); return; }

    window.CubeInput.setFaceColors(currentFace, res);
    syncFaceChips();

    var left = 6 - window.CubeInput.filledCount();
    if (left > 0) {
      currentFace = nextPendingFace();
      syncFaceChips();
      window.CubeInput.toast('已识别，接着拍' + E.FACE_NAMES[currentFace].split(' ')[0] + '（还剩 ' + left + ' 面）');
    } else {
      window.CubeInput.toast('六面都识别完了，正在进入核对…');
      setTimeout(enterFill, 700);
    }
  }

  function enterFill() {
    stop();
    var cp = document.getElementById('capturePhase');
    var fp = document.getElementById('fillPhase');
    if (cp) cp.style.display = 'none';
    if (fp) fp.style.display = 'block';
    window.CubeInput.refresh();
    window.scrollTo(0, 0);
  }

  function init() {
    var capBtn = document.getElementById('captureBtn');
    var skipBtn = document.getElementById('skipBtn');
    if (capBtn) capBtn.addEventListener('click', capture);
    if (skipBtn) skipBtn.addEventListener('click', enterFill);
    renderFaceChips();
    start();
    window.addEventListener('pagehide', stop);
  }

  window.CubeCamera = { init: init, stop: stop, classify: classify };
})();
