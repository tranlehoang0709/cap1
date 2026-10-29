const CYAN='#53e4f1', BRIGHT='#b3fbff', DIM='#268eaa';
const GLYPHS={
  heart:['01010','11111','11111','01110','00100'],
  sparkle:['00100','00100','11111','00100','00100'],
  tear:['010','111','111','010'],
  z:['11111','00010','00100','01000','11111'],
};

export class PixelFaceRenderer {
  constructor(canvas,{width=128,height=64}={}) {
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<64||height<32||width>512||height>256) throw RangeError('Logical resolution out of range');
    this.canvas=canvas;canvas.width=width;canvas.height=height;
    this.ctx=canvas.getContext('2d',{alpha:false});
    if(!this.ctx) throw Error('Canvas 2D không khả dụng');
    this.ctx.imageSmoothingEnabled=false;
  }
  pixel(x,y,color=CYAN) {this.ctx.fillStyle=color;this.ctx.fillRect(Math.round(x),Math.round(y),1,1);}
  line(x1,y1,x2,y2,color=CYAN,thickness=1) {
    const count=Math.max(Math.abs(x2-x1),Math.abs(y2-y1),1);
    for(let i=0;i<=count;i++) for(let j=0;j<thickness;j++) this.pixel(x1+(x2-x1)*i/count,y1+(y2-y1)*i/count+j,color);
  }
  glyph(name,x,y,color=CYAN) {
    const rows=GLYPHS[name];
    for(let row=0;row<rows.length;row++)for(let col=0;col<rows[row].length;col++)if(rows[row][col]==='1')this.pixel(x+col,y+row,color);
  }
  eye(id,cx,cy,side,open) {
    // Mặt nạ raster nguyên bản: oval, cung cười, nêm giận, mắt rũ, mí ngủ.
    for(let x=-11;x<=11;x++)for(let y=-12;y<=12;y++){
      let lit=false;
      const nx=x/9;
      if(id==='neutral')lit=(x*x/32+y*y/91)<=1;
      if(id==='happy')lit=Math.abs(y-(-5+0.075*x*x))<1.8 && Math.abs(x)<=9 && y<=3;
      if(id==='angry')lit=Math.abs(x)<=9 && y>=-3+side*x*0.42 && y<=5 && x*x/110+y*y/70<=1.25;
      if(id==='sad')lit=Math.abs(nx)<=1 && y>=-2-side*x*0.28 && y<=5+Math.sqrt(Math.max(0,1-nx*nx))*3;
      if(id==='sleepy')lit=Math.abs(x)<=9 && Math.abs(y-(3-0.035*x*x))<=0.9;
      if(lit)this.pixel(cx+x,cy+y*Math.max(0.07,open));
    }
    if(id==='angry')this.line(cx-10,cy-9-side*4,cx+10,cy-9+side*4,CYAN,2);
    if(id==='sad')this.line(cx-8,cy-7+side*2,cx+8,cy-7-side*2,DIM);
  }
  mouth(id,x,y,pulse) {
    if(id==='neutral'){this.line(x-4,y,x-2,y+1);this.line(x-2,y+1,x+2,y+1);this.line(x+2,y+1,x+4,y);}
    if(id==='happy'){
      for(let dx=-10;dx<=10;dx++){
        const depth=Math.round(Math.sqrt(Math.max(0,1-(dx/10)**2))*(5+Math.max(0,pulse)));
        this.line(x+dx,y,x+dx,y+depth);
      }
      this.line(x-5,y+4,x+5,y+4,BRIGHT);
    }
    if(id==='angry'){
      this.line(x-7,y+1,x-3,y-1);this.line(x-3,y-1,x+3,y-1);this.line(x+3,y-1,x+7,y+1);
      this.pixel(x-8,y+2,DIM);this.pixel(x+8,y+2,DIM);
    }
    if(id==='sad') for(let dx=-7;dx<=7;dx++)this.pixel(x+dx,y+Math.round(dx*dx/16),CYAN);
    if(id==='sleepy')for(let dx=-3;dx<=3;dx++)for(let dy=-2;dy<=2;dy++)if(Math.abs(dx*dx/9+dy*dy/4-1)<0.55)this.pixel(x+dx,y+dy);
  }
  face(id,s,alpha) {
    if(alpha<=0)return;
    this.ctx.globalAlpha=alpha;
    const cx=64+s.lookX,cy=28+s.lookY+s.offsetY;
    this.eye(id,cx-23,cy,1,s.eyeOpen);this.eye(id,cx+23,cy,-1,s.eyeOpen);
    this.mouth(id,cx,47+s.offsetY,s.mouthPulse);
  }
  effects(s,motion) {
    const t=motion?s.time:0;
    const drift=motion?Math.floor(t*3)%5:0;
    if(s.id==='happy'){
      this.glyph('heart',107,13-drift);
      this.glyph('sparkle',15,17+Math.round(Math.sin(t*2)),s.time%2<1?BRIGHT:CYAN);
    }
    if(s.id==='angry'){
      this.line(104,12,104,16);this.line(107,16,110,16);this.line(107,19,107,22);this.line(100,19,103,19);
    }
    if(s.id==='sad'){
      this.glyph('tear',39,39+(motion?Math.floor(t*3)%12:2));
      this.glyph('tear',86,39+(motion?Math.floor(t*3+6)%12:5),DIM);
    }
    if(s.id==='sleepy'){
      this.glyph('z',104,22-drift);
      this.glyph('z',113,12-drift,DIM);
    }
  }
  render(state,{motion=true}={}) {
    const ctx=this.ctx;
    ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;
    ctx.fillStyle='#02080b';ctx.fillRect(0,0,this.canvas.width,this.canvas.height);
    ctx.setTransform(this.canvas.width/128,0,0,this.canvas.height/64,0,0);
    const t=state.transition*state.transition*(3-2*state.transition);
    this.face(state.previous,state,1-t);this.face(state.id,state,t);
    ctx.globalAlpha=t;this.effects(state,motion);ctx.globalAlpha=1;
  }
}
