/*
 * 集成冒烟测试：用 jsdom 真实加载四个页面，检查脚本错误与关键 DOM 结构，
 * 并模拟"填满六面 -> 求解 -> 渲染步骤"的完整链路。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
let fail = 0;
function ok(cond, msg) { console.log((cond ? 'ok   : ' : 'FAIL : ') + msg); if (!cond) fail++; }

async function load(page, beforeParse) {
  const vc = new VirtualConsole();
  const errs = [];
  vc.on('jsdomError', e => errs.push(e.message));
  vc.on('error', (...a) => errs.push(a.join(' ')));
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, page), 'utf8'), {
    url: 'file:///' + path.join(ROOT, page).replace(/\\/g, '/'),
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse: beforeParse
  });
  await new Promise(r => setTimeout(r, 350));
  return { dom, w: dom.window, errs };
}

(async () => {
  console.log('=== index.html ===');
  {
    const { w, errs } = await load('index.html');
    ok(errs.length === 0, '无脚本错误 ' + (errs[0] || ''));
    ok(w.document.querySelectorAll('.mode-card').length === 2, '两个模式入口');
  }

  console.log('\n=== manual.html ===');
  let state = null;
  {
    const { w, errs } = await load('manual.html');
    ok(errs.length === 0, '无脚本错误 ' + (errs[0] || ''));
    const net = w.document.querySelectorAll('.net-cell');
    ok(net.length === 54, '展开图 54 个格子（实际 ' + net.length + '）');
    ok(w.document.querySelectorAll('.swatch-btn').length === 7, '调色板 6 色 + 清除');
    ok(w.document.querySelectorAll('.cube-face').length === 6, '3D 魔方 6 个面');
    ok(!!w.CubeInput, 'CubeInput 已就绪');

    // 点第一个格子，应该被刷成默认画笔色（白）
    net[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    ok(w.CubeInput.getFaces()[0][0] === 0, '点击格子后填入画笔颜色');

    // 用一组随机打乱的合法状态填满
    const E = w.CubeEngine;
    const names = ['U', "U'", 'U2', 'D', "D'", 'D2', 'F', "F'", 'F2', 'B', "B'", 'B2', 'R', "R'", 'R2', 'L', "L'", 'L2'];
    const alg = [];
    for (let i = 0; i < 25; i++) alg.push(names[Math.floor(Math.random() * names.length)]);
    const st = E.applyAlg(E.solvedCube(), alg.join(' '));
    for (let f = 0; f < 6; f++) {
      w.CubeInput.setFaceColors(f, st.slice(E.FS[f], E.FS[f] + 9));
    }
    ok(w.CubeInput.filledCount() === 6, '六面填满');
    ok(w.document.getElementById('solveBtn').disabled === false, '求解按钮已启用');
    ok(w.document.getElementById('cubeProgress').textContent.indexOf('6 / 6') >= 0, '进度显示 6/6');
    state = st;
  }

  console.log('\n=== camera.html ===');
  {
    const { w, errs } = await load('camera.html');
    ok(errs.length === 0, '无脚本错误 ' + (errs[0] || ''));
    ok(w.document.querySelectorAll('.face-chip').length === 6, '六个面切换按钮');
    // jsdom 没有 mediaDevices，应当走降级分支（正常行为）
    ok(!!w.document.querySelector('.camera-fallback'), '无摄像头时给出降级提示');
    ok(w.document.getElementById('captureBtn').disabled === true, '降级后禁用识别按钮');
    // 颜色归类自测：六个标准色应各自归类正确
    const C = w.CubeCamera.classify;
    const std = [[255, 255, 255, 0], [255, 213, 0, 1], [0, 177, 106, 2], [0, 81, 186, 3], [183, 18, 52, 4], [255, 88, 0, 5]];
    let allOk = true;
    std.forEach(([r, g, b, want]) => { if (C(r, g, b) !== want) { allOk = false; console.log('   归类错误', r, g, b, '得到', C(r, g, b), '期望', want); } });
    ok(allOk, '六个标准色归类正确');
  }

  console.log('\n=== solve.html（完整链路）===');
  {
    const { w, errs } = await load('solve.html');
    ok(errs.length === 0, '无脚本错误 ' + (errs[0] || ''));
    ok(w.document.getElementById('errorSection').style.display === 'block', '没有数据时显示错误提示');

    // 灌入状态后重新执行 solve.js
    w.CubeState.cubeData = state;
    w.eval(fs.readFileSync(path.join(ROOT, 'js/solve.js'), 'utf8'));
    await new Promise(r => setTimeout(r, 300));

    const sec = w.document.getElementById('solutionSection');
    ok(sec.style.display === 'block', '解法区已显示');
    const pill = w.document.getElementById('stepPill').textContent;
    ok(/^1 \/ \d+$/.test(pill), '步骤计数从第 1 步开始（实际 ' + pill + '）');
    ok(w.document.getElementById('stepText').textContent.indexOf('第 1 步') === 0, '步骤文案正确：' + w.document.getElementById('stepText').textContent);
    ok(w.document.getElementById('moveHighlight').style.display === 'block', '高亮提示当前要转的面');
    ok(w.document.querySelectorAll('#solveCube3d .cube-face').length === 6, '解法 3D 魔方已渲染');
    ok(w.document.querySelectorAll('#solveCube3d .cube-face.is-highlight').length === 1, '恰好一个面被高亮');

    // 第 1 步显示的应当是"转动前"的状态，也就是原始打乱状态
    const E = w.CubeEngine;
    const shown = [];
    w.document.querySelectorAll('#solveCube3d .cube-face').forEach(fe => {
      const f = parseInt(fe.getAttribute('data-face'), 10);
      fe.querySelectorAll('.stk').forEach((s, i) => shown[E.FS[f] + i] = s.style.backgroundColor);
    });
    // jsdom 的 cssstyle 会把 #ffffff 归一化成 rgb(255, 255, 255)，比较前先统一
    const hex2rgb = h => 'rgb(' + [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)).join(', ') + ')';
    let same = true, firstBad = -1;
    for (let i = 0; i < 54; i++) if (shown[i] !== hex2rgb(E.COLOR_HEX[state[i]])) { same = false; firstBad = i; break; }
    ok(same, '第 1 步展示的是转动「前」的魔方状态' + (same ? '' : '（第 ' + firstBad + ' 格: ' + shown[firstBad] + ' vs ' + hex2rgb(E.COLOR_HEX[state[firstBad]]) + '）'));

    // 点"下一步"应该前进
    const before = w.document.getElementById('stepPill').textContent;
    w.document.getElementById('nextStepBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 60));
    ok(w.document.getElementById('stepPill').textContent !== before, '点下一步后步骤前进（' + before + ' -> ' + w.document.getElementById('stepPill').textContent + '）');

    // 跳到最后一步应该显示完成
    const total = parseInt(before.split('/')[1].trim(), 10);
    for (let i = 0; i < total + 2; i++) {
      w.document.getElementById('nextStepBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    }
    await new Promise(r => setTimeout(r, 120));
    ok(w.document.getElementById('solvedSection').style.display === 'flex', '走到最后显示"已复原"');
    const doneShown = [];
    w.document.querySelectorAll('#solveCube3d .cube-face').forEach(fe => {
      const f = parseInt(fe.getAttribute('data-face'), 10);
      fe.querySelectorAll('.stk').forEach((s, i) => doneShown[E.FS[f] + i] = s.style.backgroundColor);
    });
    let solved = true, badIdx = -1;
    for (let i = 0; i < 54; i++) if (doneShown[i] !== hex2rgb(E.COLOR_HEX[E.solvedCube()[i]])) { solved = false; badIdx = i; break; }
    ok(solved, '最后一步展示的是复原状态' + (solved ? '' : '（第 ' + badIdx + ' 格: ' + doneShown[badIdx] + '）'));
  }

  console.log(fail === 0 ? '\n全部通过 🎉' : '\n失败 ' + fail + ' 项');
  process.exit(fail === 0 ? 0 : 1);
})();
