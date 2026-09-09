/*
 * 变异测试：故意把源码改坏，检验 E2E 用例集到底能不能抓到。
 * 抓不到 = 测试用例是摆设（上一次线上事故就是这么漏掉的）。
 *
 *   node tests/mutation.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BACKUP = path.join(__dirname, 'mutation.bak');
const TESTS = ['engine', 'colorscheme', 'cubies', 'viewmap', 'pages', 'e2e', 'deep', 'recover'];

const MUTANTS = [
  {
    id: 'M1 配色映射退化成非双射（所有颜色都当 U）',
    file: 'js/solver.js',
    from: 'for (var f = 0; f < 6; f++) m[cube[E.FACE_CENTER[f]]] = E.FACE_SHORT[f];',
    to: 'for (var f = 0; f < 6; f++) m[cube[E.FACE_CENTER[f]]] = E.FACE_SHORT[0];'
  },
  {
    id: 'M2 isSolved 写死配色（上一轮的关键修复点）',
    file: 'js/cube.js',
    from: 'function isSolved(c){for(var f=0;f<6;f++){var want=c[FACE_CENTER[f]];for(var i=0;i<9;i++)if(c[FS[f]+i]!==want)return false;}return true;}',
    to: 'function isSolved(c){for(var f=0;f<6;f++){for(var i=0;i<9;i++)if(c[FS[f]+i]!==f)return false;}return true;}'
  },
  {
    id: 'M3 九宫格格序左右镜像（显示顺序错位）',
    file: 'js/input.js',
    from: 'cells[i].style.backgroundColor = v < 0 ? EMPTY : COLORS[v].hex;',
    to: 'var _ii = (i % 3 === 0 ? i + 2 : i % 3 === 2 ? i - 2 : i); var _vv = faces[activeFace][_ii]; cells[i].style.backgroundColor = _vv < 0 ? EMPTY : COLORS[_vv].hex;'
  },
  {
    id: 'M4 解法验证兜底被删（min2phase 静默空串会误报已还原）',
    file: 'js/solver.js',
    from: 'if (!E.isSolved(check)) return fail(cubeState);',
    to: 'if (false) return fail(cubeState);'
  },
  {
    id: 'M5 填色写错面（永远写进 F 面）',
    file: 'js/input.js',
    from: 'faces[activeFace][idx] = brush;',
    to: 'faces[2][idx] = brush;'
  },
  {
    id: 'M6 填色草稿不落盘（报错后回去就是空白页 —— 用户抱怨的那条）',
    file: 'js/input.js',
    from: 'if (window.CubeInputStore) window.CubeInputStore.save({ faces: faces, active: activeFace, bad: bad, msg: badMsg });',
    to: 'if (false) window.CubeInputStore.save({ faces: faces, active: activeFace, bad: bad, msg: badMsg });'
  },
  {
    id: 'M7 填色页不读草稿（存了也不恢复）',
    file: 'js/input.js',
    from: 'var d = window.CubeInputStore && window.CubeInputStore.load();',
    to: 'var d = null && window.CubeInputStore.load();'
  },
  {
    id: 'M8 报错时不把可疑格子写回草稿（回去没有红框）',
    file: 'js/solve.js',
    from: 'window.CubeInputStore.save({ bad: cells, msg: msg });',
    to: 'window.CubeInputStore.save({ bad: [], msg: msg });'
  },
  {
    id: 'M9 报错页没有「返回修改」出口（又变回死路）',
    file: 'js/solve.js',
    from: "if (backBtn) backBtn.addEventListener('click', function () { window.location.href = inputUrl(); });",
    to: "if (false) backBtn.addEventListener('click', function () { window.location.href = inputUrl(); });"
  }
];

// 被 Ctrl+C / 超时杀掉时也必须把源码还原，否则会留下一个"变异过的仓库"
let dirty = null;
function restoreAll() {
  if (!dirty) return;
  try { fs.copyFileSync(BACKUP, dirty); } catch (e) {}
  try { fs.unlinkSync(BACKUP); } catch (e) {}
  if (process.env.MUT_VERBOSE) console.log('[还原] ' + dirty);
  dirty = null;
}
process.on('exit', restoreAll);
['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(function (sig) {
  process.on(sig, function () { restoreAll(); process.exit(1); });
});
process.on('uncaughtException', function (e) { restoreAll(); console.error(e); process.exit(1); });

function runTests() {
  // 任一测试文件失败即视为"抓到"
  for (const t of TESTS) {
    try {
      execFileSync(process.execPath, [path.join(ROOT, 'tests', t + '.test.js')], { stdio: 'pipe' });
    } catch (e) {
      const out = (e.stdout || '').toString() + (e.stderr || '').toString();
      const fails = out.split('\n').filter(l => /FAIL/.test(l));
      const failLine = fails.length
        ? fails.slice(0, 3).map(s => s.trim()).join('  ||  ')
        : '进程异常退出：' + out.split('\n').slice(-6).join(' | ').slice(0, 220);
      return { caught: true, by: t, msg: failLine.trim().slice(0, 200) };
    }
  }
  return { caught: false };
}

console.log('变异测试：改坏代码 → 看测试是否报警\n');
let undetected = 0;

// 先确认基线是绿的
const base = runTests();
if (base.caught) {
  console.log('基线就是红的，先修好再跑变异：' + base.by + ' → ' + base.msg);
  process.exit(1);
}
console.log('基线：全部测试通过 ✅\n');

for (const m of MUTANTS) {
  const file = path.join(ROOT, m.file);
  const orig = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(BACKUP, orig);
  dirty = file;
  if (orig.indexOf(m.from) < 0) {
    console.log('SKIP : ' + m.id + ' —— 找不到目标代码，变异脚本需更新');
    undetected++;
    restoreAll();
    continue;
  }
  fs.writeFileSync(file, orig.replace(m.from, m.to));
  let res;
  try {
    res = runTests();
  } finally {
    restoreAll();     // 无论如何都要还原
  }
  if (res.caught) {
    console.log('抓到 ✅ : ' + m.id + '\n         → ' + res.by + ' : ' + res.msg);
  } else {
    undetected++;
    console.log('漏网 ❌ : ' + m.id + ' —— 代码坏了但测试仍然全绿！');
  }
}

console.log('\n' + (undetected === 0
  ? '全部变异都被抓到，用例集有效 🎉'
  : '有 ' + undetected + ' 个变异没被抓到，需要补用例'));
process.exit(undetected === 0 ? 0 : 1);
