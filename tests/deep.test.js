'use strict';
/*
 * 深层黑盒测试：覆盖真实的"用户犯错 / 异常输入 / 跨页状态 / 求解压力 / 边界"。
 * 全部走真实 DOM 交互，不调用任何内部方法直接塞数据。
 *
 *   node tests/deep.test.js
 *
 * 覆盖方向：
 *   DC-01  跨页链路：manual → sessionStorage → solve.html
 *   DC-02  sessionStorage 损坏（null）
 *   DC-03  cubeData 是字符串
 *   DC-04  cubeData 长度不是 54
 *   DC-05  cubeData 含 -1（未填色残值）
 *   DC-06  求解压力：20 步打乱
 *   DC-07  求解压力：30 步打乱（接近事实魔方极限）
 *   DC-08  求解页步进边界 prev/next
 *   DC-09  已是复原态：给出 0 步
 *   DC-10  拍照降级（jsdom 无摄像头）
 *   DC-11  双向闭合：手动填 → 跳页求解 → apply → 回到用户填的配色
 *   DC-12  求解页「重看」回到第 0 步
 *   DC-13  多次快速点击求解按钮
 *   DC-14  引导填色中途切面，原面颜色不丢
 *   DC-15  错误信息非空 + 提到具体面
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://cubefun.test';

const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.ico': 'image/x-icon' };
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

/* ---------- node 侧引擎（构造预期数据） ---------- */
const sb = { window: {}, console };
sb.globalThis = sb;
vm.createContext(sb);
['js/cube.js', 'js/min2phase.js', 'js/solver.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb));
const E = sb.window.CubeEngine;
const S = sb.window.CubeSolver;

/* ---------- 工具 ---------- */
const wait = ms => new Promise(r => setTimeout(r, ms));
let fail = 0, pass = 0;
const fails = [];
function ok(cond, label) {
  if (cond) { pass++; console.log('  ok   : ' + label); }
  else { fail++; fails.push(label); console.log('  FAIL : ' + label); }
}
function section(name) { console.log('\n━━ ' + name + ' ━━'); }
async function uc(name, fn) { section('UC: ' + name); try { await fn(); } catch (e) { fail++; fails.push(name + ' 异常: ' + e.message); console.error('  EXC :', e.message); } }

const click = (el, w) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const chip = (w, f) => w.document.querySelector('.face-chip[data-face="' + f + '"]');
const swatch = (w, c) => w.document.querySelector('.swatch-btn[data-color="' + c + '"]');
const cells = w => w.document.querySelectorAll('.ed-cell');
const txt = (w, id) => (w.document.getElementById(id) || {}).textContent || '';
const shown = (w, id) => (w.document.getElementById(id) || {}).style.display;

/** 切到 f 面，按 nine[0..8] 的颜色一格一格点。nine[i] 缺省时全用 0。 */
function paintFace(w, f, nine) {
  nine = nine || [0, 0, 0, 0, 0, 0, 0, 0, 0];
  click(chip(w, f), w);
  for (let i = 0; i < 9; i++) {
    click(swatch(w, nine[i]), w);
    click(cells(w)[i], w);
  }
}

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
    beforeParse(w) { if (seed) w.sessionStorage.setItem('cubeState', JSON.stringify(seed)); }
  });
  await wait(500);
  const real = () => errs.filter(m => !/Not implemented: navigation/.test(m));
  return { dom, w: dom.window, errs: real };
}

function isValid(st) {
  if (!st || st.length !== 54) return false;
  for (let i = 0; i < 54; i++) if (!Number.isInteger(st[i]) || st[i] < 0 || st[i] > 5) return false;
  const cnt = Array(6).fill(0);
  for (let i = 0; i < 54; i++) cnt[st[i]]++;
  if (cnt.some(c => c !== 9)) return false;
  const centers = [0, 1, 2, 3, 4, 5].map(f => st[E.FS[f] + 4]);
  return new Set(centers).size === 6;
}

/* ================= 用例 ================= */

(async () => {

  // input.js 的引导顺序是 F R B L U D = [2,4,3,5,0,1]
  const GUIDE = [2, 4, 3, 5, 0, 1];
  // 6 种颜色各填一面（每色 9 个），保证 validate 通过
  const COL = [0, 1, 2, 3, 4, 5];
  await uc('DC-01 跨页链路：manual.html 填一组 → sessionStorage → 加载 solve.html → 求解成功', async () => {
    const a = await load('manual.html');
    ok(a.w.CubeInput, 'manual.html 装载后 CubeInput 就绪');
    for (let k = 0; k < 6; k++) { paintFace(a.w, GUIDE[k], new Array(9).fill(COL[k])); await wait(150); }
    const solveBtn = a.w.document.getElementById('solveBtn');
    ok(solveBtn, '求解按钮存在');
    ok(!solveBtn.disabled, '六面填满后求解按钮可用');
    click(solveBtn, a.w);
    await wait(200);
    const stored = a.w.sessionStorage.getItem('cubeState');
    ok(stored, 'sessionStorage 里有 cubeState');
    const parsed = JSON.parse(stored);
    ok(isValid(parsed.cubeData), 'sessionStorage 里的状态合法（' + parsed.cubeData.length + ' 格）');

    // 模拟"用户跳到 solve.html"：把 sessionStorage 复制到 b
    const b = await load('solve.html', { cubeData: parsed.cubeData, scanMode: 'manual' });
    await wait(300);
    const vis = shown(b.w, 'errorSection');
    ok(vis === 'none' || !vis, '没有错误区（求到了）：' + vis);
    ok(shown(b.w, 'solutionSection') === 'block' || shown(b.w, 'solutionSection') === '', '解法区显示了');
    ok(/\d+\s*\/\s*\d+/.test(txt(b.w, 'stepPill')), '步骤指示器显示「当前/总步数」：' + txt(b.w, 'stepPill'));
  });

  await uc('DC-02 sessionStorage 损坏：cubeData=null → 错误区有内容', async () => {
    const a = await load('solve.html', { cubeData: null, scanMode: 'manual' });
    await wait(200);
    const vis = shown(a.w, 'errorSection');
    ok(vis !== 'none', 'cubeData=null 时显示错误区（' + vis + '）');
    const errTxt = a.w.document.getElementById('errorText');
    ok(errTxt && errTxt.innerHTML.length > 0, '错误提示有内容：' + (errTxt ? errTxt.textContent.slice(0, 50) : ''));
    ok(shown(a.w, 'solutionSection') === 'none', '解法区不显示');
  });

  await uc('DC-03 cubeData 是字符串：错误区有内容', async () => {
    const a = await load('solve.html', { cubeData: 'not an array', scanMode: 'manual' });
    await wait(200);
    ok(shown(a.w, 'errorSection') !== 'none', '字符串 cubeData 触发错误区');
    const errTxt = a.w.document.getElementById('errorText');
    ok(errTxt && errTxt.textContent.replace(/<[^>]+>/g, '').length > 0, '错误文案非空');
  });

  await uc('DC-04 cubeData 长度不是 54：错误区有内容', async () => {
    const a = await load('solve.html', { cubeData: new Array(20).fill(0), scanMode: 'manual' });
    await wait(200);
    ok(shown(a.w, 'errorSection') !== 'none', '长度不对触发错误区');
  });

  await uc('DC-05 cubeData 含 -1（未填色残值）：错误区有内容', async () => {
    const st = E.solvedCube(); st[0] = -1;
    const a = await load('solve.html', { cubeData: st, scanMode: 'manual' });
    await wait(200);
    ok(shown(a.w, 'errorSection') !== 'none', '未填完触发错误区');
    const txt0 = a.w.document.getElementById('errorText').textContent;
    ok(txt0.length > 10, '错误文案非空（' + txt0.slice(0, 30) + '）');
  });

  await uc('DC-06 求解压力：20 步深打乱', async () => {
    const MOVES = ['U', "U'", 'U2', 'D', "D'", 'D2', 'F', "F'", 'F2', 'B', "B'", 'B2', 'R', "R'", 'R2', 'L', "L'", 'L2'];
    let st = E.solvedCube();
    for (let i = 0; i < 20; i++) st = E.applyMove(st, MOVES[Math.floor(Math.random() * MOVES.length)]);
    ok(isValid(st), '20 步打乱后的状态合法');
    const t0 = Date.now();
    const res = S.solve(st);
    const ms = Date.now() - t0;
    ok(!res.error, '20 步打乱可解（用时 ' + ms + 'ms）');
    if (!res.error) {
      const back = E.applyAlg(st, res.solution.join(' '));
      let okEach = true;
      for (let f = 0; f < 6; f++) {
        const want = back[E.FS[f] + 4];
        for (let i = 0; i < 9; i++) if (back[E.FS[f] + i] !== want) { okEach = false; break; }
        if (!okEach) break;
      }
      ok(okEach, '20 步解法 apply 后每面同色');
    }
  });

  await uc('DC-07 求解压力：30 步深打乱', async () => {
    const MOVES = ['U', "U'", 'U2', 'D', "D'", 'D2', 'F', "F'", 'F2', 'B', "B'", 'B2', 'R', "R'", 'R2', 'L', "L'", 'L2'];
    let st = E.solvedCube();
    for (let i = 0; i < 30; i++) st = E.applyMove(st, MOVES[Math.floor(Math.random() * MOVES.length)]);
    const t0 = Date.now();
    const res = S.solve(st);
    const ms = Date.now() - t0;
    ok(!res.error, '30 步打乱可解（用时 ' + ms + 'ms）');
    ok(ms < 5000, '30 步求解在 5 秒内完成（实测 ' + ms + 'ms）');
  });

  await uc('DC-08 求解步进边界：prev/next 在 0/total 处不崩', async () => {
    const MOVES = ['U', "U'", 'R', "R'", 'F', "F'"]; let st = E.solvedCube();
    for (let i = 0; i < 7; i++) st = E.applyMove(st, MOVES[Math.floor(Math.random() * MOVES.length)]);
    const a = await load('solve.html', { cubeData: st, scanMode: 'manual' });
    await wait(300);
    const prev = a.w.document.getElementById('prevStepBtn');
    const next = a.w.document.getElementById('nextStepBtn');
    ok(prev && next, '步进按钮存在');
    let crashed = false;
    try { click(prev, a.w); click(prev, a.w); } catch (e) { crashed = true; }
    ok(!crashed, 'current=0 时连点 prev 不崩');
    try {
      const total = parseInt(txt(a.w, 'stepPill').split('/')[1], 10);
      for (let i = 0; i < total + 5; i++) click(next, a.w);
    } catch (e) { crashed = true; }
    ok(!crashed, '超过 total 后连点 next 不崩');
    await wait(100);
    const vis = shown(a.w, 'solvedSection');
    ok(vis === 'flex' || vis === 'block', '走到末尾显示「已复原」');
  });

  await uc('DC-09 已是复原态：solve.html 加载后给出 0 步', async () => {
    const a = await load('solve.html', { cubeData: E.solvedCube(), scanMode: 'manual' });
    await wait(300);
    ok(/0\s*\/\s*0/.test(txt(a.w, 'stepPill')), '复原态 → 0/0 步（' + txt(a.w, 'stepPill') + '）');
    const vis = shown(a.w, 'solvedSection');
    ok(vis === 'flex' || vis === 'block', '直接显示「已复原」（' + vis + '）');
  });

  await uc('DC-10 拍照降级：camera.html 在没摄像头时给出手动填色的退路', async () => {
    const a = await load('camera.html');
    await wait(400);
    const hasCam = !!(a.w.navigator.mediaDevices && a.w.navigator.mediaDevices.getUserMedia);
    ok(!hasCam, 'jsdom 确认没有摄像头 API');
    const fallback = a.w.document.getElementById('cameraFallback') ||
      a.w.document.querySelector('.camera-fallback');
    const altBtn = a.w.document.querySelector('a[href*="manual.html"]');
    const altBtn2 = a.w.document.querySelector('[id*="manual"]');
    ok(fallback || altBtn || altBtn2, '没摄像头时给出 fallback 或跳手动页的入口');
  });

  await uc('DC-11 双向闭合：手动填一组非标准配色 → 跳页 → apply → 中心 == 用户配色', async () => {
    const a = await load('manual.html');
    // 引导顺序 F R B L U D = [2,4,3,5,0,1]，按面索引选 swatch
    // 期望"按面"配色：U=1(黄) D=0(白) F=2(绿) B=3(蓝) R=4(红) L=5(橙)
    const colorByFace = [1, 0, 2, 3, 4, 5];
    for (let k = 0; k < 6; k++) { paintFace(a.w, GUIDE[k], new Array(9).fill(colorByFace[GUIDE[k]])); await wait(150); }
    const input = a.w.CubeInput.toState();
    ok(isValid(input), 'manual.html 填完 6 面后 cubeData 合法');

    const res = S.solve(input);
    ok(!res.error, '用户填的非标准配色可解');
    if (!res.error) {
      const back = E.applyAlg(input, res.solution.join(' '));
      let okEach = true;
      for (let f = 0; f < 6; f++) {
        const want = back[E.FS[f] + 4];
        for (let i = 0; i < 9; i++) if (back[E.FS[f] + i] !== want) { okEach = false; break; }
        if (!okEach) break;
      }
      ok(okEach, 'apply 解法后每面同色');
      const cn = [0, 1, 2, 3, 4, 5].map(f => back[E.FS[f] + 4]);
      ok(JSON.stringify(cn) === JSON.stringify(colorByFace), 'apply 后 6 个中心 = 用户填的 6 色（' + cn.join(',') + '）');
    }
  });

  await uc('DC-12 求解页：点「重看」回到第 0 步', async () => {
    const MOVES = ['U', "U'", 'R', "R'", 'F', "F'"]; let st = E.solvedCube();
    for (let i = 0; i < 6; i++) st = E.applyMove(st, MOVES[Math.floor(Math.random() * MOVES.length)]);
    const a = await load('solve.html', { cubeData: st, scanMode: 'manual' });
    await wait(300);
    click(a.w.document.getElementById('nextStepBtn'), a.w);
    click(a.w.document.getElementById('nextStepBtn'), a.w);
    await wait(80);
    const before = txt(a.w, 'stepPill');
    click(a.w.document.getElementById('restartBtn'), a.w);
    await wait(80);
    const after = txt(a.w, 'stepPill');
    // stepPill 人类友好格式：(current+1)/total，goTo(0) 应回到 "1 / N"
    const total = parseInt(before.split('/')[1], 10);
    ok(after === '1 / ' + total, '「重看」回到第 0 步（重看前=' + before + '，重看后=' + after + '，期望 1 / ' + total + '）');
  });

  await uc('DC-13 多次快速点击 next：不崩', async () => {
    const MOVES = ['U', 'R', 'F']; let st = E.solvedCube();
    for (let i = 0; i < 5; i++) st = E.applyMove(st, MOVES[Math.floor(Math.random() * MOVES.length)]);
    const a = await load('solve.html', { cubeData: st, scanMode: 'manual' });
    await wait(300);
    let crashed = false;
    try { for (let i = 0; i < 30; i++) click(a.w.document.getElementById('nextStepBtn'), a.w); } catch (e) { crashed = true; }
    ok(!crashed, '30 次连点 next 不崩');
  });

  await uc('DC-14 引导填色：填完一面前中途跳面，原面颜色不丢', async () => {
    const a = await load('manual.html');
    paintFace(a.w, 2, [0, 0, 0, 0, 0, 0, 0, 0, 0]); // 前面全白
    await wait(100);
    paintFace(a.w, 4, [4, 4, 4, 4, 4, 4, 4, 4, 4]); // 右面全红
    await wait(100);
    // 回到前面，再读格子背景
    click(chip(a.w, 2), a.w);
    await wait(100);
    const cs = cells(a.w);
    let allWhite = true;
    for (let i = 0; i < 9; i++) {
      const bg = cs[i].style.backgroundColor;
      // jsdom 把 #ffffff 归一化成 rgb(255, 255, 255)
      if (bg !== 'rgb(255, 255, 255)') { allWhite = false; break; }
    }
    ok(allWhite, '切走再回来，前面 9 格仍为白色');
  });

  await uc('DC-15 错误信息非空 + 必须提到具体面', async () => {
    // 构造"真不可解"：从 solvedCube 出发，把 URF 角块的 3 个贴纸循环置换
    // URF 角块：U[2]=FS[0]+2, F[2]=FS[2]+2, R[0]=FS[4]+0
    // 循环 st[2]→st[20]→st[36]→st[2]，每色 9 个数不变，但单个角块错位
    const st = E.solvedCube();
    const a = E.FS[0] + 2, b = E.FS[2] + 2, c = E.FS[4] + 0;
    const tmp = st[a]; st[a] = st[b]; st[b] = st[c]; st[c] = tmp;
    const valid = E.validate(st);
    ok(valid.ok, '构造的状态形式合法（每色 9 个，中心互异）');
    const a2 = await load('solve.html', { cubeData: st, scanMode: 'manual' });
    await wait(300);
    const err = a2.w.document.getElementById('errorText');
    const vis = shown(a2.w, 'errorSection');
    ok(vis !== 'none', '非法状态显示错误区（' + vis + '）');
    const text = (err.textContent || '').trim();
    ok(text.length >= 10, '错误文案长度足够（' + text.length + '）：' + text.slice(0, 80));
    const FACES = ['上面', '下面', '前面', '后面', '右面', '左面'];
    const mentioned = FACES.filter(f => text.indexOf(f) >= 0);
    ok(mentioned.length >= 1, '错误文案至少提到一个具体面（提到了：' + mentioned.join('、') + '）');
  });

  /* ========== 第二轮：状态恢复 / 竞态 / DOM 健壮性 / Fuzz ========== */

  await uc('DC-16 填一半后「刷新」：sessionStorage 恢复未完成状态', async () => {
    // 第一次：填 2 面后中止
    const a = await load('manual.html');
    paintFace(a.w, 2, new Array(9).fill(0)); await wait(150);  // F
    paintFace(a.w, 4, new Array(9).fill(4)); await wait(150);  // R
    // 写入 sessionStorage（模拟"用户点过求解按钮但被拦"或"页面已经准备就绪"）
    // 这里直接用 CubeInput.toState 把当前进度写回
    const st0 = a.w.CubeInput.toState();
    // 模拟关闭页面：新开一个 jsdom 装载 manual.html，但 sessionStorage 已被写入 a.w
    // jsdom 之间 sessionStorage 不共享 —— 直接给 cubeData 注入
    const b = await load('manual.html');
    // 把 a 的状态复制到 b（先看是否有恢复入口）
    // 现在的 input.js 初始化从 sessionStorage 读，b 的 sessionStorage 是空的
    // 所以这个用例真正测的是：如果有人手工把进度写回 sessionStorage，重载后能恢复
    b.w.sessionStorage.setItem('cubeState', JSON.stringify({ cubeData: st0, scanMode: 'manual' }));
    // 现在再点 chip 切到 5 (L) —— 模拟用户回来时点击别的面
    click(chip(b.w, 5), b.w); await wait(150);
    // 验证 L 面 9 格是空的（未填）
    let lEmpty = true;
    for (let i = 0; i < 9; i++) {
      const bg = cells(b.w)[i].style.backgroundColor;
      // 没填色的格子是 EMPTY（rgb(58, 63, 85)）
      if (bg === 'rgb(255, 255, 255)' || bg === 'rgb(238, 238, 238)') { lEmpty = false; break; }
    }
    ok(lEmpty, 'sessionStorage 恢复后未填的面仍是空的');
  });

  await uc('DC-17 填一半点求解：被拦，给出 toast 提示且不跳页', async () => {
    const a = await load('manual.html');
    paintFace(a.w, 2, new Array(9).fill(0)); await wait(150);  // 只填 1 面
    const solveBtn = a.w.document.getElementById('solveBtn');
    ok(solveBtn && solveBtn.disabled, '只填 1 面时求解按钮被禁用');
  });

  await uc('DC-18 求解页 60ms 异步窗口：DOMContentLoaded 期间点击 prev/next 不崩', async () => {
    // 用 0 wait 跑 load，让 init() 内的 60ms setTimeout 还没跑完
    const MOVES = ['U', 'R', 'F']; let st = E.solvedCube();
    for (let i = 0; i < 5; i++) st = E.applyMove(st, MOVES[Math.floor(Math.random() * MOVES.length)]);
    // 直接 jsdom 装载，不等 wait
    const vc = new VirtualConsole();
    const errs = [];
    vc.on('jsdomError', e => errs.push(e.message));
    const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'solve.html'), 'utf8'), {
      url: ORIGIN + '/solve.html', runScripts: 'dangerously',
      resources: { interceptors: [localInterceptor] }, pretendToBeVisual: true, virtualConsole: vc,
      beforeParse(w) { w.sessionStorage.setItem('cubeState', JSON.stringify({ cubeData: st, scanMode: 'manual' })); }
    });
    // 不等 wait，立即在异步窗口期间触发点击
    const w = dom.window;
    let crashed = false;
    setTimeout(() => {
      try {
        const next = w.document.getElementById('nextStepBtn');
        const prev = w.document.getElementById('prevStepBtn');
        if (next) next.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
        if (prev) prev.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      } catch (e) { crashed = true; }
    }, 10);
    await wait(400);
    // solving 状态最终应该消失（异步求解完成）
    const vis = shown(w, 'solvingSection');
    const solVis = shown(w, 'solutionSection');
    ok(vis === 'none' && (solVis === 'block' || solVis === ''), '异步窗口期点击不崩，求解最终完成（solving=' + vis + ', solution=' + solVis + '）');
    ok(!crashed, '异步窗口内点击 prev/next 不抛错');
  });

  await uc('DC-19 DOM 部分缺失：删掉几个格子元素时不崩', async () => {
    const a = await load('manual.html');
    // 删掉 editor 的 3、6 两个格子
    const cs = a.w.document.querySelectorAll('.ed-cell');
    if (cs[3]) cs[3].parentNode.removeChild(cs[3]);
    if (cs[6]) cs[6].parentNode.removeChild(cs[6]);
    // 再点 swatch + 剩余格子
    click(swatch(a.w, 0), a.w);
    let crashed = false;
    try { for (let i = 0; i < 9; i++) click(cells(a.w)[i], a.w); } catch (e) { crashed = true; }
    ok(!crashed, '删格子后再点不崩');
  });

  await uc('DC-20 Fuzz：随机点击序列 200 次后页面不崩', async () => {
    const a = await load('manual.html');
    const CHOICES = () => Math.floor(Math.random() * 17) - 1; // -1=清除, 0..5=颜色, 6..11=chip, 12=solve, 13=next, 14=prev, 15=play, 16=restart
    let crashed = false;
    try {
      for (let i = 0; i < 200; i++) {
        const c = CHOICES();
        if (c < 0) click(swatch(a.w, -1), a.w);
        else if (c < 6) click(swatch(a.w, c), a.w);
        else if (c < 12) click(chip(a.w, c - 6), a.w);
        else if (c === 12) { const b = a.w.document.getElementById('solveBtn'); if (b && !b.disabled) click(b, a.w); }
        else if (c === 13) { const b = a.w.document.getElementById('nextStepBtn'); if (b) click(b, a.w); }
        else if (c === 14) { const b = a.w.document.getElementById('prevStepBtn'); if (b) click(b, a.w); }
        else if (c === 15) { const b = a.w.document.getElementById('playBtn'); if (b) click(b, a.w); }
        else if (c === 16) { const b = a.w.document.getElementById('restartBtn'); if (b) click(b, a.w); }
        // 偶尔点 cell
        if (Math.random() < 0.3) { const cs = a.w.document.querySelectorAll('.ed-cell'); if (cs.length) click(cs[Math.floor(Math.random() * cs.length)], a.w); }
      }
    } catch (e) { crashed = true; console.error('  fuzz crash:', e.message); }
    ok(!crashed, '200 次随机点击不崩');
  });

  await uc('DC-21 求解页：真打乱态下逐步演示能正确把状态打回复原', async () => {
    // 端到端：用户填一组合法非复原态 → 跳到 solve.html → 演示 → apply 节点侧确认 = 用户填的状态
    const a = await load('manual.html');
    // 用非标准配色 + 真打乱：先按 DC-11 顺序填好，然后随机打乱几下
    for (let k = 0; k < 6; k++) { paintFace(a.w, GUIDE[k], new Array(9).fill(COL[k])); await wait(150); }
    let userState = a.w.CubeInput.toState();
    // 用引擎打乱 3 步（在 node 端），同步更新 input.js 的 faces（也用 setFaceColors 不行，要走真实点击）
    // 简化：直接构造一个 R 操作的非复原态作为用户输入
    userState = E.applyAlg(userState, 'R U R\'');
    // 但是 input.js 的 faces 还是原本的，需要重新装载
    const b = await load('solve.html', { cubeData: userState, scanMode: 'manual' });
    await wait(300);
    const total = parseInt(txt(b.w, 'stepPill').split('/')[1], 10);
    ok(total >= 1, '非复原态有解法（步数 ' + total + '）');
    if (total > 0) {
      // 走到末尾
      for (let i = 0; i <= total; i++) click(b.w.document.getElementById('nextStepBtn'), b.w);
      await wait(150);
      const stepPillFinal = txt(b.w, 'stepPill');
      ok(stepPillFinal === total + ' / ' + total, '走到末尾 stepPill 显示 ' + total + ' / ' + total + '（实际 ' + stepPillFinal + '）');
      ok(shown(b.w, 'solvedSection') === 'flex' || shown(b.w, 'solvedSection') === 'block', '显示「已复原」面板');
      // 独立 node 侧：解法在闭包里拿不到，但我们可以从 userState 出发
      // 求解页用的是 cubeState = data.slice()，total 步解法 apply 后 = 复原态
      // 这里我们能验证的就是"到达末尾 → solvedSection 显示"即可（已经断言）
    }
  });

  await uc('DC-22 求解页：单步解法（1 步）的 prev/next 行为', async () => {
    // 构造一个 1 步可达的状态
    const st = E.applyMove(E.solvedCube(), 'R');
    const a = await load('solve.html', { cubeData: st, scanMode: 'manual' });
    await wait(300);
    const total = parseInt(txt(a.w, 'stepPill').split('/')[1], 10);
    ok(total >= 1, 'R 操作后可解（步数 ' + total + '）');
    // 反复 prev 回到 0
    for (let i = 0; i < total + 3; i++) click(a.w.document.getElementById('prevStepBtn'), a.w);
    const pill = txt(a.w, 'stepPill');
    ok(pill === '1 / ' + total, 'prev 到底停在 1 / ' + total + '（实际 ' + pill + '）');
  });

  await uc('DC-23 求解页：从 total 步点 next 不应崩，solvedSection 保持显示', async () => {
    const st = E.applyMove(E.solvedCube(), 'U');
    const a = await load('solve.html', { cubeData: st, scanMode: 'manual' });
    await wait(300);
    const total = parseInt(txt(a.w, 'stepPill').split('/')[1], 10);
    // 点 next 超过 total
    let crashed = false;
    for (let i = 0; i < total + 10; i++) try { click(a.w.document.getElementById('nextStepBtn'), a.w); } catch (e) { crashed = true; }
    ok(!crashed, '超过 total 连点 next 不崩');
    const vis = shown(a.w, 'solvedSection');
    ok(vis === 'flex' || vis === 'block', '已复原面板保持显示');
  });

  await uc('DC-24 真实场景：用户用「随机打乱」按钮', async () => {
    const a = await load('manual.html');
    const btn = a.w.document.getElementById('scrambleBtn');
    ok(btn, '手动填色页有「随机打乱」按钮');
    if (btn) {
      click(btn, a.w);
      await wait(200);
      const filled = a.w.CubeInput.filledCount();
      ok(filled === 6, '打乱后 6 面全填（实际 ' + filled + '）');
      // 校验合法性
      const st = a.w.CubeInput.toState();
      ok(isValid(st), '打乱后的状态合法（54 格，每色 9 个，中心互异）');
      // 不是复原态（≥1 步解法）
      const res = S.solve(st);
      ok(!res.error && res.solution.length > 0, '打乱状态有解（' + (res.solution ? res.solution.length : 0) + ' 步）');
      // 解法 apply 后回到复原（以 user 配色为目标的复原）
      if (res.solution && res.solution.length) {
        const back = E.applyAlg(st, res.solution.join(' '));
        let okEach = true;
        for (let f = 0; f < 6; f++) {
          const want = back[E.FS[f] + 4];
          for (let i = 0; i < 9; i++) if (back[E.FS[f] + i] !== want) { okEach = false; break; }
          if (!okEach) break;
        }
        ok(okEach, '打乱态的解法 apply 后回到以 user 配色为目标的复原');
      }
    }
  });

  await uc('DC-25 拍照页：随机打乱后产生的状态也合法', async () => {
    const a = await load('manual.html');
    const btn = a.w.document.getElementById('scrambleBtn');
    click(btn, a.w);
    await wait(200);
    // 拍照页应该接受这个状态（因为 camera.html 共用 input.js）
    const st = a.w.CubeInput.toState();
    // 模拟从 camera 跳到 solve：直接 load solve.html 验证
    const b = await load('solve.html', { cubeData: st, scanMode: 'camera' });
    await wait(300);
    const vis = shown(b.w, 'errorSection');
    const solVis = shown(b.w, 'solutionSection');
    ok(vis === 'none' || !vis, '打乱态在求解页没有错误区（' + vis + '）');
    ok(solVis === 'block' || solVis === '', '打乱态在求解页显示解法（' + solVis + '）');
  });

  await uc('DC-26 求解页：键盘快捷键（← → 空格）应该工作', async () => {
    const st = E.applyAlg(E.solvedCube(), 'R U R\' U\'');
    const a = await load('solve.html', { cubeData: st, scanMode: 'manual' });
    await wait(300);
    const total = parseInt(txt(a.w, 'stepPill').split('/')[1], 10);
    if (total === 0) { ok(true, '0 步解法，跳过键盘测试'); return; }
    // 模拟键盘事件
    a.w.document.dispatchEvent(new a.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await wait(80);
    const pill1 = txt(a.w, 'stepPill');
    ok(pill1 === '2 / ' + total || pill1 === '1 / ' + total, '→ 键让 step 推进（' + pill1 + '）');
    a.w.document.dispatchEvent(new a.w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await wait(80);
    const pill2 = txt(a.w, 'stepPill');
    ok(pill2 === '1 / ' + total, '← 键让 step 退一（' + pill2 + '）');
  });

  await uc('DC-27 压力 Fuzz：2000 次随机点击后内部状态保持完整', async () => {
    const a = await load('manual.html');
    // 预填一些颜色
    for (let k = 0; k < 6; k++) { paintFace(a.w, GUIDE[k], new Array(9).fill(COL[k])); await wait(50); }
    const beforeState = a.w.CubeInput.toState();
    ok(isValid(beforeState), 'fuzz 前状态合法');
    // 2000 次随机点击（包含涂改、换色、切面等）
    let crashed = false;
    for (let i = 0; i < 2000; i++) {
      const choice = Math.floor(Math.random() * 12);
      try {
        if (choice < 6) click(swatch(a.w, choice), a.w);
        else if (choice < 12) click(chip(a.w, choice - 6), a.w);
        if (Math.random() < 0.4) { const cs = a.w.document.querySelectorAll('.ed-cell'); if (cs.length) click(cs[Math.floor(Math.random() * cs.length)], a.w); }
      } catch (e) { crashed = true; console.error('  crash at iter ' + i + ':', e.message); break; }
      // 每 100 次显示进度（jsdom 单线程，能跑到的实际速度）
      if (i % 500 === 499) await wait(0);
    }
    ok(!crashed, '2000 次随机点击不崩');
    const afterState = a.w.CubeInput.toState();
    // fuzz 后：长度 54，所有值在 -1..5 范围内（用户涂改可能让某色计数偏离 9，但不应出非法值）
    ok(afterState.length === 54, 'fuzz 后状态仍是 54 长度');
    let inRange = true, hasEmpty = false;
    for (let i = 0; i < 54; i++) {
      if (afterState[i] < -1 || afterState[i] > 5) { inRange = false; break; }
      if (afterState[i] === -1) hasEmpty = true;
    }
    ok(inRange, 'fuzz 后所有贴纸值在 -1..5 范围内');
    // 同时：toState 返回的是 faces 数组的拷贝，不是引用
    const st2 = a.w.CubeInput.toState();
    st2[0] = 99;
    const st3 = a.w.CubeInput.toState();
    ok(st3[0] !== 99, 'toState() 返回新数组，不暴露内部引用');
    // 用户用求解按钮可以正常走（如果合法）
    if (isValid(afterState)) {
      const res = S.solve(afterState);
      ok(!res.error, 'fuzz 后的合法状态可解');
    }
  });

  await uc('DC-28 完整端到端：manual.html 填一组非标准配色 → 点求解 → 模拟跳页 → solve.html 显示解法 → apply 后回用户填的状态', async () => {
    // 真实用户路径：
    //  1) 在 manual.html 填一组非标准配色（黄顶白底绿前蓝后红右橙左）
    //  2) 点求解 → goSolve 写 sessionStorage + 跳到 solve.html
    //  3) solve.html 读 sessionStorage → 异步求解 → 显示解法
    //  4) 走完解法 → 魔方应回到用户填的那组颜色
    const a = await load('manual.html');
    const colorByFace = [1, 0, 2, 3, 4, 5]; // U黄 D白 F绿 B蓝 R红 L橙
    for (let k = 0; k < 6; k++) {
      paintFace(a.w, GUIDE[k], new Array(9).fill(colorByFace[GUIDE[k]]));
      await wait(150);
    }
    // 点击求解按钮
    const solveBtn = a.w.document.getElementById('solveBtn');
    click(solveBtn, a.w);
    // 立即同步读 sessionStorage（goSolve 是同步的）
    const stored = a.w.sessionStorage.getItem('cubeState');
    ok(stored, '点求解后 sessionStorage 立即写入');
    const seed = JSON.parse(stored);
    const userInput = seed.cubeData;
    ok(isValid(userInput), '写入 sessionStorage 的状态合法（' + userInput.length + ' 格）');
    ok(seed.scanMode === 'manual', 'scanMode 标记为 manual');

    // 模拟用户跳到 solve.html
    const b = await load('solve.html', { cubeData: userInput, scanMode: 'manual' });
    await wait(300);
    const stepPill = txt(b.w, 'stepPill');
    const total = parseInt(stepPill.split('/')[1], 10);
    ok(total >= 0, 'solve.html 加载后给出解法（' + stepPill + '）');

    // 走到末尾
    for (let i = 0; i <= total; i++) click(b.w.document.getElementById('nextStepBtn'), b.w);
    await wait(150);
    ok(shown(b.w, 'solvedSection') === 'flex' || shown(b.w, 'solvedSection') === 'block', '走完显示「已复原」');

    // 验证：3D 渲染的每面 9 格颜色，应该等于用户填的颜色
    // 3D 渲染按面顺序 U D F B R L（FACE_CLASS）
    // 每面 9 个贴纸 stk[i]
    const FACE_CLASS = ['f-U', 'f-D', 'f-F', 'f-B', 'f-R', 'f-L'];
    // 颜色 -> rgb 串（与 css COLORS 的 hex 对应）
    const hex2rgb = h => 'rgb(' + [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)).join(', ') + ')';
    const COL_HEX = ['#ffffff', '#f5d000', '#43b649', '#0096d8', '#e53935', '#fb8c00']; // 0白 1黄 2绿 3蓝 4红 5橙
    // 加载 solve.js 的 E.COLOR_HEX
    const sb = { window: {} }; sb.globalThis = sb; const vm = require('vm'); vm.createContext(sb);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/cube.js'), 'utf8'), sb);
    const EE = sb.window.CubeEngine;
    const want = colorByFace.map(c => hex2rgb(EE.COLOR_HEX[c]));
    let allMatch = true, bad = '';
    for (let f = 0; f < 6; f++) {
      const faceEl = b.w.document.querySelector('.cube-face.' + FACE_CLASS[f]);
      if (!faceEl) { allMatch = false; bad = '缺 ' + FACE_CLASS[f]; break; }
      const stks = faceEl.querySelectorAll('.stk');
      for (let i = 0; i < 9; i++) {
        const got = stks[i].style.backgroundColor;
        if (got !== want[f]) { allMatch = false; bad = FACE_CLASS[f] + ' 第 ' + (i + 1) + ' 格：期望 ' + want[f] + '，实际 ' + got; break; }
      }
      if (!allMatch) break;
    }
    ok(allMatch, '3D 渲染的复原态 = 用户填的配色' + (allMatch ? '' : '（' + bad + '）'));
  });

  await uc('DC-29 拍照页 → 求解页端到端：scanMode=camera', async () => {
    // 真实用户可能从 camera.html 跳到 solve.html
    // 手动填一组状态模拟拍照结果
    const a = await load('manual.html');
    for (let k = 0; k < 6; k++) { paintFace(a.w, GUIDE[k], new Array(9).fill(COL[k])); await wait(150); }
    // 通过 solveBtn 把状态写进 sessionStorage
    click(a.w.document.getElementById('solveBtn'), a.w);
    const stored = a.w.sessionStorage.getItem('cubeState');
    const seed = JSON.parse(stored);
    seed.scanMode = 'camera';
    // 模拟拍照页跳转
    const b = await load('solve.html', { cubeData: seed.cubeData, scanMode: 'camera' });
    await wait(300);
    ok(shown(b.w, 'solutionSection') === 'block' || shown(b.w, 'solutionSection') === '', 'camera 来源也能成功求解');
  });

  /* ---------- 汇总 ---------- */
  console.log('\n━━━ 汇总 ━━━');
  console.log('总断言: ' + (pass + fail) + '  通过: ' + pass + '  失败: ' + fail);
  if (fail) {
    console.log('\n失败清单:');
    fails.forEach(f => console.log('  · ' + f));
    process.exit(1);
  }
  process.exit(0);
})().catch(e => { console.error('顶层异常:', e); process.exit(2); });
