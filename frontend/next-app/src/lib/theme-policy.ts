export type AivaTheme='light'|'dark';
export const AIVA_THEMES=['light','dark'];
export const DEFAULT_THEME:AivaTheme='dark';
export const normalizeTheme=(value:unknown):AivaTheme=>value==='light'?'light':'dark';

/** Self-contained so its serialized version can run before next-themes/paint. */
export function initializeTheme(){
 let mode='dark';
 try{
  const saved=localStorage.getItem('theme');
  mode=saved==='light'?'light':'dark';
  if(saved!==mode)localStorage.setItem('theme',mode);
 }catch{/* Storage may be unavailable. The document still gets a safe default. */}
 const root=document.documentElement;
 root.classList.remove('light','dark','system');
 root.classList.add(mode);
 root.style.colorScheme=mode;
}
export const themeBootstrap=`(${initializeTheme.toString()})();`;
