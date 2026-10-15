# AIVA Portal UI verification — 2026-10-14

This is evidence from the existing local Streamlit application in Chrome, not
a claim that Python tests validate browser layout. Admin used the authorized
demo session at localhost:8502; User used the existing session at localhost:8501.
Chrome page zoom was 100%; DevTools viewport emulation used Fit to window.

## Confirmed causes and fixes

- Header: Streamlit retained `stMain.scrollTop=96` across login/navigation.
  The header started at y=0 behind the native toolbar ending at y=60. Resetting
  scroll restored header y=96 without changing padding. The existing route
  observer now resets scroll on entry/heading changes, retaining same-page scroll.
- Historical theme diagnostics: the old `dark` field was the requested test
  state, and the test restored the original state afterward. It did not prove
  the theme visible in a later screenshot. Version 2 records toggle, CSS scheme,
  actual root scheme and computed application/sidebar backgrounds separately.
- Newly found chat layout: native columns use a 1:3.4 ratio and 64px gap. At a
  narrow window with the app sidebar open, history collapsed into a few pixels.
  The old `max-width:767px` viewport rule did not change the columns. The scoped
  `aiva-chat` container query now stacks chat columns when the actual workspace
  is at most 700px. The 1440px desktop layout retains its existing two columns.

No theme palette, authentication, navigation, data/API contracts, robot code or
iframe sandbox permissions were changed in this continuation.

## Browser checks

| Scope | Evidence | Result |
| --- | --- | --- |
| 8 Admin routes × Light/Dark, 1024×1080 | theme-browser-admin-v2-1024.json | 16 route/theme checks pass |
| 8 User routes × Light/Dark, 1024×1080 | theme-browser-user-v2-1024.json | 16 route/theme checks pass |
| 8 Admin routes × Light/Dark, 1440×1080 | theme-browser-admin-v2-1440.json | 16 route/theme checks pass |
| 8 User routes × Light/Dark, 1440×1080 | theme-browser-user-v2-1440.json | 16 route/theme checks pass |
| Admin tabs/expanders/open selects, 1024px | interactions-admin-1024.json | 140 samples, 1980 control observations pass |
| Admin tabs/expanders/open selects, 1440px | interactions-admin-1440.json | 140 samples, 232 option observations pass |
| User tabs/expanders/open selects, 1024px | interactions-user-1024.json | 69 samples, 75 option observations pass |
| Chat container layout, Light/Dark | chat-layout-768.json, chat-layout-1024.json, chat-layout-1440.json | Narrow: stacked; desktop: two columns |
| Existing chat popover and disabled provider/composer, Light/Dark | chat-popover.json | Popover opens; measured text contrast passes |

The 1920px role reports were obtained in the preceding run. New 1024/1440px
route checks deliberately scrolled before navigation and sampled the header
four times per route. They compare actual theme colors and robot render/theme
diagnostics, rather than relying solely on a requested boolean.

Native keyboard selection was verified on the User AI Chat provider: Down +
Enter selected OpenAI; Alt+Down, Up + Enter restored Local AI. No chat was sent
and no forms were submitted. A native narrow-window screenshot before/after
confirmed the history title and buttons no longer wrap character by character.

## Automated checks after the CSS change

- `checks/theme_ui.py`: palette, 8 routes per role, Light/Dark/Light and reruns pass.
- `checks/smoke.py`: both roles and functional regression checks pass.
- Node header scroll and robot theme tests: 3 pass.
- New browser scripts: Node syntax checks pass; `git diff --check` passes.

## Limits

- New full-route 1024/1440px checks preceded the chat-only CSS change; the changed
  chat layout was then rechecked separately at 768/1024/1440px in both themes.
- Keyboard selection was sampled on the provider control, not every selectbox.
- Not every form validation/error state, long user-supplied dataset, dropdown
  scroll position, or possible overlay state was exercised.
- No full Admin/User route sweep at 768px was completed in this continuation.
- Robot theme/render success was checked during route sweeps; rotation, waving
  and zoom were not re-tested here because robot implementation was unchanged.
- Streamlit iframe sandbox/unsupported-feature warnings remain. They were not
  treated as rendering failures or addressed by relaxing security settings.
