/*
 * 引擎 + 求解器测试（不需要浏览器，直接 node 跑）
 *   node tests/engine.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0;
function ok(cond, msg) { console.log((cond ? 'ok   : ' : 'FAIL : ') + msg); if (!cond) fail++; }

// 在干净的沙箱里加载浏览器端脚本
const sandbox = { window: {}, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
['js/cube.js', 'js/min2phase.js', 'js/solver.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
});
const E = sandbox.window.CubeEngine;
const S = sandbox.window.CubeSolver;

const MOVE_NAMES = ['U', "U'", 'U2', 'D', "D'", 'D2', 'F', "F'", 'F2', 'B', "B'", 'B2', 'R', "R'", 'R2', 'L', "L'", 'L2'];

console.log('--- 转动表 ---');
for (const n of MOVE_NAMES) {
  let c = E.solvedCube();
  for (let i = 0; i < 4; i++) c = E.applyMove(c, n);
  ok(E.isSolved(c), n + ' 转 4 次回到原状');
}
for (const n of ['U', 'D', 'F', 'B', 'R', 'L']) {
  ok(E.isSolved(E.applyAlg(E.solvedCube(), n + " " + n + "'")), n + " 与 " + n + "' 互逆");
}
{
  const c = E.applyAlg(E.solvedCube(), "R U R' F2 L2 D'");
  ok([0, 1, 2, 3, 4, 5].every((v, f) => c[E.FS[f] + 4] === v), '任意转动后六个中心块不动');
}
{
  // 标准约定校验：R 把 F 面右列送到 U 面右列
  const c = E.applyAlg(E.solvedCube(), 'R');
  ok(c[2] === 2 && c[5] === 2 && c[8] === 2, 'R 转动方向符合标准（F → U）');
}

console.log('--- 非法状态必须报错，不能误报"已还原" ---');
function expectError(label, state) {
  const r = S.solve(state);
  ok(!!r.error, label + ' => ' + (r.error || '（错误：返回了 ' + r.solution.length + ' 步）'));
}
{
  let a = E.solvedCube(); a[0] = 1; a[9] = 0;
  expectError('交换两个角块贴纸', a);
}
expectError('机械循环分布', Array.from({ length: 54 }, (_, i) => i % 6));
expectError('全同色', new Array(54).fill(3));
expectError('长度不足', new Array(10).fill(0));
expectError('含非法值', E.solvedCube().map((x, i) => (i === 3 ? null : x)));
{
  const r = S.solve(E.solvedCube());
  ok(!r.error && r.alreadySolved, '已复原的魔方识别为"无需还原"');
}

console.log('--- 端到端：随机打乱 → 求解 → 复原 ---');
{
  let maxLen = 0, sum = 0, n = 100;
  for (let i = 0; i < n; i++) {
    const scramble = [];
    for (let j = 0; j < 25; j++) scramble.push(MOVE_NAMES[Math.floor(Math.random() * MOVE_NAMES.length)]);
    const st = E.applyAlg(E.solvedCube(), scramble.join(' '));
    const r = S.solve(st);
    if (r.error) { ok(false, '合法状态被拒：' + r.error); break; }
    if (!E.isSolved(E.applyAlg(st, r.solution.join(' ')))) { ok(false, '解法未能复原'); break; }
    sum += r.solution.length;
    if (r.solution.length > maxLen) maxLen = r.solution.length;
  }
  ok(true, n + ' 个随机打乱全部复原，最长 ' + maxLen + ' 步，平均 ' + (sum / n).toFixed(1) + ' 步');
}

console.log('--- 步骤文案 ---');
ok(S.describeMove("R'").indexOf('右面') === 0, "\n" + 'R\' 描述为「' + S.describeMove("R'") + '」');
ok(S.describeMove('U2').indexOf('180') > 0, 'U2 描述为「' + S.describeMove('U2') + '」');

console.log(fail === 0 ? '\n全部通过' : '\n失败 ' + fail + ' 项');
process.exit(fail === 0 ? 0 : 1);
