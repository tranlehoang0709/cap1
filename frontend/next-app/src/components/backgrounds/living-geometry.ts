/** Original deterministic wave surface. No image, random seed or frame loop. */
export const FLOW_PATHS=[
 'M-140 705C80 665 100 490 330 595S710 710 920 795S1330 915 1740 740',
 'M-140 717C80 677 100 502 330 607S710 722 920 807S1330 927 1740 752',
 'M-140 735C90 687 115 522 345 623S725 737 935 820S1345 940 1755 766',
 'M240 850C490 792 600 785 770 645S1110 315 1690 228',
 'M250 865C500 807 610 800 780 660S1120 330 1700 243',
];
export function createDigitalMesh(){
 const points:Array<{x:number;y:number;r:number;opacity:number}>=[];
 for(let row=0;row<18;row++)for(let column=0;column<81;column++){
  const depth=row/17,t=column/80;
  // A crest on the left falls below the center and rises at the far edge.
  const crest=640-90*Math.exp(-Math.pow((t-.18)/.16,2))+170*Math.exp(-Math.pow((t-.65)/.23,2));
  const x=-100+t*1800+(depth-.5)*Math.sin(t*8)*14;
  const y=crest+Math.pow(depth,1.45)*245+Math.sin(t*12+depth)*depth*12;
  points.push({x:+x.toFixed(2),y:+y.toFixed(2),r:+(.55+depth*.5).toFixed(2),opacity:+(.75-depth*.4).toFixed(2)});
 }
 return points;
}
