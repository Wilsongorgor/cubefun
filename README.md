# 乐玩魔方 🧊

一个纯前端的三阶魔方还原助手。把魔方六个面的颜色告诉它，它还你一组可以照着做的还原步骤。

**没有后端、没有构建、没有账号** —— 打开网页就能用，求解在本地浏览器里完成。

## 功能

- **📷 拍照识别**：对准魔方，九宫格实时显示识别到的颜色，一键读入整面
- **✍️ 手动填色**：在六面展开图上点格子填色，选好颜色连续点就行
- **🧊 3D 预览**：可拖动旋转的立体魔方，与展开图实时同步
- **▶️ 分步演示**：每一步都显示「转动前」的样子，并用黄色高亮标出这一步要转的面，支持自动播放与键盘操作
- **⚡ 平均 20 步**：Kociemba 两阶段算法，通常 19–21 步

## 在线体验

用 GitHub Pages 托管，推送到 `master` 后自动生效。

## 本地运行

因为用到了摄像头，浏览器只在 **https** 或 **localhost** 下才允许调用，所以请不要直接双击 `index.html`，而是起一个本地服务：

```bash
# 任选一种
python -m http.server 8000
npx serve .
```

然后打开 <http://localhost:8000>。

## 目录结构

```
index.html          首页
manual.html         手动填色
camera.html         拍照识别
solve.html          还原步骤演示
css/styles.css      样式
js/cube.js          魔方引擎：54 贴纸状态 + 18 种转动的置换表
js/min2phase.js     Kociemba 两阶段算法（vendored，来自 cs0x7f/min2phase）
js/solver.js        求解桥接：颜色状态 → facelet 串 → 解法 + 中文步骤描述
js/input.js         输入模块：六面展开图 + 3D 预览 + 调色板（两个输入页共用）
js/camera.js        摄像头取色与颜色归类
js/solve.js         解法分步播放
js/app.js           跨页面状态（sessionStorage）
tests/              测试
```

## 展开图的约定

六面展开图就是魔方拆开摊平的样子，可直接折叠成立体：

```
        ┌───┐
        │ U │        上面
    ┌───┼───┼───┬───┐
    │ L │ F │ R │ B │    左 · 前 · 右 · 后
    └───┼───┼───┴───┘
        │ D │        下面
        └───┘
```

贴纸下标采用 Kociemba 标准 facelet 顺序（每面 0–8，从左上角按行读），
U 面的上边贴着 B、F 面的上边贴着 U，以此类推。

## 测试

```bash
npm install     # 只装 jsdom，用于页面测试
npm test
```

- `tests/engine.test.js`：转动表自洽性（转 4 次复原、互逆、中心不动）、
  非法状态的错误处理、**100 个随机打乱的端到端求解**
- `tests/pages.test.js`：用 jsdom 加载真实页面，检查 DOM 结构与完整交互链路

其中有一条测试专门盯着一个曾经出现过的 BUG：min2phase 遇到非法魔方状态时会
**静默返回空串**，如果直接当成「0 步解法」就会误报「已还原」。
现在 `js/solver.js` 会把解法真的转一遍验证，验证不过就明确报错。

## 浏览器支持

需要支持 CSS 3D Transform 与 Pointer Events 的现代浏览器。
摄像头识别要求 HTTPS 环境（localhost 除外）。

## 第三方

- [min2phase](https://github.com/cs0x7f/min2phase) — Kociemba 两阶段算法实现
