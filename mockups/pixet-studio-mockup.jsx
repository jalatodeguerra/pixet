import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

const STYLES = `
:root {
  --bg: #0a0d10;
  --surface: #15181e;
  --surface-2: #191d24;
  --surface-3: #20252e;
  --chrome: #101318;
  --text: #e9edf3;
  --text-2: #9ca6b5;
  --text-3: #687382;
  --line: rgba(255,255,255,.065);
  --line-strong: rgba(255,255,255,.105);
  --accent: #93aaff;
  --accent-strong: #b8c8ff;
  --accent-soft: rgba(143,168,255,.12);
  --mint: #93e3a4;
  --gold: #f4c558;
  --font: "Inter", "InterVariable", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --mono: "JetBrains Mono", "SFMono-Regular", "Cascadia Code", "Roboto Mono", Consolas, monospace;
}

html, body, #root { height: 100%; }
html, body { margin: 0; padding: 0; background: #080a0d; }
body { font-family: var(--font); overflow: hidden; }
*, *::before, *::after { box-sizing: border-box; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
button:disabled { cursor: default; }
input { font: inherit; color: inherit; }
::selection { background: rgba(143,168,255,.3); color: #fff; }

.app-shell {
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background:
    radial-gradient(1200px 800px at 50% 28%, #11151c 0%, #090c10 55%, #06080b 100%);
}
.app-frame {
  position: relative;
  flex: none;
  width: 1280px;
  height: 800px;
  border-radius: 12px;
  overflow: hidden;
  transform-origin: center center;
  box-shadow: 0 50px 140px -35px rgba(0,0,0,.95), 0 22px 55px -28px rgba(0,0,0,.9), 0 0 0 1px rgba(255,255,255,.10);
  will-change: transform;
}
.app {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  border-radius: 12px;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  font-size: 12px;
  line-height: 1.4;
  letter-spacing: -.005em;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  user-select: none;
}
.app input { user-select: text; }
.mono { font-family: var(--mono); font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
.kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border: 1px solid var(--line-strong);
  border-bottom-color: rgba(255,255,255,.16);
  border-radius: 4px;
  background: rgba(255,255,255,.045);
  box-shadow: 0 1px 0 rgba(0,0,0,.45);
  color: #96a1b0;
  font-family: var(--mono);
  font-size: 8.5px;
  line-height: 1;
  white-space: nowrap;
}

/* ------------------------------- chrome -------------------------------- */

.topbar {
  position: relative;
  z-index: 50;
  height: 46px;
  flex: none;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  padding: 0 12px;
  background: linear-gradient(180deg, #14181d 0%, #101318 100%);
  border-bottom: 1px solid var(--line);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.025);
}
.tb-left, .tb-right { display: flex; align-items: center; min-width: 0; }
.tb-left { gap: 10px; }
.tb-right { justify-content: flex-end; gap: 5px; }
.tb-center { display: flex; align-items: center; justify-content: center; }
.tb-sep { width: 1px; height: 19px; flex: none; background: var(--line); margin: 0 3px; }
.brand { display: flex; align-items: center; gap: 8px; flex: none; user-select: none; }
.brand-mark {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: linear-gradient(145deg, #bccbff 0%, #91a9ff 48%, #6d86ed 100%);
  box-shadow: 0 1px 0 rgba(255,255,255,.5) inset, 0 7px 18px -8px rgba(137,162,255,.8);
  color: #0b1223;
}
.brand-word { font-size: 14px; font-weight: 650; letter-spacing: -.035em; color: #f1f4f9; }
.menu-strip { display: flex; align-items: center; gap: 1px; position: relative; }
.menu-wrap { position: relative; }
.menu-btn {
  height: 26px;
  padding: 0 8px;
  border-radius: 6px;
  color: #9aa5b3;
  font-size: 11.5px;
  font-weight: 500;
  transition: background .13s ease, color .13s ease;
}
.menu-btn:hover { background: rgba(255,255,255,.045); color: #e3e8ef; }
.menu-btn.open { background: rgba(255,255,255,.07); color: #f2f5fa; box-shadow: inset 0 0 0 1px var(--line); }
.menu-pop {
  position: absolute;
  top: calc(100% + 8px);
  left: -2px;
  z-index: 100;
  width: 238px;
  padding: 5px;
  border: 1px solid rgba(255,255,255,.11);
  border-radius: 10px;
  background: #181c22;
  box-shadow: 0 26px 60px -14px rgba(0,0,0,.9), 0 0 0 1px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.05);
  animation: menu-in .13s cubic-bezier(.2,.8,.2,1);
}
@keyframes menu-in { from { opacity: 0; transform: translateY(-4px) scale(.985); } to { opacity: 1; transform: none; } }
.menu-item {
  width: 100%;
  height: 29px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 8px;
  border-radius: 6px;
  color: #d4dae3;
  font-size: 11.5px;
  text-align: left;
}
.menu-item:hover { background: rgba(143,168,255,.12); color: #fff; }
.menu-tail { display: flex; align-items: center; gap: 5px; color: var(--accent); }
.menu-shortcut { font-family: var(--mono); font-size: 8.5px; color: #6f7a89; letter-spacing: -.02em; }
.menu-divider { height: 1px; margin: 5px 7px; background: var(--line); }

.modes {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(5,8,11,.48);
  box-shadow: inset 0 1px 3px rgba(0,0,0,.36);
}
.mode {
  height: 24px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border-radius: 6px;
  color: #8b97a6;
  font-size: 10.5px;
  font-weight: 550;
  transition: background .14s ease, color .14s ease, box-shadow .14s ease;
}
.mode:hover { color: #c9d1dc; }
.mode.active {
  background: #232932;
  color: #eef2f8;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.07), 0 2px 8px rgba(0,0,0,.38);
}
.mode-badge {
  display: inline-grid;
  place-items: center;
  min-width: 12px;
  height: 12px;
  padding: 0 3px;
  border-radius: 3px;
  background: rgba(255,255,255,.05);
  color: #687585;
  font-family: var(--mono);
  font-size: 7.5px;
}
.icon-btn {
  width: 28px;
  height: 28px;
  flex: none;
  display: inline-grid;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 7px;
  color: #97a2b1;
  transition: background .13s ease, color .13s ease, border-color .13s ease;
}
.icon-btn:hover { background: rgba(255,255,255,.05); border-color: var(--line); color: #e6ebf2; }
.icon-btn.on { background: rgba(143,168,255,.16); border-color: rgba(143,168,255,.3); color: #cedaff; }
.icon-btn.sm { width: 23px; height: 23px; border-radius: 5px; }
.icon-btn:disabled { opacity: .28; }
.actions-group { display: flex; align-items: center; gap: 1px; }
.export-btn {
  height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 9px 0 10px;
  border-radius: 7px;
  background: linear-gradient(180deg, #bccbff 0%, #91a9ff 100%);
  color: #0b1224;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: -.01em;
  box-shadow: 0 1px 0 rgba(255,255,255,.5) inset, 0 7px 20px -9px rgba(138,164,255,.9);
  transition: filter .13s ease, transform .13s ease;
}
.export-btn:hover { filter: brightness(1.06); }
.export-btn:active { transform: translateY(1px); }
.export-chevron { display: flex; margin-left: 1px; opacity: .6; }

/* ------------------------------ options -------------------------------- */

.optionsbar {
  height: 44px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 0 12px;
  border-bottom: 1px solid var(--line);
  background: #0e1115;
  overflow: hidden;
}
.opt-group { display: flex; align-items: center; gap: 10px; min-width: 0; }
.active-tool {
  height: 27px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 7px;
  border: 1px solid rgba(143,168,255,.18);
  border-radius: 7px;
  background: rgba(143,168,255,.085);
  color: #c8d4ff;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.045);
}
.active-tool-name { font-size: 11px; font-weight: 600; white-space: nowrap; }
.v-sep { width: 1px; height: 18px; flex: none; background: var(--line); }
.opt-field { display: flex; align-items: center; gap: 7px; flex: none; }
.opt-label {
  color: #7b8795;
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .09em;
  white-space: nowrap;
}
.value-pill {
  height: 20px;
  min-width: 42px;
  padding: 0 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: rgba(255,255,255,.035);
  color: #d9e0e9;
  font-family: var(--mono);
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.value-pill.tiny { height: 18px; min-width: 35px; font-size: 8.5px; }
.chip {
  height: 26px;
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: rgba(255,255,255,.018);
  color: #909ba9;
  font-size: 10.5px;
  font-weight: 500;
  white-space: nowrap;
  transition: background .13s ease, color .13s ease, border-color .13s ease;
}
.chip:hover { background: rgba(255,255,255,.045); color: #dce3ec; border-color: var(--line-strong); }
.chip.active { background: rgba(143,168,255,.1); border-color: rgba(143,168,255,.25); color: #bbcaff; }
.chip.compact { height: 24px; padding: 0 7px; font-size: 10px; }
.symmetry-field { gap: 3px; }
.symmetry-field .opt-label { margin-right: 4px; }
.toggle-mini {
  width: 21px;
  height: 21px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: rgba(255,255,255,.015);
  color: #75808f;
  font-family: var(--mono);
  font-size: 8.5px;
  transition: .13s ease;
}
.toggle-mini:hover { color: #dbe3ed; background: rgba(255,255,255,.05); }
.toggle-mini.active { color: #cbd7ff; background: rgba(143,168,255,.13); border-color: rgba(143,168,255,.3); }
.options-hint {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  color: #778390;
  font-size: 9.5px;
  white-space: nowrap;
}
.options-hint .kbd { height: 15px; min-width: 15px; font-size: 8px; color: #76818f; }
.hint-dot { width: 2px; height: 2px; border-radius: 50%; background: #3f4955; margin: 0 1px; }

/* -------------------------------- layout -------------------------------- */

.main {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 8px;
  padding: 8px;
  overflow: hidden;
  background:
    radial-gradient(800px 420px at 18% -12%, rgba(124,154,255,.055), transparent 65%),
    radial-gradient(760px 500px at 100% 112%, rgba(112,213,150,.035), transparent 62%),
    #0b0e12;
}
.rail {
  width: 50px;
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 0 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: linear-gradient(180deg, #161a20 0%, #12151a 100%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.035), 0 18px 34px -28px rgba(0,0,0,.9);
}
.rail-group { display: flex; flex-direction: column; align-items: center; gap: 2px; width: 100%; }
.rail-sep { width: 22px; height: 1px; flex: none; margin: 5px 0; background: var(--line); }
.rail-btn {
  position: relative;
  width: 36px;
  height: 33px;
  display: grid;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 8px;
  color: #7f8b9a;
  transition: background .13s ease, color .13s ease, border-color .13s ease;
}
.rail-btn:hover { background: rgba(255,255,255,.05); color: #e0e6ee; }
.rail-btn.active {
  background: linear-gradient(180deg, rgba(143,168,255,.23), rgba(143,168,255,.09));
  border-color: rgba(143,168,255,.26);
  color: #c6d4ff;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 5px 14px -9px rgba(143,168,255,.65);
}
.rail-tip {
  position: absolute;
  left: calc(100% + 9px);
  top: 50%;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 7px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: #1b1f27;
  box-shadow: 0 12px 26px -8px rgba(0,0,0,.8);
  color: #e1e7ef;
  font-size: 10px;
  font-weight: 500;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transform: translateY(-50%) translateX(-3px);
  transition: opacity .12s ease, transform .12s ease;
}
.rail-tip .kbd { height: 14px; min-width: 14px; font-size: 8px; }
.rail-btn:hover .rail-tip { opacity: 1; transform: translateY(-50%) translateX(0); }
.rail-bottom { margin-top: auto; display: flex; flex-direction: column; align-items: center; gap: 12px; padding-top: 12px; }
.rail-colors { position: relative; width: 30px; height: 30px; }
.mini-swatch {
  position: absolute;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  border: 1px solid rgba(255,255,255,.25);
  box-shadow: 0 2px 6px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.22);
}
.mini-swatch.fg { left: 0; top: 0; z-index: 2; }
.mini-swatch.bg { right: 0; bottom: 0; z-index: 1; }
.swap-mini {
  position: absolute;
  z-index: 3;
  right: -4px;
  top: -4px;
  width: 15px;
  height: 15px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line-strong);
  border-radius: 4px;
  background: #29313b;
  color: #b3bfcd;
  box-shadow: 0 2px 7px rgba(0,0,0,.5);
}
.swap-mini:hover { color: #fff; background: #2d3540; }
.rail-help {
  width: 19px;
  height: 19px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 50%;
  color: #5f6b79;
  font-family: var(--mono);
  font-size: 9px;
  transition: .13s ease;
}
.rail-help:hover { color: #d5dde7; border-color: var(--line-strong); }
.center { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 8px; }

/* ------------------------------- workspace ------------------------------ */

.workspace {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 13px;
  background:
    radial-gradient(55% 55% at 48% 8%, rgba(143,168,255,.055), transparent 72%),
    radial-gradient(44% 50% at 82% 100%, rgba(118,213,154,.03), transparent 72%),
    #0d1014;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.03), 0 20px 42px -30px rgba(0,0,0,.9);
}
.workspace::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 0;
  background-image: radial-gradient(rgba(255,255,255,.07) 1px, transparent 1px);
  background-size: 18px 18px;
  opacity: .34;
  pointer-events: none;
}
.workspace::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 0;
  background: radial-gradient(ellipse at 50% 48%, transparent 35%, rgba(4,6,9,.45) 100%);
  pointer-events: none;
}
.stage {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  overflow: auto;
  padding: 20px 22px 54px;
  scrollbar-width: none;
}
.stage::-webkit-scrollbar { display: none; }
.stage-inner { margin: auto; flex: none; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.app.ui-ready .stage-inner { transition: transform .28s cubic-bezier(.2,.8,.2,1); }
.art-meta {
  height: 17px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #8793a2;
  font-size: 10px;
  white-space: nowrap;
}
.art-meta .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--mint); box-shadow: 0 0 8px rgba(147,227,164,.65); }
.art-name { color: #c1cad6; font-weight: 550; }
.meta-sep { width: 1px; height: 9px; background: var(--line-strong); }
.art-meta .mono { font-size: 9px; color: #8491a1; }
.mode-caption { font-family: var(--mono); font-size: 8.5px; color: #66717f; letter-spacing: .08em; }
.artboard {
  position: relative;
  flex: none;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,.22);
  border-radius: 3px;
  outline: 1px solid rgba(255,255,255,.055);
  outline-offset: 3px;
  box-shadow:
    0 36px 80px -28px rgba(0,0,0,.95),
    0 14px 30px -18px rgba(0,0,0,.8),
    0 0 0 1px rgba(0,0,0,.5);
  cursor: crosshair;
}
.checker {
  background-color: #232931;
  background-image: conic-gradient(#2c333c 25%, #20262d 0 50%, #2c333c 0 75%, #20262d 0);
  background-size: 16px 16px;
}
.artboard-checker { position: absolute; inset: 0; }
.art-svg { position: absolute; inset: 0; z-index: 2; }
.art-svg .pixel-art { display: block; width: 100%; height: 100%; }
.pixel-art { display: block; width: 100%; height: 100%; }
.pixel-grid {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  background-image:
    linear-gradient(to right, rgba(255,255,255,.085) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255,255,255,.085) 1px, transparent 1px);
  opacity: .38;
}
.hover-pixel {
  position: absolute;
  z-index: 4;
  pointer-events: none;
  border: 1px solid rgba(206,221,255,.92);
  background: rgba(143,168,255,.075);
  box-shadow: 0 0 0 1px rgba(4,7,11,.65), 0 0 12px rgba(143,168,255,.28);
}
.zoom-pill {
  position: absolute;
  left: 50%;
  bottom: 14px;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 1px;
  height: 34px;
  padding: 0 4px;
  border: 1px solid var(--line-strong);
  border-radius: 9px;
  background: rgba(18,22,28,.9);
  box-shadow: 0 14px 34px -12px rgba(0,0,0,.85), inset 0 1px 0 rgba(255,255,255,.055);
  backdrop-filter: blur(16px);
  transform: translateX(-50%);
}
.app.ui-ready .zoom-pill { transition: left .28s cubic-bezier(.2,.8,.2,1); }
.zoom-btn {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  color: #8b96a5;
  transition: .13s ease;
}
.zoom-btn:hover { background: rgba(255,255,255,.065); color: #eef2f8; }
.zoom-value {
  min-width: 58px;
  text-align: center;
  color: #e5ebf4;
  font-family: var(--mono);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  letter-spacing: -.01em;
}
.zoom-div { width: 1px; height: 15px; margin: 0 3px; background: var(--line); }

/* ----------------------------- floating preview ------------------------- */

.floating {
  position: absolute;
  z-index: 30;
  width: 292px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,.11);
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(27,31,38,.98), rgba(17,20,26,.985));
  box-shadow:
    0 42px 90px -26px rgba(0,0,0,.95),
    0 16px 38px -20px rgba(0,0,0,.8),
    inset 0 1px 0 rgba(255,255,255,.075);
  backdrop-filter: blur(20px);
  animation: float-in .24s cubic-bezier(.2,.8,.2,1);
  transition: box-shadow .16s ease;
}
.app.ui-ready .floating { transition: box-shadow .16s ease, left .28s cubic-bezier(.2,.8,.2,1), top .28s cubic-bezier(.2,.8,.2,1); }
.floating::before {
  content: "";
  position: absolute;
  left: 12px;
  right: 12px;
  top: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(167,187,255,.55), rgba(147,227,164,.28), transparent);
  opacity: .7;
  pointer-events: none;
}
.floating.dragging {
  box-shadow:
    0 55px 120px -26px rgba(0,0,0,.98),
    0 0 0 1px rgba(143,168,255,.22),
    0 0 48px -9px rgba(143,168,255,.18);
  transition: none;
}
.app.ui-ready .floating.dragging { transition: none; }
@keyframes float-in { from { opacity: 0; transform: translateY(9px) scale(.982); } to { opacity: 1; transform: none; } }
.fp-head {
  height: 38px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 7px 0 9px;
  border-bottom: 1px solid var(--line);
  background: linear-gradient(180deg, rgba(255,255,255,.028), transparent);
  cursor: grab;
  touch-action: none;
}
.floating.dragging .fp-head { cursor: grabbing; }
.fp-grip { display: flex; color: #707c8b; flex: none; }
.fp-title { color: #bdc7d4; font-size: 9.5px; font-weight: 650; letter-spacing: .11em; text-transform: uppercase; white-space: nowrap; }
.fp-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 18px;
  padding: 0 6px;
  border: 1px solid rgba(143,168,255,.2);
  border-radius: 5px;
  background: rgba(143,168,255,.075);
  color: #b6c5f4;
  font-size: 9px;
  font-weight: 500;
  white-space: nowrap;
}
.fp-tag .dot { width: 4px; height: 4px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 6px rgba(143,168,255,.7); }
.fp-head-actions { margin-left: auto; display: flex; align-items: center; gap: 1px; }
.fp-icon {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  color: #aab6c4;
  transition: .13s ease;
}
.fp-icon:hover { background: rgba(255,255,255,.06); color: #e4eaf2; }
.fp-toolbar {
  height: 34px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 9px;
  border-bottom: 1px solid rgba(255,255,255,.045);
  background: rgba(7,10,14,.22);
}
.fp-label { color: #707d8c; font-size: 8px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase; }
.fp-scale {
  display: flex;
  gap: 1px;
  padding: 2px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: rgba(0,0,0,.22);
}
.fp-scale button {
  height: 19px;
  min-width: 24px;
  padding: 0 5px;
  border-radius: 4px;
  color: #76818f;
  font-family: var(--mono);
  font-size: 8.5px;
  transition: .12s ease;
}
.fp-scale button:hover { color: #dbe3ee; }
.fp-scale button.active { background: #29303a; color: #e3eaf5; box-shadow: inset 0 1px 0 rgba(255,255,255,.07); }
.fp-frames { margin-left: auto; color: #758190; font-family: var(--mono); font-size: 8.5px; white-space: nowrap; }
.fp-play {
  width: 26px;
  height: 24px;
  flex: none;
  margin-left: auto;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: rgba(255,255,255,.02);
  color: #a2adbb;
  transition: .13s ease;
}
.fp-play:hover { color: #fff; background: rgba(255,255,255,.06); }
.fp-play.active { color: #c5f1cf; background: rgba(147,227,164,.12); border-color: rgba(147,227,164,.28); }
.fp-body { padding: 9px; }
.fp-stage {
  position: relative;
  height: 146px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,.065);
  border-radius: 8px;
  background-color: #14181e;
  background-image: conic-gradient(#1c2129 25%, #15191f 0 50%, #1c2129 0 75%, #15191f 0);
  background-size: 12px 12px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.025), inset 0 10px 30px rgba(0,0,0,.28);
}
.fp-stage::after {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 50% 45%, transparent 38%, rgba(4,6,9,.38) 100%);
  pointer-events: none;
}
.fp-glow {
  position: absolute;
  width: 150px;
  height: 96px;
  bottom: 14px;
  border-radius: 50%;
  background: radial-gradient(closest-side, rgba(129,224,152,.18), transparent);
  filter: blur(10px);
  pointer-events: none;
}
.fp-sprite {
  position: relative;
  z-index: 2;
  display: grid;
  place-items: center;
  filter: drop-shadow(0 12px 12px rgba(0,0,0,.48));
  transition: transform .09s linear;
  will-change: transform;
}
.fp-sprite .pixel-art { width: 100%; height: 100%; }
.fp-size {
  position: absolute;
  right: 6px;
  bottom: 6px;
  z-index: 3;
  padding: 2px 4px;
  border: 1px solid rgba(255,255,255,.06);
  border-radius: 4px;
  background: rgba(9,12,16,.58);
  color: #74808e;
  font-family: var(--mono);
  font-size: 7.5px;
}
.fp-live {
  position: absolute;
  left: 8px;
  top: 8px;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 5px;
  height: 16px;
  padding: 0 6px;
  border: 1px solid rgba(147,227,164,.18);
  border-radius: 4px;
  background: rgba(12,24,17,.62);
  color: #a8eab6;
  font-size: 7.5px;
  font-weight: 650;
  letter-spacing: .08em;
}
.fp-live.paused { color: #d4a96d; border-color: rgba(212,169,109,.2); background: rgba(31,23,12,.55); }
.fp-live .pulse { width: 4px; height: 4px; border-radius: 50%; background: var(--mint); box-shadow: 0 0 7px rgba(147,227,164,.85); animation: live-pulse 1.8s ease-in-out infinite; }
.fp-live.paused .pulse { background: #d4a96d; animation: none; }
@keyframes live-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
.fp-foot {
  height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 9px;
  border-top: 1px solid var(--line);
  background: rgba(9,12,16,.22);
}
.fp-frame-text { color: #c0cad7; font-family: var(--mono); font-size: 9px; white-space: nowrap; }
.fp-frame-text span { color: #758190; }
.fp-fps { color: #7e8a98; font-family: var(--mono); font-size: 9px; white-space: nowrap; }
.fp-dots { margin-left: auto; display: flex; align-items: center; gap: 4px; }
.fp-dot { width: 6px; height: 6px; padding: 0; border-radius: 50%; background: #3c4552; transition: .15s ease; }
.fp-dot:hover { background: #74808f; }
.fp-dot.active { width: 14px; border-radius: 4px; background: #a6b9ff; box-shadow: 0 0 8px rgba(143,168,255,.45); }
.fp-loop {
  width: 21px;
  height: 21px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  color: #5f6a78;
  transition: .13s ease;
}
.fp-loop:hover { color: #dbe3ee; background: rgba(255,255,255,.05); }
.fp-loop.on { color: #a9bbff; }

/* -------------------------------- timeline ------------------------------ */

.timeline {
  flex: none;
  overflow: hidden;
  transition: height .22s cubic-bezier(.2,.8,.2,1);
}
.timeline.collapsed .tl-head { border-bottom-color: transparent; }
.tl-head {
  height: 38px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 9px;
  border-bottom: 1px solid var(--line);
  background: linear-gradient(180deg, rgba(255,255,255,.02), transparent);
  overflow: hidden;
}
.tl-title { display: flex; align-items: center; gap: 7px; color: #9ba6b5; font-size: 9.5px; font-weight: 650; letter-spacing: .11em; text-transform: uppercase; white-space: nowrap; }
.tl-title svg { color: #6c7887; }
.tl-count { display: inline-flex; align-items: center; height: 16px; padding: 0 4px; border: 1px solid var(--line); border-radius: 4px; background: rgba(255,255,255,.025); color: #8491a0; font-family: var(--mono); font-size: 8px; letter-spacing: 0; }
.tl-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 18px;
  padding: 0 6px;
  border: 1px solid rgba(143,168,255,.18);
  border-radius: 4px;
  background: rgba(143,168,255,.07);
  color: #aab9e6;
  font-size: 8.5px;
  white-space: nowrap;
}
.tl-tag .dot { width: 4px; height: 4px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 6px rgba(143,168,255,.65); }
.tl-controls { display: flex; align-items: center; gap: 1px; flex: none; }
.tl-head .icon-btn.sm { width: 23px; height: 23px; }
.tl-play {
  width: 27px;
  height: 27px;
  display: grid;
  place-items: center;
  margin: 0 1px;
  border: 1px solid rgba(147,227,164,.23);
  border-radius: 7px;
  background: linear-gradient(180deg, #29342e, #202a24);
  color: #bfecc9;
  transition: .13s ease;
}
.tl-play:hover { filter: brightness(1.12); }
.tl-play.active { background: rgba(147,227,164,.14); color: #d7f8df; border-color: rgba(147,227,164,.38); box-shadow: 0 0 0 3px rgba(147,227,164,.05); }
.tl-sep { width: 1px; height: 17px; flex: none; margin: 0 2px; background: var(--line); }
.tl-fps { display: flex; align-items: center; gap: 6px; flex: none; }
.tl-fps .opt-label { font-size: 8px; }
.tl-fps .pix-range { width: 66px; flex: none; }
.tl-right { margin-left: auto; display: flex; align-items: center; gap: 1px; flex: none; }
.timeline > .tl-body { flex: 1; min-height: 0; background: #111419; }
.tl-grid { width: 100%; height: 100%; min-height: 0; display: grid; overflow: auto; background: #111419; scrollbar-width: none; }
.tl-grid::-webkit-scrollbar { display: none; }
.tl-corner {
  display: flex;
  align-items: flex-end;
  padding: 0 10px 7px;
  border-right: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  background: #12161b;
  color: #6c7988;
  font-size: 8px;
  font-weight: 650;
  letter-spacing: .1em;
  text-transform: uppercase;
}
.tl-frame-head {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-width: 0;
  border-right: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  background: rgba(255,255,255,.008);
  color: #7c8898;
  transition: background .13s ease;
}
.tl-frame-head:hover { background: rgba(255,255,255,.045); }
.tl-frame-head.active { background: rgba(147,227,164,.17); color: #effbf2; box-shadow: inset 0 2px 0 var(--mint); }
.tl-frame-head.active .tl-frame-no { font-weight: 600; }
.tl-frame-head.active::after {
  content: "";
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 5px;
  height: 5px;
  transform: translate(-50%, 1px) rotate(45deg);
  border-radius: 1px;
  background: #a7e7b6;
  box-shadow: 0 0 8px rgba(147,227,164,.6);
}
.tl-frame-no { font-family: var(--mono); font-size: 9px; color: #a3aebc; line-height: 1; }
.tl-frame-head.active .tl-frame-no { color: #c5f0cd; }
.tl-frame-thumb { position: relative; width: 28px; height: 28px; overflow: hidden; border: 1px solid rgba(255,255,255,.1); border-radius: 4px; background-color: #20262d; }
.tl-frame-thumb .pixel-art { width: 100%; height: 100%; }
.tl-frame-head.active .tl-frame-thumb { border-color: rgba(147,227,164,.48); box-shadow: 0 0 10px -1px rgba(147,227,164,.45); }
.tl-addcol { display: grid; place-items: center; border-bottom: 1px solid var(--line); background: #12161b; }
.tl-addcol .icon-btn { color: #65717f; }
.tl-row-label {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 0 9px;
  border-right: 1px solid var(--line);
  border-bottom: 1px solid rgba(255,255,255,.045);
  background: #12161b;
  color: #9aa6b4;
  font-size: 10px;
  text-align: left;
  transition: background .12s ease, color .12s ease;
}
.tl-row-label:hover { background: #171b22; color: #d9e1eb; }
.tl-row-label.active { background: rgba(143,168,255,.16); color: #f4f7fb; box-shadow: inset 2px 0 0 var(--accent); }
.tl-row-label svg { margin-left: auto; color: #5f6a79; }
.tl-layer-dot { width: 6px; height: 6px; flex: none; border-radius: 2px; }
.tl-layer-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tl-cell {
  position: relative;
  display: grid;
  place-items: center;
  border-right: 1px solid rgba(255,255,255,.045);
  border-bottom: 1px solid rgba(255,255,255,.045);
  background: transparent;
  transition: background .12s ease;
}
.tl-cell:hover { background: rgba(255,255,255,.035); }
.tl-cell.active-col { background: rgba(147,227,164,.07); box-shadow: inset 1px 0 0 rgba(147,227,164,.16), inset -1px 0 0 rgba(147,227,164,.16); }
.tl-cell.active-row { background: rgba(143,168,255,.07); }
.tl-key {
  width: 22px;
  height: 8px;
  border-radius: 3px;
  opacity: 1;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.52), 0 1px 4px rgba(0,0,0,.5);
}
.tl-key.active { box-shadow: inset 0 0 0 1px rgba(255,255,255,.85), 0 0 10px rgba(147,227,164,.35); }
.tl-empty-dot { width: 4px; height: 4px; border: 1px solid rgba(255,255,255,.16); border-radius: 50%; opacity: .65; }
.tl-empty { border-bottom: 1px solid rgba(255,255,255,.03); }

/* ------------------------------- inspector ------------------------------ */

.inspector {
  width: 304px;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
}
.inspector::-webkit-scrollbar { display: none; }
.card {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--line);
  border-radius: 12px;
  background:
    linear-gradient(180deg, rgba(255,255,255,.026) 0%, rgba(255,255,255,0) 28%),
    var(--surface);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.03), 0 18px 32px -26px rgba(0,0,0,.9);
}
.layers-card { flex: 1 1 auto; min-height: 270px; }
.color-card { flex: 0 0 auto; }
.panel-head {
  height: 36px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 11px;
  border-bottom: 1px solid var(--line);
  background: linear-gradient(180deg, rgba(255,255,255,.014), transparent);
}
.panel-title { display: flex; align-items: center; gap: 7px; min-width: 0; color: #a3aebb; font-size: 10px; font-weight: 650; letter-spacing: .1em; text-transform: uppercase; }
.panel-title-icon { color: #71808f; }
.count-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 17px; height: 16px; padding: 0 4px; border: 1px solid var(--line); border-radius: 4px; background: rgba(255,255,255,.028); color: #8b97a5; font-family: var(--mono); font-size: 8.5px; letter-spacing: 0; }
.panel-actions { margin-left: auto; display: flex; align-items: center; gap: 1px; }
.panel-actions .icon-btn { color: #a9b5c3; }
.panel-actions .icon-btn:hover { color: #eef4fb; }
.panel-actions .icon-btn:disabled { color: #6a7684; }
.mini-badge { display: inline-flex; align-items: center; height: 16px; padding: 0 5px; border: 1px solid var(--line); border-radius: 4px; color: #6d7988; font-family: var(--mono); font-size: 7.5px; letter-spacing: .02em; }

.layers-controls {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--line);
  background: rgba(0,0,0,.08);
}
.control-row { display: flex; align-items: center; gap: 8px; height: 21px; min-width: 0; }
.control-label { width: 42px; flex: none; color: #84909e; font-size: 8.5px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
.select-wrap { position: relative; flex: 1; min-width: 0; }
.select {
  width: 100%;
  height: 21px;
  padding: 0 20px 0 7px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: rgba(255,255,255,.032);
  color: #c7d0dc;
  font-size: 10px;
  outline: none;
  appearance: none;
  -webkit-appearance: none;
}
.select:hover { border-color: var(--line-strong); background: rgba(255,255,255,.05); }
.select:focus { border-color: rgba(143,168,255,.4); box-shadow: 0 0 0 2px rgba(143,168,255,.1); }
.select option { background: #171b21; color: #e2e8f0; }
.select-caret { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); pointer-events: none; color: #6b7685; }
.flex-range { flex: 1; width: auto; min-width: 0; }

.layer-list { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 1px; padding: 2px 5px; overflow-y: auto; overflow-x: hidden; }
.layer-row {
  position: relative;
  flex: none;
  min-height: 42px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 3px 5px;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: background .12s ease, border-color .12s ease;
}
.layer-row:hover { background: rgba(255,255,255,.032); }
.layer-row.group { min-height: 40px; }
.layer-row.child { margin-left: 20px; width: calc(100% - 20px); }
.layer-row.child::before {
  content: "";
  position: absolute;
  left: -10px;
  top: -3px;
  bottom: -3px;
  border-left: 1px solid rgba(255,255,255,.11);
}
.layer-row.child::after {
  content: "";
  position: absolute;
  left: -10px;
  top: 50%;
  width: 8px;
  height: 1px;
  background: rgba(255,255,255,.11);
}
.layer-row.child + .layer-row:not(.child) { margin-top: 6px; }
.layer-row.child + .layer-row:not(.child)::before {
  content: "";
  position: absolute;
  left: 1px;
  right: 1px;
  top: -4px;
  height: 1px;
  background: rgba(255,255,255,.075);
}
.layer-row.active {
  background: linear-gradient(90deg, rgba(143,168,255,.145), rgba(143,168,255,.035));
  border-color: rgba(143,168,255,.22);
  box-shadow: inset 2px 0 0 #9fb3ff, inset 0 1px 0 rgba(255,255,255,.025), 0 0 14px -8px rgba(143,168,255,.4);
}
.group-chevron { width: 14px; height: 24px; flex: none; display: grid; place-items: center; border-radius: 4px; color: #687483; }
.group-chevron:hover { color: #d5dee8; background: rgba(255,255,255,.055); }
.layer-thumb {
  position: relative;
  width: 34px;
  height: 34px;
  flex: none;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,.13);
  border-radius: 5px;
  background-color: #2b323b;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.25), 0 1px 2px rgba(0,0,0,.3);
}
.layer-thumb.is-group { border-color: rgba(143,168,255,.26); }
.layer-thumb.tone-highlights { border-color: rgba(216,240,164,.28); }
.layer-thumb.tone-outline { border-color: rgba(169,195,177,.26); }
.layer-thumb.tone-fx { border-color: rgba(245,212,122,.3); }
.thumb-checker {
  position: absolute;
  inset: 0;
  background-color: #4a535f;
  background-image: conic-gradient(#555f6c 25%, #414a55 0 50%, #555f6c 0 75%, #414a55 0);
  background-size: 6px 6px;
}
.thumb-art { position: absolute; inset: 0; transition: opacity .15s ease; }
.thumb-art .pixel-art { width: 100%; height: 100%; }
.layer-thumb.tone-outline .thumb-art { filter: drop-shadow(0 0 0.9px rgba(231,255,242,.6)); }
.layer-thumb.tone-highlights .thumb-art { filter: drop-shadow(0 0 0.8px rgba(0,0,0,.7)); }
.layer-thumb.tone-fx .thumb-art { filter: drop-shadow(0 0 0.8px rgba(0,0,0,.55)); }
.layer-thumb.dim .thumb-art { opacity: .28; }
.thumb-gloss { position: absolute; inset: 0; border-radius: inherit; box-shadow: inset 0 1px 0 rgba(255,255,255,.08), inset 0 -10px 14px rgba(0,0,0,.16); pointer-events: none; }
.thumb-group-badge {
  position: absolute;
  right: 1px;
  bottom: 1px;
  z-index: 3;
  width: 12px;
  height: 12px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(255,255,255,.16);
  border-radius: 3px;
  background: rgba(9,12,16,.74);
  color: #c1d0ff;
  box-shadow: 0 1px 3px rgba(0,0,0,.5);
}
.layer-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.layer-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #cdd5df; font-size: 11.5px; font-weight: 500; line-height: 1.2; }
.layer-row.active .layer-name { color: #f0f4fa; }
.layer-row.group .layer-name { color: #d9e0e9; }
.layer-meta { display: flex; align-items: center; gap: 4px; overflow: hidden; color: #96a2b0; font-size: 9.5px; line-height: 1.1; white-space: nowrap; }
.layer-meta .mono { font-size: 9px; color: #9fabb9; }
.meta-dot { width: 2px; height: 2px; flex: none; border-radius: 50%; background: #49525e; }
.layer-actions { display: flex; align-items: center; gap: 0; margin-left: auto; flex: none; }
.row-btn { width: 21px; height: 21px; display: grid; place-items: center; border-radius: 4px; color: #b4c0ce; opacity: .9; transition: .12s ease; }
.layer-row:hover .row-btn, .layer-row.active .row-btn { opacity: 1; }
.row-btn:hover { background: rgba(255,255,255,.07); color: #eef3f9; }
.row-btn.lock-btn { opacity: 0; }
.layer-row:hover .row-btn.lock-btn, .layer-row.active .row-btn.lock-btn, .row-btn.lock-btn.on { opacity: .85; }
.row-btn.eye-hidden { opacity: 1; color: #d8ab6c; }
.row-btn.on { opacity: 1; color: #b0c2ff; }
.layer-hidden .layer-name { color: #778391; }
.layer-hidden .layer-meta { color: #535e6b; }
.layer-rename-input {
  width: 100%;
  height: 19px;
  padding: 0 4px;
  border: 1px solid rgba(143,168,255,.48);
  border-radius: 3px;
  outline: none;
  background: #0e1217;
  color: #e8eef6;
  font-size: 11px;
}
.layer-foot {
  height: 26px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  border-top: 1px solid var(--line);
  background: rgba(0,0,0,.09);
  color: #8b97a5;
  font-size: 9px;
  letter-spacing: .01em;
}

.color-body { display: flex; flex-direction: column; gap: 8px; padding: 9px 11px 10px; }
.color-top { display: flex; align-items: stretch; gap: 11px; min-height: 38px; }
.swatch-stack { position: relative; width: 39px; height: 39px; flex: none; }
.swatch-big {
  position: absolute;
  width: 28px;
  height: 28px;
  border: 1px solid rgba(255,255,255,.23);
  border-radius: 7px;
  box-shadow: 0 4px 10px -2px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.25);
}
.swatch-big::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(180deg, rgba(255,255,255,.12), transparent 52%);
}
.swatch-big.fg { left: 0; top: 0; z-index: 2; }
.swatch-big.bg { right: 0; bottom: 0; z-index: 1; }
.color-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.hex-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 25px;
  padding: 0 7px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: rgba(7,10,14,.4);
}
.hex-wrap:focus-within { border-color: rgba(143,168,255,.35); box-shadow: 0 0 0 2px rgba(143,168,255,.08); }
.hex-dot { width: 7px; height: 7px; flex: none; border-radius: 50%; box-shadow: 0 0 0 1px rgba(255,255,255,.18); }
.hex-input { width: 100%; min-width: 0; padding: 0; border: 0; outline: none; background: transparent; color: #e3eaf3; font-family: var(--mono); font-size: 10px; letter-spacing: .03em; text-transform: uppercase; }
.hex-alpha { flex: none; color: #73808e; font-family: var(--mono); font-size: 8.5px; }
.ramp-wrap { display: flex; flex-direction: column; gap: 3px; }
.ramp-label { display: flex; justify-content: space-between; color: #7b8795; font-size: 7.5px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
.ramp { display: flex; gap: 2px; height: 8px; }
.ramp-step { flex: 1; height: 8px; border-radius: 2px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); transition: transform .12s ease; }
.ramp-step:hover { transform: scaleY(1.55); }
.hsv { display: flex; flex-direction: column; gap: 5px; }
.hsv-row { display: flex; align-items: center; gap: 7px; height: 19px; }
.hsv-char { width: 8px; flex: none; color: #6e7a88; font-family: var(--mono); font-size: 8.5px; }
.hsv-range { flex: 1; width: auto; min-width: 0; }
.hsv-val { width: 33px; flex: none; text-align: right; color: #a1adba; font-family: var(--mono); font-size: 9px; font-variant-numeric: tabular-nums; }
.palette-head { display: flex; align-items: center; gap: 6px; color: #7e8a98; font-size: 8px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase; }
.palette-name { margin-left: auto; color: #98a4b2; font-size: 9px; font-weight: 400; letter-spacing: 0; text-transform: none; }
.add-color { width: 18px; height: 18px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 4px; color: #7a8695; transition: .12s ease; }
.add-color:hover { color: #dde5ee; background: rgba(255,255,255,.05); }
.palette-grid { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 3px; }
.palette-swatch { height: 23px; min-width: 0; border: 1px solid rgba(255,255,255,.1); border-radius: 4px; transition: transform .12s ease, box-shadow .12s ease; }
.palette-swatch:hover { transform: translateY(-1px) scale(1.05); z-index: 2; box-shadow: 0 4px 10px rgba(0,0,0,.5); }
.palette-swatch.active { box-shadow: 0 0 0 1px #12151a, 0 0 0 2px #e4ebff, 0 4px 12px rgba(0,0,0,.55); }

/* ------------------------------- statusbar ------------------------------ */

.statusbar {
  height: 28px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 0;
  padding: 0 11px;
  border-top: 1px solid var(--line);
  background: #0c0f13;
  color: #7f8c9a;
  font-size: 9.5px;
  overflow: hidden;
}
.status-group { display: flex; align-items: center; min-width: 0; overflow: hidden; }
.status-item { display: flex; align-items: center; gap: 5px; white-space: nowrap; }
.status-item.mono { font-size: 9px; color: #97a3b1; }
.status-ready { color: #a2adba; }
.status-ready .dot { width: 5px; height: 5px; flex: none; border-radius: 50%; background: var(--mint); box-shadow: 0 0 7px rgba(147,227,164,.65); }
.status-sep { width: 1px; height: 11px; flex: none; margin: 0 9px; background: var(--line); }
.status-right { margin-left: auto; display: flex; align-items: center; gap: 11px; min-width: 0; }
.status-pill { display: inline-flex; align-items: center; gap: 4px; height: 18px; padding: 0 6px; border: 1px solid rgba(143,168,255,.16); border-radius: 4px; background: rgba(143,168,255,.055); color: #94a8e8; font-size: 8.5px; white-space: nowrap; }
.layer-status { gap: 5px; font-size: 9px; }
.layer-status-label { color: #6c7886; }
.layer-status-name { color: #c2cbd6; font-weight: 500; }
.version { color: #6b7785; font-family: var(--mono); font-size: 8.5px; }
.toast { display: inline-flex; align-items: center; gap: 6px; color: #b7c8ff; font-size: 9.5px; white-space: nowrap; animation: toast-in .2s ease; }
.toast-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 7px rgba(143,168,255,.7); }
@keyframes toast-in { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; } }

/* -------------------------------- sliders ------------------------------- */

.pix-range {
  -webkit-appearance: none;
  appearance: none;
  display: block;
  width: 100%;
  height: 18px;
  margin: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  outline: none;
}
.pix-range::-webkit-slider-runnable-track {
  width: 100%;
  height: 3px;
  border-radius: 99px;
  background: var(--track);
  box-shadow: inset 0 1px 1px rgba(0,0,0,.35), 0 1px 0 rgba(255,255,255,.035);
}
.pix-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  margin-top: -4.5px;
  border: 2px solid #0d1014;
  border-radius: 50%;
  background: #f1f4f9;
  box-shadow: 0 0 0 1px rgba(255,255,255,.34), 0 2px 6px rgba(0,0,0,.55);
  transition: transform .12s ease, box-shadow .12s ease;
}
.pix-range:hover::-webkit-slider-thumb {
  transform: scale(1.12);
  box-shadow: 0 0 0 1px rgba(255,255,255,.45), 0 0 0 4px rgba(143,168,255,.12), 0 2px 8px rgba(0,0,0,.6);
}
.pix-range:active::-webkit-slider-thumb {
  transform: scale(1.05);
  box-shadow: 0 0 0 1px rgba(255,255,255,.5), 0 0 0 5px rgba(143,168,255,.17), 0 2px 8px rgba(0,0,0,.6);
}
.pix-range::-moz-range-track {
  height: 3px;
  border-radius: 99px;
  background: var(--track);
  box-shadow: inset 0 1px 1px rgba(0,0,0,.35);
}
.pix-range::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border: 2px solid #0d1014;
  border-radius: 50%;
  background: #f1f4f9;
  box-shadow: 0 0 0 1px rgba(255,255,255,.34), 0 2px 6px rgba(0,0,0,.55);
  transition: transform .12s ease, box-shadow .12s ease;
}
.pix-range:hover::-moz-range-thumb { transform: scale(1.12); }
.pix-range:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 1px rgba(255,255,255,.55), 0 0 0 5px rgba(143,168,255,.22); }
.pix-range:disabled { opacity: .4; cursor: default; }
.pix-range.small { height: 16px; }
.pix-range.small::-webkit-slider-thumb { width: 9px; height: 9px; margin-top: -3px; border-width: 1.5px; }
.pix-range.small::-moz-range-thumb { width: 9px; height: 9px; border-width: 1.5px; }
.pix-range.flex-range { flex: 1 1 auto; width: auto; min-width: 0; margin-right: 3px; }
.pix-range.hsv-range { flex: 1 1 auto; width: auto; min-width: 0; }
.tl-fps .pix-range { width: 66px; flex: none; }
.tl-cell.active-col.active-row { background: rgba(143,168,255,.06); }

.scroll-thin { scrollbar-width: thin; scrollbar-color: #333b46 transparent; }
.scroll-thin::-webkit-scrollbar { width: 7px; height: 7px; }
.scroll-thin::-webkit-scrollbar-track { background: transparent; }
.scroll-thin::-webkit-scrollbar-thumb { background: rgba(255,255,255,.12); border: 2px solid transparent; border-radius: 8px; background-clip: padding-box; }
.scroll-thin::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.2); border: 2px solid transparent; background-clip: padding-box; }

button:focus-visible, .layer-row:focus-visible, input:focus-visible, select:focus-visible {
  outline: 1px solid rgba(143,168,255,.75);
  outline-offset: 2px;
}

`;

const cx = (...values) => values.filter(Boolean).join(" ");
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const pad2 = (n) => String(n).padStart(2, "0");

/* ------------------------------------------------------------------ */
/*  Inline icon set                                                     */
/* ------------------------------------------------------------------ */

const ICONS = {
  move: (
    <>
      <path d="M12 3v18M3 12h18" />
      <path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
    </>
  ),
  marquee: (
    <>
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <path d="M9 4h6M9 20h6M4 9v6M20 9v6" opacity=".5" />
    </>
  ),
  lasso: (
    <>
      <path d="M20 10.5c0 3.1-3.6 5.6-8 5.6s-8-2.5-8-5.6 3.6-5.6 8-5.6 8 2.5 8 5.6Z" />
      <path d="M8 15.4c.7 2.2-.2 3.6-1.6 4.6" />
      <circle cx="5.8" cy="20.5" r="1.2" />
    </>
  ),
  wand: (
    <>
      <path d="m5 19 10.5-10.5" />
      <path d="m13.8 5.8 4.4 4.4" />
      <path d="M5 4v3M3.5 5.5h3M18.5 12.5v3M17 14h3M9 2.5v1.8M8.1 3.4h1.8" />
    </>
  ),
  pencil: (
    <>
      <path d="M4.5 19.5 5.7 15 16.4 4.3a2.1 2.1 0 0 1 3 0l.3.3a2.1 2.1 0 0 1 0 3L9 18.3l-4.5 1.2Z" />
      <path d="m13.8 6.9 3.3 3.3" />
    </>
  ),
  eraser: (
    <>
      <path d="M8.5 20H5l-2.6-2.6a2 2 0 0 1 0-2.8l9-9a2 2 0 0 1 2.8 0l4.2 4.2a2 2 0 0 1 0 2.8L11.5 20" />
      <path d="m8 10 6 6M8.5 20H20" />
    </>
  ),
  bucket: (
    <>
      <path d="m5 11 6-6 7.5 7.5-5.2 5.2a2 2 0 0 1-2.8 0l-4.7-4.7a2 2 0 0 1 0-2.8Z" />
      <path d="m8 7 2-2" />
      <path d="M19.5 14.5s2 2.1 2 3.3a2 2 0 0 1-4 0c0-1.2 2-3.3 2-3.3Z" />
    </>
  ),
  line: <path d="M5 19 19 5" />,
  square: <rect x="4" y="4" width="16" height="16" rx="2" />,
  circle: <circle cx="12" cy="12" r="8" />,
  pipette: (
    <>
      <path d="m14 4 6 6M17.5 2.5l4 4" />
      <path d="M16.5 5.5 7 15l-1 4 4-1 9.5-9.5" />
      <path d="m9 13 2 2" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </>
  ),
  redo: (
    <>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H10a6 6 0 0 0 0 12h3" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
    </>
  ),
  panelRight: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M15 4v16" />
    </>
  ),
  timeline: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M3 15h18M9 4v16" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.4" />
      <path d="m4 17 5-5 4 4 3-3 4 4" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M3 3 21 21" />
      <path d="M10.6 6c.5-.1.9-.1 1.4-.1 6 0 9.5 6.1 9.5 6.1a17 17 0 0 1-2.7 3.4M6.1 6.9A17.4 17.4 0 0 0 2.5 12S6 18.5 12 18.5c1.3 0 2.5-.3 3.6-.7" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5M12 14.5v2.5" />
    </>
  ),
  unlock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7a4 4 0 0 1 7.7-1.5M12 14.5v2.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
    </>
  ),
  folder: <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2.5h7A2.5 2.5 0 0 1 21 10v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17Z" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronUp: <path d="m6 15 6-6 6 6" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  play: <path d="M8 5.3v13.4L19 12 8 5.3Z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="7.5" y="5.5" width="3.2" height="13" rx="1" fill="currentColor" stroke="none" />
      <rect x="13.3" y="5.5" width="3.2" height="13" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  skipBack: (
    <>
      <path d="M18 5.5v13L8 12 18 5.5Z" />
      <path d="M5 5v14" />
    </>
  ),
  skipForward: (
    <>
      <path d="M6 5.5v13L16 12 6 5.5Z" />
      <path d="M19 5v14" />
    </>
  ),
  repeat: (
    <>
      <path d="m17 3 3 3-3 3" />
      <path d="M4 12V9a3 3 0 0 1 3-3h13" />
      <path d="m7 21-3-3 3-3" />
      <path d="M20 12v3a3 3 0 0 1-3 3H4" />
    </>
  ),
  x: <path d="m6 6 12 12M18 6 6 18" />,
  target: (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="1.4" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </>
  ),
  fit: <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" />,
  grid: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
    </>
  ),
  sparkles: (
    <>
      <path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z" />
      <path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z" />
    </>
  ),
  swap: <path d="M4 7h13l-3-3M20 7l-3 3M20 17H7l3 3M4 17l3-3" />,
  color: (
    <>
      <path d="M12 3a9 9 0 1 0 .2 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.2 0-.9.8-1.5 1.8-1.5H16a4 4 0 0 0 4-4c0-4.4-3.8-8.3-8-8.3Z" />
      <circle cx="7.7" cy="10.6" r=".9" fill="currentColor" stroke="none" />
      <circle cx="10.4" cy="7.6" r=".9" fill="currentColor" stroke="none" />
      <circle cx="14.4" cy="7.6" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 16 9 5 9-5" />
    </>
  ),
  onion: (
    <>
      <rect x="7.5" y="4.5" width="12" height="12" rx="2" opacity=".5" />
      <rect x="4.5" y="7.5" width="12" height="12" rx="2" />
    </>
  ),
  grip: (
    <>
      <circle cx="9" cy="6" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="9" cy="18" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15" cy="18" r="1.15" fill="currentColor" stroke="none" />
    </>
  ),
  check: <path d="m4.5 12 5 5L20 6" />
};

function Icon({ name, size = 16, strokeWidth = 1.7, className = "", style }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flex: "none", ...style }}
      aria-hidden="true"
    >
      {ICONS[name] || null}
    </svg>
  );
}

function IconBtn({ name, label, onClick, active = false, small = false, disabled = false, className = "", iconSize }) {
  return (
    <button
      type="button"
      className={cx("icon-btn", small && "sm", active && "on", className)}
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={name} size={iconSize || (small ? 13 : 15)} />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Tiny formatting + colour utilities                                  */
/* ------------------------------------------------------------------ */

function hexToRgb(hex) {
  let h = String(hex).replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) h = "000000";
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r, g, b) {
  const f = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`;
}

function rgbToHsv({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h: Math.round(h) % 360, s: Math.round((max === 0 ? 0 : d / max) * 100), v: Math.round(max * 100) };
}

function hsvToHex(h, s, v) {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp(s, 0, 100) / 100;
  const vv = clamp(v, 0, 100) / 100;
  const c = vv * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = vv - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

function mixHex(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex(ca.r + (cb.r - ca.r) * t, ca.g + (cb.g - ca.g) * t, ca.b + (cb.b - ca.b) * t);
}

/* ------------------------------------------------------------------ */
/*  Pixel artwork, authored once and painted as SVG paths               */
/* ------------------------------------------------------------------ */

const ART = {
  ink: "#1a2921",
  body: "#7bd48a",
  belly: "#9de58f",
  dark: "#4a9f68",
  deep: "#327d55",
  crown: "#f3c55a",
  crownLight: "#ffe69b",
  crownDark: "#c48d2f",
  gem: "#5fe2c0",
  gemDark: "#2da98b",
  gemLight: "#c7ffed",
  blush: "#ee8fa0",
  eye: "#15231d",
  white: "#f6fff4",
  shadow: "#070b0e",
  spark: "#ffe9a8"
};

const BODY_ROWS = [
  [12, 13, 18],
  [13, 11, 20],
  [14, 10, 21],
  [15, 9, 22],
  [16, 8, 23],
  [17, 7, 24],
  [18, 7, 24],
  [19, 6, 25],
  [20, 6, 25],
  [21, 5, 26],
  [22, 5, 26],
  [23, 4, 27],
  [24, 4, 27],
  [25, 5, 26],
  [26, 7, 24]
];

const CROWN_ROWS = [
  [5, 15, 16],
  [6, 15, 16],
  [7, 11, 12],
  [7, 15, 16],
  [7, 20, 21],
  [8, 11, 12],
  [8, 15, 16],
  [8, 20, 21],
  [9, 11, 12],
  [9, 14, 17],
  [9, 20, 21],
  [10, 11, 21],
  [11, 11, 21]
];

const bodyCells = [];
BODY_ROWS.forEach(([y, x0, x1]) => {
  for (let x = x0; x <= x1; x++) bodyCells.push({ x, y });
});
const crownCells = [];
CROWN_ROWS.forEach(([y, x0, x1]) => {
  for (let x = x0; x <= x1; x++) crownCells.push({ x, y });
});

const keyOf = (x, y) => `${x},${y}`;
const bodySet = new Set(bodyCells.map(({ x, y }) => keyOf(x, y)));
const crownSet = new Set(crownCells.map(({ x, y }) => keyOf(x, y)));
const solidSet = new Set([...bodySet, ...crownSet]);

const outlineSet = new Set();
solidSet.forEach((k) => {
  const [x, y] = k.split(",").map(Number);
  [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
    const nk = keyOf(x + dx, y + dy);
    if (!solidSet.has(nk)) outlineSet.add(nk);
  });
});

const isBelly = (x, y) =>
  (y === 20 && x >= 13 && x <= 18) ||
  ((y === 21 || y === 22) && x >= 12 && x <= 19) ||
  (y === 23 && x >= 13 && x <= 18);

const gemKeys = new Set(["15,9", "16,9", "15,10", "16,10"]);

const basePixels = [];
bodyCells.forEach(({ x, y }) => {
  basePixels.push({ x, y, c: isBelly(x, y) ? ART.belly : ART.body });
});
crownCells.forEach(({ x, y }) => {
  if (!gemKeys.has(keyOf(x, y))) basePixels.push({ x, y, c: ART.crown });
});
gemKeys.forEach((k) => {
  const [x, y] = k.split(",").map(Number);
  basePixels.push({ x, y, c: ART.gem });
});

const eyeCells = [
  [12, 18], [11, 19], [12, 19], [13, 19], [11, 20], [12, 20], [13, 20], [12, 21],
  [19, 18], [18, 19], [19, 19], [20, 19], [18, 20], [19, 20], [20, 20], [19, 21]
];
const mouthCells = [[15, 23], [16, 24], [17, 23]];

const outlinePixels = [...outlineSet].map((k) => {
  const [x, y] = k.split(",").map(Number);
  return { x, y, c: ART.ink };
});
eyeCells.forEach(([x, y]) => outlinePixels.push({ x, y, c: ART.eye }));
mouthCells.forEach(([x, y]) => outlinePixels.push({ x, y, c: ART.eye }));

const shadingMap = new Map();
BODY_ROWS.forEach(([y, x0, x1]) => {
  if (y === 25 || y === 26) {
    for (let x = x0; x <= x1; x++) shadingMap.set(keyOf(x, y), ART.dark);
  }
  if (y === 24) {
    for (let x = 16; x <= x1; x++) shadingMap.set(keyOf(x, y), ART.dark);
  }
  if (y >= 16 && y <= 24) {
    shadingMap.set(keyOf(x1, y), ART.deep);
    if (y >= 21) shadingMap.set(keyOf(x1 - 1, y), ART.dark);
  }
});
for (let x = 13; x <= 18; x++) shadingMap.set(keyOf(x, 12), "#5cb675");
for (let x = 14; x <= 17; x++) shadingMap.set(keyOf(x, 13), "#5cb675");
[
  [8, 21], [9, 21], [8, 22],
  [23, 21], [24, 21], [24, 22]
].forEach(([x, y]) => shadingMap.set(keyOf(x, y), ART.blush));
for (let x = 19; x <= 21; x++) {
  if (crownSet.has(keyOf(x, 10))) shadingMap.set(keyOf(x, 10), ART.crownDark);
}
for (let x = 13; x <= 21; x++) {
  if (crownSet.has(keyOf(x, 11))) shadingMap.set(keyOf(x, 11), ART.crownDark);
}
shadingMap.set("16,9", ART.gemDark);
shadingMap.set("16,10", ART.gemDark);

const shadingPixels = [...shadingMap.entries()].map(([k, c]) => {
  const [x, y] = k.split(",").map(Number);
  return { x, y, c };
});

const highlightPixels = [];
[
  [12, 13], [11, 14], [10, 15], [9, 16], [8, 17], [8, 18], [7, 19], [7, 20], [10, 17], [9, 19], [10, 18]
].forEach(([x, y]) => highlightPixels.push({ x, y, c: "#b6eda0" }));
[
  [12, 10], [13, 10], [12, 9], [12, 8], [15, 6], [16, 6]
].forEach(([x, y]) => highlightPixels.push({ x, y, c: ART.crownLight }));
[
  [11, 19], [12, 19], [18, 19], [19, 19], [13, 20], [20, 20]
].forEach(([x, y]) => highlightPixels.push({ x, y, c: ART.white }));
[[15, 9], [15, 10]].forEach(([x, y]) => highlightPixels.push({ x, y, c: ART.gemLight }));
[[15, 22], [16, 22]].forEach(([x, y]) => highlightPixels.push({ x, y, c: "#c9f7b1" }));

const fxPixels = [];
for (let x = 8; x <= 23; x++) fxPixels.push({ x, y: 27, c: ART.shadow, o: 0.5 });
for (let x = 11; x <= 20; x++) fxPixels.push({ x, y: 28, c: ART.shadow, o: 0.34 });
const addStar = (cx, cy, arms, opacity = 0.95) => {
  fxPixels.push({ x: cx, y: cy, c: ART.spark, o: opacity });
  if (arms > 0) {
    fxPixels.push({ x: cx - 1, y: cy, c: ART.spark, o: opacity });
    fxPixels.push({ x: cx + 1, y: cy, c: ART.spark, o: opacity });
    fxPixels.push({ x: cx, y: cy - 1, c: ART.spark, o: opacity });
    fxPixels.push({ x: cx, y: cy + 1, c: ART.spark, o: opacity });
  }
};
addStar(5, 7, 1);
addStar(26, 15, 1);
addStar(24, 6, 0, 0.8);
addStar(8, 25, 0, 0.7);
addStar(27, 23, 0, 0.55);

const PIXEL_MAP = {
  base: basePixels,
  shading: shadingPixels,
  outline: outlinePixels,
  highlights: highlightPixels,
  fx: fxPixels
};

const GROUP_PIXELS = [...basePixels, ...shadingPixels, ...outlinePixels, ...highlightPixels];

const pathCache = new WeakMap();
function pixelPaths(pixels) {
  if (!pixels || pixels.length === 0) return [];
  if (pathCache.has(pixels)) return pathCache.get(pixels);
  const groups = new Map();
  pixels.forEach((p) => {
    const opacity = p.o == null ? 1 : p.o;
    const key = `${p.c}|${opacity}`;
    let group = groups.get(key);
    if (!group) {
      group = { color: p.c, opacity, rows: new Map() };
      groups.set(key, group);
    }
    if (!group.rows.has(p.y)) group.rows.set(p.y, []);
    group.rows.get(p.y).push(p.x);
  });
  const result = [...groups.values()].map((group) => {
    const parts = [];
    group.rows.forEach((xs, y) => {
      xs.sort((a, b) => a - b);
      let runStart = xs[0];
      for (let i = 1; i <= xs.length; i++) {
        const x = xs[i];
        if (i === xs.length || x !== xs[i - 1] + 1) {
          const end = xs[i - 1];
          const len = end - runStart + 1;
          parts.push(`M${runStart} ${y}h${len}v1h-${len}z`);
          runStart = x;
        }
      }
    });
    return { color: group.color, opacity: group.opacity, d: parts.join("") };
  });
  pathCache.set(pixels, result);
  return result;
}

function PixelArt({ sets, className = "", style }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cx("pixel-art", className)}
      style={style}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {sets.map((set, index) =>
        set && set.opacity > 0.001 ? (
          <g key={index} opacity={set.opacity}>
            {pixelPaths(set.pixels).map((p) => (
              <path key={`${p.color}-${p.opacity}`} d={p.d} fill={p.color} fillOpacity={p.opacity < 1 ? p.opacity : undefined} />
            ))}
          </g>
        ) : null
      )}
    </svg>
  );
}

function LayerThumb({ pixels, dim = false, group = false, tone = "default" }) {
  return (
    <div className={cx("layer-thumb", dim && "dim", group && "is-group", `tone-${tone}`)}>
      <div className="thumb-checker" />
      <div className="thumb-art">
        <PixelArt sets={[{ pixels: pixels || [], opacity: 1 }]} />
      </div>
      {group && (
        <span className="thumb-group-badge">
          <Icon name="folder" size={8} />
        </span>
      )}
      <div className="thumb-gloss" />
    </div>
  );
}

function Range({ value, min = 0, max = 100, step = 1, onChange, track, width, className = "", ariaLabel, disabled = false, small = false }) {
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
  const background =
    track ||
    `linear-gradient(90deg, #93aaff 0%, #93aaff ${pct}%, rgba(255,255,255,.105) ${pct}%, rgba(255,255,255,.105) 100%)`;
  return (
    <input
      type="range"
      className={cx("pix-range", small && "small", className)}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      style={{ "--track": background, width }}
      aria-label={ariaLabel}
      disabled={disabled}
    />
  );
}

function PanelHead({ icon, title, count, actions }) {
  return (
    <div className="panel-head">
      <div className="panel-title">
        {icon && <Icon name={icon} size={13} className="panel-title-icon" />}
        <span>{title}</span>
        {count != null && <span className="count-badge">{count}</span>}
      </div>
      <div className="panel-actions">{actions}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Static UI data                                                      */
/* ------------------------------------------------------------------ */

const TOOL_GROUPS = [
  [
    { id: "move", name: "Move", key: "V", icon: "move" },
    { id: "marquee", name: "Rectangular marquee", key: "M", icon: "marquee" },
    { id: "lasso", name: "Lasso select", key: "Q", icon: "lasso" },
    { id: "wand", name: "Magic wand", key: "W", icon: "wand" }
  ],
  [
    { id: "pencil", name: "Pencil", key: "B", icon: "pencil" },
    { id: "eraser", name: "Eraser", key: "E", icon: "eraser" },
    { id: "fill", name: "Paint bucket", key: "G", icon: "bucket" }
  ],
  [
    { id: "line", name: "Line", key: "L", icon: "line" },
    { id: "rect", name: "Rectangle", key: "U", icon: "square" },
    { id: "ellipse", name: "Ellipse", key: "O", icon: "circle" }
  ],
  [{ id: "eyedropper", name: "Eyedropper", key: "I", icon: "pipette" }]
];
const ALL_TOOLS = TOOL_GROUPS.flat();

const MODES = [
  { id: "draw", label: "Draw", icon: "pencil" },
  { id: "tiles", label: "Tiles", icon: "grid", badge: "2" },
  { id: "rig", label: "Rig", icon: "move", badge: "3" }
];

const BLEND_MODES = ["Normal", "Multiply", "Screen", "Overlay", "Add"];

const DEFAULT_PALETTE = [
  "#11151B", "#252C36", "#475363", "#7C8A9D", "#E8EDF5",
  "#F07178", "#F59E5C", "#F4C558", "#E8EF8A", "#A7E27E",
  "#5ECF9A", "#5FC9D8", "#7FA8FF", "#9A8CF2", "#D78BD2", "#E6B8A2"
];

const DEFAULT_LAYERS = [
  { id: "group-slime", name: "Slime", kind: "group", parentId: null, visible: true, expanded: true, locked: false, opacity: 100, blend: "Normal", tint: "#8fa8ff" },
  { id: "highlights", name: "Highlights", kind: "raster", parentId: "group-slime", visible: true, locked: false, opacity: 90, blend: "Screen", tint: "#d8f0a4" },
  { id: "outline", name: "Outline", kind: "raster", parentId: "group-slime", visible: true, locked: false, opacity: 100, blend: "Normal", tint: "#a9c3b1" },
  { id: "shading", name: "Shading", kind: "raster", parentId: "group-slime", visible: true, locked: false, opacity: 100, blend: "Multiply", tint: "#6cc98c" },
  { id: "base", name: "Base", kind: "raster", parentId: "group-slime", visible: true, locked: false, opacity: 100, blend: "Normal", tint: "#8fe3a0" },
  { id: "fx", name: "Sparkle FX", kind: "raster", parentId: null, visible: true, locked: false, opacity: 80, blend: "Screen", tint: "#f5d47a" }
];

const KEYFRAMES = {
  base: [0, 1, 2, 3],
  shading: [0, 1, 2, 3],
  outline: [0, 1, 2, 3],
  highlights: [1, 3],
  fx: [0, 2]
};

const FLOAT_W = 292;
const FLOAT_H = 272;
const DESIGN_W = 1280;
const DESIGN_H = 800;
const STAGE_GAP = 24;

/* ------------------------------------------------------------------ */

export default function App() {
  const [menuOpen, setMenuOpen] = useState(null);
  const [toolId, setToolId] = useState("pencil");
  const [mode, setMode] = useState("draw");
  const [brush, setBrush] = useState(3);
  const [pixelPerfect, setPixelPerfect] = useState(true);
  const [symmetry, setSymmetry] = useState({ x: true, y: false });
  const [showGrid, setShowGrid] = useState(true);
  const [zoom, setZoom] = useState(11);
  const [cursor, setCursor] = useState(null);

  const [previewOpen, setPreviewOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [colorOpen, setColorOpen] = useState(true);
  const [previewScale, setPreviewScale] = useState(4);
  const [playing, setPlaying] = useState(true);
  const [loop, setLoop] = useState(true);
  const [fps, setFps] = useState(8);
  const [onion, setOnion] = useState(false);
  const [frameCount, setFrameCount] = useState(4);
  const [currentFrame, setCurrentFrame] = useState(0);

  const [layers, setLayers] = useState(DEFAULT_LAYERS);
  const [pixelMap, setPixelMap] = useState(PIXEL_MAP);
  const [activeLayerId, setActiveLayerId] = useState("outline");
  const [renaming, setRenaming] = useState(null);

  const [primary, setPrimary] = useState("#A7E27E");
  const [secondary, setSecondary] = useState("#252C36");
  const [hexInput, setHexInput] = useState("#A7E27E");
  const [palette, setPalette] = useState(DEFAULT_PALETTE);

  const [notice, setNotice] = useState(null);
  const [floatPos, setFloatPos] = useState({ x: null, y: null });
  const [dragging, setDragging] = useState(false);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const [uiReady, setUiReady] = useState(false);
  const [fitScale, setFitScale] = useState(() => {
    if (typeof window === "undefined") return 1;
    const raw = Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H);
    return raw >= 1
      ? raw
      : Math.min(
          window.innerWidth / (DESIGN_W + 32),
          window.innerHeight / (DESIGN_H + 32)
        );
  });

  const workspaceRef = useRef(null);
  const menuRef = useRef(null);
  const dragRef = useRef(null);
  const noticeId = useRef(0);
  const newId = useRef(0);
  const floatPinned = useRef(true);

  const flash = (text) => {
    noticeId.current += 1;
    setNotice({ text, id: noticeId.current });
  };

  const activeTool = ALL_TOOLS.find((t) => t.id === toolId) || ALL_TOOLS[0];
  const activeLayer =
    layers.find((layer) => layer.id === activeLayerId) ||
    layers.find((layer) => layer.kind === "raster") ||
    layers[0];
  const groupLayer = layers.find((layer) => layer.kind === "group");
  const rasterLayers = layers.filter((layer) => layer.kind === "raster");
  const rasterCount = rasterLayers.length;

  const hsv = useMemo(() => rgbToHsv(hexToRgb(primary)), [primary]);
  const hueTrack = "linear-gradient(90deg,#f25555 0%,#f2d94f 16%,#9be15d 33%,#4fe1c4 50%,#5aa4ff 66%,#a076f2 83%,#ed6bc7 100%)";
  const satTrack = `linear-gradient(90deg, ${hsvToHex(hsv.h, 0, hsv.v)}, ${hsvToHex(hsv.h, 100, hsv.v)})`;
  const valTrack = `linear-gradient(90deg, #0b0d10, ${hsvToHex(hsv.h, hsv.s, 100)})`;
  const shades = useMemo(
    () => [-0.46, -0.3, -0.14, 0, 0.16, 0.32].map((amount) =>
      amount < 0 ? mixHex(primary, "#0a0d10", -amount) : mixHex(primary, "#ffffff", amount)
    ),
    [primary]
  );

  const flatRows = useMemo(() => {
    const rows = [];
    layers
      .filter((layer) => !layer.parentId)
      .forEach((root) => {
        rows.push(root);
        if (root.kind === "group") {
          rows.push(...layers.filter((layer) => layer.parentId === root.id));
        }
      });
    return rows;
  }, [layers]);

  const displayRows = useMemo(() => {
    const rows = [];
    layers
      .filter((layer) => !layer.parentId)
      .forEach((root) => {
        rows.push(root);
        if (root.kind === "group" && root.expanded !== false) {
          rows.push(...layers.filter((layer) => layer.parentId === root.id));
        }
      });
    return rows;
  }, [layers]);

  const timelineRows = useMemo(() => flatRows.filter((layer) => layer.kind === "raster"), [flatRows]);

  const canvasSets = useMemo(() => {
    const rasterFlat = flatRows.filter((layer) => layer.kind === "raster");
    return rasterFlat
      .slice()
      .reverse()
      .map((layer) => {
        const inheritedVisible =
          !layer.parentId || !groupLayer ? true : groupLayer.visible;
        const inheritedOpacity =
          !layer.parentId || !groupLayer ? 1 : groupLayer.opacity / 100;
        const opacity =
          layer.visible && inheritedVisible
            ? (layer.opacity / 100) * inheritedOpacity
            : 0;
        return { pixels: pixelMap[layer.id] || [], opacity };
      });
  }, [flatRows, groupLayer, pixelMap]);

  const menuDefs = [
    {
      name: "File",
      items: [
        { label: "New Sprite…", shortcut: "Ctrl N", action: () => flash("New sprite preset · 32 × 32") },
        { label: "Open Project…", shortcut: "Ctrl O", action: () => flash("Open a .pixet project") },
        { label: "Save", shortcut: "Ctrl S", action: () => flash("Project saved · untitled.pixet") },
        { divider: true },
        { label: "Export Spritesheet…", shortcut: "Ctrl E", action: () => flash(`Export spritesheet · ${frameCount} frames`) }
      ]
    },
    {
      name: "Edit",
      items: [
        { label: "Undo", shortcut: "Ctrl Z", action: () => flash("Nothing to undo") },
        { label: "Redo", shortcut: "Ctrl ⇧ Z", action: () => flash("Nothing to redo") },
        { divider: true },
        { label: "Cut", shortcut: "Ctrl X", action: () => flash("Cut selection") },
        { label: "Copy", shortcut: "Ctrl C", action: () => flash("Copied selection") },
        { label: "Paste", shortcut: "Ctrl V", action: () => flash("Pasted pixels") },
        { label: "Select All", shortcut: "Ctrl A", action: () => flash("Selected the full canvas") },
        { divider: true },
        { label: "Flip Horizontal", action: () => flash("Flip horizontal applied") },
        { label: "Flip Vertical", action: () => flash("Flip vertical applied") }
      ]
    },
    {
      name: "View",
      items: [
        {
          label: "Pixel Grid",
          shortcut: "G",
          checked: showGrid,
          action: () => {
            setShowGrid((value) => !value);
            flash(showGrid ? "Pixel grid hidden" : "Pixel grid shown");
          }
        },
        {
          label: "Floating Preview",
          shortcut: "P",
          checked: previewOpen,
          action: () => {
            setPreviewOpen((value) => !value);
            flash(previewOpen ? "Preview hidden" : "Preview reopened");
          }
        },
        {
          label: "Inspector",
          shortcut: "Tab",
          checked: inspectorOpen,
          action: () => {
            setInspectorOpen((value) => !value);
            flash(inspectorOpen ? "Inspector hidden" : "Inspector shown");
          }
        },
        {
          label: "Timeline",
          shortcut: "T",
          checked: timelineOpen,
          action: () => {
            setTimelineOpen((value) => !value);
            flash(timelineOpen ? "Timeline collapsed" : "Timeline expanded");
          }
        },
        { divider: true },
        { label: "Fit Canvas", shortcut: "⇧ 0", action: () => fitCanvas() }
      ]
    },
    {
      name: "Sprite",
      items: [
        { label: "New Layer", action: addLayer },
        { label: "Duplicate Layer", action: duplicateLayer },
        { label: "New Frame", action: addFrame },
        { divider: true },
        { label: "Rename Layer", action: () => activeLayer && startRename(activeLayer) },
        { label: "Delete Layer", action: deleteLayer }
      ]
    }
  ];

  useEffect(() => {
    const updateScale = () => {
      const raw = Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H);
      setFitScale(
        raw >= 1
          ? raw
          : Math.min(
              window.innerWidth / (DESIGN_W + 32),
              window.innerHeight / (DESIGN_H + 32)
            )
      );
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setUiReady(true), 320);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    setHexInput(primary.toUpperCase());
  }, [primary]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  useEffect(() => {
    if (!playing) return;
    const delay = Math.max(55, Math.round(1000 / Math.max(1, fps)));
    const timer = setTimeout(() => {
      if (currentFrame >= frameCount - 1) {
        if (loop) setCurrentFrame(0);
        else setPlaying(false);
      } else {
        setCurrentFrame((frame) => frame + 1);
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [playing, fps, frameCount, loop, currentFrame]);

  useLayoutEffect(() => {
    const el = workspaceRef.current;
    if (!el) return;
    const maxY = Math.max(8, el.clientHeight - FLOAT_H - 8);
    const cardW = zoom * 32;
    const pairW = cardW + STAGE_GAP + FLOAT_W;
    setWorkspaceWidth(el.clientWidth);
    setFloatPos({
      x: Math.max(10, Math.round((el.clientWidth - pairW) / 2 + cardW + STAGE_GAP)),
      y: clamp(Math.round((el.clientHeight - FLOAT_H) / 2), 14, maxY)
    });
  }, []);

  useEffect(() => {
    const el = workspaceRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setWorkspaceWidth(el.clientWidth);
      setFloatPos((position) => {
        const maxY = Math.max(8, el.clientHeight - FLOAT_H - 8);
        if (floatPinned.current) {
          const cardW = zoom * 32;
          const pairW = cardW + STAGE_GAP + FLOAT_W;
          return {
            x: Math.max(8, Math.round((el.clientWidth - pairW) / 2 + cardW + STAGE_GAP)),
            y: clamp(Math.round((el.clientHeight - FLOAT_H) / 2), 14, maxY)
          };
        }
        if (position.x == null) return position;
        return {
          x: clamp(position.x, 8, Math.max(8, el.clientWidth - FLOAT_W - 8)),
          y: clamp(position.y, 8, maxY)
        };
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /* ------------------------------- actions ------------------------------- */

  function selectTool(id) {
    setToolId(id);
  }

  function swapColors() {
    setPrimary(secondary);
    setSecondary(primary);
  }

  function selectFrame(frame) {
    setCurrentFrame(frame);
    setPlaying(false);
  }

  function addFrame() {
    if (frameCount >= 8) {
      flash("This concept keeps up to 8 frames");
      return;
    }
    const next = frameCount;
    setFrameCount((count) => count + 1);
    setCurrentFrame(next);
    setPlaying(false);
    flash(`Frame ${next + 1} added`);
  }

  function updateLayer(id, patch) {
    setLayers((current) => current.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)));
  }

  function selectLayer(id) {
    setActiveLayerId(id);
  }

  function toggleVisible(id) {
    const layer = layers.find((item) => item.id === id);
    if (!layer) return;
    updateLayer(id, { visible: !layer.visible });
    flash(`${layer.name} ${layer.visible ? "hidden" : "visible"}`);
  }

  function toggleLocked(id) {
    const layer = layers.find((item) => item.id === id);
    if (!layer) return;
    updateLayer(id, { locked: !layer.locked });
    flash(`${layer.name} ${layer.locked ? "unlocked" : "locked"}`);
  }

  function toggleGroup(id) {
    const layer = layers.find((item) => item.id === id);
    if (!layer) return;
    updateLayer(id, { expanded: layer.expanded === false });
  }

  function addLayer() {
    newId.current += 1;
    const id = `layer-${Date.now()}-${newId.current}`;
    const anchor = layers.find((layer) => layer.id === activeLayerId);
    const parentId = anchor && anchor.kind === "raster" ? anchor.parentId : groupLayer ? groupLayer.id : null;
    const layer = {
      id,
      name: `Layer ${rasterCount + 1}`,
      kind: "raster",
      parentId,
      visible: true,
      locked: false,
      opacity: 100,
      blend: "Normal",
      tint: "#91a4b8"
    };
    setLayers((current) => {
      const index = current.findIndex((item) => item.id === activeLayerId);
      const copy = [...current];
      copy.splice(index >= 0 ? index + 1 : copy.length, 0, layer);
      return copy;
    });
    setPixelMap((current) => ({ ...current, [id]: [] }));
    setActiveLayerId(id);
    setInspectorOpen(true);
    flash("New empty layer created");
  }

  function duplicateLayer() {
    const source = layers.find((layer) => layer.id === activeLayerId);
    if (!source || source.kind === "group") {
      flash("Select a raster layer to duplicate");
      return;
    }
    newId.current += 1;
    const id = `layer-${Date.now()}-${newId.current}`;
    const copyLayer = { ...source, id, name: `${source.name} copy`, locked: false };
    setLayers((current) => {
      const index = current.findIndex((layer) => layer.id === source.id);
      const copy = [...current];
      copy.splice(index + 1, 0, copyLayer);
      return copy;
    });
    setPixelMap((current) => ({ ...current, [id]: current[source.id] || [] }));
    setActiveLayerId(id);
    flash(`${source.name} duplicated`);
  }

  function deleteLayer() {
    const layer = layers.find((item) => item.id === activeLayerId);
    if (!layer) return;
    if (layer.kind === "group") {
      flash("Groups are kept intact in this concept");
      return;
    }
    if (rasterCount <= 1) {
      flash("Keep at least one raster layer");
      return;
    }
    const remaining = layers.filter((item) => item.id !== layer.id);
    setLayers(remaining);
    setPixelMap((current) => {
      const copy = { ...current };
      delete copy[layer.id];
      return copy;
    });
    const nextActive = remaining.find((item) => item.kind === "raster");
    setActiveLayerId(nextActive ? nextActive.id : remaining[0].id);
    flash(`${layer.name} deleted`);
  }

  function startRename(layer) {
    if (!layer) return;
    setRenaming({ id: layer.id, value: layer.name });
  }

  function commitRename() {
    if (!renaming) return;
    const value = renaming.value.trim();
    if (value) {
      updateLayer(renaming.id, { name: value });
      flash("Layer renamed");
    }
    setRenaming(null);
  }

  function addColor() {
    const next = primary.toUpperCase();
    if (palette.some((color) => color.toUpperCase() === next)) {
      flash(`${next} is already in the palette`);
      return;
    }
    if (palette.length >= 24) {
      flash("Palette is full");
      return;
    }
    setPalette((colors) => [...colors, next]);
    flash(`Added ${next} to the palette`);
  }

  function commitHex() {
    let value = hexInput.trim().toUpperCase();
    if (!value.startsWith("#")) value = `#${value}`;
    if (/^#[0-9A-F]{6}$/.test(value)) {
      setPrimary(value.toLowerCase());
      setHexInput(value);
    } else {
      setHexInput(primary.toUpperCase());
      flash("Enter a six-digit hex colour");
    }
  }

  function chooseColor(hex) {
    setPrimary(hex.toLowerCase());
    setHexInput(hex.toUpperCase());
  }

  function setHsv(part, value) {
    const next = {
      h: part === "h" ? Number(value) : hsv.h,
      s: part === "s" ? Number(value) : hsv.s,
      v: part === "v" ? Number(value) : hsv.v
    };
    const hex = hsvToHex(next.h, next.s, next.v);
    setPrimary(hex);
    setHexInput(hex.toUpperCase());
  }

  function fitCanvas() {
    const el = workspaceRef.current;
    if (!el) return;
    const fitted = Math.floor(Math.min((el.clientHeight - 100) / 32, (el.clientWidth - 150) / 32));
    setZoom(clamp(fitted, 6, 16));
    flash("Canvas fitted to the workspace");
  }

  function resetFloat() {
    const el = workspaceRef.current;
    floatPinned.current = true;
    if (!el) return;
    const cardW = zoom * 32;
    const pairW = cardW + STAGE_GAP + FLOAT_W;
    setFloatPos({
      x: Math.max(10, Math.round((el.clientWidth - pairW) / 2 + cardW + STAGE_GAP)),
      y: clamp(Math.round((el.clientHeight - FLOAT_H) / 2), 14, Math.max(8, el.clientHeight - FLOAT_H - 8))
    });
  }

  /* ----------------------------- canvas events ---------------------------- */

  function handleArtboardMove(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * 32);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * 32);
    if (x >= 0 && x < 32 && y >= 0 && y < 32) setCursor({ x, y });
    else setCursor(null);
  }

  function handleArtboardDown() {
    if (toolId !== "eyedropper" || !cursor) return;
    for (let i = canvasSets.length - 1; i >= 0; i--) {
      const set = canvasSets[i];
      if (!set || set.opacity <= 0) continue;
      const hit = [...set.pixels].reverse().find((pixel) => pixel.x === cursor.x && pixel.y === cursor.y);
      if (hit) {
        chooseColor(hit.c);
        flash(`Picked ${hit.c.toUpperCase()} at ${cursor.x}, ${cursor.y}`);
        return;
      }
    }
    flash("That pixel is transparent");
  }

  /* ---------------------------- floating drag ----------------------------- */

  function onFloatDown(event) {
    if (event.button !== 0) return;
    if (event.target.closest && event.target.closest("[data-nodrag]")) return;
    const el = workspaceRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const scale = rect.width / el.offsetWidth || 1;
    dragRef.current = {
      ox: (event.clientX - rect.left) / scale - (floatPos.x || 0),
      oy: (event.clientY - rect.top) / scale - (floatPos.y || 0)
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onFloatMove(event) {
    if (!dragRef.current) return;
    floatPinned.current = false;
    const el = workspaceRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const scale = rect.width / el.offsetWidth || 1;
    const x = clamp((event.clientX - rect.left) / scale - dragRef.current.ox, 8, Math.max(8, el.clientWidth - FLOAT_W - 8));
    const y = clamp((event.clientY - rect.top) / scale - dragRef.current.oy, 8, Math.max(8, el.clientHeight - FLOAT_H - 8));
    setFloatPos({ x, y });
  }

  function endFloatDrag(event) {
    dragRef.current = null;
    setDragging(false);
    if (event && event.currentTarget && event.currentTarget.hasPointerCapture && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  /* -------------------------------- render -------------------------------- */

  const previewSpriteSize = previewScale * 32;
  const bobUnit = [0, -1, 0, 1][currentFrame % 4] * previewScale * 0.72;
  const canvasSize = zoom * 32;
  const stageShift =
    previewOpen && workspaceWidth > 0
      ? clamp(
          (STAGE_GAP + FLOAT_W) / 2,
          0,
          Math.max(0, (workspaceWidth - canvasSize) / 2 - 16)
        )
      : 0;

  return (
    <div className="app-shell">
      <div className="app-frame" style={{ transform: `scale(${fitScale})` }}>
        <div className={cx("app", uiReady && "ui-ready")}>
          <style>{STYLES}</style>

      <header className="topbar">
        <div className="tb-left">
          <div className="brand" title="Pixet">
            <div className="brand-mark">
              <svg width="15" height="15" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
                <rect x="3" y="2" width="3" height="12" fill="currentColor" />
                <rect x="6" y="2" width="6" height="3" fill="currentColor" />
                <rect x="10" y="5" width="2" height="3" fill="currentColor" />
                <rect x="6" y="7" width="5" height="3" fill="currentColor" />
              </svg>
            </div>
            <span className="brand-word">pixet</span>
          </div>
          <div className="tb-sep" />
          <nav className="menu-strip" ref={menuRef} aria-label="Main menu">
            {menuDefs.map((menu) => (
              <div className="menu-wrap" key={menu.name}>
                <button
                  type="button"
                  className={cx("menu-btn", menuOpen === menu.name && "open")}
                  onClick={() => setMenuOpen(menuOpen === menu.name ? null : menu.name)}
                >
                  {menu.name}
                </button>
                {menuOpen === menu.name && (
                  <div className="menu-pop" role="menu">
                    {menu.items.map((item, index) =>
                      item.divider ? (
                        <div className="menu-divider" key={`divider-${index}`} />
                      ) : (
                        <button
                          type="button"
                          className="menu-item"
                          key={item.label}
                          role="menuitem"
                          onClick={() => {
                            setMenuOpen(null);
                            item.action();
                          }}
                        >
                          <span>{item.label}</span>
                          <span className="menu-tail">
                            {item.checked && <Icon name="check" size={11} />}
                            {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
                          </span>
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            ))}
          </nav>
        </div>

        <div className="tb-center">
          <div className="modes" role="tablist" aria-label="Workspace mode">
            {MODES.map((item) => (
              <button
                type="button"
                key={item.id}
                role="tab"
                aria-selected={mode === item.id}
                className={cx("mode", mode === item.id && "active")}
                onClick={() => {
                  setMode(item.id);
                  if (item.id !== "draw") flash(`${item.label} workspace · Phase ${item.badge}`);
                }}
              >
                <Icon name={item.icon} size={13} />
                <span>{item.label}</span>
                {item.badge && <span className="mode-badge">{item.badge}</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="tb-right">
          <div className="actions-group">
            <IconBtn name="undo" label="Undo (Ctrl+Z)" onClick={() => flash("Nothing to undo yet")} />
            <IconBtn name="redo" label="Redo (Ctrl+Shift+Z)" onClick={() => flash("Nothing to redo yet")} />
          </div>
          <div className="tb-sep" />
          <IconBtn
            name="image"
            label="Toggle floating preview"
            active={previewOpen}
            onClick={() => {
              setPreviewOpen((value) => !value);
              flash(previewOpen ? "Floating preview hidden" : "Floating preview opened");
            }}
          />
          <IconBtn
            name="panelRight"
            label="Toggle inspector"
            active={inspectorOpen}
            onClick={() => {
              setInspectorOpen((value) => !value);
              flash(inspectorOpen ? "Inspector hidden" : "Inspector shown");
            }}
          />
          <IconBtn
            name="timeline"
            label="Toggle timeline"
            active={timelineOpen}
            onClick={() => {
              setTimelineOpen((value) => !value);
              flash(timelineOpen ? "Timeline collapsed" : "Timeline expanded");
            }}
          />
          <div className="tb-sep" />
          <button
            type="button"
            className="export-btn"
            onClick={() => flash(`Export spritesheet · ${frameCount} frames · 32 × 32`)}
            title="Export spritesheet (Ctrl+E)"
          >
            <Icon name="download" size={13} />
            <span>Export</span>
            <span className="export-chevron">
              <Icon name="chevronDown" size={10} />
            </span>
          </button>
        </div>
      </header>

      <div className="optionsbar">
        <div className="opt-group">
          <div className="active-tool">
            <Icon name={activeTool.icon} size={14} />
            <span className="active-tool-name">{activeTool.name}</span>
            <span className="kbd">{activeTool.key}</span>
          </div>
          <div className="v-sep" />
          <div className="opt-field">
            <span className="opt-label">Size</span>
            <Range value={brush} min={1} max={12} onChange={setBrush} width={92} ariaLabel="Brush size" />
            <span className="value-pill">{pad2(brush)} px</span>
          </div>
          <div className="v-sep" />
          <button
            type="button"
            className={cx("chip", pixelPerfect && "active")}
            onClick={() => setPixelPerfect((value) => !value)}
            title="Prevent L-shaped corners while drawing"
          >
            <Icon name="sparkles" size={12} />
            <span>Pixel-perfect</span>
          </button>
          <div className="opt-field symmetry-field">
            <span className="opt-label">Symmetry</span>
            <button
              type="button"
              className={cx("toggle-mini", symmetry.x && "active")}
              onClick={() => setSymmetry((value) => ({ ...value, x: !value.x }))}
              title="Mirror horizontally"
            >
              X
            </button>
            <button
              type="button"
              className={cx("toggle-mini", symmetry.y && "active")}
              onClick={() => setSymmetry((value) => ({ ...value, y: !value.y }))}
              title="Mirror vertically"
            >
              Y
            </button>
          </div>
          <button
            type="button"
            className={cx("chip", showGrid && "active")}
            onClick={() => setShowGrid((value) => !value)}
            title="Toggle pixel grid"
          >
            <Icon name="grid" size={12} />
            <span>Grid</span>
          </button>
        </div>
        <div className="options-hint">
          <span className="kbd">Space</span><span>pan</span>
          <span className="hint-dot" />
          <span className="kbd">Scroll</span><span>zoom</span>
          <span className="hint-dot" />
          <span className="kbd">Tab</span><span>panels</span>
        </div>
      </div>

      <main className="main">
        <aside className="rail" aria-label="Tools">
          {TOOL_GROUPS.map((group, groupIndex) => (
            <React.Fragment key={groupIndex}>
              <div className="rail-group">
                {group.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={cx("rail-btn", toolId === item.id && "active")}
                    onClick={() => selectTool(item.id)}
                    aria-label={item.name}
                    aria-pressed={toolId === item.id}
                  >
                    <Icon name={item.icon} size={17} />
                    <span className="rail-tip">
                      <span>{item.name}</span>
                      <span className="kbd">{item.key}</span>
                    </span>
                  </button>
                ))}
              </div>
              {groupIndex < TOOL_GROUPS.length - 1 && <div className="rail-sep" />}
            </React.Fragment>
          ))}
          <div className="rail-bottom">
            <div className="rail-colors" title={`Foreground ${primary.toUpperCase()} · Background ${secondary.toUpperCase()}`}>
              <div className="mini-swatch bg" style={{ background: secondary }} />
              <div className="mini-swatch fg" style={{ background: primary }} />
              <button type="button" className="swap-mini" onClick={swapColors} title="Swap foreground and background">
                <Icon name="swap" size={9} />
              </button>
            </div>
            <button type="button" className="rail-help" onClick={() => flash("Shortcuts · B pencil · E eraser · G fill · M marquee")} title="Keyboard shortcuts">
              ?
            </button>
          </div>
        </aside>

        <div className="center">
          <div className="workspace" ref={workspaceRef}>
            <div className="stage">
              <div className="stage-inner" style={{ transform: `translateX(${-stageShift}px)` }}>
                <div className="art-meta">
                  <span className="dot" />
                  <span className="art-name">untitled.pixet</span>
                  <span className="meta-sep" />
                  <span className="mono">32 × 32</span>
                  <span className="meta-sep" />
                  <span className="mono">RGBA</span>
                  <span className="meta-sep" />
                  <span className="mode-caption">{mode.toUpperCase()}</span>
                </div>
                <div
                  className="artboard"
                  style={{ width: zoom * 32, height: zoom * 32 }}
                  onPointerMove={handleArtboardMove}
                  onPointerDown={handleArtboardDown}
                  onPointerLeave={() => setCursor(null)}
                >
                  <div className="artboard-checker checker" />
                  <div className="art-svg">
                    <PixelArt sets={canvasSets} />
                  </div>
                  {showGrid && <div className="pixel-grid" style={{ backgroundSize: `${zoom}px ${zoom}px` }} />}
                  {cursor && (
                    <div
                      className="hover-pixel"
                      style={{ left: cursor.x * zoom, top: cursor.y * zoom, width: zoom, height: zoom }}
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="zoom-pill" style={{ left: `calc(50% - ${stageShift}px)` }}>
              <button type="button" className="zoom-btn" onClick={() => setZoom((value) => clamp(value - 1, 6, 16))} title="Zoom out">
                <Icon name="minus" size={13} />
              </button>
              <span className="zoom-value">{zoom * 100}%</span>
              <button type="button" className="zoom-btn" onClick={() => setZoom((value) => clamp(value + 1, 6, 16))} title="Zoom in">
                <Icon name="plus" size={13} />
              </button>
              <span className="zoom-div" />
              <button type="button" className="zoom-btn" onClick={fitCanvas} title="Fit canvas">
                <Icon name="fit" size={12} />
              </button>
            </div>

            {previewOpen && floatPos.x != null && (
              <div
                className={cx("floating", dragging && "dragging")}
                style={{ left: floatPos.x == null ? 0 : floatPos.x, top: floatPos.y == null ? 0 : floatPos.y }}
              >
                <div
                  className="fp-head"
                  onPointerDown={onFloatDown}
                  onPointerMove={onFloatMove}
                  onPointerUp={endFloatDrag}
                  onPointerCancel={endFloatDrag}
                  onLostPointerCapture={endFloatDrag}
                  onDoubleClick={resetFloat}
                  title="Drag to move the preview"
                >
                  <span className="fp-grip"><Icon name="grip" size={12} /></span>
                  <span className="fp-title">Preview</span>
                  <span className="fp-tag"><span className="dot" />idle</span>
                  <div className="fp-head-actions" data-nodrag>
                    <button type="button" className="fp-icon" onClick={resetFloat} title="Reset preview position">
                      <Icon name="target" size={13} />
                    </button>
                    <button
                      type="button"
                      className="fp-icon"
                      onClick={() => {
                        setPreviewOpen(false);
                        flash("Floating preview hidden");
                      }}
                      title="Close preview"
                    >
                      <Icon name="x" size={13} />
                    </button>
                  </div>
                </div>

                <div className="fp-toolbar">
                  <span className="fp-label">Scale</span>
                  <div className="fp-scale">
                    {[1, 2, 4].map((scale) => (
                      <button
                        type="button"
                        key={scale}
                        className={cx(previewScale === scale && "active")}
                        onClick={() => setPreviewScale(scale)}
                      >
                        {scale}×
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className={cx("fp-play", playing && "active")}
                    onClick={() => setPlaying((value) => !value)}
                    title={playing ? "Pause preview" : "Play preview"}
                  >
                    <Icon name={playing ? "pause" : "play"} size={12} />
                  </button>
                </div>

                <div className="fp-body">
                  <div className="fp-stage checker">
                    <div className="fp-glow" />
                    <div
                      className="fp-sprite"
                      style={{ width: previewSpriteSize, height: previewSpriteSize, transform: `translateY(${bobUnit}px)` }}
                    >
                      <PixelArt sets={canvasSets} />
                    </div>
                    <span className="fp-size">32 × 32</span>
                    <span className={cx("fp-live", !playing && "paused")}>
                      <span className="pulse" />
                      {playing ? "LIVE" : "PAUSED"}
                    </span>
                  </div>
                </div>

                <div className="fp-foot">
                  <span className="fp-frame-text">F {pad2(currentFrame + 1)}<span> / {pad2(frameCount)}</span></span>
                  <span className="fp-fps">{fps} FPS</span>
                  <div className="fp-dots">
                    {Array.from({ length: frameCount }).map((_, index) => (
                      <button
                        type="button"
                        key={index}
                        className={cx("fp-dot", index === currentFrame && "active")}
                        onClick={() => selectFrame(index)}
                        title={`Frame ${index + 1}`}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    className={cx("fp-loop", loop && "on")}
                    onClick={() => setLoop((value) => !value)}
                    title="Loop playback"
                  >
                    <Icon name="repeat" size={11} />
                  </button>
                </div>
              </div>
            )}
          </div>

          <section
            className={cx("timeline card", !timelineOpen && "collapsed")}
            style={{ height: timelineOpen ? 184 : 40 }}
            aria-label="Timeline"
          >
            <div className="tl-head">
              <div className="tl-title">
                <Icon name="layers" size={12} />
                <span>Timeline</span>
                <span className="tl-count">{frameCount}f</span>
              </div>
              <span className="tl-tag"><span className="dot" />idle</span>
              <div className="tl-controls">
                <button type="button" className="icon-btn sm" onClick={() => selectFrame(Math.max(0, currentFrame - 1))} title="Previous frame">
                  <Icon name="skipBack" size={13} />
                </button>
                <button
                  type="button"
                  className={cx("tl-play", playing && "active")}
                  onClick={() => setPlaying((value) => !value)}
                  title={playing ? "Pause" : "Play"}
                >
                  <Icon name={playing ? "pause" : "play"} size={13} />
                </button>
                <button type="button" className="icon-btn sm" onClick={() => selectFrame(Math.min(frameCount - 1, currentFrame + 1))} title="Next frame">
                  <Icon name="skipForward" size={13} />
                </button>
                <button type="button" className={cx("icon-btn sm", loop && "on")} onClick={() => setLoop((value) => !value)} title="Loop playback">
                  <Icon name="repeat" size={13} />
                </button>
              </div>
              <div className="tl-sep" />
              <div className="tl-fps">
                <span className="opt-label">FPS</span>
                <Range value={fps} min={4} max={24} onChange={setFps} small ariaLabel="Frames per second" />
                <span className="value-pill tiny">{fps}</span>
              </div>
              <button
                type="button"
                className={cx("chip compact", onion && "active")}
                onClick={() => {
                  setOnion((value) => !value);
                  flash(onion ? "Onion skin off" : "Onion skin on");
                }}
                title="Toggle onion skin"
              >
                <Icon name="onion" size={11} />
                <span>Onion</span>
              </button>
              <div className="tl-right">
                <button type="button" className="icon-btn sm" onClick={addFrame} title="Add frame">
                  <Icon name="plus" size={13} />
                </button>
                <button
                  type="button"
                  className="icon-btn sm"
                  onClick={() => setTimelineOpen((value) => !value)}
                  title={timelineOpen ? "Collapse timeline" : "Expand timeline"}
                >
                  <Icon name={timelineOpen ? "chevronDown" : "chevronUp"} size={13} />
                </button>
              </div>
            </div>

            {timelineOpen && (
              <div className="tl-body">
                <div
                  className="tl-grid"
                  style={{
                    gridTemplateColumns: `144px repeat(${frameCount}, minmax(68px, 1fr)) 34px`,
                    gridTemplateRows: `44px repeat(${timelineRows.length}, minmax(20px, 1fr))`
                  }}
                >
                  <div className="tl-corner">Layers</div>
                  {Array.from({ length: frameCount }).map((_, frame) => (
                    <button
                      type="button"
                      key={frame}
                      className={cx("tl-frame-head", frame === currentFrame && "active")}
                      onClick={() => selectFrame(frame)}
                      title={`Go to frame ${frame + 1}`}
                    >
                      <span className="tl-frame-no">{pad2(frame + 1)}</span>
                      <span className="tl-frame-thumb">
                        <PixelArt sets={canvasSets} />
                      </span>
                    </button>
                  ))}
                  <div className="tl-addcol">
                    <button type="button" className="icon-btn sm" onClick={addFrame} title="Add frame">
                      <Icon name="plus" size={12} />
                    </button>
                  </div>

                  {timelineRows.map((layer) => (
                    <React.Fragment key={layer.id}>
                      <button
                        type="button"
                        className={cx("tl-row-label", layer.id === activeLayerId && "active")}
                        onClick={() => setActiveLayerId(layer.id)}
                        title={layer.name}
                      >
                        <span className="tl-layer-dot" style={{ background: layer.tint || "#8f9baa" }} />
                        <span className="tl-layer-name">{layer.name}</span>
                        {layer.locked && <Icon name="lock" size={9} />}
                      </button>
                      {Array.from({ length: frameCount }).map((_, frame) => {
                        const present = KEYFRAMES[layer.id] ? KEYFRAMES[layer.id].includes(frame % 4) : true;
                        return (
                          <button
                            type="button"
                            key={frame}
                            className={cx("tl-cell", frame === currentFrame && "active-col", layer.id === activeLayerId && "active-row")}
                            onClick={() => {
                              setActiveLayerId(layer.id);
                              selectFrame(frame);
                            }}
                            title={`${layer.name} · frame ${frame + 1}`}
                          >
                            {present ? (
                              <span className={cx("tl-key", frame === currentFrame && "active")} style={{ background: layer.tint || "#8f9baa" }} />
                            ) : null}
                          </button>
                        );
                      })}
                      <div className="tl-empty" />
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>

        {inspectorOpen && (
          <aside className="inspector" aria-label="Inspector">
            <section className="card layers-card">
              <PanelHead
                icon="layers"
                title="Layers"
                count={rasterCount}
                actions={
                  <>
                    <IconBtn name="plus" label="New layer" small onClick={addLayer} />
                    <IconBtn name="copy" label="Duplicate layer" small onClick={duplicateLayer} />
                    <IconBtn name="trash" label="Delete layer" small onClick={deleteLayer} disabled={rasterCount <= 1} />
                  </>
                }
              />
              <div className="layers-controls">
                <div className="control-row">
                  <span className="control-label">Blend</span>
                  <div className="select-wrap">
                    <select
                      className="select"
                      value={activeLayer ? activeLayer.blend : "Normal"}
                      onChange={(event) => activeLayer && updateLayer(activeLayer.id, { blend: event.target.value })}
                      aria-label="Layer blend mode"
                    >
                      {BLEND_MODES.map((blend) => (
                        <option key={blend} value={blend}>{blend}</option>
                      ))}
                    </select>
                    <Icon name="chevronDown" size={11} className="select-caret" />
                  </div>
                </div>
                <div className="control-row">
                  <span className="control-label">Opacity</span>
                  <Range
                    value={activeLayer ? activeLayer.opacity : 100}
                    min={0}
                    max={100}
                    onChange={(value) => activeLayer && updateLayer(activeLayer.id, { opacity: value })}
                    ariaLabel="Layer opacity"
                    className="flex-range"
                  />
                  <span className="value-pill tiny">{activeLayer ? activeLayer.opacity : 100}%</span>
                </div>
              </div>

              <div className="layer-list scroll-thin">
                {displayRows.map((layer) => {
                  const isGroup = layer.kind === "group";
                  const active = layer.id === activeLayerId;
                  const child = Boolean(layer.parentId);
                  const effectiveVisible = layer.visible && (layer.parentId && groupLayer ? groupLayer.visible : true);
                  const childCount = layers.filter((item) => item.parentId === layer.id).length;
                  return (
                    <div
                      key={layer.id}
                      className={cx("layer-row", isGroup && "group", child && "child", active && "active", !effectiveVisible && "layer-hidden")}
                      onClick={() => selectLayer(layer.id)}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        startRename(layer);
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectLayer(layer.id);
                        }
                      }}
                    >
                      {isGroup && (
                        <button
                          type="button"
                          className="group-chevron"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleGroup(layer.id);
                          }}
                          title={layer.expanded === false ? "Expand group" : "Collapse group"}
                        >
                          <Icon name={layer.expanded === false ? "chevronRight" : "chevronDown"} size={12} />
                        </button>
                      )}
                      <LayerThumb
                        pixels={isGroup ? GROUP_PIXELS : pixelMap[layer.id] || []}
                        dim={!effectiveVisible}
                        group={isGroup}
                        tone={
                          isGroup
                            ? "group"
                            : layer.id === "outline"
                              ? "outline"
                              : layer.id === "highlights"
                                ? "highlights"
                                : layer.id === "fx"
                                  ? "fx"
                                  : "default"
                        }
                      />
                      <div className="layer-copy">
                        {renaming && renaming.id === layer.id ? (
                          <input
                            className="layer-rename-input"
                            autoFocus
                            value={renaming.value}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => setRenaming({ id: layer.id, value: event.target.value })}
                            onBlur={commitRename}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") commitRename();
                              if (event.key === "Escape") setRenaming(null);
                            }}
                            aria-label="Layer name"
                          />
                        ) : (
                          <span className="layer-name">{layer.name}</span>
                        )}
                        <span className="layer-meta">
                          {isGroup ? (
                            <>
                              <span>{childCount} layers</span>
                            </>
                          ) : (
                            <>
                              <span>{layer.blend}</span>
                              {layer.opacity !== 100 && (
                                <>
                                  <span className="meta-dot" />
                                  <span className="mono">{layer.opacity}%</span>
                                </>
                              )}
                            </>
                          )}
                        </span>
                      </div>
                      <div className="layer-actions">
                        <button
                          type="button"
                          className={cx("row-btn", !layer.visible && "eye-hidden")}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleVisible(layer.id);
                          }}
                          title={layer.visible ? "Hide layer" : "Show layer"}
                        >
                          <Icon name={layer.visible ? "eye" : "eyeOff"} size={13} />
                        </button>
                        {!isGroup && (
                          <button
                            type="button"
                            className={cx("row-btn", "lock-btn", layer.locked && "on")}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleLocked(layer.id);
                            }}
                            title={layer.locked ? "Unlock layer" : "Lock layer"}
                          >
                            <Icon name={layer.locked ? "lock" : "unlock"} size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="layer-foot">
                <span>{rasterCount} layers total</span>
                <span>Double-click to rename</span>
              </div>
            </section>

            <section className={cx("card color-card", !colorOpen && "collapsed")}>
              <PanelHead
                icon="color"
                title="Color"
                actions={
                  <>
                    <span className="mini-badge">sRGB</span>
                    <button type="button" className="icon-btn sm" onClick={() => setColorOpen((value) => !value)} title={colorOpen ? "Collapse color" : "Expand color"}>
                      <Icon name={colorOpen ? "chevronUp" : "chevronDown"} size={13} />
                    </button>
                  </>
                }
              />
              {colorOpen && (
                <div className="color-body">
                  <div className="color-top">
                    <div className="swatch-stack">
                      <div className="swatch-big bg" style={{ background: secondary }} title={`Background ${secondary.toUpperCase()}`} />
                      <div className="swatch-big fg" style={{ background: primary }} title={`Foreground ${primary.toUpperCase()}`} />
                      <button type="button" className="swap-mini" onClick={swapColors} title="Swap colors">
                        <Icon name="swap" size={9} />
                      </button>
                    </div>
                    <div className="color-info">
                      <div className="hex-wrap">
                        <span className="hex-dot" style={{ background: primary }} />
                        <input
                          className="hex-input"
                          value={hexInput}
                          maxLength={7}
                          spellCheck={false}
                          onChange={(event) => setHexInput(event.target.value.toUpperCase())}
                          onBlur={commitHex}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              commitHex();
                              event.currentTarget.blur();
                            }
                          }}
                          aria-label="Hex color"
                        />
                        <span className="hex-alpha">100%</span>
                      </div>
                      <div className="ramp-wrap">
                        <div className="ramp-label">
                          <span>Shades</span>
                        </div>
                        <div className="ramp">
                          {shades.map((shade, index) => (
                            <button
                              type="button"
                              key={`${shade}-${index}`}
                              className="ramp-step"
                              style={{ background: shade }}
                              onClick={() => chooseColor(shade)}
                              title={shade.toUpperCase()}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="hsv">
                    <div className="hsv-row">
                      <span className="hsv-char">H</span>
                      <Range value={hsv.h} min={0} max={359} onChange={(value) => setHsv("h", value)} track={hueTrack} ariaLabel="Hue" className="hsv-range" />
                      <span className="hsv-val">{hsv.h}°</span>
                    </div>
                    <div className="hsv-row">
                      <span className="hsv-char">S</span>
                      <Range value={hsv.s} min={0} max={100} onChange={(value) => setHsv("s", value)} track={satTrack} ariaLabel="Saturation" className="hsv-range" />
                      <span className="hsv-val">{hsv.s}%</span>
                    </div>
                    <div className="hsv-row">
                      <span className="hsv-char">V</span>
                      <Range value={hsv.v} min={0} max={100} onChange={(value) => setHsv("v", value)} track={valTrack} ariaLabel="Value" className="hsv-range" />
                      <span className="hsv-val">{hsv.v}%</span>
                    </div>
                  </div>

                  <div className="palette-head">
                    <span>Palette</span>
                    <span className="palette-name">Pixet 16</span>
                    <button type="button" className="add-color" onClick={addColor} title="Add current color">
                      <Icon name="plus" size={11} />
                    </button>
                  </div>
                  <div className="palette-grid">
                    {palette.map((color) => (
                      <button
                        type="button"
                        key={color}
                        className={cx("palette-swatch", color.toLowerCase() === primary.toLowerCase() && "active")}
                        style={{ background: color }}
                        onClick={() => chooseColor(color)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setSecondary(color);
                          flash(`Background set to ${color.toUpperCase()}`);
                        }}
                        title={`${color.toUpperCase()} · click for foreground · right-click for background`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </section>
          </aside>
        )}
      </main>

      <footer className="statusbar">
        <div className="status-group">
          <span className="status-item status-ready"><span className="dot" />Ready</span>
          <span className="status-sep" />
          <span className="status-item">untitled.pixet</span>
          <span className="status-sep" />
          <span className="status-item mono">32 × 32</span>
          <span className="status-sep" />
          <span className="status-item mono">{cursor ? `X ${pad2(cursor.x)}  Y ${pad2(cursor.y)}` : "X --  Y --"}</span>
          <span className="status-sep" />
          <span className="status-item mono">{zoom * 100}%</span>
          <span className="status-sep" />
          <span className="status-item mono">F {pad2(currentFrame + 1)} / {pad2(frameCount)}</span>
          <span className="status-sep" />
          <span className="status-item">RGBA</span>
        </div>
        <div className="status-right">
          {notice ? (
            <span className="toast" key={notice.id}>
              <span className="toast-dot" />
              {notice.text}
            </span>
          ) : (
            <>
              {previewOpen && (
                <span className="status-pill" title="The preview is a floating panel">
                  <Icon name="target" size={9} />
                  Floating preview
                </span>
              )}
              <span className="status-item layer-status">
                <span className="layer-status-label">Layer</span>
                <span className="layer-status-name">{activeLayer ? activeLayer.name : "—"}</span>
              </span>
              <span className="status-item version">Pixet 0.2</span>
            </>
          )}
        </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
