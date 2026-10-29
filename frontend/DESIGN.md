# AIVA-IoT design direction

TasteSkill source: https://github.com/Leonxlnx/taste-skill/tree/main/skills/taste-skill
Installed locally as design-taste-frontend on 2026-10-13.

## Audit and scope

This is a Streamlit product portal for robot owners and administrators.
The skill's landing-page and React defaults are contextual, so this redesign
uses its audit, preservation, typography, palette and accessibility guidance
within the existing Python frontend.

Existing identity: AIVA-IoT wordmark, violet accent, Xiaozhi robot mascot,
Vietnamese copy, five User navigation destinations and eight Admin routes.
Existing problems: duplicated theme rules, invisible text in light inputs,
large space above content, nested panels and repeated animated robot scenes.

Preserved: internal route identifiers and form labels, mock operations, ownership and role rules,
private chat handling, robot interaction and manual theme switch.
No backend integration, new external services or publishing.
User navigation groups existing features into Trang chủ, Trò chuyện AI (with
history), Robot của tôi, Cài đặt trợ lý (with advanced provider/API settings),
and Tài khoản (with privacy). Old navigation targets resolve to the matching tab;
Admin navigation remains unchanged.

## Decisions

- Design variance 5, motion intensity 4, visual density 5.
- One violet accent, cool neutral surfaces, explicit semantic status colors.
- Typography: system Segoe UI / system sans, no font network dependency.
- Panels 16px, controls 10px, status pills 999px.
- Theme control moves into the sidebar after sign-in.
- Login uses an asymmetric robot / form split; demo credentials use a disclosure.
- User dashboard uses a robot focal point, four metrics and compact device rows.
- Chat preserves its conversation list, centered empty state and automatic naming.
- Entry and navigation stay native Streamlit; CSS changes visual presentation.
- Controls provide hover, active, focus and disabled states.
- Mobile columns collapse below 768px, chat history uses a bounded scroll area.
- Robot scenes use matching light/dark surfaces. Motion is reserved for the
  interactive mascot and theme switch, with reduced-motion support.

## Validation and limits

AppTest smoke and reference suites passed, including all 16 routes in both modes,
chat ending/private disposal, provider disabling, dashboard navigation and
account operations. AppTest verifies Python rendering and behavior, not CSS layout.

Browser inventory returned no connected browsers. Windows native inspection
returned an unavailable native pipe. Screenshots, viewport review, keyboard
inspection and Lighthouse remain unverified in this environment.

The native dark dataframe canvas still uses Streamlit's configured base theme;
light mode uses the existing HTML table alternative.

## Frontend skills applied in this pass

Sources: https://www.tasteskill.dev/ and
https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md.
The installed frontend-design and design-taste-frontend skills guide the login
composition. Web Interface Guidelines guide keyboard focus, form autocomplete,
empty states, text overflow, numeric alignment and reduced motion.

This remains a native Streamlit product portal, not an implementation of Fluent,
Carbon or another React design system. React best practices, composition patterns,
View Transitions and React Native skills do not directly apply to this Python
stack. No React dependencies were added.

- Preserve mode; variance 5, motion 3, density 5. Existing AIVA violet and robot
  artwork are retained. Login uses a Vietnamese heading and full-width submit.
- Shared tables group search and filters, provide a reset action, show filtered
  totals, return to page 1 on filter changes and explain zero results.
- Filter options come from the full dataset so searching cannot hide a selected
  option. Deleted records and stale filters recover on the next rerun.
- Native dark theme matches CSS tokens. Light tables retain the HTML alternative.
- Keyboard focus is visible on input groups, checkboxes and navigation. Long
  account names and table content wrap instead of widening the page.
- The login robot has an explicit pause toggle. Card scenes do not run hidden
  particle animation loops; reduced-motion preferences still stop animation.

Validation: smoke.py and reference.py pass, including all 16 routes in both
themes. tables.py covers pagination, literal search, zero results, reset,
removed filter options, deleted selections and light tables. Browser inventory
is empty in this session, so screenshots, mobile layout and keyboard appearance
remain unverified. No visual-performance or full accessibility pass is claimed.
