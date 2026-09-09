/*
 * 角块 / 棱块分组测试（不需要浏览器）
 *   node tests/cubies.test.js
 *
 * solver.js 里的 CORNERS / EDGES 是出错定位功能的地基，写错就会指错面。
 * 这里用两条独立证据来钉死它：
 *   1) 从 css 的 3D 变换算出每个贴纸的真实坐标，自动聚类 —— 必须和常量一致
 *   2) 任一次转动都必须"整块搬到整块"
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const sandbox = { window: {}, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
['js/cube.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f }));
const E = sandbox.window.CubeEngine;

let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   : ' : 'FAIL : ') + m); if (!c) fail++; };

/* --- 从 solver.js 源码里取出常量，避免测试和实现脱节 --- */
function grab(name) {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'solver.js'), 'utf8');
  const m = src.match(new RegExp('var\\s+' + name + '\\s*=\\s*\\[([\\s\\S]*?)\\n\\s*\\];'));
  if (!m) { ok(false, 'solver.js 里找不到 ' + name); return []; }
  return (m[1].match(/\[[^\]]*\]/g) || []).map(s =>
    s.replace(/[\[\]]/g, '').split(',').map(x => parseInt(x.trim(), 10)).filter(x => !isNaN(x)).sort((a, b) => a - b));
}
const CORNERS = grab('CORNERS'), EDGES = grab('EDGES');
ok(CORNERS.length === 8, `solver.js 里有 8 个角块（实际 ${CORNERS.length}）`);
ok(EDGES.length === 12, `solver.js 里有 12 个棱块（实际 ${EDGES.length}）`);

/* --- 证据 1：从 CSS 几何自动聚类，结果必须一致 --- */
const css = fs.readFileSync(path.join(ROOT, 'css', 'styles.css'), 'utf8');
const FACE_CLASS = ['f-U', 'f-D', 'f-F', 'f-B', 'f-R', 'f-L'];
const mul = (A, B) => A.map((r, i) => B[0].map((_, j) => r.reduce((s, _, k) => s + A[i][k] * B[k][j], 0)));
const I = () => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
const rotX = d => { const r = d * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [[1, 0, 0, 0], [0, c, -s, 0], [0, s, c, 0], [0, 0, 0, 1]]; };
const rotY = d => { const r = d * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [[c, 0, s, 0], [0, 1, 0, 0], [-s, 0, c, 0], [0, 0, 0, 1]]; };
const transZ = t => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, t], [0, 0, 0, 1]];
const apply = (M, p) => { const v = [p[0], p[1], p[2], 1], o = [0, 0, 0]; for (let i = 0; i < 3; i++) for (let k = 0; k < 4; k++) o[i] += M[i][k] * v[k]; return o; };
function parseT(str) {
  let M = I();
  const re = /(rotateX|rotateY|translateZ)\(\s*(-?[\d.]+)(deg|px)\s*\)/g;
  let m;
  while ((m = re.exec(str))) {
    if (m[1] === 'rotateX') M = mul(M, rotX(parseFloat(m[2])));
    else if (m[1] === 'rotateY') M = mul(M, rotY(parseFloat(m[2])));
    else M = mul(M, transZ(parseFloat(m[2])));
  }
  return M;
}
const CELL = 140 / 3;
const derivedC = new Set(), derivedE = new Set();
for (let f = 0; f < 6; f++) {
  const mm = css.match(new RegExp('\\.cube-face\\.' + FACE_CLASS[f] + '\\s*\\{[^}]*?transform:\\s*([^;]+);', 'm'));
  const M = parseT(mm[1]);
  for (let i = 0; i < 9; i++) {
    const p = apply(M, [((i % 3) - 1) * CELL, (Math.floor(i / 3) - 1) * CELL, 0]);
    const zeros = p.filter(v => Math.abs(v) < 1).length;
    if (zeros === 0) derivedC.add([E.FS[f] + i]);
    else if (zeros === 1) derivedE.add([E.FS[f] + i]);
  }
}
// 把单点按坐标符号并成组
function cluster(pts) {
  const map = new Map();
  for (let f = 0; f < 6; f++) {
    const mm = css.match(new RegExp('\\.cube-face\\.' + FACE_CLASS[f] + '\\s*\\{[^}]*?transform:\\s*([^;]+);', 'm'));
    const M = parseT(mm[1]);
    for (let i = 0; i < 9; i++) {
      const p = apply(M, [((i % 3) - 1) * CELL, (Math.floor(i / 3) - 1) * CELL, 0]);
      const zeros = p.filter(v => Math.abs(v) < 1).length;
      if (zeros !== pts) continue;
      const key = p.map(v => Math.abs(v) < 1 ? 0 : Math.sign(Math.round(v))).join(',');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(E.FS[f] + i);
    }
  }
  return [...map.values()].map(g => g.slice().sort((a, b) => a - b));
}
const c2 = cluster(0), e2 = cluster(1);
const norm = gs => gs.map(g => g.join(',')).sort().join(' | ');
ok(norm(c2) === norm(CORNERS), '角块分组与 CSS 几何推导一致');
ok(norm(e2) === norm(EDGES), '棱块分组与 CSS 几何推导一致');

/* --- 证据 2：整块必须搬到整块 --- */
const MOVES = ['U', "U'", 'U2', 'D', "D'", 'D2', 'F', "F'", 'F2', 'B', "B'", 'B2', 'R', "R'", 'R2', 'L', "L'", 'L2'];
const srcOf = (mv, p) => { const mk = []; for (let i = 0; i < 54; i++) mk.push(i + 1000); return E.applyMove(mk, mv)[p] - 1000; };
const idxMap = gs => { const m = {}; gs.forEach((g, gi) => g.forEach(i => { m[i] = gi; })); return m; };
const cMap = idxMap(CORNERS), eMap = idxMap(EDGES);
let badMoves = 0;
for (const mv of MOVES) {
  let bad = 0;
  for (const g of CORNERS) if (new Set(g.map(p => cMap[srcOf(mv, p)])).size !== 1) bad++;
  for (const g of EDGES) if (new Set(g.map(p => eMap[srcOf(mv, p)])).size !== 1) bad++;
  if (bad) badMoves++;
}
ok(badMoves === 0, `18 种转动全部"整块搬整块"（${18 - badMoves}/18）`);

console.log('\n' + (fail === 0 ? '全部通过 🎉' : `发现 ${fail} 处问题`));
process.exit(fail ? 1 : 0);
