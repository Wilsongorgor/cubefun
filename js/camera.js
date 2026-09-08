/*
 * 拍照识别：打开摄像头，用九宫格取景，采样 9 格中心区域的颜色并归类到魔方六色。
 * 识别结果写入 CubeInput 当前正在编辑的那一面，之后仍可手动改。
 *
 * 依赖：js/cube.js、js/input.js
 */
(function () {
  var E = window.CubeEngine;

  var stream = null;
  var video = null;
  var gridEl = null;
  var sampler = null;
  var lastTick = 0;
  var rafId = null;

  /* ---------- 颜色归类：主要看色相，受光照影响小 ---------- */
  function classify(r, g, b) {
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var v = max / 255;
    var d = max - min;
    var s = max === 0 ? 0 : d / max;

    if (v < 0.12) return 0;                 // 太暗，没有有效色相

    var h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
      else if (max === g) h = ((b - r) / d + 2) * 60;
      else h = ((r - g) / d + 4) * 60;
    }

    if (s < 0.20 && v > 0.45) return 0;     // 白
    if (h >= 330 || h < 12) return 4;       // 红
    if (h < 45) return 5;                   // 橙
    if (h < 75) return 1;                   // 黄
    if (h < 170) return 2;                  // 绿
    if (h < 265) return 3;                  // 蓝
    return 4;                               // 品红 / 紫 → 归红
  }

  function sampleCell(sx, sy, sw, sh) {
    var ctx = sampler.getContext('2d');
    var data = ctx.getImageData(Math.round(sx), Math.round(sy),
      Math.max(1, Math.round(sw)), Math.max(1, Math.round(sh))).data;
    var r = 0, g = 0, b = 0, n = 0;
    for (var i = 0; i < data.length; i += 16) {
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    if (!n) return 0;
    return classify(r / n, g / n, b / n);
  }

  /** 采样九宫格每一格的中心 46%，避开格子边缘与黑边 */
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
      var pad = 0.27;
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

  /** 同步"正在拍哪一面"的文案 */
  function syncLabel() {
    var t = document.getElementById('captureFaceName');
    if (t && window.CubeInput) t.textContent = E.FACE_NAMES[window.CubeInput.getActiveFace()];
    var b = document.getElementById('captureBtn');
    if (b && window.CubeInput) {
      b.textContent = '识别' + E.FACE_NAMES[window.CubeInput.getActiveFace()].split(' ')[0];
    }
  }

  function capture() {
    if (!video || !video.videoWidth) {
      window.CubeInput.toast('摄像头还没准备好，稍等一下');
      return;
    }
    var res = sampleGrid();
    if (!res) { window.CubeInput.toast('取样失败，请让魔方完整出现在取景框里'); return; }
    window.CubeInput.recognizeActive(res);
    syncLabel();
  }

  function init() {
    var capBtn = document.getElementById('captureBtn');
    if (capBtn) capBtn.addEventListener('click', capture);
    var hideBtn = document.getElementById('hideCameraBtn');
    if (hideBtn) hideBtn.addEventListener('click', function () {
      stop();
      var p = document.getElementById('cameraPanel');
      if (p) p.style.display = 'none';
    });
    syncLabel();
    start();
    window.addEventListener('pagehide', stop);
    // 用户切换了要填的面时，同步按钮文案
    document.addEventListener('click', function (e) {
      if (e.target && e.target.closest && (e.target.closest('#faceChips') || e.target.closest('#cubeScene'))) {
        setTimeout(syncLabel, 30);
      }
    });
  }

  window.CubeCamera = { init: init, stop: stop, classify: classify, syncLabel: syncLabel };
})();
