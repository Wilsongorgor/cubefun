/*
 * E2E 用例集（黑盒 / Use Case 视角）
 *
 * 与 tests/pages.test.js 的区别：那份偏"冒烟"，会用 setFaceColors() 直接往
 * 内部塞数据；这份全程只用真实 DOM 交互（点调色板 → 点格子 → 点面签 → 点按钮），
 * 并且刻意使用【非标准配色】的魔方，用来复现"怎么填都解不出来"那类线上问题。
 *
 *   node tests/e2e.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://cubefun.test';

/* ---------- node 侧加载引擎（只用来构造预期数据） ---------- */
const sb = { window: {}, console };
sb.globalThis = sb;
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'cube.js'), 'utf8'), sb);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'min2phase.js'), 'utf8'), sb);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'solver.js'), 'utf8'), sb);
const E = sb.window.CubeEngine;
const S = sb.window.CubeSolver;

const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png' };

/** 拦截器：把 https://cubefun.test/xx 的请求映射到本地文件（jsdom 29 起无 ResourceLoader） */
const localInterceptor = requestInterceptor(req => {
  const u = new URL(req.url);
  if (u.origin !== ORIGIN) return undefined;
  const rel = decodeURIComponent(u.pathname).replace(/^\//, '');
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) return undefined;
  return new Response(fs.readFileSync(file), {
    headers: { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' }
  });
});

const wait = ms => new Promise(r => setTimeout(r, ms));

async function load(page, seed) {
  const vc = new VirtualConsole();
  const errs = [];
  vc.on('jsdomError', e => errs.push(e.message));
  vc.on('error', (...a) => errs.push(a.join(' ')));
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, page), 'utf8'), {
    url: ORIGIN + '/' + page,
    runScripts: 'dangerously',
    resources: { interceptors: [localInterceptor] },
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      if (seed) w.sessionStorage.setItem('cubeState', JSON.stringify(seed));
    }
  });
  await wait(400);
  // 页面跳转在 jsdom 里会报 "Not implemented: navigation"，属预期，过滤掉
  const real = () => errs.filter(m => !/Not implemented: navigation/.test(m));
  return { dom, w: dom.window, errs: real };
}

/* ---------- 真实交互原语 ---------- */
const click = (el, w) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const chip = (w, f) => w.document.querySelector('.face-chip[data-face="' + f + '"]');
const swatch = (w, c) => w.document.querySelector('.swatch-btn[data-color="' + c + '"]');
const cells = w => w.document.querySelectorAll('.ed-cell');
const txt = (w, id) => (w.document.getElementById(id) || {}).textContent || '';
const shown = (w, id) => (w.document.getElementById(id) || {}).style.display;

/** 切到 f 面，然后一格一格点出来（选色 → 点格），完全模拟手指操作 */
function paintFace(w, f, nine) {
  click(chip(w, f), w);
  for (let i = 0; i < 9; i++) {
    click(swatch(w, nine[i]), w);
    click(cells(w)[i], w);
  }
}

/* ---------- 断言 ---------- */
let fail = 0, pass = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ok   : ' + msg); }
  else { fail++; console.log('  FAIL : ' + msg); }
}
const hex2rgb = h => 'rgb(' + [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)).join(', ') + ')';

/* ---------- 测试数据：一个真实存在的【非标准配色】魔方 ----------
 * 面序 U D F B R L → 黄顶、白底、红前、橙后、蓝右、绿左
 * 这跟 solver 曾经写死的"白顶黄底绿前"完全不同，是复现线上 BUG 的关键。 */
const SCHEME = [1, 0, 4, 5, 3, 2];
const MOVE_NAMES = ['U', "U'", 'U2', 'D', "D'", 'D2', 'F', "F'", 'F2',
  'B', "B'", 'B2', 'R', "R'", 'R2', 'L', "L'", 'L2'];

function solvedWith(scheme) {
  const st = new Array(54);
  for (let f = 0; f < 6; f++) for (let i = 0; i < 9; i++) st[E.FS[f] + i] = scheme[f];
  return st;
}
function randAlg(n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push(MOVE_NAMES[Math.floor(Math.random() * MOVE_NAMES.length)]);
  return a.join(' ');
}
const faceOf = (st, f) => st.slice(E.FS[f], E.FS[f] + 9);

function readCube3D(w, rootId) {
  const out = new Array(54);
  w.document.querySelectorAll('#' + rootId + ' .cube-face').forEach(fe => {
    const f = parseInt(fe.getAttribute('data-face'), 10);
    fe.querySelectorAll('.stk').forEach((s, i) => { out[E.FS[f] + i] = s.style.backgroundColor; });
  });
  return out;
}

/* 从 3D 渲染反查回颜色下标（黑盒：只认屏幕上显示出来的颜色） */
const RGB2IDX = {};
E.COLOR_HEX.forEach((h, i) => { RGB2IDX[hex2rgb(h)] = i; });
function colorsOf(w, rootId) {
  const out = new Array(54);
  w.document.querySelectorAll('#' + rootId + ' .cube-face').forEach(fe => {
    const f = parseInt(fe.getAttribute('data-face'), 10);
    fe.querySelectorAll('.stk').forEach((s, i) => { out[E.FS[f] + i] = RGB2IDX[s.style.backgroundColor]; });
  });
  return out;
}
const FACE_CHAR = ['U', 'D', 'F', 'B', 'R', 'L'];   // 面下标 → 转动记号
const MOVES = [];
['U', 'D', 'F', 'B', 'R', 'L'].forEach(m => { MOVES.push(m, m + "'", m + '2'); });

/** 找出 a→b 之间到底转了哪一步；找不到返回 null */
function findMove(a, b) {
  for (const m of MOVES) {
    const t = E.applyMove(a, m);
    let same = true;
    for (let i = 0; i < 54; i++) if (t[i] !== b[i]) { same = false; break; }
    if (same) return m;
  }
  return null;
}
const isSolvedState = st => {
  for (let f = 0; f < 6; f++) for (let i = 0; i < 9; i++) if (st[E.FS[f] + i] !== st[E.FS[f] + 4]) return false;
  return true;
};

/* ================= 用例 ================= */
const CASES = [];
const uc = (id, title, fn) => CASES.push({ id, title, fn });

/* 全局共享：UC-04 填出来的状态，后面几个用例接着用 */
let TARGET = null;
let SESSION = null;

uc('UC-01', '首页：两个入口可用且指向正确页面', async () => {
  const { w, errs } = await load('index.html');
  ok(errs().length === 0, '无脚本错误' + (errs()[0] ? '：' + errs()[0] : ''));
  const hrefs = [...w.document.querySelectorAll('a.mode-card')].map(a => a.getAttribute('href'));
  ok(hrefs.length === 2, '两个模式入口（实际 ' + hrefs.length + '）');
  ok(hrefs.includes('manual.html'), '入口包含手动填色 manual.html');
  ok(hrefs.includes('camera.html'), '入口包含拍照识别 camera.html');
});

uc('UC-02', '手动填色：初始态正确，未填满不允许求解', async () => {
  const { w, errs } = await load('manual.html');
  ok(errs().length === 0, '无脚本错误' + (errs()[0] ? '：' + errs()[0] : ''));
  ok(w.CubeInput.getActiveFace() === 2, '默认停在「前面 F」');
  ok(w.document.querySelectorAll('.ed-cell').length === 9, '编辑器 9 格');
  ok(w.document.querySelectorAll('.cube-face').length === 6, '立体魔方 6 面');
  ok(w.document.querySelectorAll('.face-chip').length === 6, '六个面签');
  ok(w.document.getElementById('solveBtn').disabled === true, '未填满时「开始求解」不可点');
  ok(txt(w, 'cubeProgress').indexOf('0 / 6') >= 0, '进度显示 0 / 6');
  ok(/先填|正对着自己/.test(txt(w, 'guideBox')), '首面引导提示存在：' + txt(w, 'guideBox').replace(/\s+/g, ' ').trim());
});

uc('UC-03b', '格序：点哪一格，那一格就显示所选颜色（防止显示镜像/错位）', async () => {
  const { w } = await load('manual.html');
  click(chip(w, 2), w);                       // 前面 F
  const nine = [0, 1, 2, 3, 4, 5, 1, 2, 3];   // 混搭颜色，避免全同色测不出顺序
  // 只填前 8 格：填满第 9 格会自动跳面，这里不触发跳面，专门验显示顺序
  let allOk = true, badCell = -1, badWant = '', badGot = '';
  for (let i = 0; i < 8; i++) {
    click(swatch(w, nine[i]), w);
    click(cells(w)[i], w);
    const got = cells(w)[i].style.backgroundColor;
    const want = hex2rgb(E.COLOR_HEX[nine[i]]);
    if (got !== want) { allOk = false; badCell = i; badWant = want; badGot = got; break; }
  }
  ok(allOk, '8 格显示顺序与点击一致' + (allOk ? '' :
    '（第 ' + (badCell + 1) + ' 格：期望 ' + badWant + '，实际 ' + badGot + '）'));

  // 编辑器显示与内部数据完全一致（只比已填的 8 格，第 9 格尚未填）
  const faces = w.CubeInput.getFaces();
  let sync = true, sBad = -1;
  for (let i = 0; i < 8; i++) {
    if (cells(w)[i].style.backgroundColor !== hex2rgb(E.COLOR_HEX[faces[2][i]])) { sync = false; sBad = i; break; }
  }
  ok(sync, '编辑器九宫格与内部数据一致' + (sync ? '' : '（第 ' + (sBad + 1) + ' 格不一致）'));
});

uc('UC-03', '手动填色：填满一面自动跳下一面并给出转动方向', async () => {
  const { w } = await load('manual.html');
  const before = w.CubeInput.getActiveFace();
  for (let i = 0; i < 9; i++) { click(swatch(w, 4), w); click(cells(w)[i], w); }
  ok(before === 2 && w.CubeInput.getActiveFace() === 4, '前面填满后自动切到「右面 R」（' + before + ' → ' + w.CubeInput.getActiveFace() + '）');
  ok(w.CubeInput.filledCount() === 1, '已填面数 = 1');
  const g = txt(w, 'guideBox').replace(/\s+/g, ' ').trim();
  ok(g.includes('右面') && /转|翻/.test(g), '引导条说明要转到右面：' + g);
  ok(!!w.document.getElementById('guideGoBtn'), '提供「看演示」重播转动');
  ok(w.document.querySelectorAll('#cube3d .cube-face.is-active').length === 1, '始终只有一个面处于编辑态');
});

uc('UC-04', '核心：非标准配色 + 乱序填面，逐格点击后数据完全一致', async () => {
  const alg = randAlg(20);
  TARGET = E.applyAlg(solvedWith(SCHEME), alg);
  const { w, errs } = await load('manual.html');
  ok(errs().length === 0, '无脚本错误' + (errs()[0] ? '：' + errs()[0] : ''));

  // 故意不按引导顺序：F → D → L → B → R → U
  const order = [2, 1, 5, 3, 4, 0];
  for (const f of order) paintFace(w, f, faceOf(TARGET, f));

  const got = w.CubeInput.toState();
  let same = true, bad = -1;
  for (let i = 0; i < 54; i++) if (got[i] !== TARGET[i]) { same = false; bad = i; break; }
  ok(same, '54 格逐格比对一致（乱序填面不丢数据）' + (same ? '' : '，首个不符下标 ' + bad));
  ok(w.CubeInput.filledCount() === 6, '六面已填满');
  ok(w.document.getElementById('solveBtn').disabled === false, '「开始求解」已启用');
  ok(txt(w, 'cubeProgress').indexOf('6 / 6') >= 0, '进度显示 6 / 6');

  // 填进去的是非标准配色，中心块必须保留用户实际的颜色
  const centers = [0, 1, 2, 3, 4, 5].map(f => got[E.FS[f] + 4]);
  ok(centers.join() === SCHEME.join(), '六个中心块保持用户配色 [' + centers.join(',') + ']');
});

uc('UC-05', '点「开始求解」把状态写进 sessionStorage', async () => {
  const { w } = await load('manual.html');
  const order = [2, 1, 5, 3, 4, 0];
  for (const f of order) paintFace(w, f, faceOf(TARGET, f));
  click(w.document.getElementById('solveBtn'), w);
  await wait(50);
  const raw = w.sessionStorage.getItem('cubeState');
  ok(!!raw, 'sessionStorage 已写入 cubeState');
  const obj = JSON.parse(raw || '{}');
  ok(JSON.stringify(obj.cubeData) === JSON.stringify(TARGET), '落盘数据与界面一致');
  ok(obj.scanMode === 'manual', '记录来源模式 = manual');
  SESSION = obj;
});

uc('UC-06', '求解页：从 sessionStorage 恢复并给出合理步数', async () => {
  const { w, errs } = await load('solve.html', { cubeData: TARGET, scanMode: 'manual' });
  ok(errs().length === 0, '无脚本错误' + (errs()[0] ? '：' + errs()[0] : ''));
  ok(shown(w, 'errorSection') !== 'block', '没有报错');
  ok(shown(w, 'solutionSection') === 'block', '解法区已显示');
  const pill = txt(w, 'stepPill').trim();
  const m = pill.match(/^1\s*\/\s*(\d+)$/);
  ok(!!m, '步骤计数形如 "1 / N"（实际 ' + pill + '）');
  const total = m ? parseInt(m[1], 10) : 0;
  ok(total >= 1 && total <= 24, '步数在合理区间 1–24（实际 ' + total + '）');

  // 第 1 步展示的必须是「转动之前」的魔方
  const cur = readCube3D(w, 'solveCube3d');
  let same = true, bad = -1;
  for (let i = 0; i < 54; i++) if (cur[i] !== hex2rgb(E.COLOR_HEX[TARGET[i]])) { same = false; bad = i; break; }
  ok(same, '第 1 步展示输入状态' + (same ? '' : '，首个不符下标 ' + bad +
    '（期望 ' + hex2rgb(E.COLOR_HEX[TARGET[bad]]) + ' 实际 ' + cur[bad] + '）'));
  ok(w.document.querySelectorAll('#solveCube3d .cube-face.is-highlight').length === 1, '高亮当前要转的面');
});

uc('UC-07', '求解页：逐步播放，每一步都能真的转出来且高亮面一致', async () => {
  const { w } = await load('solve.html', { cubeData: TARGET, scanMode: 'manual' });
  const total = parseInt(txt(w, 'stepPill').trim().split('/')[1], 10);

  // 逐步抓快照：第 i 个快照 = 执行第 i 步「之前」的样子
  const snaps = [], hls = [];
  for (let i = 0; i < total; i++) {
    snaps.push(colorsOf(w, 'solveCube3d'));
    const h = w.document.querySelector('#solveCube3d .cube-face.is-highlight');
    hls.push(h ? parseInt(h.getAttribute('data-face'), 10) : -1);
    click(w.document.getElementById('nextStepBtn'), w);
    await wait(25);
  }
  snaps.push(colorsOf(w, 'solveCube3d'));   // 最后一步：复原态
  ok(snaps.length === total + 1, '抓到 ' + (total + 1) + ' 个状态快照');

  // 1) 首个快照必须是用户填进去的状态
  let same = true, bad = -1;
  for (let i = 0; i < 54; i++) if (snaps[0][i] !== TARGET[i]) { same = false; bad = i; break; }
  ok(same, '第 1 步展示输入状态' + (same ? '' : '，首个不符下标 ' + bad));

  // 2) 相邻两个快照之间必须恰好差「一次转动」，且高亮的面就是实际转的那个面
  const seq = [];
  let stepBad = -1, hlBad = -1;
  for (let i = 0; i < total; i++) {
    const m = findMove(snaps[i], snaps[i + 1]);
    if (!m) { stepBad = i; break; }
    seq.push(m);
    if (FACE_CHAR[hls[i]] !== m[0]) { hlBad = i; }
  }
  ok(stepBad < 0, '每一步都对应一次真实转动' + (stepBad < 0 ? '' : '（第 ' + (stepBad + 1) + ' 步对不上）'));
  ok(hlBad < 0, '高亮提示的面与实际转动的面一致' +
    (hlBad < 0 ? '' : '（第 ' + (hlBad + 1) + ' 步高亮 ' + FACE_CHAR[hls[hlBad]] + '，实际转 ' + seq[hlBad] + '）'));

  // 3) 末态必须是复原态，且按用户配色复原
  const fin = snaps[snaps.length - 1];
  ok(isSolvedState(fin), '最后一步是复原态（每面同色）');
  let centersOk = true;
  for (let f = 0; f < 6; f++) if (fin[E.FS[f] + 4] !== SCHEME[f]) centersOk = false;
  ok(centersOk, '复原态用的是用户自己的配色，不是标准配色');

  // 4) 独立复核：把演示出来的动作序列在 node 侧真转一遍
  if (seq.length === total) {
    const check = E.applyAlg(TARGET, seq.join(' '));
    ok(isSolvedState(check), '动作序列在 node 侧复核：apply 后确实复原（' + total + ' 步：' + seq.join(' ') + '）');
  }

  ok(shown(w, 'solvedSection') === 'flex' || shown(w, 'solvedSection') === 'block', '显示「已复原」');
});

uc('UC-08', '错误输入：某一面整体填反 → 明确报错并定位到面', async () => {
  const { w } = await load('manual.html');
  const order = [2, 1, 5, 3, 4, 0];
  for (const f of order) paintFace(w, f, faceOf(TARGET, f));

  // 用户最容易犯的错：某一面整体左右镜像。逐格重填来模拟。
  click(chip(w, 0), w);
  for (let r = 0; r < 3; r++) {
    const a = r * 3, b = r * 3 + 2;
    const va = TARGET[E.FS[0] + b], vb = TARGET[E.FS[0] + a];
    click(swatch(w, va), w); click(cells(w)[a], w);
    click(swatch(w, vb), w); click(cells(w)[b], w);
  }
  const broken = w.CubeInput.toState();
  ok(broken.join() !== TARGET.join(), '状态确实被改坏了（前提成立）');
  ok(w.CubeInput.filledCount() === 6, '仍是六面填满，按钮可点');

  click(w.document.getElementById('solveBtn'), w);
  await wait(50);
  const { w: w2, errs } = await load('solve.html', { cubeData: broken, scanMode: 'manual' });
  ok(errs().length === 0, '求解页无脚本错误' + (errs()[0] ? '：' + errs()[0] : ''));
  ok(shown(w2, 'errorSection') === 'block', '显示错误区而不是假装解出来');
  ok(shown(w2, 'solutionSection') !== 'block', '没有给出错误解法');

  const msg = txt(w2, 'errorSection').replace(/\s+/g, ' ').trim();
  ok(msg.length > 10, '有错误文案');
  ok(!/^这个魔方状态无法还原。?$/.test(msg), '不是无信息量的笼统报错');
  ok(/块|面/.test(msg), '文案指出了具体的块或面：' + msg.slice(0, 90));
});

uc('UC-09', '错误输入：两个面中心同色 → 填色页当场提示', async () => {
  const { w } = await load('manual.html');
  for (const f of [2, 1, 5, 3, 4, 0]) paintFace(w, f, faceOf(TARGET, f));
  // 把 U 面中心改成和 D 面中心一样的颜色
  click(chip(w, 0), w);
  click(swatch(w, TARGET[E.FS[1] + 4]), w);
  click(cells(w)[4], w);
  const hint = txt(w, 'inputHint');
  ok(/中心/.test(hint), '提示中心块冲突：' + hint.replace(/\s+/g, ' ').trim());
  ok(shown(w, 'inputHint') === 'block', '提示可见');
});

uc('UC-10', '求解页：没有数据时给出降级提示而非白屏', async () => {
  const { w, errs } = await load('solve.html');
  ok(errs().length === 0, '无脚本错误' + (errs()[0] ? '：' + errs()[0] : ''));
  ok(shown(w, 'errorSection') === 'block', '显示「没有数据」提示');
  ok(shown(w, 'solutionSection') !== 'block', '不显示解法区');
});

uc('UC-11', '试玩：随机打乱 → 求解闭环', async () => {
  const { w } = await load('manual.html');
  click(w.document.getElementById('scrambleBtn'), w);
  await wait(50);
  ok(w.CubeInput.filledCount() === 6, '打乱后六面自动填满');
  ok(w.document.getElementById('solveBtn').disabled === false, '求解按钮可用');
  const st = w.CubeInput.toState();
  const v = E.validate(st);
  ok(v.ok, '打乱出来的状态形式合法' + (v.ok ? '' : '：' + v.error));

  const { w: w2 } = await load('solve.html', { cubeData: st, scanMode: 'manual' });
  ok(shown(w2, 'solutionSection') === 'block', '求解页给出解法');
  const total = parseInt(txt(w2, 'stepPill').trim().split('/')[1], 10);
  ok(total >= 1 && total <= 24, '步数合理（' + total + '）');
});

uc('UC-12', '清空：重置后回到初始态', async () => {
  const { w } = await load('manual.html');
  for (const f of [2, 1, 5, 3, 4, 0]) paintFace(w, f, faceOf(TARGET, f));
  ok(w.CubeInput.filledCount() === 6, '先填满（前提成立）');
  click(w.document.getElementById('resetBtn'), w);
  await wait(50);
  ok(w.CubeInput.filledCount() === 0, '清空后已填面数归零');
  ok(w.document.getElementById('solveBtn').disabled === true, '求解按钮重新禁用');
  ok(w.CubeInput.getActiveFace() === 2, '回到「前面 F」');
  ok(txt(w, 'cubeProgress').indexOf('0 / 6') >= 0, '进度回到 0 / 6');
});

uc('UC-13', '拍照页：无摄像头时降级，且颜色分类抗光照波动', async () => {
  const { w, errs } = await load('camera.html');
  ok(errs().length === 0, '无脚本错误' + (errs()[0] ? '：' + errs()[0] : ''));
  ok(!!w.document.querySelector('.camera-fallback'), '无摄像头时给出降级提示');
  ok(w.document.getElementById('captureBtn').disabled === true, '降级后禁用识别按钮');
  ok(w.CubeInput.getActiveFace() === 2, '与手动填色共用同一套引导式输入');

  const C = w.CubeCamera.classify;
  const std = [[255, 255, 255, 0], [255, 213, 0, 1], [0, 177, 106, 2],
    [0, 81, 186, 3], [183, 18, 52, 4], [255, 88, 0, 5]];
  let allOk = true, wrong = '';
  for (const [r, g, b, want] of std) {
    for (const k of [0.75, 0.9, 1.0, 1.1]) {   // 模拟明暗变化
      const got = C(Math.min(255, r * k) | 0, Math.min(255, g * k) | 0, Math.min(255, b * k) | 0);
      if (got !== want) { allOk = false; wrong = `rgb(${r},${g},${b})×${k} → ${got}，期望 ${want}`; }
    }
  }
  ok(allOk, '六标准色在 ±25% 光照波动下归类正确' + (allOk ? '' : '（' + wrong + '）'));
});

uc('UC-14', '覆盖度：200 组随机配色 × 随机打乱，全部可解且真能复原', async () => {
  const N = 200;
  let solvedCnt = 0, errCnt = 0, applyFail = 0, maxSteps = 0;
  const errSample = [];
  for (let n = 0; n < N; n++) {
    // 随机配色：把 0..5 随机分配给 U D F B R L 六个面
    const scheme = [0, 1, 2, 3, 4, 5];
    for (let i = 5; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = scheme[i]; scheme[i] = scheme[j]; scheme[j] = t; }
    const st = E.applyAlg(solvedWith(scheme), randAlg(25));

    const res = S.solve(st);
    if (res.error) { errCnt++; if (errSample.length < 3) errSample.push(scheme.join('') + ' → ' + res.error); continue; }
    solvedCnt++;
    maxSteps = Math.max(maxSteps, res.solution.length);
    const check = E.applyAlg(st, res.solution.join(' '));
    if (!isSolvedState(check)) applyFail++;
  }
  ok(errCnt === 0, N + ' 组随机配色全部给出解法（失败 ' + errCnt + '）' +
    (errSample.length ? '\n         ' + errSample.join('\n         ') : ''));
  ok(applyFail === 0, '所有解法 apply 后都真的复原（异常 ' + applyFail + '）');
  ok(maxSteps <= 24, '最长解法 ' + maxSteps + ' 步，未超过 24');
});

uc('UC-15', '「对准这面」按钮：点了之后魔方转到该面正对用户', async () => {
  const { w } = await load('manual.html');
  click(chip(w, 4), w);                 // 先切到右面
  await wait(700);
  click(w.document.getElementById('scrambleBtn'), w);   // 随机转一通
  await wait(50);
  click(w.document.getElementById('centerBtn'), w);     // 对准这面
  await wait(900);
  const tf = w.document.getElementById('cube3d').style.transform;
  const f = w.CubeInput.getActiveFace();
  const want = { 0: 'rotateX(-90deg)', 1: 'rotateX(90deg)', 2: 'rotateX(0deg)', 3: 'rotateY(180deg)', 4: 'rotateY(-90deg)', 5: 'rotateY(90deg)' }[f];
  ok(tf.indexOf(want) >= 0, '面 ' + f + ' 已转正（' + tf + '，期望含 ' + want + '）');
  ok(w.document.querySelectorAll('#cube3d .cube-face.is-active').length === 1, '编辑态仍唯一');
});

uc('UC-16', '求解页：上一步可以回退，状态能回到去', async () => {
  const { w } = await load('solve.html', { cubeData: TARGET, scanMode: 'manual' });
  const s0 = colorsOf(w, 'solveCube3d');
  click(w.document.getElementById('nextStepBtn'), w);
  await wait(40);
  const s1 = colorsOf(w, 'solveCube3d');
  ok(s0.join() !== s1.join(), '点下一步后状态确实前进');
  click(w.document.getElementById('prevStepBtn'), w);
  await wait(40);
  const s0b = colorsOf(w, 'solveCube3d');
  ok(s0.join() === s0b.join(), '点上一步后回到原来的状态');
});

/* ================= 执行 ================= */
(async () => {
  console.log('E2E 用例集 —— 非标准配色（黄顶·白底·红前·橙后·蓝右·绿左）\n');
  for (const c of CASES) {
    console.log('[' + c.id + '] ' + c.title);
    try {
      await c.fn();
    } catch (e) {
      fail++;
      console.log('  FAIL : 用例抛出异常 —— ' + e.message);
      if (process.env.VERBOSE) console.log(e.stack);
    }
  }
  console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log(fail === 0 ? '全部通过 🎉' : '存在失败用例，需要修复');
  process.exit(fail === 0 ? 0 : 1);
})();
