// ===== IDA* Cube Solver =====
var cube = window.CubeEngine;

var CORNERS = [
  { name: "URF", stickers: [cube.FS[0]+8, cube.FS[4]+0, cube.FS[2]+2] },
  { name: "UFL", stickers: [cube.FS[0]+6, cube.FS[2]+0, cube.FS[5]+2] },
  { name: "ULB", stickers: [cube.FS[0]+0, cube.FS[5]+0, cube.FS[3]+2] },
  { name: "UBR", stickers: [cube.FS[0]+2, cube.FS[3]+0, cube.FS[4]+2] },
  { name: "DRF", stickers: [cube.FS[1]+2, cube.FS[4]+6, cube.FS[2]+8] },
  { name: "DFL", stickers: [cube.FS[1]+0, cube.FS[2]+6, cube.FS[5]+8] },
  { name: "DLB", stickers: [cube.FS[1]+6, cube.FS[5]+6, cube.FS[3]+8] },
  { name: "DBR", stickers: [cube.FS[1]+8, cube.FS[3]+6, cube.FS[4]+8] }
];

var EDGES = [
  { name: "UR", stickers: [cube.FS[0]+5, cube.FS[4]+1] },
  { name: "UF", stickers: [cube.FS[0]+7, cube.FS[2]+1] },
  { name: "UL", stickers: [cube.FS[0]+3, cube.FS[5]+1] },
  { name: "UB", stickers: [cube.FS[0]+1, cube.FS[3]+1] },
  { name: "DR", stickers: [cube.FS[1]+5, cube.FS[4]+7] },
  { name: "DF", stickers: [cube.FS[1]+7, cube.FS[2]+7] },
  { name: "DL", stickers: [cube.FS[1]+3, cube.FS[5]+7] },
  { name: "DB", stickers: [cube.FS[1]+1, cube.FS[3]+7] },
  { name: "FR", stickers: [cube.FS[2]+5, cube.FS[4]+3] },
  { name: "FL", stickers: [cube.FS[2]+3, cube.FS[5]+5] },
  { name: "BL", stickers: [cube.FS[3]+5, cube.FS[5]+3] },
  { name: "BR", stickers: [cube.FS[3]+3, cube.FS[4]+5] }
];

var allMoves = ["U","U\'","U2","D","D\'","D2","F","F\'","F2","B","B\'","B2","R","R\'","R2","L","L\'","L2"];
var moveFace = [0,0,0,1,1,1,2,2,2,3,3,3,4,4,4,5,5,5];

var solvedCornerColors = [];
for(var c=0;c<8;c++){var sc=CORNERS[c].stickers;var cols=[];for(var s=0;s<3;s++)cols.push(cube.indexToFace(sc[s]));solvedCornerColors.push(cols);}
var solvedEdgeColors = [];
for(var e=0;e<12;e++){var se=EDGES[e].stickers;var cols=[];for(var s=0;s<2;s++)cols.push(cube.indexToFace(se[s]));solvedEdgeColors.push(cols);}

// Position-to-position move tables: moveCornerPos[m][oldPos] = newPos
var moveCornerPos=[],moveCornerOrient=[],moveEdgePos=[],moveEdgeOrient=[];

function buildMoveTables(){
  for(var m=0;m<18;m++){
    var labeled=new Array(54);
    for(var i=0;i<54;i++) labeled[i]=i;
    var after=cube.applyMove(labeled,allMoves[m]);
    var posMap=new Array(54);
    for(var j=0;j<54;j++) posMap[after[j]]=j;
    
    var cpos=[],corient=[];
    for(var c=0;c<8;c++){
      var st=CORNERS[c].stickers;
      var newStickers=[posMap[st[0]],posMap[st[1]],posMap[st[2]]];
      var found=-1;
      for(var p=0;p<8;p++){
        var s2=CORNERS[p].stickers;
        var cnt=0;
        for(var k=0;k<3;k++) if(newStickers.indexOf(s2[k])>=0) cnt++;
        if(cnt===3){found=p;break;}
      }
      if(found<0)found=c;
      cpos[c]=found;
      var s2=CORNERS[found].stickers;
      var orient=0;
      for(var o=0;o<3;o++){if(newStickers[o]===s2[0]){orient=(3-o)%3;break;}}
      corient[c]=orient;
    }
    moveCornerPos.push(cpos);
    moveCornerOrient.push(corient);
    
    var epos=[],eorient=[];
    for(var e=0;e<12;e++){
      var st=EDGES[e].stickers;
      var newStickers=[posMap[st[0]],posMap[st[1]]];
      var found=-1;
      for(var p=0;p<12;p++){
        var s2=EDGES[p].stickers;
        var cnt=0;
        for(var k=0;k<2;k++) if(newStickers.indexOf(s2[k])>=0) cnt++;
        if(cnt===2){found=p;break;}
      }
      if(found<0)found=e;
      epos[e]=found;
      var s2=EDGES[found].stickers;
      eorient[e]=(newStickers[0]===s2[0])?0:1;
    }
    moveEdgePos.push(epos);
    moveEdgeOrient.push(eorient);
  }
}

var cornerOrientPrune=null,edgeOrientPrune=null,slicePrune=null;
var sliceRankTable={};var initDone=false;

function buildSliceRankTable(){
  var idx=0;
  for(var a=0;a<9;a++){for(var b=a+1;b<10;b++){for(var c=b+1;c<11;c++){for(var d=c+1;d<12;d++){
    var bits=(1<<a)|(1<<b)|(1<<c)|(1<<d);
    sliceRankTable[bits]=idx++;
  }}}}
}

function sliceRank(bits){return sliceRankTable[bits]!==undefined?sliceRankTable[bits]:0;}

// Position-indexed encoding: state[pos] = identity and orientation at that position
function encodeState(cubeState){
  var co={cornerPos:[],cornerOrient:[],edgePos:[],edgeOrient:[]};
  for(var c=0;c<8;c++){
    var stickers=CORNERS[c].stickers;
    var colors=[cubeState[stickers[0]],cubeState[stickers[1]],cubeState[stickers[2]]];
    var found=-1;
    for(var j=0;j<8;j++){
      var match=true;
      for(var k=0;k<3;k++) if(colors.indexOf(solvedCornerColors[j][k])<0){match=false;break;}
      if(match){found=j;break;}
    }
    if(found<0)found=c;
    co.cornerPos[c]=found;
    var orient=0;
    for(var o=0;o<3;o++){
      var match=true;
      for(var s=0;s<3;s++) if(colors[(s+o)%3]!==solvedCornerColors[found][s]){match=false;break;}
      if(match){orient=o;break;}
    }
    co.cornerOrient[c]=orient;
  }
  for(var e=0;e<12;e++){
    var stickers=EDGES[e].stickers;
    var colors=[cubeState[stickers[0]],cubeState[stickers[1]]];
    var found=-1;
    for(var j=0;j<12;j++){
      var match=true;
      for(var k=0;k<2;k++) if(colors.indexOf(solvedEdgeColors[j][k])<0){match=false;break;}
      if(match){found=j;break;}
    }
    if(found<0)found=e;
    co.edgePos[e]=found;
    co.edgeOrient[e]=(colors[0]!==solvedEdgeColors[found][0])?1:0;
  }
  return co;
}

function isSolved(coords){
  for(var c=0;c<8;c++){if(coords.cornerPos[c]!==c||coords.cornerOrient[c]!==0)return false;}
  for(var e=0;e<12;e++){if(coords.edgePos[e]!==e||coords.edgeOrient[e]!==0)return false;}
  return true;
}

function applyMoveToCoords(coords,moveIdx){
  var nc={cornerPos:[],cornerOrient:[],edgePos:[],edgeOrient:[]};
  for(var c=0;c<8;c++){
    var newPos=moveCornerPos[moveIdx][c];
    nc.cornerPos[newPos]=coords.cornerPos[c];
    nc.cornerOrient[newPos]=(coords.cornerOrient[c]+moveCornerOrient[moveIdx][c])%3;
  }
  for(var e=0;e<12;e++){
    var newPos=moveEdgePos[moveIdx][e];
    nc.edgePos[newPos]=coords.edgePos[e];
    nc.edgeOrient[newPos]=(coords.edgeOrient[e]+moveEdgeOrient[moveIdx][e])%2;
  }
  return nc;
}

function buildPruningTables(){
  buildSliceRankTable();
  
  cornerOrientPrune=[];for(var i=0;i<2187;i++)cornerOrientPrune.push(-1);
  cornerOrientPrune[0]=0;var queue=[0];var qidx=0;
  while(qidx<queue.length){var state=queue[qidx++];var dist=cornerOrientPrune[state];if(dist>=10)continue;
    var orient=[];var tmp=state,sum=0;for(var c=0;c<7;c++){orient[c]=tmp%3;sum+=orient[c];tmp=Math.floor(tmp/3);}orient[7]=(300-sum)%3;
    for(var m=0;m<18;m++){
      var no=[];for(var c=0;c<8;c++)no[moveCornerPos[m][c]]=(orient[c]+moveCornerOrient[m][c])%3;
      var ns=0;for(var c=0;c<7;c++)ns+=no[c]*Math.pow(3,c);
      if(cornerOrientPrune[ns]<0){cornerOrientPrune[ns]=dist+1;queue.push(ns);}
    }
  }
  
  edgeOrientPrune=[];for(var i=0;i<2048;i++)edgeOrientPrune.push(-1);
  edgeOrientPrune[0]=0;queue=[0];qidx=0;
  while(qidx<queue.length){var state=queue[qidx++];var dist=edgeOrientPrune[state];if(dist>=10)continue;
    var orient=[];var tmp=state,sum=0;for(var e=0;e<11;e++){orient[e]=tmp%2;sum+=orient[e];tmp=Math.floor(tmp/2);}orient[11]=sum%2;
    for(var m=0;m<18;m++){
      var no=[];for(var e=0;e<12;e++)no[moveEdgePos[m][e]]=(orient[e]+moveEdgeOrient[m][e])%2;
      var ns=0;for(var e=0;e<11;e++)ns+=no[e]*Math.pow(2,e);
      if(edgeOrientPrune[ns]<0){edgeOrientPrune[ns]=dist+1;queue.push(ns);}
    }
  }
  
  slicePrune=[];for(var i=0;i<495;i++)slicePrune.push(-1);
  var solvedBits=(1<<8)|(1<<9)|(1<<10)|(1<<11);
  slicePrune[sliceRank(solvedBits)]=0;queue=[{bits:solvedBits}];qidx=0;
  while(qidx<queue.length){var cur=queue[qidx++];var dist=slicePrune[sliceRank(cur.bits)];if(dist>=8)continue;
    var p1m=[0,1,2,3,4,5,8,10,14,16];
    for(var mi=0;mi<p1m.length;mi++){
      var m=p1m[mi];var newBits=0;
      for(var pos=0;pos<12;pos++){if(cur.bits&(1<<pos)){newBits|=(1<<moveEdgePos[m][pos]);}}
      var nr=sliceRank(newBits);
      if(slicePrune[nr]<0){slicePrune[nr]=dist+1;queue.push({bits:newBits});}
    }
  }
}

function getHeuristic(coords){
  var cornerCode=0;for(var c=0;c<7;c++)cornerCode+=coords.cornerOrient[c]*Math.pow(3,c);
  var h1=cornerOrientPrune[cornerCode]||0;if(h1<0)h1=10;
  var edgeCode=0;for(var e=0;e<11;e++)edgeCode+=coords.edgeOrient[e]*Math.pow(2,e);
  var h2=edgeOrientPrune[edgeCode]||0;if(h2<0)h2=10;
  var bits=0;for(var e=0;e<12;e++)if(coords.edgePos[e]>=8)bits|=(1<<e);
  var h3=slicePrune[sliceRank(bits)]||0;if(h3<0)h3=8;
  return Math.max(h1,h2,h3);
}

var solutionFound=null,searchCount=0,searchLimit=3000000,maxSearchDepth=22;

function idaStar(coords,depth,lastMoveFace,path){
  if(searchCount>searchLimit)return false;searchCount++;
  var h=getHeuristic(coords);if(h===0&&isSolved(coords)){solutionFound=path.slice();return true;}
  if(depth+h>maxSearchDepth)return false;
  for(var m=0;m<18;m++){
    if(moveFace[m]===lastMoveFace)continue;
    var nextCoords=applyMoveToCoords(coords,m);
    path.push(allMoves[m]);
    if(idaStar(nextCoords,depth+1,moveFace[m],path))return true;
    path.pop();
  }
  return false;
}

function initSolver(){if(initDone)return;buildMoveTables();buildPruningTables();initDone=true;}

function solveCube(cubeState){
  initSolver();
  var counts=[0,0,0,0,0,0];
  for(var i=0;i<54;i++){var v=cubeState[i];if(v<0||v>5)return{error:"Invalid color at position "+i};counts[v]++;}
  for(var c=0;c<6;c++)if(counts[c]!==9)return{error:"Color "+c+" appears "+counts[c]+" times, need 9"};
  if(cube.isSolved(cubeState))return{solution:[]};
  var coords=encodeState(cubeState);searchCount=0;solutionFound=null;
  // Verify encoding produces a scramble with same face count
  for(maxSearchDepth=getHeuristic(coords);maxSearchDepth<=22;maxSearchDepth++){
    searchCount=0;if(idaStar(coords,0,-1,[]))break;if(searchCount>searchLimit)break;
  }
  if(solutionFound)return{solution:solutionFound};
  return{error:"Could not find solution after "+searchCount+" nodes"};
}

function getStepText(move,stepNum,totalSteps){
  var base=move.charAt(0);
  var dir;
  if (move.indexOf("\'") >= 0) dir = "逆时针方向";
  else if (move.indexOf("2") >= 0) dir = "180度旋转";
  else dir = "顺时针方向";
  var names = {U:"U (上)",D:"D (下)",F:"F (前)",B:"B (后)",R:"R (右)",L:"L (左)"};
  return stepNum + "/" + totalSteps + ": " + names[base] + " " + dir;
}

window.CubeSolver={solve:solveCube,initSolver:initSolver,getStepText:getStepText};

