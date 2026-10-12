"""Lightweight shaded robot illustration with CSS depth and animation."""

ROBOT = '''<div class="robot" role="img" aria-label="Robot AIVA với hiệu ứng chiều sâu 3D">
<div class="holo-stage" aria-hidden="true"><div class="holo-grid"></div><div class="holo-beam"></div><div class="holo-platform"><i></i><i></i><i></i></div><span class="holo-particle p1"></span><span class="holo-particle p2"></span><span class="holo-particle p3"></span><span class="holo-particle p4"></span><div class="holo-label">AIVA / VIRTUAL ASSISTANT</div></div>
<svg viewBox="0 0 160 185" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<defs>
  <linearGradient id="aiva-shell" x1="0" y1="0" x2="1" y2=".35"><stop stop-color="#f7fbff"/><stop offset=".28" stop-color="#e6eef9"/><stop offset=".62" stop-color="#9cacc4"/><stop offset=".85" stop-color="#687b99"/><stop offset="1" stop-color="#bac9df"/></linearGradient>
  <radialGradient id="aiva-head" cx=".3" cy=".2" r=".85"><stop stop-color="#ffffff"/><stop offset=".45" stop-color="#dce8f8"/><stop offset=".78" stop-color="#91a3bf"/><stop offset="1" stop-color="#516784"/></radialGradient>
  <linearGradient id="aiva-screen" x1="0" y1="0" x2=".7" y2="1"><stop stop-color="#243955"/><stop offset=".4" stop-color="#081728"/><stop offset="1" stop-color="#020915"/></linearGradient>
  <radialGradient id="aiva-chest" cx=".32" cy=".2" r=".9"><stop stop-color="#f7fbff"/><stop offset=".55" stop-color="#bdcde2"/><stop offset="1" stop-color="#5e7798"/></radialGradient>
</defs>
<ellipse class="robot-ground" cx="80" cy="167" rx="44" ry="8" fill="#020712"/>
<ellipse cx="80" cy="166" rx="55" ry="12" fill="none" stroke="#398ddd" stroke-opacity=".18"/>
<g class="robot-body">
  <rect x="52" y="118" width="22" height="37" rx="10" fill="url(#aiva-shell)" stroke="#c2d3ec" stroke-opacity=".4"/>
  <rect x="89" y="118" width="22" height="37" rx="10" fill="url(#aiva-shell)"/>
  <ellipse cx="62" cy="150" rx="12" ry="5" fill="#8196b2"/><ellipse cx="100" cy="150" rx="12" ry="5" fill="#6b819f"/>
  <rect x="29" y="91" width="18" height="42" rx="9" fill="url(#aiva-shell)" transform="rotate(9 38 96)"/>
  <g class="robot-arm"><rect x="116" y="91" width="18" height="42" rx="9" fill="url(#aiva-shell)" transform="rotate(-9 125 96)"/></g>
  <rect x="46" y="84" width="69" height="55" rx="25" fill="url(#aiva-chest)" stroke="#d0def1" stroke-opacity=".45"/>
  <path d="M54 104q0-13 12-15" stroke="white" stroke-width="3" stroke-linecap="round" opacity=".55" fill="none"/>
  <ellipse cx="81" cy="89" rx="22" ry="6" fill="#3c536d" opacity=".45"/>
  <path d="M81 23v-9" stroke="#aec4e0" stroke-width="4"/><circle class="robot-core" cx="81" cy="11" r="4" fill="#5be5ff"/>
  <rect x="33" y="40" width="10" height="28" rx="5" fill="#6983a3"/><rect x="119" y="40" width="10" height="28" rx="5" fill="#4a6486"/>
  <rect x="37" y="24" width="88" height="69" rx="28" fill="url(#aiva-head)" stroke="#dceaff" stroke-opacity=".65"/>
  <rect x="47" y="34" width="68" height="47" rx="18" fill="url(#aiva-screen)" stroke="#4a607a" stroke-width="2"/>
  <path class="face-scan" d="M55 46h52" stroke="#68e1ff" stroke-opacity=".35" stroke-width="2"/>
  <path d="M54 47q0-7 9-7h33" stroke="#b8dcff" stroke-width="2" opacity=".28" fill="none" stroke-linecap="round"/>
  <path d="M44 43q2-13 20-14" stroke="white" stroke-width="3" opacity=".75" fill="none" stroke-linecap="round"/>
  <ellipse class="robot-eye" cx="67" cy="56" rx="5" ry="9" fill="#45d5ff"/><ellipse class="robot-eye" cx="96" cy="56" rx="5" ry="9" fill="#45d5ff"/>
  <path d="M74 72q8 5 15 0" stroke="#40caff" stroke-width="2" fill="none" stroke-linecap="round"/>
  <circle cx="81" cy="111" r="9" fill="#527c9f"/><circle class="robot-core" cx="81" cy="111" r="5" fill="#52ddff"/>
  <path d="M67 128h28" stroke="#627c9a" stroke-opacity=".6" stroke-linecap="round"/>
</g>
</svg></div>'''
