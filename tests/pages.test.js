/*
 * 集成冒烟测试：用 jsdom 真实加载四个页面，检查脚本错误与关键 DOM 结构，
 * 并模拟"引导式填完六面 -> 求解 -> 渲染步骤"的完整链路。
 *
 *   node tests/pages.test.js
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

function click(el, w) { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); }

(async () => {
  console.log('=== index.html ===');
  {
    const { w, errs } = await load('index.html');
    ok(errs.length === 0, '无脚本错误 ' + (errs[0] || ''));
    ok(w.document.querySelectorAll('.mode-card').length === 2, '两个模式入口');
  }

  console.log('\n=== manual.html（引导式单面填写） ===');
  let state = null;
  {
    const { w, errs } = await load('manual.html');
    ok(errs.length === 0, '无脚本错误 ' + (errs[0] || ''));
    ok(!!w.CubeInput, 'CubeInput 已就绪');

    const ed = w.document.querySelectorAll('.ed-cell');
    ok(ed.length === 9, '单面编辑器 9 个格子（实际 ' + ed.length + '）');
    ok(w.document.querySelectorAll('.cube-face').length === 6, '3D 魔方 6 个面');
    ok(w.document.querySelectorAll('#cube3d .cube-face.is-active').length === 1, '恰好一个面处于编辑态');
    ok(w.document.querySelectorAll('.face-chip').length === 6, '六个面切换按钮');
    ok(w.document.querySelectorAll('.swatch-btn').length === 7, '调色板 6 色 + 清除');
    ok(w.CubeInput.getActiveFace() === 2, '默认从「前面 F」开始');

    // 选黄色(1) → 点第一个格子
    click(w.document.querySelectorAll('.swatch-btn')[1], w);
    click(w.document.querySelectorAll('.ed-cell')[0], w);
    ok(w.CubeInput.getFaces()[2][0] === 1, '选色后点格子，颜色写进当前面');

    // 立体魔方应该同步显示同一颜色
    const hex2rgb = h => 'rgb(' + [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)).join(', ') + ')';
    const activeEl = w.document.querySelector('#cube3d .cube-face.is-active');
    ok(activeEl.querySelectorAll('.stk')[0].style.backgroundColor === hex2rgb('#ffd500'),
      '填色后立体魔方同步更新');

    // 把当前面填满 → 应自动跳到下一个待填面（引导顺序 F→R）
    for (let i = 1; i < 9; i++) click(w.document.querySelectorAll('.ed-cell')[i], w);
    ok(w.CubeInput.getActiveFace() === 4, '填完一整面后自动跳到「右面 R」（实际 ' + w.CubeInput.getActiveFace() + '）');
    ok(w.document.querySelectorAll('#cube3d .cube-face.is-active').length === 1, '跳转后仍只有一个编辑面');
    ok(w.CubeInput.filledCount() === 1, '已填面数 = 1');

    // 引导条应提示下一步怎么转
    const guide = w.document.getElementById('guideBox').textContent;
    ok(guide.indexOf('右面') > 0 && guide.indexOf('转到正对自己') > 0, '引导条提示转到下一个要填的面（右面）：' + guide.replace(/\s+/g, ' ').trim());
    ok(!!w.document.getElementById('guideGoBtn'), '引导条带"转过去"按钮');

    // 点其他面的 chip 可以自由切换（不按引导顺序也行）
    click(w.document.querySelectorAll('.face-chip')[0], w);
    ok(w.CubeInput.getActiveFace() === 0, '点面名可直接切到「上面 U」');

    // 从「右面」切到「上面」是复合转动（ry 要归零 + rx 要翻），
    // 必须拆成"先转回正面 · 再往下翻"两步，否则用户会转错面、把颜色填错。
    const g2 = w.document.getElementById('guideBox').textContent;
    ok(g2.indexOf('先转回正面') > 0, '复合转动给出两步提示：' + g2.replace(/\s+/g, ' ').trim());

    // 等两段动画走完再看最终姿态（U → rotateX(-90)）
    await new Promise(r => setTimeout(r, 1500));
    const tf = w.document.getElementById('cube3d').style.transform;
    ok(tf.indexOf('rotateX(-90deg)') >= 0, '切到上面后立体魔方转到 rotateX(-90deg)：' + tf);

    // 用一组随机打乱的合法状态填满六面
    const E = w.CubeEngine;
    const names = ['U', "U'", 'U2', 'D', "D'", 'D2', 'F', "F'", 'F2', 'B', "B'", 'B2', 'R', "R'", 'R2', 'L', "L'", 'L2'];
    const alg = [];
    for (let i = 0; i < 25; i++) alg.push(names[Math.floor(Math.random() * names.length)]);
    const st = E.applyAlg(E.solvedCube(), alg.join(' '));
    for (let f = 0; f < 6; f++) w.CubeInput.setFaceColors(f, st.slice(E.FS[f], E.FS[f] + 9));
    ok(w.CubeInput.filledCount() === 6, '六面填满');
    ok(w.document.getElementById('solveBtn').disabled === false, '求解按钮已启用');
    ok(w.document.getElementById('cubeProgress').textContent.indexOf('6 / 6') >= 0, '进度显示 6/6');
    ok(w.document.getElementById('guideBox').classList.contains('is-done'), '六面填完后引导条变成完成态');
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
    ok(!!w.CubeInput && w.CubeInput.getActiveFace() === 2, '与手动填色共用同一套引导式输入');
    const C = w.CubeCamera.classify;
    const std = [[255, 255, 255, 0], [255, 213, 0, 1], [0, 177, 106, 2], [0, 81, 186, 3], [183, 18, 52, 4], [255, 88, 0, 5]];
    let allOk = true;
    std.forEach(([r, g, b, want]) => { if (C(r, g, b) !== want) { allOk = false; console.log('   归类错误', r, g, b, C(r, g, b), '期望', want); } });
    ok(allOk, '六个标准色归类正确');
  }

  console.log('\n=== solve.html（完整链路）===');
  {
    const { w, errs } = await load('solve.html');
    ok(errs.length === 0, '无脚本错误 ' + (errs[0] || ''));
    ok(w.document.getElementById('errorSection').style.display === 'block', '没有数据时显示错误提示');

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

    // jsdom 的 cssstyle 会把 #ffffff 归一化成 rgb(255, 255, 255)，比较前先统一
    const hex2rgb = h => 'rgb(' + [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)).join(', ') + ')';
    const readCube = () => {
      const out = [];
      w.document.querySelectorAll('#solveCube3d .cube-face').forEach(fe => {
        const f = parseInt(fe.getAttribute('data-face'), 10);
        fe.querySelectorAll('.stk').forEach((s, i) => out[E.FS[f] + i] = s.style.backgroundColor);
      });
      return out;
    };
    const E = w.CubeEngine;
    const shown = readCube();
    let same = true, firstBad = -1;
    for (let i = 0; i < 54; i++) if (shown[i] !== hex2rgb(E.COLOR_HEX[state[i]])) { same = false; firstBad = i; break; }
    ok(same, '第 1 步展示的是转动「前」的魔方状态' + (same ? '' : '（第 ' + firstBad + ' 格: ' + shown[firstBad] + '）'));

    const before = w.document.getElementById('stepPill').textContent;
    click(w.document.getElementById('nextStepBtn'), w);
    await new Promise(r => setTimeout(r, 60));
    ok(w.document.getElementById('stepPill').textContent !== before, '点下一步后步骤前进（' + before + ' -> ' + w.document.getElementById('stepPill').textContent + '）');

    const total = parseInt(before.split('/')[1].trim(), 10);
    for (let i = 0; i < total + 2; i++) click(w.document.getElementById('nextStepBtn'), w);
    await new Promise(r => setTimeout(r, 120));
    ok(w.document.getElementById('solvedSection').style.display === 'flex', '走到最后显示"已复原"');
    const doneShown = readCube();
    let solved = true, badIdx = -1;
    for (let i = 0; i < 54; i++) if (doneShown[i] !== hex2rgb(E.COLOR_HEX[E.solvedCube()[i]])) { solved = false; badIdx = i; break; }
    ok(solved, '最后一步展示的是复原状态' + (solved ? '' : '（第 ' + badIdx + ' 格: ' + doneShown[badIdx] + '）'));
  }

  console.log(fail === 0 ? '\n全部通过 🎉' : '\n失败 ' + fail + ' 项');
  process.exit(fail === 0 ? 0 : 1);
})();
