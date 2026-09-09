/*
 * 变异测试：故意把源码改坏，检验 E2E 用例集到底能不能抓到。
 * 抓不到 = 测试用例是摆设（上一次线上事故就是这么漏掉的）。
 *
 *   node .workbuddy/scratch/mutation.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BACKUP = path.join(__dirname, 'mutation.bak');
const TESTS = ['engine', 'colorscheme', 'cubies', 'viewmap', 'pages', 'e2e', 'deep'];

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
  }
];

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
  if (orig.indexOf(m.from) < 0) {
    console.log('SKIP : ' + m.id + ' —— 找不到目标代码，变异脚本需更新');
    undetected++;
    fs.unlinkSync(BACKUP);
    continue;
  }
  fs.writeFileSync(file, orig.replace(m.from, m.to));
  let res;
  try {
    res = runTests();
  } finally {
    fs.copyFileSync(BACKUP, path.join(ROOT, m.file));   // 无论如何都要还原
    fs.unlinkSync(BACKUP);
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
