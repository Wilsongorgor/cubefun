/* ===== 共享状态（跨页面用 sessionStorage 持久化） ===== */
var CubeState = { cubeData: null, scanMode: '' };

(function () {
  var _data = null, _mode = '';

  // 页面加载时从 sessionStorage 恢复
  try {
    var raw = sessionStorage.getItem("cubeState");
    if (raw) {
      var obj = JSON.parse(raw);
      _data = obj.cubeData;
      _mode = obj.scanMode;
    }
  } catch (e) {}

  function persist() {
    try {
      sessionStorage.setItem("cubeState", JSON.stringify({ cubeData: _data, scanMode: _mode }));
    } catch (e) {}
  }

  Object.defineProperty(CubeState, "cubeData", {
    configurable: true,
    get: function () { return _data; },
    set: function (v) { _data = v; persist(); }
  });
  Object.defineProperty(CubeState, "scanMode", {
    configurable: true,
    get: function () { return _mode; },
    set: function (v) { _mode = v; persist(); }
  });
})();
