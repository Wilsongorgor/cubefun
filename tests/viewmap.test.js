/*
 * 几何自检：验证「把某个面转到正对镜头后，九宫格第 i 格是否真的出现在屏幕的第 i 个位置」。
 *
 * 这是填色正确性的根基 —— 如果某个面的格序跟 Kociemba facelet 顺序差了一个旋转/镜像，
 * 用纯色面（还原态）做测试是发现不了的，必须用打乱的魔方才会暴露。
 * 所以这里直接算 CSS 变换矩阵来核对。
 *
 * CSS 坐标系：x 向右，y 向下，z 指向观察者。
 */
'use strict';
const fs = require('fs');
const path = require('path');

// 从 css 里抠出 .cube-face.f-X 的 transform（只取桌面版那一组）
const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');
const FACE_CLASS = ['f-U', 'f-D', 'f-F', 'f-B', 'f-R', 'f-L'];
const FACE_NAME = ['U', 'D', 'F', 'B', 'R', 'L'];

const faceT = {};
for (const cls of FACE_CLASS) {
  const re = new RegExp('\\.cube-face\\.' + cls + '\\s*\\{[^}]*?transform:\\s*([^;]+);', 'm');
  const m = css.match(re);
  if (!m) { console.log('找不到', cls); process.exit(1); }
  faceT[cls] = m[1].trim();
}
console.log('CSS face 变换：');
for (const cls of FACE_CLASS) console.log('  .' + cls.padEnd(4), faceT[cls]);
console.log();

/* ---------- 矩阵工具 ---------- */
const mul = (A, B) => {
  const C = [];
  for (let i = 0; i < 4; i++) {
    C.push([]);
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += A[i][k] * B[k][j];
      C[i].push(s);
    }
  }
  return C;
};
const I = () => [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
const rotX = d => { const r = d*Math.PI/180, c = Math.cos(r), s = Math.sin(r);
  return [[1,0,0,0],[0,c,-s,0],[0,s,c,0],[0,0,0,1]]; };
const rotY = d => { const r = d*Math.PI/180, c = Math.cos(r), s = Math.sin(r);
  return [[c,0,s,0],[0,1,0,0],[-s,0,c,0],[0,0,0,1]]; };
const transZ = t => [[1,0,0,0],[0,1,0,0],[0,0,1,t],[0,0,0,1]];

function apply(M, p) {
  const v = [p[0], p[1], p[2], 1];
  const o = [0,0,0,0];
  for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) o[i] += M[i][k] * v[k];
  return [o[0], o[1], o[2]];
}

/** 解析 "rotateX(90deg) translateZ(70px)" 这类字符串 */
function parseTransform(str) {
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

// js/input.js 里的 FACE_VIEW
const FACE_VIEW = [
  { rx: -90, ry: 0 },   // U
  { rx: 90, ry: 0 },    // D
  { rx: 0, ry: 0 },     // F
  { rx: 0, ry: 180 },   // B
  { rx: 0, ry: -90 },   // R
  { rx: 0, ry: 90 }     // L
];

// 九宫格第 i 格中心在 face 局部坐标（face 140x140，格 46.67）
const SIZE = 140, CELL = SIZE / 3, HALF = SIZE / 2;
const cellPos = i => {
  const r = Math.floor(i / 3), c = i % 3;
  return [ (c - 1) * CELL, (r - 1) * CELL, 0 ];
};
// 期望的屏幕象限：i -> [x 符号, y 符号]
const expect = i => {
  const r = Math.floor(i / 3), c = i % 3;
  return [ c === 0 ? -1 : c === 2 ? 1 : 0, r === 0 ? -1 : r === 2 ? 1 : 0 ];
};

let allOk = true;
console.log('逐面核对（目标：第 0 格落在屏幕左上、第 2 格右上、第 6 格左下、第 8 格右下，且都朝向观察者）\n');

for (let f = 0; f < 6; f++) {
  const Mface = parseTransform(faceT[FACE_CLASS[f]]);
  const v = FACE_VIEW[f];
  const Mcube = mul(rotX(v.rx), rotY(v.ry));
  const M = mul(Mcube, Mface);

  let faceOk = true;
  const detail = [];
  for (let i = 0; i < 9; i++) {
    const p = apply(M, cellPos(i));
    const [ex, ey] = expect(i);
    const okX = ex === 0 ? Math.abs(p[0]) < 1e-6 : Math.sign(Math.round(p[0] * 1e6)) === ex;
    const okY = ey === 0 ? Math.abs(p[1]) < 1e-6 : Math.sign(Math.round(p[1] * 1e6)) === ey;
    const okZ = p[2] > 1;   // 必须朝向观察者
    if (!(okX && okY && okZ)) {
      faceOk = false;
      detail.push(`格${i} => (${p.map(n=>n.toFixed(1)).join(', ')}) 期望 x${ex>0?'>0':ex<0?'<0':'=0'} y${ey>0?'>0':ey<0?'<0':'=0'} z>0`);
    }
  }
  // 再确认这个面确实是正对镜头的那一面：面中心法向应指向观察者
  const center = apply(M, [0,0,0]);
  const facingOk = center[2] > 60;

  console.log(`${FACE_NAME[f]} 面: ${faceOk && facingOk ? '✅ 格序与 facelet 顺序一致' : '❌ 不一致'}` +
    `   (面中心 z=${center[2].toFixed(1)})`);
  detail.forEach(d => console.log('     ', d));
  if (!facingOk) console.log('      ❌ 该面没有正对镜头');
  if (!(faceOk && facingOk)) allOk = false;
}

console.log('\n' + (allOk ? '全部一致 🎉' : '存在不一致，填色顺序有问题'));
process.exit(allOk ? 0 : 1);
