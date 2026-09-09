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

/* ============================================================
   填色草稿

   为什么需要：以前求解失败后点「重新填色」= 回到空白页，54 格全丢，
   用户只能从头再填一遍。有了草稿，报错页点「返回修改」能原样回到
   刚才那一版，还能顺带把可疑的格子标红。
   ============================================================ */
function validFaces(faces) {
  if (!Array.isArray(faces) || faces.length !== 6) return false;
  for (var f = 0; f < 6; f++) {
    var face = faces[f];
    if (!Array.isArray(face) || face.length !== 9) return false;
    for (var i = 0; i < 9; i++) {
      var v = face[i];
      if (typeof v !== 'number' || v !== (v | 0) || v < -1 || v > 5) return false;
    }
  }
  return true;
}

var CubeInputStore = {
  KEY: 'cubeInput',
  /** @returns {{faces:number[][]|null, active:number, bad:number[][], msg:string}|null} */
  load: function () {
    try {
      var raw = sessionStorage.getItem(this.KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || typeof o !== 'object') return null;
      if (!Array.isArray(o.bad)) o.bad = [];
      o.bad = o.bad.filter(function (p) {
        return Array.isArray(p) && p.length === 2 &&
          p[0] >= 0 && p[0] <= 5 && p[1] >= 0 && p[1] <= 8;
      });
      if (typeof o.msg !== 'string') o.msg = '';
      if (typeof o.active !== 'number' || o.active < 0 || o.active > 5) o.active = 2;
      // faces 坏了不能整个丢掉：bad/msg 还得留着，填色页照样能提示用户
      o.faces = validFaces(o.faces) ? o.faces : null;
      return o;
    } catch (e) { return null; }
  },

  /** 增量合并保存，只传要改的字段 */
  save: function (patch) {
    try {
      var cur = this.load() || { faces: null, active: 2, bad: [], msg: '' };
      for (var k in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, k)) cur[k] = patch[k];
      }
      sessionStorage.setItem(this.KEY, JSON.stringify(cur));
      return true;
    } catch (e) { return false; }
  },

  clear: function () {
    try { sessionStorage.removeItem(this.KEY); } catch (e) {}
  }
};
window.CubeInputStore = CubeInputStore;
