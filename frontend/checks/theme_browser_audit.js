/* Paste into Chrome DevTools Console on localhost:8501.
 * Read-only: no DOM/style changes, no input values, no application state writes.
 * Run in Light Mode, Dark Mode, and again after a Streamlit rerun.
 * Open a dropdown before running to include its portal-rendered options.
 */
(() => {
  const properties = ["background", "background-color", "color",
    "-webkit-text-fill-color", "border-color", "opacity", "color-scheme"];
  const tokens = ["bg", "surface", "raised", "text", "muted", "button", "tint"];
  const rules = [];
  const unreadableSheets = [];
  const visit = (sheetRules, source, active = true) => {
    for (const rule of sheetRules) {
      let enabled = active;
      if (rule instanceof CSSMediaRule) enabled &&= matchMedia(rule.conditionText).matches;
      if (rule instanceof CSSSupportsRule) enabled &&= CSS.supports(rule.conditionText);
      if (rule.selectorText && rule.style && enabled) rules.push({rule, source});
      if (rule.cssRules) visit(rule.cssRules, source, enabled);
    }
  };
  Array.from(document.styleSheets).forEach((sheet, index) => {
    try { visit(sheet.cssRules, {index, href: sheet.href, disabled: sheet.disabled}, !sheet.disabled); }
    catch (error) { unreadableSheets.push({index, href: sheet.href, error: error.name}); }
  });
  const describe = element => {
    const computed = getComputedStyle(element);
    const matched = rules.filter(({rule}) => {
      try { return element.matches(rule.selectorText); } catch { return false; }
    }).map(({rule, source}) => ({
      source, selector: rule.selectorText,
      declarations: Object.fromEntries(properties.filter(p => rule.style.getPropertyValue(p))
        .map(p => [p, {value: rule.style.getPropertyValue(p), priority: rule.style.getPropertyPriority(p)}])),
    })).filter(entry => Object.keys(entry.declarations).length);
    return {
      tag: element.tagName, testid: element.dataset.testid, role: element.getAttribute("role"),
      disabled: element.matches(":disabled,[data-disabled],[aria-disabled='true']"),
      computed: Object.fromEntries(properties.map(p => [p, computed.getPropertyValue(p)])),
      tokens: Object.fromEntries(tokens.map(t => [t, computed.getPropertyValue(`--aiva-${t}`).trim()])),
      inline: Object.fromEntries(properties.filter(p => element.style.getPropertyValue(p))
        .map(p => [p, element.style.getPropertyValue(p)])),
      matched,
    };
  };
  const selectors = {
    numberContainers: '[data-testid="stNumberInputContainer"]',
    numberFields: '[data-testid="stNumberInputField"]',
    numberSteps: '[data-testid="stNumberInputStepUp"],[data-testid="stNumberInputStepDown"]',
    selectGroups: ':is([data-testid="stSelectbox"],[data-testid="stMultiSelect"]) [role="group"]:has(input[role="combobox"])',
    selectInputs: ':is([data-testid="stSelectbox"],[data-testid="stMultiSelect"]) input[role="combobox"]',
    buttons: ':is([data-testid="stButton"],[data-testid="stFormSubmitButton"]) button',
    buttonLabels: ':is([data-testid="stButton"],[data-testid="stFormSubmitButton"]) button [data-testid="stMarkdownContainer"]',
    sidebarButtons: '[data-testid="stSidebar"] [data-testid="stButton"] button',
    dropdowns: '[data-testid="stSelectboxVirtualDropdown"],[data-testid="stMultiSelectDropdown"],[data-baseweb="popover"]:has([role="listbox"])',
    options: ':is([data-testid="stSelectboxVirtualDropdown"],[data-testid="stMultiSelectDropdown"]) [role="option"]',
  };
  const report = {
    pathname: location.pathname, timestamp: new Date().toISOString(),
    root: describe(document.documentElement),
    app: document.querySelector('.stApp') ? describe(document.querySelector('.stApp')) : null,
    themeToggle: document.querySelector('.st-key-aiva_theme_switch_scope input')?.checked,
    unreadableSheets,
    controls: Object.fromEntries(Object.entries(selectors).map(([name, selector]) => {
      const elements = Array.from(document.querySelectorAll(selector));
      return [name, {count: elements.length, samples: elements.slice(0, 6).map(describe)}];
    })),
  };
  const output = JSON.stringify(report, null, 2);
  console.log(output);
  if (typeof copy === 'function') copy(output);
  return report;
})();
