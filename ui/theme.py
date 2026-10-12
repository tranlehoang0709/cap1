import streamlit as st

def apply_theme():
    st.session_state.aiva_panel_index = 0
    light = st.session_state.get("appearance") == "☀️ Sáng"
    field_bg, field_text, field_border, muted = (
        ("#ffffff", "#17253d", "#bbc9df", "#586b87") if light
        else ("#142238", "#e7eeff", "#344969", "#a6b8d3")
    )
    st.markdown('''<style>
    :root{color-scheme:dark}.stApp{background:radial-gradient(ellipse at 70% 0%,#17243c,#0b1424 55%,#080f1d);color:#edf2ff}
    [data-testid="stHeader"]{background:transparent}.block-container{padding-top:1.5rem;max-width:1500px}
    [data-testid="stSidebar"]{background:#0c1524;border-right:1px solid #293e60}
    [data-testid="stSidebar"] .stRadio label{padding:8px 12px;border-radius:8px}
    [data-testid="stSidebar"] .stRadio label:has(input:checked){background:linear-gradient(90deg,#4b40e8,#303384)}
    h1{font-size:1.8rem!important}.brand{display:flex;gap:24px;align-items:center;flex-wrap:wrap;border-bottom:1px solid #2a3f63;padding-bottom:18px;margin-bottom:24px}
    .brand b{font-size:30px}.brand span{color:#b5c9f4;font-size:14px}.brand small{margin-left:auto;color:#93a6c8;font-size:11px}
    [data-testid="stVerticalBlockBorderWrapper"]>div{background:linear-gradient(140deg,#17263b,#101c2e);border-color:#2b3e58!important;border-radius:12px!important}
    [data-testid="stMetric"]{background:linear-gradient(135deg,#192b43,#132035);border:1px solid #2c405c;border-radius:12px;padding:18px}
    [data-testid="stMetricLabel"]{color:#adc0e2}
    .stButton button,.stFormSubmitButton button{border-radius:8px;border:1px solid #35496a;background:#1b2b44;color:#edf2ff}
    .stButton button[kind="primary"],.stFormSubmitButton button[kind="primary"]{background:linear-gradient(100deg,#5942ff,#4647ee);border-color:#6962ff}
    [data-baseweb="input"],[data-baseweb="select"]>div,[data-baseweb="textarea"]{background:#142238!important;color:#e7eeff!important;border-color:#344969!important}
    [data-testid="stChatMessage"]{background:#1b2b43;border:1px solid #2b405d;border-radius:14px}
    .robot{display:flex;justify-content:center;align-items:center;padding:22px;min-height:215px;position:relative;perspective:700px;isolation:isolate}
    .robot::before{content:"";position:absolute;width:190px;height:150px;background:radial-gradient(ellipse,#349bff22,transparent 70%);z-index:-1}
    .robot svg{height:185px;overflow:visible;filter:drop-shadow(0 12px 12px #0006);transform:rotateY(-12deg) rotateX(5deg);transition:transform .65s cubic-bezier(.2,.8,.2,1),filter .65s}
    .robot:hover svg{transform:rotateY(17deg) rotateX(-6deg) scale(1.07);filter:drop-shadow(-12px 18px 16px #0008)}
    .robot-body{animation:robot-float 4s ease-in-out infinite}
    .robot-ground{transform-origin:80px 167px;animation:robot-shadow 4s ease-in-out infinite}
    .robot-eye{transform-box:fill-box;transform-origin:center;animation:robot-blink 6s ease-in-out infinite;filter:drop-shadow(0 0 3px #39caff)}
    .robot-core{animation:robot-pulse 2.5s ease-in-out infinite}
    @keyframes robot-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}
    @keyframes robot-shadow{0%,100%{transform:scaleX(1);opacity:.65}50%{transform:scaleX(.8);opacity:.35}}
    @keyframes robot-blink{0%,43%,47%,100%{transform:scaleY(1)}45%{transform:scaleY(.12)}}
    @keyframes robot-pulse{0%,100%{opacity:.7}50%{opacity:1;filter:drop-shadow(0 0 5px #35d8ff)}}
    @media(prefers-reduced-motion:reduce){.robot-body,.robot-ground,.robot-eye,.robot-core{animation:none}.robot svg{transition:none}.robot:hover svg{transform:rotateY(-12deg) rotateX(5deg)}}
    .status{display:inline-block;padding:4px 10px;border-radius:6px;font-size:12px}.online{color:#00e69a;background:#023c30}.offline{color:#ff737d;background:#422130}
    /* Interaction effects stay local to controls and robot cards. */
    .stButton button,.stFormSubmitButton button{transition:transform .18s ease,box-shadow .22s ease,border-color .22s ease;position:relative;overflow:hidden}
    .stButton button:not(:disabled):hover,.stFormSubmitButton button:not(:disabled):hover{transform:translateY(-2px);border-color:#8c83ff;box-shadow:0 6px 20px #6255ff30}
    .stButton button:not(:disabled):active,.stFormSubmitButton button:not(:disabled):active{transform:translateY(1px) scale(.98)}
    .stButton button:focus-visible,.stFormSubmitButton button:focus-visible{outline:2px solid #a5a0ff;outline-offset:3px}
    [data-testid="stVerticalBlockBorderWrapper"]:has(.robot):not(:has(.robot-welcome)){transition:transform .25s ease,filter .25s ease}
    [data-testid="stVerticalBlockBorderWrapper"]:has(.robot):not(:has(.robot-welcome)):hover{transform:translateY(-3px);filter:drop-shadow(0 5px 10px #536bff15)}
    [data-testid="stSidebar"] .stRadio label{position:relative;transition:background .2s ease,box-shadow .2s ease,transform .2s ease}
    [data-testid="stSidebar"] .stRadio label:hover{background:#253452;transform:translateX(2px)}
    [data-testid="stSidebar"] .stRadio label:has(input:checked){box-shadow:inset 3px 0 #a5a0ff;animation:nav-select .25s ease-out}
    .stTabs [data-baseweb="tab-highlight"]{background:#8b7cff;transition:left .25s ease,width .25s ease}
    .stTabs [data-baseweb="tab"]{transition:color .2s ease,background .2s ease}
    .robot-welcome{border-radius:16px;background-image:linear-gradient(#4273ac14 1px,transparent 1px),linear-gradient(90deg,#4273ac14 1px,transparent 1px);background-size:32px 32px;overflow:hidden}
    .robot-welcome::after{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at center,#2576e21a,transparent 65%);pointer-events:none;animation:welcome-light 6s ease-in-out infinite;z-index:-1}
    .robot-arm{transform-origin:125px 96px}
    .robot-welcome .robot-arm{animation:robot-wave 2s ease-in-out .4s 2}
    .robot:hover .robot-arm{animation:robot-wave 1.8s ease-in-out 1}
    .robot-offline .robot-body,.robot-offline .robot-ground,.robot-offline .robot-eye,.robot-offline .robot-core{animation:none}
    .robot-offline .robot-eye,.robot-offline .robot-core{opacity:.35;filter:none}
    .robot-offline:hover .robot-arm{animation:none}
    .pairing-state{display:flex;align-items:center;gap:20px;padding:18px 22px;margin:10px 0 20px;border:1px solid #394a72;border-radius:12px;background:#17243a}
    .pairing-state small{color:#aec0dd}.pairing-radar{position:relative;display:grid;place-items:center;width:54px;height:54px;flex-shrink:0;color:#91a7ff}
    .pairing-radar b{font-size:28px}.pairing-radar i{position:absolute;inset:8px;border:1px solid #877bff;border-radius:50%;animation:pairing-wave 2.8s ease-out infinite}
    .pairing-radar i:nth-child(2){animation-delay:1.4s}
    .success-animation{height:42px;display:flex;align-items:center;margin-top:8px}
    .success-animation svg{width:40px;height:40px;fill:none;stroke:#48dfae;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
    .success-animation circle{stroke-dasharray:108;stroke-dashoffset:108;animation:draw-success .45s ease-out forwards}
    .success-animation path{stroke-dasharray:35;stroke-dashoffset:35;animation:draw-success .3s ease-out .35s forwards}
    @keyframes draw-success{to{stroke-dashoffset:0}}
    @keyframes nav-select{from{opacity:.65;transform:translateX(-3px)}to{opacity:1;transform:translateX(0)}}
    @keyframes robot-wave{0%,100%{transform:rotate(0)}20%,60%{transform:rotate(-130deg)}40%,80%{transform:rotate(-105deg)}}
    @keyframes pairing-wave{0%{transform:scale(.65);opacity:.8}100%{transform:scale(1.65);opacity:0}}
    @keyframes welcome-light{0%,100%{opacity:.35}50%{opacity:1}}
    @media(prefers-reduced-motion:reduce){.robot-arm,.robot-welcome .robot-arm,.robot:hover .robot-arm,.robot-welcome::after,.pairing-radar i,.success-animation circle,.success-animation path,[data-testid="stSidebar"] .stRadio label:has(input:checked){animation:none}.success-animation circle,.success-animation path{stroke-dashoffset:0}.pairing-radar i{opacity:.4}.stButton button,.stFormSubmitButton button,[data-testid="stSidebar"] .stRadio label,.stTabs [data-baseweb="tab-highlight"],[data-testid="stVerticalBlockBorderWrapper"]:has(.robot){transition:none}.stButton button:not(:disabled):hover,.stFormSubmitButton button:not(:disabled):hover,[data-testid="stSidebar"] .stRadio label:hover,[data-testid="stVerticalBlockBorderWrapper"]:has(.robot):hover{transform:none}}
    /* Hologram scene: only the welcome robot receives the full stage. */
    .holo-stage{display:none}
    .robot-welcome{min-height:355px;background:radial-gradient(ellipse at 50% 60%,#153d6644,transparent 65%),#0a1425;border:1px solid #365380;perspective:900px}
    .robot-welcome .holo-stage{display:block;position:absolute;inset:0;pointer-events:none;overflow:hidden;border-radius:16px}
    .robot-welcome svg{height:245px;margin-bottom:28px;z-index:2;animation:hero-turn 9s ease-in-out infinite}
    .robot-welcome:hover svg{animation-play-state:paused;transform:rotateY(20deg) rotateX(-5deg) scale(1.08)}
    .robot-welcome .robot-body{animation:hero-float 5s ease-in-out infinite}
    .holo-grid{position:absolute;left:-50%;width:200%;height:230px;bottom:-85px;background-image:linear-gradient(#47bdff22 1px,transparent 1px),linear-gradient(90deg,#47bdff22 1px,transparent 1px);background-size:35px 35px;transform:perspective(350px) rotateX(58deg);mask-image:radial-gradient(ellipse,#000 15%,transparent 65%);animation:grid-drift 10s linear infinite}
    .holo-platform{position:absolute;bottom:47px;left:50%;width:220px;height:65px;transform:translateX(-50%);border-radius:50%;background:radial-gradient(ellipse,#51d7ff33,#625bff11 55%,transparent 70%);box-shadow:0 8px 22px #3f7eff25}
    .holo-platform i{position:absolute;inset:5px;border:2px solid #54d8ff88;border-radius:50%;box-shadow:0 0 12px #32bcff44,inset 0 0 12px #32bcff22}
    .holo-platform i:nth-child(2){inset:13px 26px;border:2px dashed #9892ff99;animation:platform-spin 15s linear infinite}
    .holo-platform i:nth-child(3){inset:0;border:1px solid #68d7ff;animation:platform-ripple 3s ease-out infinite}
    .holo-beam{position:absolute;bottom:67px;left:50%;width:190px;height:235px;transform:translateX(-50%);background:linear-gradient(0deg,#48cfff22,transparent 85%);clip-path:polygon(30% 0,70% 0,100% 100%,0 100%);animation:beam-breathe 5s ease-in-out infinite}
    .holo-label{position:absolute;bottom:15px;width:100%;text-align:center;color:#8fabc9;font-size:10px;letter-spacing:3px;font-family:monospace}
    .holo-particle{position:absolute;bottom:75px;width:3px;height:3px;background:#93edff;border-radius:50%;box-shadow:0 0 8px #49d4ff;animation:particle-rise 5s linear infinite}
    .p1{left:36%}.p2{left:61%;animation-delay:-1.4s}.p3{left:45%;animation-delay:-2.8s}.p4{left:55%;animation-delay:-4s}
    .face-scan{animation:face-scan 4s ease-in-out infinite}
    .robot-offline .face-scan{animation:none;opacity:0}
    .stButton button[kind="primary"]::after,.stFormSubmitButton button[kind="primary"]::after{content:"";position:absolute;inset:-50% auto -50% -65%;width:35%;background:linear-gradient(90deg,transparent,#e1dcff55,transparent);transform:skewX(-25deg);pointer-events:none}
    .stButton button[kind="primary"]:not(:disabled):hover::after,.stFormSubmitButton button[kind="primary"]:not(:disabled):hover::after{animation:button-sweep .7s ease-out forwards}
    [data-testid="stVerticalBlockBorderWrapper"]:has(.robot):not(:has(.robot-welcome)):hover>div{border-color:#756aff!important;box-shadow:inset 0 1px 0 #b0c6ff22,0 0 22px #6058ff22}
    @keyframes hero-turn{0%,100%{transform:rotateY(-14deg) rotateX(4deg)}50%{transform:rotateY(14deg) rotateX(-3deg)}}
    @keyframes hero-float{0%,100%{transform:translateY(0) rotate(-1deg);transform-origin:80px 110px}50%{transform:translateY(-13px) rotate(1deg);transform-origin:80px 110px}}
    @keyframes grid-drift{to{background-position:0 35px,0 35px}}
    @keyframes platform-spin{to{transform:rotate(360deg)}}
    @keyframes platform-ripple{0%{transform:scale(.8);opacity:.8}100%{transform:scale(1.45);opacity:0}}
    @keyframes beam-breathe{0%,100%{opacity:.4}50%{opacity:1}}
    @keyframes particle-rise{0%{transform:translateY(0);opacity:0}20%{opacity:.8}100%{transform:translateY(-200px);opacity:0}}
    @keyframes face-scan{0%,100%{transform:translateY(0);opacity:0}30%{opacity:.7}70%{transform:translateY(26px);opacity:0}}
    @keyframes button-sweep{to{left:140%}}
    @media(prefers-reduced-motion:reduce){.robot-welcome svg,.robot-welcome .robot-body,.holo-grid,.holo-platform i,.holo-beam,.holo-particle,.face-scan,.stButton button::after,.stFormSubmitButton button::after{animation:none!important}.holo-particle,.face-scan{display:none}.robot-welcome:hover svg{transform:rotateY(-12deg) rotateX(5deg)}}
    @media(max-width:700px){.brand span{display:none}.brand small{margin-left:0}.block-container{padding:1rem}.robot-welcome{min-height:300px}.robot-welcome svg{height:205px}.holo-label{letter-spacing:1.5px}}
    </style>''', unsafe_allow_html=True)
    # Streamlit 1.65 input/select roots are no longer BaseWeb input elements.
    # Theme the real roots, their children, and portalled dropdowns together.
    surface = "#ffffff" if light else "#16253b"
    text = "#17253d" if light else "#edf2ff"
    border = "#c3cfe3" if light else "#344969"
    muted_text = "#546782" if light else "#adc0e2"
    st.markdown(f'''<style>
    :root {{ --aiva-surface:{surface};--aiva-text:{text};--aiva-border:{border};--aiva-muted:{muted_text}; }}
    .stApp [data-testid="stMarkdownContainer"],.stApp [data-testid="stMarkdownContainer"] p,
    .stApp [data-testid="stMarkdownContainer"] strong,.stApp [data-testid="stWidgetLabel"] p,
    .stApp [data-testid="stChatMessageContent"],.stApp [data-testid="stChatMessageContent"] p {{color:var(--aiva-text)!important;}}
    .stApp [data-testid="stCaptionContainer"],.stApp [data-testid="stCaptionContainer"] p {{color:var(--aiva-muted)!important;}}
    .stApp [data-testid="stTextInputRootElement"],.stApp [data-testid="stNumberInputContainer"],
    .stApp [data-testid="stSelectbox"] [role="combobox"],.stApp [data-testid="stMultiSelect"] [role="combobox"],
    .stApp [data-testid="stChatInput"] {{background:var(--aiva-surface)!important;color:var(--aiva-text)!important;border:1px solid var(--aiva-border)!important;border-radius:9px;}}
    .stApp [data-testid="stTextInputRootElement"] *,
    .stApp [data-testid="stNumberInput"] button,
    .stApp [data-testid="stSelectbox"] [role="combobox"] *,
    .stApp [data-testid="stMultiSelect"] [role="combobox"] *,
    .stApp [data-testid="stChatInput"] textarea {{background:transparent!important;color:var(--aiva-text)!important;-webkit-text-fill-color:var(--aiva-text)!important;}}
    .stApp [data-testid="stSelectbox"] button,.stApp [data-testid="stMultiSelect"] button {{background:var(--aiva-surface)!important;color:var(--aiva-text)!important;border-color:var(--aiva-border)!important;}}
    [data-testid="stSelectboxVirtualDropdown"],[data-testid="stSelectboxVirtualDropdown"] *,
    [role="listbox"],[role="listbox"] *,[role="option"] {{color:var(--aiva-text)!important;-webkit-text-fill-color:var(--aiva-text)!important;}}
    [data-testid="stSelectboxVirtualDropdown"],[role="listbox"] {{background:var(--aiva-surface)!important;border-color:var(--aiva-border)!important;}}
    [role="option"]:hover,[role="option"][aria-selected="true"] {{background:{"#e8e5ff" if light else "#30365c"}!important;}}
    .stApp [data-testid="stVerticalBlock"] [data-testid="stVerticalBlock"] {{border-color:var(--aiva-border)!important;}}
    .stApp [data-testid="stVerticalBlock"]:has(> [data-testid="stVerticalBlockBorderWrapper"]) {{border-color:var(--aiva-border)!important;}}
    .stApp [data-testid="stVerticalBlockBorderWrapper"],.stApp [data-testid="stLayoutWrapper"]:has(> [data-testid="stVerticalBlock"][style*="border"]) {{border-color:var(--aiva-border)!important;}}
    .stApp .stButton button[kind="primary"] p,.stApp .stFormSubmitButton button[kind="primary"] p {{color:#fff!important;}}
    .stApp [data-baseweb="tab"] p {{color:var(--aiva-text)!important;}}
    .stApp [data-testid="stAlert"] p {{color:{"#243852" if light else "#e7eeff"}!important;}}
    .stApp [data-testid="stTable"] th,.stApp [data-testid="stTable"] td {{background:var(--aiva-surface)!important;color:var(--aiva-text)!important;border-color:var(--aiva-border)!important;}}
    .st-key-aiva_theme_switch_scope,.st-key-aiva_theme_switch_scope label {{background:transparent!important;}}
    .stApp [data-testid="stTextInputRootElement"]:focus-within {{border-color:#8172ff!important;}}
    .stApp [class*="st-key-aiva_panel_"] {{border:1px solid var(--aiva-border)!important;background:var(--aiva-surface)!important;border-radius:12px!important;padding:16px!important;}}
    .stApp [data-testid="stSelectbox"] div:not([data-testid="stWidgetLabel"]):not([data-testid="stMarkdownContainer"]),
    .stApp [data-testid="stMultiSelect"] div:not([data-testid="stWidgetLabel"]):not([data-testid="stMarkdownContainer"]) {{background:var(--aiva-surface)!important;color:var(--aiva-text)!important;}}
    .stApp [data-testid="stSelectbox"] span,.stApp [data-testid="stMultiSelect"] span {{color:var(--aiva-text)!important;}}
    </style>''', unsafe_allow_html=True)
    if st.session_state.get("appearance") == "☀️ Sáng":
        st.markdown('''<style>
        :root{color-scheme:light}
        .stApp{background:radial-gradient(ellipse at 70% 0%,#e9e8ff,#f5f7fc 60%,#edf2fa);color:#17253d;--text-color:#17253d;--background-color:#f5f7fc;--secondary-background-color:#eaf0fa}
        [data-testid="stSidebar"]{background:#f0f3fb;border-color:#d2daeb;--text-color:#17253d}
        [data-testid="stMarkdownContainer"], [data-testid="stWidgetLabel"], [data-testid="stMetricValue"], [data-testid="stHeadingWithActionElements"]{color:inherit}
        .stApp h1,.stApp h2,.stApp h3,.stApp label{color:#17253d}
        [data-testid="stCaptionContainer"]{color:#586b87}
        .brand{border-color:#cbd5e8}.brand span{color:#495c83}.brand small{color:#63748c}
        [data-testid="stVerticalBlockBorderWrapper"]>div{background:linear-gradient(140deg,#ffffff,#f0f4fc);border-color:#d0daeb!important}
        [data-testid="stMetric"]{background:linear-gradient(135deg,#fff,#eaf0fc);border-color:#d0daeb}
        [data-testid="stMetricLabel"]{color:#546782}[data-testid="stMetricValue"]{color:#17253d}
        .stButton button,.stFormSubmitButton button{background:#fff;color:#263852;border-color:#c4cfe2}
        .stButton button[kind="primary"],.stFormSubmitButton button[kind="primary"]{background:linear-gradient(100deg,#5942ff,#4647ee);color:#fff;border-color:#6962ff}
        [data-baseweb="input"],[data-baseweb="select"]>div,[data-baseweb="textarea"]{background:#fff!important;color:#17253d!important;border-color:#bbc9df!important}
        .stApp input,.stApp textarea,[data-baseweb="select"]{color:#17253d!important;-webkit-text-fill-color:#17253d}
        .stApp input::placeholder,.stApp textarea::placeholder{color:#71829a!important;-webkit-text-fill-color:#71829a}
        [data-baseweb="popover"],[data-baseweb="menu"], [role="listbox"]{background:#fff;color:#17253d}
        [data-testid="stChatMessage"]{background:#e9effb;border-color:#cad6e9;color:#17253d}
        [data-testid="stChatInput"]{background:#fff;border-color:#bbc9df;color:#17253d}
        [data-testid="stSidebar"] .stRadio label:hover{background:#e0e6f7}
        [data-testid="stSidebar"] .stRadio label:has(input:checked){background:linear-gradient(90deg,#dedaff,#eceaff);box-shadow:inset 3px 0 #6655ff;color:#32246b}
        .stTabs [data-baseweb="tab"]{color:#536782}.stTabs [aria-selected="true"]{color:#5942d9}
        [data-testid="stSegmentedControl"] button{color:#17253d;background:#e5eafa}
        .pairing-state{background:#eef0ff;border-color:#cbd0ee;color:#253652}.pairing-state small{color:#586b87}
        .robot-welcome{background:radial-gradient(ellipse at 50% 60%,#8ed6ff55,transparent 65%),#e9f0fc;border-color:#c6d4e9}
        .holo-label{color:#4d6889}.robot-welcome .holo-grid{opacity:.7}
        .online{color:#006d49;background:#d8f5e8}.offline{color:#a62a3c;background:#ffe3e7}
        [data-testid="stExpander"]{border-color:#ccd6e7}
        [data-testid="stExpander"] summary{color:#253652}
        </style>''', unsafe_allow_html=True)
    # BaseWeb gives the wrapper and the actual editable input separate styles.
    # Override both, including WebKit text fill and saved-login autofill.
    st.markdown(f'''<style>
    .stApp {{ --aiva-field-bg:{field_bg}; --aiva-field-text:{field_text}; --aiva-field-border:{field_border}; --aiva-field-muted:{muted}; }}
    .stApp [data-testid="stTextInput"] [data-baseweb="input"],
    .stApp [data-testid="stTextInput"] [data-baseweb="base-input"],
    .stApp [data-testid="stNumberInput"] [data-baseweb="input"],
    .stApp [data-testid="stNumberInput"] [data-baseweb="base-input"],
    .stApp [data-testid="stTextArea"] [data-baseweb="textarea"] {{
        background:var(--aiva-field-bg)!important;color:var(--aiva-field-text)!important;
        border-color:var(--aiva-field-border)!important;
    }}
    .stApp [data-testid="stTextInput"] input,
    .stApp [data-testid="stNumberInput"] input,
    .stApp [data-testid="stTextArea"] textarea {{
        background:var(--aiva-field-bg)!important;color:var(--aiva-field-text)!important;
        -webkit-text-fill-color:var(--aiva-field-text)!important;caret-color:var(--aiva-field-text)!important;
    }}
    .stApp input::placeholder,.stApp textarea::placeholder {{
        color:var(--aiva-field-muted)!important;-webkit-text-fill-color:var(--aiva-field-muted)!important;opacity:1;
    }}
    .stApp input:-webkit-autofill {{
        -webkit-box-shadow:0 0 0 1000px var(--aiva-field-bg) inset!important;
        -webkit-text-fill-color:var(--aiva-field-text)!important;caret-color:var(--aiva-field-text)!important;
    }}
    .stApp [data-testid="stTextInput"] button {{background:var(--aiva-field-bg)!important;color:var(--aiva-field-text)!important;}}
    .stApp [data-testid="stTextInput"] button svg {{fill:currentColor;}}
    .stApp [data-testid="stTextInput"] [data-baseweb="input"] > div,
    .stApp [data-testid="stTextInput"] [data-baseweb="input"] > div > div,
    .stApp [data-testid="stTextInput"] [data-baseweb="input"] [role="button"] {{
        background:var(--aiva-field-bg)!important;color:var(--aiva-field-text)!important;
    }}
    .stApp [data-testid="stTextInput"] [data-baseweb="input"] {{
        border:1px solid var(--aiva-field-border)!important;border-radius:9px!important;
        overflow:hidden;
    }}
    .stApp [data-testid="stTextInput"] [data-baseweb="base-input"] {{border:0!important;}}
    .stApp .st-key-login_brand_panel,.stApp .st-key-login_form_panel {{
        border:1px solid {"#c3cfe3" if light else "#2b3e58"}!important;
        background:{"linear-gradient(140deg,#ffffff,#f0f4fc)" if light else "linear-gradient(140deg,#17263b,#101c2e)"}!important;
        border-radius:14px!important;padding:20px!important;
        box-shadow:{"0 6px 24px #526b9510" if light else "0 6px 24px #00000015"};
    }}
    .stApp [data-testid="stTextInput"] [data-baseweb="input"]:focus-within {{border-color:#8172ff!important;box-shadow:0 0 0 2px #8172ff22;}}
    </style>''', unsafe_allow_html=True)
