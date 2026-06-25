// ===== Correct Rubik'"'"'s Cube Engine =====

// 54-sticker 1D array: [U0..U8, D0..D8, F0..F8, B0..B8, R0..R8, L0..L8]



var U=0,D=1,F=2,B=3,R=4,L=5;

var COLOR_HEX = ['#ffffff','#ffd500','#00b16a','#0051ba','#b71234','#ff5800'];

var COLOR_NAMES = ["\u767d","\u9ec4","\u7eff","\u84dd","\u7ea2","\u6a59"];

var SC=[0,1,2,3,4,5];

var FS=[0,9,18,27,36,45];

var FACE_COLORS=SC;

var FACE_SHORT=["U","D","F","B","R","L"];

var FACE_NAMES=["top (U)","bottom (D)","front (F)","back (B)","right (R)","left (L)"];



function solvedCube(){var c=new Array(54);for(var f=0;f<6;f++)for(var i=0;i<9;i++)c[FS[f]+i]=SC[f];return c;}

function cloneCube(c){return c.slice();}

function equalCube(a,b){for(var i=0;i<54;i++)if(a[i]!==b[i])return false;return true;}

function indexToFace(i){for(var f=0;f<6;f++)if(i>=FS[f]&&i<FS[f]+9)return f;return -1;}

function isSolved(c){for(var f=0;f<6;f++)for(var i=0;i<9;i++)if(c[FS[f]+i]!==SC[f])return false;return true;}

function getFaceColors(c,face){var b=FS[face];return [[c[b],c[b+1],c[b+2]],[c[b+3],c[b+4],c[b+5]],[c[b+6],c[b+7],c[b+8]]];}

function setFaceColors(c,face,m){var b=FS[face];for(var r=0;r<3;r++)for(var col=0;col<3;col++)c[b+r*3+col]=m[r][col];}



// Auto-generated PERM tables [src, dst] for CW turn

var PERM_U=[[0,2],[1,5],[2,8],[3,1],[5,7],[6,0],[7,3],[8,6],[18,36],[19,39],[20,42],[27,53],[28,50],[29,47],[36,29],[39,28],[42,27],[47,18],[50,19],[53,20]];

var PERM_D=[[9,11],[10,14],[11,17],[12,10],[14,16],[15,9],[16,12],[17,15],[24,51],[25,48],[26,45],[33,44],[34,41],[35,38],[38,24],[41,25],[44,26],[45,33],[48,34],[51,35]];

var PERM_F=[[6,42],[7,39],[8,36],[9,53],[10,50],[11,47],[18,20],[19,23],[20,26],[21,19],[23,25],[24,18],[25,21],[26,24],[36,9],[39,10],[42,11],[47,6],[50,7],[53,8]];

var PERM_B=[[0,51],[1,48],[2,45],[15,44],[16,41],[17,38],[27,29],[28,32],[29,35],[30,28],[32,34],[33,27],[34,30],[35,33],[38,0],[41,1],[44,2],[45,15],[48,16],[51,17]];

var PERM_R=[[2,33],[5,30],[8,27],[11,26],[14,23],[17,20],[20,2],[23,5],[26,8],[27,11],[30,14],[33,17],[36,38],[37,41],[38,44],[39,37],[41,43],[42,36],[43,39],[44,42]];

var PERM_L=[[0,24],[3,21],[6,18],[9,35],[12,32],[15,29],[18,9],[21,12],[24,15],[29,0],[32,3],[35,6],[45,47],[46,50],[47,53],[48,46],[50,52],[51,45],[52,48],[53,51]];



function composeCWPairs(cw){

  var map={};for(var i=0;i<cw.length;i++)map[cw[i][0]]=cw[i][1];

  var d2=[];for(var i=0;i<cw.length;i++){

    var src=cw[i][0];var mid=cw[i][1];

    if(mid!==src&&map[mid]!==undefined&&map[mid]!==src)d2.push([src,map[mid]]);

  }

  return d2;

}



var ALL_PERMS={U:PERM_U,D:PERM_D,F:PERM_F,B:PERM_B,R:PERM_R,L:PERM_L};

var MOVES={};



for(var f=0;f<6;f++){

  var n=FACE_SHORT[f];var cw=ALL_PERMS[n];

  var ccw=[];for(var i=0;i<cw.length;i++)ccw.push([cw[i][1],cw[i][0]]);

  var d2=composeCWPairs(cw);

  MOVES[n]=cw;MOVES[n+"\'"]=ccw;MOVES[n+"2"]=d2;

}



function applyMove(a,m){var p=MOVES[m];if(!p)return a;var c=cloneCube(a);for(var i=0;i<p.length;i++)c[p[i][1]]=a[p[i][0]];return c;}

function applyAlg(a,alg){var m=alg.trim().split(/\s+/).filter(function(s){return s.length>0;});var c=cloneCube(a);for(var i=0;i<m.length;i++)c=applyMove(c,m[i]);return c;}



window.CubeEngine = {U,D,F,B,R,L,FS,SC,FACE_COLORS,FACE_SHORT,FACE_NAMES,

solvedCube,cloneCube,equalCube,applyMove,applyAlg,COLOR_HEX,COLOR_NAMES,

getFaceColors,setFaceColors,isSolved,indexToFace};

