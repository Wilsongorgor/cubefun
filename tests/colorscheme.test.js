/*
 * 配色无关性测试（不需要浏览器，直接 node 跑）
 *   node tests/colorscheme.test.js
 *
 * 背景：曾经把"白=U 黄=D 绿=F 蓝=B 红=R 橙=L"写死在 solver.js 的 TO_STD 里，
 * 结果所有非标准配色的魔方（黄顶白底、蓝顶、日系…）一律求解失败，
 * 连一个已经复原的魔方都报"无法还原"。
 *
 * 物理事实：给一个可还原的魔方换一套贴纸颜色，它当然还是可还原的。
 * 所以任意配色置换都必须仍然可解。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const sandbox = { window: {}, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
['js/cube.js', 'js/min2phase.js', 'js/solver.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
});
const E = sandbox.window.CubeEngine;
const S = sandbox.window.CubeSolver;

const MOVE_NAMES = ['U', "U'", 'U2', 'D', "D'", 'D2', 'F', "F'", 'F2', 'B', "B'", 'B2', 'R', "R'", 'R2', 'L', "L'", 'L2'];
function rndAlg(n) { const a = []; for (let i = 0; i < n; i++) a.push(MOVE_NAMES[Math.floor(Math.random() * MOVE_NAMES.length)]); return a.join(' '); }

let fail = 0;
function ok(cond, msg) { console.log((cond ? 'ok   : ' : 'FAIL : ') + msg); if (!cond) fail++; }

console.log('--- 复原态：任意合法配色都应识别为"已还原" ---');
// 下标 = 面序 U D F B R L，值 = 颜色下标 0白 1黄 2绿 3蓝 4红 5橙
const SCHEMES = {
  '标准西式（白顶绿前）': [0, 1, 2, 3, 4, 5],
  '黄顶白底': [1, 0, 2, 3, 4, 5],
  '蓝顶白底': [3, 1, 2, 0, 4, 5],
  '红顶白底': [4, 1, 2, 3, 0, 5],
  '橙顶绿前': [5, 1, 2, 3, 4, 0],
  '绿顶蓝底': [2, 3, 0, 1, 4, 5]
};
for (const [name, scheme] of Object.entries(SCHEMES)) {
  const st = new Array(54);
  for (let f = 0; f < 6; f++) for (let i = 0; i < 9; i++) st[E.FS[f] + i] = scheme[f];
  const res = S.solve(st);
  ok(!res.error && res.alreadySolved, `${name} -> ${res.error || (res.alreadySolved ? '已还原' : '竟给了 ' + res.solution.length + ' 步')}`);
}

console.log('\n--- 打乱态 + 随机配色置换（60 例）---');
{
  let bad = 0, steps = [];
  for (let t = 0; t < 60; t++) {
    const st = E.applyAlg(E.solvedCube(), rndAlg(20));
    const perm = [0, 1, 2, 3, 4, 5];
    for (let i = 5; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    const renamed = st.map(c => perm[c]);
    const res = S.solve(renamed);
    if (res.error) { bad++; if (bad === 1) console.log('      首个失败例，置换 [' + perm.join(',') + '] -> ' + res.error); continue; }
    // 解法必须真的能复原
    let check = renamed.slice();
    for (const m of res.solution) check = E.applyMove(check, m);
    if (!E.isSolved(check)) bad++;
    else steps.push(res.solution.length);
  }
  ok(bad === 0, `${60 - bad} / 60 例可解且解法验证通过（平均 ${(steps.reduce((a, b) => a + b, 0) / steps.length).toFixed(1)} 步）`);
}

// 注意：不能拿"交换两个贴纸"当非法样例 —— 随机打乱后那两个位置可能恰好同色，
// 交换等于没换，状态依然合法、依然可解（踩过一次）。
// 这里改用 100% 非法的构造：单独扭转一个角块 / 单独翻转一个棱块。
// cube.js 索引：U:0-8, D:9-17, F:18-26, B:27-35, R:36-44, L:45-53
const CORNER_URF = [2, 20, 36];   // URF 角块 = U面右上 / F面右上 / R面左上
const EDGE_UR = [5, 37];          // UR 棱块 = U面右中 / R面上中

console.log('\n--- 对照：真·非法状态仍要报错 ---');
for (let t = 0; t < 20; t++) {
  const st = E.applyAlg(E.solvedCube(), rndAlg(10));

  let badCorner = st.slice();
  const c0 = badCorner[CORNER_URF[0]];
  badCorner[CORNER_URF[0]] = badCorner[CORNER_URF[1]];
  badCorner[CORNER_URF[1]] = badCorner[CORNER_URF[2]];
  badCorner[CORNER_URF[2]] = c0;
  if (t === 0) ok(!!S.solve(badCorner).error, '单独扭转一个角块 -> 报错');

  let badEdge = st.slice();
  const e0 = badEdge[EDGE_UR[0]];
  badEdge[EDGE_UR[0]] = badEdge[EDGE_UR[1]];
  badEdge[EDGE_UR[1]] = e0;
  if (t === 0) ok(!!S.solve(badEdge).error, '单独翻转一个棱块 -> 报错');

  if (S.solve(badCorner).error && S.solve(badEdge).error) continue;
  fail++; console.log('FAIL : 第 ' + (t + 1) + ' 例非法状态竟然解出来了');
  break;
}
ok(true, '20 组非法状态全部被正确拦下');

{
  const dup = E.applyAlg(E.solvedCube(), rndAlg(10)).slice();
  dup[4] = dup[13];   // 让 U 面和 D 面中心同色
  ok(!!S.solve(dup).error, '两个面中心同色 -> 报错');
}

console.log('\n' + (fail === 0 ? '全部通过 🎉' : `发现 ${fail} 处问题`));
process.exit(fail ? 1 : 0);
