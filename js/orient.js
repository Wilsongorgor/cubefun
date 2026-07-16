/* ===== 魔方朝向跟踪（整魔方旋转） =====
 * 物理魔方的 6 个面是固定的：U(0) D(1) F(2) B(3) R(4) L(5)
 * 我们用一个映射 faceAt[slot] 记录“当前朝向（前/上/右…）对应物理上的哪个面”。
 * 初始时：前=F, 上=U, 右=R, 左=L, 下=D, 后=B
 *
 * 用户把实体魔方“向右转”等，等价于整魔方旋转（whole-cube rotation）：
 *  - 向右翻转 (Y')：原右面转到前面，原前面转到左面，原左面转到后面，原后面转到右面；上下面不动
 *  - 向左翻转 (Y )：相反
 *  - 向上翻转 (X' )：原上面转到前面，原前面转到下面，原下面转到后面，原后面转到上面；左右面不动
 *  - 向下翻转 (X  )：相反
 */

var CubeOrient = (function () {
  // slot 顺序固定： [U, D, F, B, R, L]
  var U = 0, D = 1, F = 2, B = 3, R = 4, L = 5;

  function identity() {
    return [U, D, F, B, R, L];
  }

  // 整魔方向右翻转 (Y')：右面转到前面
  // 新前=旧右, 新右=旧后, 新后=旧左, 新左=旧前, 上下不变
  // slot 顺序 [U,D,F,B,R,L]
  function rotRight(faceAt) {
    // [U,D,F,B,R,L] -> [U, D, oldR, oldL, oldB, oldF]
    return [faceAt[0], faceAt[1], faceAt[4], faceAt[5], faceAt[3], faceAt[2]];
  }
  function rotLeft(faceAt) {
    // [U,D,F,B,R,L] -> [U, D, oldL, oldR, oldF, oldB]
    return [faceAt[0], faceAt[1], faceAt[5], faceAt[4], faceAt[2], faceAt[3]];
  }
  function rotUp(faceAt) {
    // [U,D,F,B,R,L] -> [oldB, oldF, oldU, oldD, oldR, oldL]
    return [faceAt[3], faceAt[2], faceAt[0], faceAt[1], faceAt[4], faceAt[5]];
  }
  function rotDown(faceAt) {
    // [U,D,F,B,R,L] -> [oldF, oldB, oldD, oldU, oldR, oldL]
    return [faceAt[2], faceAt[3], faceAt[1], faceAt[0], faceAt[4], faceAt[5]];
  }

  // 当前朝向对应到物理面索引
  function front(faceAt) { return faceAt[F]; }
  function up(faceAt) { return faceAt[U]; }
  function right(faceAt) { return faceAt[R]; }
  function left(faceAt) { return faceAt[L]; }
  function down(faceAt) { return faceAt[D]; }
  function back(faceAt) { return faceAt[B]; }

  return {
    U: U, D: D, F: F, B: B, R: R, L: L,
    identity: identity,
    rotRight: rotRight, rotLeft: rotLeft, rotUp: rotUp, rotDown: rotDown,
    front: front, up: up, right: right, left: left, down: down, back: back
  };
})();
