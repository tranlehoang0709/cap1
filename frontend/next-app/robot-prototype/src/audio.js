// Original synthesized SFX. No recordings or third-party audio assets.
export class NovaAudio{
 constructor(){this.enabled=false;this.context=null;this.voices=new Set();this.played=0;}
 async enable(value){this.enabled=value;if(!value){this.stop();return;}try{this.context??=new AudioContext();await this.context.resume();this.play('wave');}catch{this.enabled=false;throw new Error('Trình duyệt chưa cho phép âm thanh. Hãy bật lại bằng thao tác trực tiếp.');}}
 play(action){if(!this.enabled||!this.context||this.context.state!=='running')return;this.stop();const patterns={wave:[523,659,784],dance:[196,294,392,294,220,330,440,330],celebrate:[523,659,784,1047],react:[440,880,660],blink:[920]};const notes=patterns[action]||patterns.react;const start=this.context.currentTime;notes.forEach((frequency,i)=>{const osc=this.context.createOscillator(),gain=this.context.createGain();osc.type=action==='dance'?'triangle':'sine';osc.frequency.setValueAtTime(frequency,start+i*.12);gain.gain.setValueAtTime(0,start+i*.12);gain.gain.linearRampToValueAtTime(.055,start+i*.12+.012);gain.gain.exponentialRampToValueAtTime(.001,start+i*.12+.18);osc.connect(gain);gain.connect(this.context.destination);const voice={osc,gain};this.voices.add(voice);osc.onended=()=>{osc.disconnect();gain.disconnect();this.voices.delete(voice);};osc.start(start+i*.12);osc.stop(start+i*.12+.2);});this.played++;}
 stop(){for(const v of this.voices){try{v.osc.stop();}catch{}v.osc.disconnect();v.gain.disconnect();}this.voices.clear();}
 async suspend(){this.stop();if(this.context?.state==='running')await this.context.suspend();}
 async resume(){if(this.enabled&&this.context?.state==='suspended')await this.context.resume();}
 async dispose(){this.enabled=false;this.stop();if(this.context&&this.context.state!=='closed')await this.context.close();}
}
