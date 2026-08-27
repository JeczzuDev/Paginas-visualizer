/**
 * Page-context helpers, injected by bake-bg.mjs.
 *
 * These functions are stringified and evaluated inside the browser, so they
 * must be self-contained -- no imports, no closure over module scope.
 */

/**
 * Retune every animation so its period divides the loop length T exactly,
 * then freeze both clocks (SMIL and CSS) so frames can be seeked.
 *
 * A CSS animation with direction `alternate` takes 2x its duration to return
 * to its starting pose, so that is the period we quantize -- getting this
 * wrong is what pushes these files to multi-hour true loops.
 */
export function harmonizeAndFreeze(T) {
  const report = { css: [], smil: [], warnings: [] };

  // --- CSS / Web Animations ---
  const anims = document.getAnimations();
  for (const anim of anims) {
    const eff = anim.effect;
    if (!eff) continue;
    const t = eff.getTiming();
    const durMs = t.duration;
    if (typeof durMs !== "number" || !isFinite(durMs) || durMs <= 0) continue;
    if (t.delay) report.warnings.push(`delay ${t.delay}ms on ${anim.animationName || "?"} not quantized`);

    const alternates = String(t.direction).startsWith("alternate");
    const periodMs = alternates ? durMs * 2 : durMs;
    const cycles = Math.max(1, Math.round((T * 1000) / periodMs));
    const newPeriodMs = (T * 1000) / cycles;
    const newDurMs = alternates ? newPeriodMs / 2 : newPeriodMs;

    eff.updateTiming({ duration: newDurMs });
    report.css.push({
      name: anim.animationName || "?",
      alternates,
      from: +(durMs / 1000).toFixed(4),
      to: +(newDurMs / 1000).toFixed(4),
      cycles,
    });
  }

  // --- SMIL ---
  const parseDur = (raw) => {
    if (!raw) return null;
    const m = String(raw).trim().match(/^([\d.]+)(ms|s|min)?$/);
    if (!m) return null;
    const v = parseFloat(m[1]);
    if (!isFinite(v) || v <= 0) return null;
    return m[2] === "ms" ? v / 1000 : m[2] === "min" ? v * 60 : v;
  };

  for (const el of document.querySelectorAll("animate, animateTransform, animateMotion, animateColor, set")) {
    const secs = parseDur(el.getAttribute("dur"));
    if (secs === null) continue;
    if (el.getAttribute("repeatCount") !== "indefinite") {
      report.warnings.push(`<${el.tagName}> dur=${secs}s is not repeatCount="indefinite"`);
    }
    const cycles = Math.max(1, Math.round(T / secs));
    const newDur = T / cycles;
    el.setAttribute("dur", newDur.toFixed(6) + "s");
    report.smil.push({
      attr: el.getAttribute("attributeName") || el.tagName,
      from: secs,
      to: +newDur.toFixed(4),
      cycles,
    });
  }

  // --- Freeze both clocks and cache the handles for seeking ---
  const svgs = [...document.querySelectorAll("svg")].filter((s) => typeof s.pauseAnimations === "function");
  for (const s of svgs) {
    s.setCurrentTime(0);
    s.pauseAnimations();
  }
  for (const a of anims) a.pause();

  window.__bakeSvgs = svgs;
  window.__bakeAnims = anims;

  // Worst-case timing distortion, so the caller can sanity-check the choice of T.
  const drift = [...report.css, ...report.smil]
    .map((r) => Math.abs(r.to - r.from) / r.from)
    .reduce((a, b) => Math.max(a, b), 0);
  report.maxDriftPct = +(drift * 100).toFixed(2);
  report.animCount = anims.length;
  return report;
}

/** Move both frozen clocks to `t` seconds and wait for the resulting paint. */
export function seekTo(t) {
  for (const s of window.__bakeSvgs) s.setCurrentTime(t);
  for (const a of window.__bakeAnims) a.currentTime = t * 1000;
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

/** Hide the authoring chrome that custom_bg.html ships (panel, picker, toast). */
export function hideAuthoringUI() {
  const style = document.createElement("style");
  style.textContent = `#panel,#picker,#toast{display:none !important}
    html,body{cursor:none !important}
    *{caret-color:transparent !important}`;
  document.documentElement.appendChild(style);
}
