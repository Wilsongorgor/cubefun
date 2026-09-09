'use strict';
/*
 * 「报错后能回去改」专项黑盒测试。
 *
 * 背景：以前在 solve.html 上看到"算不出解法"，唯一的出路是「重新填色」，
 * 一按就回到空白页，54 格全丢，只能从头再填一遍 —— 用户抱怨体验太差。
 *
 * 现在的预期行为：
 *   1) 六个面的颜色随时存进 sessionStorage 草稿（CubeInputStore）；
 *   2) 报错页画出用户填进去的魔方 + 「返回修改」按钮（保留颜色）；
 *   3) 回到填色页自动恢复草稿，并把可疑格子标红；
 *   4) 改完再求解，能算出解法。
 *
 *   node tests/recover.test.js
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

/* ---------- node 侧引擎 ---------- */
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
async function uc(name, fn) {
  section('UC: ' + name);
  try { await fn(); } catch (e) { fail++; fails.push(name + ' 异常: ' + e.message); console.error('  EXC :', e.message); }
}

const click = (el, w) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const chip = (w, f) => w.document.querySelector('.face-chip[data-face="' + f + '"]');
const swatch = (w, c) => w.document.querySelector('.swatch-btn[data-color="' + c + '"]');
const cells = w => w.document.querySelectorAll('.ed-cell');
const txt = (w, id) => (w.document.getElementById(id) || {}).textContent || '';
const shown = (w, id) => (w.document.getElementById(id) || {}).style.display;
const qsa = (w, sel) => Array.from(w.document.querySelectorAll(sel));
const norm = c => String(c).replace(/\s/g, '');

/** store: { cubeState: {...}, cubeInput: {...} } —— 模拟从上一页带过来的 sessionStorage */
async function load(page, store) {
  const vc = new VirtualConsole();
  const errs = [];
  const navs = [];   // jsdom 不实现跳转，但会报 "Not implemented: navigation"，拿它当"确实点了跳页"的证据
  vc.on('jsdomError', e => { errs.push(e.message); if (/navigation/i.test(e.message)) navs.push(e.message); });
  vc.on('error', (...a) => errs.push(a.join(' ')));
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, page), 'utf8'), {
    url: ORIGIN + '/' + page,
    runScripts: 'dangerously',
    resources: { interceptors: [localInterceptor] },
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      if (!store) return;
      Object.keys(store).forEach(k => w.sessionStorage.setItem(k, JSON.stringify(store[k])));
    }
  });
  await wait(500);
  return {
    dom, w: dom.window, navs,
    errs: () => errs.filter(m => !/Not implemented: navigation/.test(m))
  };
}

const draft = w => {
  try { return JSON.parse(w.sessionStorage.getItem('cubeInput')); } catch (e) { return null; }
};
const cubeState = w => {
  try { return JSON.parse(w.sessionStorage.getItem('cubeState')); } catch (e) { return null; }
};

function paintFace(w, f, nine) {
  click(chip(w, f), w);
  for (let i = 0; i < 9; i++) {
    click(swatch(w, nine[i]), w);
    click(cells(w)[i], w);
  }
}

/** 六面各填一色（标准西式配色），再把 F 左上角和 R 左上角互换 —— 形式合法但无解 */
const SOLVED_FACES = [0, 1, 2, 3, 4, 5];
async function fillUnsolvable(w) {
  for (let f = 0; f < 6; f++) { paintFace(w, f, new Array(9).fill(SOLVED_FACES[f])); await wait(60); }
  click(chip(w, 2), w); click(swatch(w, 4), w); click(cells(w)[0], w);   // F 左上 -> 红
  click(chip(w, 4), w); click(swatch(w, 2), w); click(cells(w)[0], w);   // R 左上 -> 绿
  await wait(80);
}

// jsdom 会把 #rrggbb 归一化成 rgb(r, g, b)，断言要按 rgb 写
const RGB = ['rgb(255,255,255)', 'rgb(255,213,0)', 'rgb(0,177,106)', 'rgb(0,81,186)', 'rgb(183,18,52)', 'rgb(255,88,0)'];

/** 走一遍真实流程：填一个无解的魔方并点求解，拿到 (cubeState, 草稿) —— 供 solve.html 用 */
async function makeBroken() {
  const a = await load('manual.html');
  await fillUnsolvable(a.w);
  click(a.w.document.getElementById('solveBtn'), a.w);
  await wait(200);
  return { cubeState: cubeState(a.w), cubeInput: draft(a.w) };
}

/** 报错后的完整现场：solve.html 已经把 bad 写进草稿。返回 load() 的结果（带 .w / .navs） */
async function makeFailedSolve() {
  const b = await makeBroken();
  const s = await load('solve.html', { cubeState: b.cubeState, cubeInput: b.cubeInput });
  await wait(300);
  s.seeded = b;
  return s;
}

/* ================= 用例 ================= */

(async () => {

  // 先确认这个样例确实"形式上合法、但解不出来"
  await uc('RC-00 前提：交换两个角块贴纸后，validate 通过但求解失败', async () => {
    const st = E.solvedCube();
    st[E.FS[2] + 0] = 4; st[E.FS[4] + 0] = 2;
    ok(E.validate(st).ok, '交换后仍然形式合法（每色 9 个、中心互异）');
    const r = S.solve(st);
    ok(!!r.error, '求解失败（真的无解，不是被 validate 拦下）');
    ok(Array.isArray(r.bad) && r.bad.length > 0, '给出了可疑格子下标：' + JSON.stringify(r.bad));
    ok(Array.isArray(r.suspectFaces) && r.suspectFaces.length > 0, '给出了可疑面：' + JSON.stringify(r.suspectFaces));
    ok(r.bad.indexOf(E.FS[2] + 0) >= 0 && r.bad.indexOf(E.FS[4] + 0) >= 0, '可疑格子里包含真正填错的那两格');
  });

  await uc('RC-01 填色过程会实时存草稿：点求解后 sessionStorage 里有六个面', async () => {
    const a = await load('manual.html');
    await fillUnsolvable(a.w);
    const d = draft(a.w);
    ok(d && Array.isArray(d.faces) && d.faces.length === 6, '草稿里有六个面');
    ok(d.faces.every(f => f.indexOf(-1) < 0), '六个面都填满了（没有 -1）');
    ok(d.faces[2][0] === 4 && d.faces[4][0] === 2, '草稿里记下了被改坏的两格');
    click(a.w.document.getElementById('solveBtn'), a.w);
    await wait(200);
    const cs = cubeState(a.w);
    ok(cs && cs.cubeData && cs.cubeData.length === 54, '点求解后同时写入了 cubeState');
  });

  await uc('RC-02 报错页不再是死路：有返回修改 / 全部重来，还有魔方预览', async () => {
    const st = E.solvedCube();
    st[E.FS[2] + 0] = 4; st[E.FS[4] + 0] = 2;
    const a = await load('solve.html', { cubeState: { cubeData: st, scanMode: 'manual' } });
    await wait(300);
    ok(shown(a.w, 'errorSection') !== 'none', '显示了错误区');
    ok(txt(a.w, 'errorText').length > 10, '错误文案非空');
    ok(!!a.w.document.getElementById('backEditBtn'), '有「返回修改」按钮');
    ok(!!a.w.document.getElementById('restartInputBtn'), '有「六面全部重来」按钮');
    ok(!a.w.document.querySelector('#errorSection a[href="manual.html"].btn-primary'), '不再是那个一按就清空的「重新填色」链接');
    const faces = qsa(a.w, '#errorCube3d .cube-face');
    ok(faces.length === 6, '错误页画出了 6 个面的魔方（' + faces.length + '）');
    const stks = qsa(a.w, '#errorCube3d .stk');
    ok(stks.length === 54, '预览魔方有 54 格（' + stks.length + '）');
    ok(norm(stks[E.FS[2] + 0].style.backgroundColor) === RGB[4], '预览里 F 左上角是用户填的红色：' + stks[E.FS[2] + 0].style.backgroundColor);
  });

  await uc('RC-03 报错时把可疑面标红，并把可疑格子写进草稿', async () => {
    const st = E.solvedCube();
    st[E.FS[2] + 0] = 4; st[E.FS[4] + 0] = 2;
    const a = await load('solve.html', { cubeState: { cubeData: st, scanMode: 'manual' } });
    await wait(300);
    const red = qsa(a.w, '#errorCube3d .cube-face.has-error');
    ok(red.length > 0, '有面被标红（' + red.length + ' 个）');
    const d = draft(a.w);
    ok(d && Array.isArray(d.bad) && d.bad.length > 0, '草稿里写入了可疑格子（' + (d ? d.bad.length : 0) + ' 个）');
    ok(d && /重点检查|无法还原/.test(d.msg), '草稿里带了错误说明');
  });

  await uc('RC-04 回到填色页：颜色原样恢复（不用重新填一遍）', async () => {
    const a = await load('manual.html');
    await fillUnsolvable(a.w);
    const d = draft(a.w);
    // 模拟用户点了「返回修改」—— 新开一个填色页，草稿从 sessionStorage 带过来
    const b = await load('manual.html', { cubeInput: d });
    ok(/6\s*\/\s*6/.test(txt(b.w, 'cubeProgress')), '进度条显示已填 6 / 6（' + txt(b.w, 'cubeProgress') + '）');
    const btn = b.w.document.getElementById('solveBtn');
    ok(btn && !btn.disabled, '求解按钮立刻可用（不需要填满才能点）');
    const want = RGB;
    let same = true;
    for (let f = 0; f < 6; f++) {
      click(chip(b.w, f), b.w);
      const cs = cells(b.w);
      for (let i = 0; i < 9; i++) {
        if (i === 0 && (f === 2 || f === 4)) continue;   // 这两格被故意改坏了
        if (norm(cs[i].style.backgroundColor) !== want[f]) same = false;
      }
    }
    ok(same, '六个面的颜色和之前填的一致');
    click(chip(b.w, 2), b.w);
    ok(norm(cells(b.w)[0].style.backgroundColor) === RGB[4], 'F 左上角还是被改坏时的红色：' + cells(b.w)[0].style.backgroundColor);
  });

  await uc('RC-05 恢复后直接告诉用户哪里可疑：提示条 + 红框 + 面按钮标红', async () => {
    const f = await makeFailedSolve();
    const b = await load('manual.html', { cubeInput: draft(f.w) });
    const banner = b.w.document.getElementById('fixBanner');
    ok(banner && banner.style.display === 'block', '顶部提示条显示出来了');
    ok(/上次没能算出解法/.test(banner.textContent), '提示条说明这是上一次没算出来的那版：' + banner.textContent.slice(0, 30));
    ok(qsa(b.w, '.face-chip.has-error').length > 0, '面切换按钮上有可疑标记');
    ok(qsa(b.w, '.cube-face.has-error').length > 0, '3D 魔方上有可疑面被标红');
    // 会直接跳到可疑格子最多的那一面
    const af = b.w.CubeInput.getActiveFace();
    const badHere = b.w.CubeInput.getBad().filter(p => p[0] === af).length;
    ok(badHere > 0, '自动跳到了可疑格子最多的那一面（第 ' + af + ' 面，' + badHere + ' 格）');
    ok(qsa(b.w, '.ed-cell.is-bad').length === badHere, '九宫格里标红的格子数 = 该面可疑格数（' + badHere + '）');
  });

  await uc('RC-06 「清除红框」按钮能把标记去掉', async () => {
    const f = await makeFailedSolve();
    const b = await load('manual.html', { cubeInput: draft(f.w) });
    ok(qsa(b.w, '.ed-cell.is-bad').length > 0, '清除前有红框');
    click(b.w.document.getElementById('fixClearBtn'), b.w);
    await wait(60);
    ok(qsa(b.w, '.ed-cell.is-bad').length === 0, '清除后没有红框了');
    ok(b.w.document.getElementById('fixBanner').style.display === 'none', '提示条也收起来了');
    // 颜色还在，只是不标红了
    ok(/6\s*\/\s*6/.test(txt(b.w, 'cubeProgress')), '清除标记不会把颜色也清掉');
  });

  await uc('RC-07 改掉一个可疑格，那一格的红框就消失', async () => {
    const f = await makeFailedSolve();
    const b = await load('manual.html', { cubeInput: draft(f.w) });
    click(chip(b.w, 2), b.w);
    const before = qsa(b.w, '.ed-cell.is-bad').length;
    ok(before > 0, 'F 面有 ' + before + ' 个红框');
    click(swatch(b.w, 2), b.w);        // 选回绿色
    click(cells(b.w)[0], b.w);         // 改掉左上角
    await wait(60);
    ok(!cells(b.w)[0].classList.contains('is-bad'), '改过的那一格（F 左上角）不再标红');
    ok(qsa(b.w, '.ed-cell.is-bad').length === before - 1, '红框少了一个（' + before + ' -> ' + qsa(b.w, '.ed-cell.is-bad').length + '）');
    ok(draft(b.w).bad.filter(p => p[0] === 2 && p[1] === 0).length === 0, '草稿里这一格也不再可疑');
  });

  await uc('RC-08b 「返回修改」真的会跳回填色页，而且不丢草稿', async () => {
    const f = await makeFailedSolve();
    ok(f.navs.length === 0, '加载时没有多余的跳转');
    click(f.w.document.getElementById('backEditBtn'), f.w);
    await wait(150);
    ok(f.navs.length === 1, '点「返回修改」触发了一次跳转（' + f.navs.length + ' 次）');
    const d = draft(f.w);
    ok(d && d.faces && d.faces.every(x => x.indexOf(-1) < 0), '跳转不会把六面颜色清掉');
    ok(d && d.bad.length > 0, '跳转后草稿里仍然带着可疑格子（回去能标红）');
  });

  await uc('RC-08 「六面全部重来」才是真的清空', async () => {
    const f = await makeFailedSolve();
    ok(draft(f.w) !== null, '报错后草稿存在');
    let crashed = false;
    try { click(f.w.document.getElementById('restartInputBtn'), f.w); } catch (e) { crashed = true; }
    await wait(120);
    ok(!crashed, '点按钮不崩（jsdom 里跳转未实现也不该抛异常）');
    ok(f.navs.length === 1, '点「全部重来」也触发了一次跳转');
    ok(draft(f.w) === null, '点「六面全部重来」后草稿被清掉');
    // 重来之后打开填色页应该是空白
    const b = await load('manual.html');
    ok(/0\s*\/\s*6/.test(txt(b.w, 'cubeProgress')), '填色页回到 0 / 6（' + txt(b.w, 'cubeProgress') + '）');
  });

  await uc('RC-09 求解成功时会把上次留下的红框清掉', async () => {
    const st = E.solvedCube();
    st[E.FS[2] + 0] = 4; st[E.FS[4] + 0] = 2;
    const bad = await load('solve.html', { cubeState: { cubeData: st, scanMode: 'manual' }, cubeInput: { faces: null, active: 2, bad: [[0, 1]], msg: 'x' } });
    await wait(300);
    ok(draft(bad.w).bad.length > 0, '失败时 bad 被写进草稿');

    let s2 = E.solvedCube();
    s2 = E.applyAlg(s2, "R U R' U'");
    const good = await load('solve.html', {
      cubeState: { cubeData: s2, scanMode: 'manual' },
      cubeInput: { faces: null, active: 2, bad: [[0, 1], [2, 3]], msg: '上次失败' }
    });
    await wait(400);
    ok(shown(good.w, 'errorSection') === 'none', '这次求解成功');
    const d = draft(good.w);
    ok(d && d.bad.length === 0, '成功后草稿里的红框被清空（' + (d ? d.bad.length : '?') + '）');
  });

  await uc('RC-10 求解页的「‹ 返回」回到填色页，而不是首页', async () => {
    const st = E.solvedCube();
    st[E.FS[2] + 0] = 4; st[E.FS[4] + 0] = 2;
    const m = await load('solve.html', { cubeState: { cubeData: st, scanMode: 'manual' } });
    await wait(300);
    const href = m.w.document.querySelector('.nav-back').getAttribute('href');
    ok(href === 'manual.html', '手动填色来的 → 返回 manual.html（' + href + '）');

    const c = await load('solve.html', { cubeState: { cubeData: st, scanMode: 'camera' } });
    await wait(300);
    const href2 = c.w.document.querySelector('.nav-back').getAttribute('href');
    ok(href2 === 'camera.html', '拍照识别来的 → 返回 camera.html（' + href2 + '）');
  });

  await uc('RC-11 拍照页同样能恢复草稿', async () => {
    const f = await makeFailedSolve();
    const b = await load('camera.html', { cubeInput: draft(f.w) });
    ok(/6\s*\/\s*6/.test(txt(b.w, 'cubeProgress')), '拍照页也恢复成 6 / 6（' + txt(b.w, 'cubeProgress') + '）');
    ok(b.w.document.getElementById('fixBanner').style.display === 'block', '拍照页也有提示条');
    ok(qsa(b.w, '.ed-cell.is-bad').length > 0, '拍照页也标红了可疑格');
  });

  await uc('RC-12 「清空」按钮把草稿一起清掉', async () => {
    const a = await load('manual.html');
    await fillUnsolvable(a.w);
    ok(draft(a.w).faces[0].indexOf(-1) < 0, '清空前草稿是满的');
    click(a.w.document.getElementById('resetBtn'), a.w);
    await wait(80);
    const d = draft(a.w);
    ok(d.faces.every(f => f.indexOf(-1) >= 0), '清空后草稿也是空的');
    ok(d.bad.length === 0, '红框一起清掉');
  });

  await uc('RC-13 草稿损坏时 quietly 退回空白，不崩', async () => {
    const bads = [
      { faces: 'not an array', active: 2, bad: [], msg: '' },
      { faces: [[1, 2], [1, 2]], active: 2, bad: [], msg: '' },
      { faces: new Array(6).fill(new Array(9).fill(9)), active: 2, bad: [], msg: '' }
    ];
    for (let i = 0; i < bads.length; i++) {
      const b = await load('manual.html', { cubeInput: bads[i] });
      ok(/0\s*\/\s*6/.test(txt(b.w, 'cubeProgress')), '坏草稿 #' + (i + 1) + ' 退回 0 / 6（' + txt(b.w, 'cubeProgress') + '）');
      ok(b.errs().length === 0, '坏草稿 #' + (i + 1) + ' 没有脚本报错：' + b.errs().join(' | '));
    }
  });

  await uc('RC-14 没读到魔方数据时，不要留下莫名其妙的红条', async () => {
    const a = await load('solve.html', { cubeState: { cubeData: null, scanMode: 'manual' } });
    await wait(250);
    ok(shown(a.w, 'errorSection') !== 'none', '显示了「没有读到魔方数据」');
    ok(draft(a.w) === null, '没有往草稿里写 bad/msg（否则下次进填色页会看到无意义的红条）');
    ok(qsa(a.w, '#errorScene .cube-face').length === 0, '没有数据时也不画预览魔方');
  });

  await uc('RC-15 中途退出再回来：填了 3 面也不会丢', async () => {
    const a = await load('manual.html');
    paintFace(a.w, 2, new Array(9).fill(2)); await wait(60);
    paintFace(a.w, 4, new Array(9).fill(4)); await wait(60);
    paintFace(a.w, 3, new Array(9).fill(3)); await wait(60);
    ok(/3\s*\/\s*6/.test(txt(a.w, 'cubeProgress')), '填了 3 面（' + txt(a.w, 'cubeProgress') + '）');
    const b = await load('manual.html', { cubeInput: draft(a.w) });
    ok(/3\s*\/\s*6/.test(txt(b.w, 'cubeProgress')), '回来还是 3 面（' + txt(b.w, 'cubeProgress') + '）');
    click(chip(b.w, 2), b.w);
    ok(norm(cells(b.w)[0].style.backgroundColor) === 'rgb(0,177,106)', '前面还是绿色');
  });

  await uc('RC-16 完整闭环：报错 → 返回修改 → 改对 → 再求解 → 出解法', async () => {
    const a = await load('manual.html');
    await fillUnsolvable(a.w);
    const badState = cubeState(a.w);   // 点求解之前先手动触发一次
    click(a.w.document.getElementById('solveBtn'), a.w);
    await wait(200);
    const cs = cubeState(a.w);
    ok(cs && cs.cubeData, '拿到了填错的魔方数据');

    const s = await load('solve.html', { cubeState: cs, cubeInput: draft(a.w) });
    await wait(300);
    ok(shown(s.w, 'errorSection') !== 'none', '第一步：求解失败并给出提示');

    // 用户点「返回修改」
    const b = await load('manual.html', { cubeInput: draft(s.w) });
    ok(/6\s*\/\s*6/.test(txt(b.w, 'cubeProgress')), '第二步：回到填色页，六面都还在');

    // 照着红框把两格改回正确颜色
    click(chip(b.w, 2), b.w); click(swatch(b.w, 2), b.w); click(cells(b.w)[0], b.w);
    click(chip(b.w, 4), b.w); click(swatch(b.w, 4), b.w); click(cells(b.w)[0], b.w);
    await wait(80);
    click(b.w.document.getElementById('solveBtn'), b.w);
    await wait(200);
    const cs2 = cubeState(b.w);
    const back = cs2.cubeData.slice();
    let solved = true;
    for (let f = 0; f < 6; f++) {
      const want = back[E.FS[f] + 4];
      for (let i = 0; i < 9; i++) if (back[E.FS[f] + i] !== want) { solved = false; break; }
    }
    ok(solved, '第三步：改完之后状态确实是复原态（改对了）');

    const s2 = await load('solve.html', { cubeState: cs2, cubeInput: draft(b.w) });
    await wait(400);
    ok(shown(s2.w, 'errorSection') === 'none', '第四步：重新求解不再报错');
    ok(/0\s*\/\s*0/.test(txt(s2.w, 'stepPill')), '复原态 → 0 / 0 步（' + txt(s2.w, 'stepPill') + '）');
  });

  await uc('RC-17 恢复草稿不会引入脚本错误', async () => {
    const f = await makeFailedSolve();
    const b = await load('manual.html', { cubeInput: draft(f.w) });
    await wait(200);
    ok(b.errs().length === 0, 'manual.html 恢复过程无脚本错误：' + b.errs().join(' | '));
    const c = await load('camera.html', { cubeInput: draft(f.w) });
    await wait(200);
    ok(c.errs().length === 0, 'camera.html 恢复过程无脚本错误：' + c.errs().join(' | '));
  });

  console.log('\n━━━ 汇总 ━━━');
  console.log('总断言: ' + (pass + fail) + '  通过: ' + pass + '  失败: ' + fail);
  if (fail) { console.log('\n失败项：'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
})();
