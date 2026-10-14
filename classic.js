(() => {
  "use strict";
  const GATE = 'html[data-kcr-enabled="true"]';
  const FAMILY = '"KCR Inter", Inter, Arial, sans-serif';
  const PALETTE = new Map(Object.entries({
    "181818": "1c1d20", "1f1f1f": "202124",
    "3d3d3d": "3c4043", "5a5a5a": "5f6368", "828282": "80868b",
    "909090": "9aa0a6", "b8b8b8": "bdc1c6", "d9d9d9": "dadce0",
    "e6e6e6": "e8eaed", "f1f1f1": "f1f3f4", "f8f8f8": "f8f9fa",
    "b3c8ce": "20beff", "9191ff": "8148fd", "ff6a00": "ff5c19",
    "4d94ff": "20beff", "68a742": "1ccd76",
    "dbf9df": "33bf57", "189629": "197631",
    "f4dcd9": "ff7136", "cd3824": "cc450d",
    "fdf4d5": "ffeb70", "e19a00": "d6ad1b"
  }));
  const COLOR_PROPS = new Set([
    "color", "background-color", "border-color", "border-top-color", "border-right-color",
    "border-bottom-color", "border-left-color", "outline-color", "text-decoration-color",
    "caret-color", "fill", "stroke", "box-shadow"
  ]);
  const INLINE_PROPS = [...COLOR_PROPS, "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-transform"];
  const OWN_ATTRS = new Set();
  const cache = new Map();
  const inlineRules = new Map();
  let overlay;
  let observer;
  let timer;
  let enabled = true;
  let pending = false;
  let dirtySheets = true;
  let lastSignature = "";
  let lastPath = "";
  let previousActive;
  let roleDirty = true;
  let pollCount = 0;
  const dirtyRoots = new Set();

  const mark = (el, key, value) => {
    if (!el) return;
    if (el.getAttribute(key) !== value) el.setAttribute(key, value);
  };
  function rgbKey(r, g, b) {
    return [r, g, b].map(v => Math.round(Number(v)).toString(16).padStart(2, "0")).join("");
  }
  function rgbaFor(hex, alpha) {
    return `rgba(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)}, ${alpha})`;
  }
  function recolor(value, focus) {
    return value.replace(/#([\da-f]{6})([\da-f]{2})?\b|rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/gi,
      (original, hex, alphaHex, r, g, b, alpha) => {
        const key = hex ? hex.toLowerCase() : rgbKey(r, g, b);
        const target = focus && key === "ffc412" ? "20beff" : PALETTE.get(key);
        if (!target) return original;
        const a = alphaHex ? parseInt(alphaHex, 16) / 255 : alpha;
        return a === undefined ? `#${target}` : rgbaFor(target, a);
      });
  }
  function typeOverrides(style) {
    const family = style.getPropertyValue("font-family");
    const size = parseFloat(style.getPropertyValue("font-size"));
    const weight = Number(style.getPropertyValue("font-weight"));
    const line = style.getPropertyValue("line-height");
    const inheritedBody = !family && ((weight === 300 && [12, 14, 16].includes(size) && ["140%", "110%", "1.4", "1.1"].includes(line)) || (weight === 500 && size === 16 && ["140%", "1.4"].includes(line)));
    const googleBody = /Google Sans Flex/i.test(family) || inheritedBody;
    const futurist = /FG Futurist/i.test(family);
    const googleCode = /Google Sans Code/i.test(family);
    if (/Google Symbols/i.test(family) && weight === 300) return { "font-weight": "400" };
    if (!googleBody && !futurist && !googleCode) return {};
    const result = inheritedBody ? {} : { "font-family": googleCode ? '"Roboto Mono", monospace' : FAMILY };
    if (googleCode) {
      result["font-weight"] = "400";
      if (size === 14) result["line-height"] = "20px";
    } else if (futurist && size >= 16 && weight === 400) {
      result["font-weight"] = "700";
      const oldLine = {16: 20, 20: 24, 24: 32, 28: 36, 32: 40, 36: 44, 44: 52};
      if (oldLine[size]) result["line-height"] = `${oldLine[size]}px`;
      result["letter-spacing"] = "normal";
    } else if (futurist && size === 14) {
      result["font-weight"] = "700";
      result["line-height"] = "20px";
      result["letter-spacing"] = "normal";
    } else if (googleBody && weight === 300) {
      result["font-weight"] = "400";
      if (size === 16) result["line-height"] = "24px";
      if (size === 14) result["line-height"] = "20px";
      if (size === 12) {
        const caption = line === "110%" || (parseFloat(line) > 0 && parseFloat(line) < 15);
        result["font-weight"] = caption ? "500" : "400";
        result["line-height"] = caption ? "16px" : "20px";
        result["letter-spacing"] = "0.2px";
      } else result["letter-spacing"] = "normal";
    } else if (googleBody && size === 16 && weight === 500) {
      result["font-weight"] = "600";
      result["line-height"] = "24px";
    } else if (googleBody && size === 14 && weight === 500 && ["140%", "1.4"].includes(line)) {
      Object.assign(result, { "font-family": FAMILY, "font-size": "10px", "font-weight": "600", "line-height": "16px", "letter-spacing": "1px", "text-transform": "uppercase" });
    }
    return result;
  }
  function splitSelectors(text) {
    const parts = [];
    let start = 0, depth = 0, quote = "", escaped = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (escaped) { escaped = false; continue; }
      if (c === "\\") { escaped = true; continue; }
      if (quote) { if (c === quote) quote = ""; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === "(" || c === "[") depth++;
      if (c === ")" || c === "]") depth--;
      if (c === "," && depth === 0) { parts.push(text.slice(start, i).trim()); start = i + 1; }
    }
    parts.push(text.slice(start).trim());
    return parts;
  }
  function gatedSelector(selector, strong = false) {
    const gate = strong ? `${GATE}[data-kcr-enabled="true"]` : GATE;
    return splitSelectors(selector).map(s => {
      if (/^html(?=[\s.#[:]|$)/i.test(s)) return s.replace(/^html/i, gate);
      if (/^:root(?=[\s.#[:]|$)/i.test(s)) return s.replace(/^:root/i, gate);
      return `${gate} ${s}`;
    }).join(",");
  }
  function declarations(style, selector = "") {
    const result = {};
    for (const prop of COLOR_PROPS) {
      const original = style.getPropertyValue(prop);
      const mapped = recolor(original, /focus|Mui-focused/i.test(selector));
      if (mapped !== original) {
        const rootSurface = prop === "background-color" && splitSelectors(selector).some(s => /^(?:body|html|:root)$/.test(s));
        result[prop] = rootSurface ? "var(--kcr-page)" : mapped;
      }
    }
    Object.assign(result, typeOverrides(style));
    const normal = [], important = [];
    for (const [k, v] of Object.entries(result)) {
      (style.getPropertyPriority(k) === "important" ? important : normal).push(`${k}:${v}!important`);
    }
    return { normal: normal.join(";"), important: important.join(";") };
  }
  function rewriteRules(rules) {
    const output = [];
    for (const rule of rules) {
      if (rule.selectorText && rule.style) {
        const body = declarations(rule.style, rule.selectorText);
        if (body.normal) output.push(`${gatedSelector(rule.selectorText)}{${body.normal}}`);
        if (body.important) output.push(`${gatedSelector(rule.selectorText, true)}{${body.important}}`);
      } else if (rule.cssRules) {
        const nested = rewriteRules(rule.cssRules);
        if (nested) {
          const prefix = rule.cssText.slice(0, rule.cssText.indexOf("{"));
          output.push(`${prefix}{${nested}}`);
        }
      }
    }
    return output.join("\n");
  }
  function isOwnNode(node) {
    return node?.nodeType === 1 && (node.hasAttribute("data-kcr-owned") || node.closest?.('[data-kcr-owned]'));
  }
  function originalSheets() {
    return Array.from(document.styleSheets).filter(s => !isOwnNode(s.ownerNode));
  }
  function refreshSheets() {
    const sheets = originalSheets();
    const current = new Set(sheets);
    for (const sheet of cache.keys()) if (!current.has(sheet)) cache.delete(sheet);
    for (const sheet of sheets) {
      try {
        const count = sheet.cssRules.length;
        const saved = cache.get(sheet);
        if (dirtySheets || !saved || saved.count !== count) {
          cache.set(sheet, { count, css: rewriteRules(sheet.cssRules) });
        }
      } catch (_) {}
    }
    dirtySheets = false;
    const text = [...cache.values()].map(v => v.css).join("\n") + "\n" + [...inlineRules.values()].map(v => v.css).join("\n");
    if (overlay.textContent !== text) overlay.textContent = text;
  }
  function avatarCircle(el) {
    const svg = el.closest?.("svg");
    return svg?.previousElementSibling?.matches('[data-testid="avatar-image"]');
  }
  function patchInline(el) {
    if (!el.style || isOwnNode(el) || avatarCircle(el) || el.closest?.('.js-plotly-plot,.vega-embed,.bk-root,.monaco-editor,.CodeMirror,.cm-editor,[contenteditable="true"]')) return;
    const overrides = {};
    for (const prop of COLOR_PROPS) {
      const source = el.style.getPropertyValue(prop);
      if (!source) continue;
      const target = recolor(source, false);
      if (target !== source) overrides[prop] = target;
    }
    Object.assign(overrides, typeOverrides(el.style));
    for (const prop of INLINE_PROPS) {
      const attr = `data-kcr-inline-${prop}`;
      OWN_ATTRS.add(attr);
      const target = overrides[prop];
      if (!target) { if (el.hasAttribute(attr)) el.removeAttribute(attr); continue; }
      const key = `${prop}:${target}`;
      if (!inlineRules.has(key)) {
        const id = String(inlineRules.size);
        inlineRules.set(key, { id, css: `${GATE} [${attr}="${id}"]{${prop}:${target}!important}` });
      }
      mark(el, attr, inlineRules.get(key).id);
    }
  }
  function scanInline(root) {
    if (root?.nodeType !== 1 || isOwnNode(root)) return;
    if (root.hasAttribute("style")) patchInline(root);
    root.querySelectorAll("[style]").forEach(patchInline);
  }
  function detectTheme() {
    const raw = document.body?.style.getPropertyValue("background-color");
    let background = raw;
    if (!background) {
      const prior = document.documentElement.getAttribute("data-kcr-theme");
      document.documentElement.removeAttribute("data-kcr-theme");
      background = document.body ? getComputedStyle(document.body).backgroundColor : "";
      if (prior) document.documentElement.setAttribute("data-kcr-theme", prior);
    }
    const channels = background?.match(/[\d.]+/g);
    const dark = channels && channels.length >= 3 && Number(channels[0]) + Number(channels[1]) + Number(channels[2]) < 380;
    mark(document.documentElement, "data-kcr-theme", dark ? "dark" : "light");
  }
  function iconElements(el) {
    return Array.from(el.querySelectorAll('span[aria-hidden="true"],svg'));
  }
  function annotateNavigation() {
    const navigation = document.querySelector('nav[aria-label="Main Kaggle page navigation"]');
    const menu = navigation?.querySelector('button[aria-label="Navigation menu"]');
    if (menu) {
      mark(menu, "data-kcr-role", "nav-menu-button");
      mark(menu.parentElement, "data-kcr-role", "nav-menu-holder");
    }
    const create = document.querySelector('button[aria-label="Create on Kaggle"], nav button[aria-label="Create"]');
    if (create) {
      mark(create, "data-kcr-role", "create-button");
      mark(create, "data-kcr-collapsed", create.title === "Create" ? "true" : "false");
      if (create.firstElementChild?.tagName === "SPAN") mark(create.firstElementChild, "data-kcr-role", "create-content");
      iconElements(create).forEach(el => {
        if (el.tagName.toLowerCase() === "svg" && el.getAttribute("viewBox") === "0 0 118 44") mark(el, "data-kcr-role", "create-shape");
        else if (el.textContent.trim() === "add") mark(el, "data-kcr-role", "create-icon");
      });
      create.querySelectorAll(".custom-icon").forEach(el => {
        mark(el, "data-kcr-role", "create-icon-mask");
        mark(el.parentElement, "data-kcr-role", "create-icon-holder");
      });
      create.querySelectorAll('p').forEach(el => {
        if (el.textContent.trim() === 'Create') {
          mark(el, "data-kcr-role", "create-label");
          mark(el.parentElement?.parentElement, "data-kcr-role", "create-label-holder");
        }
      });
    }
    const logoLink = document.querySelector('[data-testid="kaggle-logo-wrapper"] a, a[aria-label="Return to Kaggle home page"]');
    if (logoLink && !logoLink.closest("main")) {
      mark(logoLink, "data-kcr-role", "site-logo");
      if (!logoLink.querySelector('[data-kcr-legacy-logo]')) {
        const img = document.createElement("img");
        img.setAttribute("data-kcr-owned", "logo");
        img.setAttribute("data-kcr-legacy-logo", "");
        img.alt = "";
        img.src = chrome.runtime.getURL("assets/legacy-logo.svg");
        logoLink.append(img);
      }
    }
    const nav = document.querySelector('nav[aria-label="Main Kaggle page navigation"]');
    if (!nav) return;
    const oldIcons = { Home: "explore", Competitions: "emoji_events", Benchmarks: "leaderboard", "Game Arena": "smart_toy", "Data Hub": "code", "More on Kaggle": "format_list_bulleted", Discussions: "forum", "Kaggle Learn": "school" };
    nav.querySelectorAll('a[aria-label]').forEach(link => {
      const glyph = oldIcons[link.getAttribute('aria-label')];
      if (!glyph) return;
      link.querySelectorAll('.custom-icon').forEach(el => {
        mark(el, "data-kcr-role", "nav-icon");
        mark(el, "data-kcr-glyph", glyph);
      });
    });
    const path = location.pathname;
    const prefix = ["competitions", "benchmarks", "game-arena", "datasets", "models", "code", "discussions", "learn"].find(p => path === `/${p}` || path.startsWith(`/${p}/`));
    const href = prefix ? `/${prefix}` : path === "/" ? "/" : null;
    const link = href && nav.querySelector(`a[href="${href}"]`);
    const nextActive = link?.closest('li,[role="listitem"]');
    if (nextActive !== previousActive) {
      if (previousActive?.isConnected) previousActive.removeAttribute("data-kcr-role");
      previousActive = nextActive;
    }
    if (previousActive) mark(previousActive, "data-kcr-role", "nav-active");
  }
  function annotateComponents() {
    annotateNavigation();
    if (/^\/competitions\/.+/.test(location.pathname)) document.querySelectorAll('h1').forEach(el => mark(el, "data-kcr-role", "competition-title"));
    document.querySelectorAll('[data-testid="avatar-image"] + svg').forEach(svg => {
      const track = svg.querySelector("circle");
      const stroke = track?.style.stroke || track?.getAttribute("stroke") || "";
      if (stroke === "transparent" || /rgba\([^)]*,\s*0\s*\)/.test(stroke)) mark(svg, "data-kcr-ring", "hidden");
      else if (svg.hasAttribute("data-kcr-ring")) svg.removeAttribute("data-kcr-ring");
    });
    const actions = new Map([
      ["Submit Prediction", "primary-button"], ["Save Changes", "primary-button"], ["Join Competition", "primary-button"],
      ["New Notebook", "outline-button"], ["New Topic", "outline-button"],
      ["Raw Data", "outline-button"], ["Refresh", "outline-button"], ["Follow", "outline-button"]
    ]);
    document.querySelectorAll(':is(main,[role="main"]) button,:is(main,[role="main"]) [role="button"]').forEach(el => {
      const label = el.textContent.trim().replace(/\s+/g, " ");
      for (const [text, role] of actions) {
        if (label === text || label.endsWith(text) || el.getAttribute("aria-label") === text) mark(el, "data-kcr-role", role);
      }
    });
    document.querySelectorAll("label").forEach(el => {
      if (/^team name$/i.test(el.textContent.trim())) mark(el, "data-kcr-role", "team-name-label");
    });
    if (/\/submissions(?:\/|$)/.test(location.pathname)) {
      document.querySelectorAll(':is(main,[role="main"]) [role="progressbar"], :is(main,[role="main"]) svg[aria-label*="Running"], :is(main,[role="main"]) svg[aria-label*="Loading"]').forEach(el => mark(el, "data-kcr-role", "submission-spinner"));
      const main = document.querySelector('main,[role="main"]');
      if (main) {
        const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          if (node.nodeValue.trim() !== "Auto-selection candidates") continue;
          const label = node.parentElement;
          const container = label.childElementCount ? label : label.parentElement;
          for (const marker of container?.children || []) {
            if (marker.querySelector('a,input,button') || marker.contains(label) || marker === label) continue;
            const style = getComputedStyle(marker);
            if (/255\s*,\s*196\s*,\s*18/.test(style.backgroundColor) && parseFloat(style.width) <= 22 && parseFloat(style.height) <= 22) mark(marker, "data-kcr-role", "candidate-marker");
          }
        }
        main.querySelectorAll("[style]").forEach(el => {
          if (/255\s*,\s*196\s*,\s*18|ffc412/i.test(el.style.borderRightColor)) mark(el, "data-kcr-role", "candidate-row");
        });
        main.querySelectorAll('li,[role="listitem"],div').forEach(el => {
          const style = getComputedStyle(el);
          if (parseFloat(style.borderRightWidth) >= 4 && /255\s*,\s*196\s*,\s*18/.test(style.borderRightColor) && /succeeded|complete|version/i.test(el.textContent) && el.querySelector('a')) mark(el, "data-kcr-role", "candidate-row");
        });
        main.querySelectorAll('svg circle[fill="none"]').forEach(el => {
          const svg = el.closest('svg');
          const row = svg?.closest('li,[role="listitem"]');
          const semanticSpinner = svg?.closest('[role="progressbar"]') || /CircularProgress/.test(svg?.getAttribute('class') || '') || /Notebook Running|Pending|Processing/i.test(row?.textContent || '');
          if (semanticSpinner && !avatarCircle(el) && /255\s*,\s*196\s*,\s*18/.test(el.style.stroke || el.getAttribute("stroke") || getComputedStyle(el).stroke)) mark(el, "data-kcr-role", "submission-spinner");
        });
      }
    }
  }
  function flush() {
    pending = false;
    if (!enabled || !document.body || !overlay?.isConnected) return;
    detectTheme();
    for (const root of dirtyRoots) if (root.isConnected) scanInline(root);
    dirtyRoots.clear();
    if (roleDirty || location.pathname !== lastPath) {
      annotateComponents();
      roleDirty = false;
    }
    refreshSheets();
    lastPath = location.pathname;
  }
  function schedule(root, force) {
    if (root?.nodeType === 1 && !isOwnNode(root)) { dirtyRoots.add(root); roleDirty = true; }
    if (force) dirtySheets = true;
    if (!pending && enabled) { pending = true; setTimeout(flush, 120); }
  }
  function signature() {
    return originalSheets().map(s => { try { return s.cssRules.length; } catch (_) { return -1; } }).join(",");
  }
  function start() {
    if (!document.head || !document.body) { document.addEventListener("DOMContentLoaded", start, { once: true }); return; }
    overlay = document.createElement("style");
    overlay.setAttribute("data-kcr-owned", "overlay");
    document.head.append(overlay);
    observer = new MutationObserver(records => {
      if (!enabled) return;
      let force = false;
      for (const r of records) {
        if (isOwnNode(r.target) || isOwnNode(r.target.parentElement)) continue;
        if (r.type === "attributes") {
          if (r.attributeName === "style") {
            if (r.target === document.body) detectTheme();
            patchInline(r.target);
            schedule(null, false);
          }
          else {
            if (r.target.closest?.('nav')) roleDirty = true;
            schedule(null, false);
          }
        } else {
          if (r.target.closest?.("head,style") || r.target.tagName === "STYLE") force = true;
          for (const added of r.addedNodes) if (added.nodeType === 1) schedule(added, false);
          schedule(null, false);
        }
      }
      if (force) schedule(null, true);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "aria-current", "aria-selected"] });
    schedule(document.body, true);
    timer = setInterval(() => {
      if (!enabled || document.hidden) return;
      const value = signature();
      const periodicRefresh = ++pollCount % 12 === 0;
      if (value !== lastSignature || location.pathname !== lastPath) {
        const pathChanged = location.pathname !== lastPath;
        lastSignature = value;
        schedule(null, pathChanged);
      } else if (periodicRefresh) schedule(null, true);
    }, 1200);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) schedule(document.body, true); });
  }
  globalThis.KcrClassic = {
    setEnabled(value) {
      enabled = value !== false;
      if (!enabled) dirtyRoots.clear();
      if (enabled && overlay) schedule(document.body, true);
    },
    refresh() { schedule(document.body, true); }
  };
  start();
})();
