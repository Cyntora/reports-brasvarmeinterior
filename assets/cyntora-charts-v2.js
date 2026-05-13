/* Cyntora Reports v2 — custom SVG chart renderer.
 *
 * Replaces Chart.js for v2 reports. Walks every `[data-cyntora]` element
 * (canvases or div placeholders), reads the spec, and renders an
 * inline SVG chart with hover/tooltip interactivity. Five chart kinds:
 *
 *   line       — multi-series line chart with crosshair tooltip
 *   bar        — vertical bars (optionally grouped two-series)
 *   donut      — donut with hover-segment highlight
 *   sparkline  — small inline trend line
 *
 * Visual language:
 *   - cream `#f8f6ec` background, ink `#1c1c1e` axes
 *   - brass `#B58F4B` accent for primary series
 *   - Inter tabular-nums via parent font-feature-settings
 *
 * Public API matches the old Chart.js renderer:
 *   window.cyntoraLine(elemId, spec)
 *   window.cyntoraBar(elemId, spec)
 *   window.cyntoraDonut(elemId, spec)
 *   window.cyntoraInlineSparkline(elemId, spec)
 *
 * Spec format is the same `data-cyntora` JSON the existing partials emit,
 * so no template changes are needed.
 */

(function () {
  'use strict';

  // ---- Palette ----------------------------------------------------------- //

  var P = {
    ink: '#1c1c1e',
    inkMuted: '#5a4d41',
    muted: '#868880',
    border: '#c9cbc1',
    borderSoft: '#dfe2d6',
    cream: '#f8f6ec',
    creamSoft: '#fffbf4',
    accent: '#272723',
    brass: '#B58F4B',
    brassSoft: 'rgba(181,143,75,0.18)',
    series: {
      current: '#272723',
      previous: '#B58F4B',
    },
    donut: [
      '#272723', '#B58F4B', '#5a4d41', '#868880',
      '#c9cbc1', '#3a3a35', '#a89b8b', '#dfe2d6',
      '#595a56', '#b2b5ab'
    ],
    good: '#3a7c4d',
    bad: '#b54141',
    onDark: '#f8f6ec',
    onDarkMuted: '#b2b5ab',
  };

  // ---- Formatters -------------------------------------------------------- //

  function fmtNumber(v) {
    if (v == null || isNaN(v)) return '';
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1).replace('.', ',') + 'M';
    if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1).replace('.', ',') + 'K';
    return Math.round(v).toLocaleString('sv-SE');
  }
  function fmtInt(v) {
    if (v == null || isNaN(v)) return '';
    return Math.round(v).toLocaleString('sv-SE');
  }
  function fmtCurrency(v, ccy) {
    var symbols = { USD: '$', EUR: '€', GBP: '£', SEK: 'kr', NOK: 'kr', DKK: 'kr', CHF: 'CHF', CAD: 'C$' };
    var s = symbols[ccy] || (ccy + ' ');
    if (v == null || isNaN(v)) return s + '0';
    if (Math.abs(v) >= 1e6) return s + (v / 1e6).toFixed(2).replace('.', ',') + 'M';
    if (Math.abs(v) >= 1e3) return s + (v / 1e3).toFixed(1).replace('.', ',') + 'K';
    return s + Math.round(v).toLocaleString('sv-SE');
  }
  function fmtDuration(seconds) {
    if (seconds == null || isNaN(seconds)) return '–';
    var s = Math.round(seconds);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    if (h) return h + ':' + pad(m) + ':' + pad(sec);
    return pad(m) + ':' + pad(sec);
  }
  function fmtPercent(v) {
    if (v == null || isNaN(v)) return '0%';
    return (v * 100).toFixed(1).replace('.', ',') + '%';
  }
  function pickFormatter(spec) {
    if (!spec) return fmtNumber;
    if (spec.format === 'currency') return function (v) { return fmtCurrency(v, spec.currency || 'SEK'); };
    if (spec.format === 'duration') return fmtDuration;
    if (spec.format === 'percent') return fmtPercent;
    return fmtNumber;
  }

  // ---- SVG helpers ------------------------------------------------------- //

  var NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs) {
    var el = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) {
      if (attrs[k] != null) el.setAttribute(k, attrs[k]);
    }
    return el;
  }

  function ensureContainer(target) {
    // Accept either a canvas (legacy) or a div placeholder. Replace canvas
    // with a div of the same size; keep div as-is.
    if (target.tagName === 'CANVAS') {
      var div = document.createElement('div');
      for (var i = 0; i < target.attributes.length; i++) {
        var a = target.attributes[i];
        if (a.name === 'id' || a.name.indexOf('data-') === 0 || a.name === 'class') {
          div.setAttribute(a.name, a.value);
        }
      }
      target.parentNode.replaceChild(div, target);
      return div;
    }
    return target;
  }

  function darkContext(el) {
    // Is this chart inside a `.page--dark` ancestor?
    var n = el;
    while (n && n !== document.body) {
      if (n.classList && n.classList.contains('page--dark')) return true;
      n = n.parentNode;
    }
    return false;
  }

  // ---- Tooltip ---------------------------------------------------------- //

  var globalTooltip = null;
  function getTooltip() {
    if (globalTooltip) return globalTooltip;
    globalTooltip = document.createElement('div');
    globalTooltip.className = 'cyntora-tooltip';
    globalTooltip.style.cssText = [
      'position: fixed', 'pointer-events: none', 'z-index: 1000',
      'background: rgba(28, 28, 30, 0.96)', 'color: #fffbf4',
      'font-family: "TT Hoves Pro Trial", Inter, system-ui, sans-serif',
      'font-size: 12.5px', 'line-height: 1.45',
      'padding: 10px 14px', 'border-radius: 0',
      'box-shadow: 0 4px 18px rgba(0,0,0,0.18)',
      'border-left: 2px solid #B58F4B',
      'min-width: 140px', 'max-width: 280px',
      'opacity: 0', 'transition: opacity 0.12s ease, transform 0.08s ease',
      'transform: translateY(2px)'
    ].join(';');
    document.body.appendChild(globalTooltip);
    return globalTooltip;
  }
  function showTooltip(html, x, y) {
    var t = getTooltip();
    t.innerHTML = html;
    var bb = t.getBoundingClientRect();
    var px = x + 14;
    var py = y + 14;
    if (px + bb.width > window.innerWidth - 8) px = x - bb.width - 14;
    if (py + bb.height > window.innerHeight - 8) py = y - bb.height - 14;
    t.style.left = Math.max(8, px) + 'px';
    t.style.top = Math.max(8, py) + 'px';
    t.style.opacity = '1';
    t.style.transform = 'translateY(0)';
  }
  function hideTooltip() {
    if (!globalTooltip) return;
    globalTooltip.style.opacity = '0';
    globalTooltip.style.transform = 'translateY(2px)';
  }

  // ---- Tick helpers ----------------------------------------------------- //

  function niceTicks(min, max, count, integer) {
    if (min === max) { min = min - 1; max = max + 1; }
    var range = max - min;
    var step = Math.pow(10, Math.floor(Math.log10(range / Math.max(count, 1))));
    var err = (count * step) / range;
    if (err <= 0.15) step *= 10;
    else if (err <= 0.35) step *= 5;
    else if (err <= 0.75) step *= 2;
    if (integer && step < 1) step = 1;
    var niceMin = Math.floor(min / step) * step;
    var niceMax = Math.ceil(max / step) * step;
    var ticks = [];
    for (var v = niceMin; v <= niceMax + step / 2; v += step) {
      ticks.push(integer ? Math.round(v) : Math.round(v * 1e6) / 1e6);
    }
    return { min: niceMin, max: niceMax, ticks: ticks, step: step };
  }

  // ---- LINE CHART -------------------------------------------------------- //

  function renderLine(container, spec) {
    container.innerHTML = '';
    var dark = darkContext(container);
    var w = container.clientWidth || 600;
    var h = container.clientHeight || 220;
    var pad = { top: 12, right: 18, bottom: 28, left: 44 };
    var iw = Math.max(0, w - pad.left - pad.right);
    var ih = Math.max(0, h - pad.top - pad.bottom);

    var labels = spec.labels || [];
    var series = (spec.series || []).filter(function (s) { return s && s.values; });
    if (!labels.length || !series.length) return;

    var allVals = [];
    series.forEach(function (s) { (s.values || []).forEach(function (v) { if (v != null && !isNaN(v)) allVals.push(+v); }); });
    var dataMin = Math.min.apply(null, allVals);
    var dataMax = Math.max.apply(null, allVals);
    if (spec.zero !== false && dataMin > 0) dataMin = 0;
    var ticks = niceTicks(dataMin, dataMax, 4, !!spec.integer);

    var fmt = pickFormatter(spec);
    var n = labels.length;
    var x = function (i) { return pad.left + (n === 1 ? iw / 2 : iw * i / (n - 1)); };
    var y = function (v) {
      var t = (v - ticks.min) / Math.max(1e-9, (ticks.max - ticks.min));
      return pad.top + ih * (1 - t);
    };

    var root = svg('svg', {
      width: '100%', height: h, viewBox: '0 0 ' + w + ' ' + h,
      role: 'img', 'aria-label': spec.aria || 'Linjediagram'
    });
    root.style.cssText = 'display:block;overflow:visible';

    // Gridlines + Y tick labels
    ticks.ticks.forEach(function (t) {
      var yy = y(t);
      root.appendChild(svg('line', {
        x1: pad.left, x2: pad.left + iw, y1: yy, y2: yy,
        stroke: dark ? 'rgba(255,255,255,0.08)' : '#eeeae0',
        'stroke-width': 1, 'shape-rendering': 'crispEdges'
      }));
      var label = svg('text', {
        x: pad.left - 8, y: yy + 4,
        fill: dark ? P.onDarkMuted : P.muted,
        'font-size': 10.5, 'font-family': 'Inter, system-ui, sans-serif',
        'text-anchor': 'end'
      });
      label.textContent = fmt(t);
      root.appendChild(label);
    });

    // X tick labels (skip to avoid crowding)
    var xStep = Math.max(1, Math.ceil(n / 6));
    for (var i = 0; i < n; i++) {
      if (i % xStep !== 0 && i !== n - 1) continue;
      var lbl = svg('text', {
        x: x(i), y: pad.top + ih + 16,
        fill: dark ? P.onDarkMuted : P.muted,
        'font-size': 10.5, 'font-family': 'Inter, system-ui, sans-serif',
        'text-anchor': 'middle'
      });
      lbl.textContent = labels[i];
      root.appendChild(lbl);
    }

    // Series lines + area fill for first series
    var colors = series.map(function (s, i) {
      return s.color || (i === 0
        ? (dark ? P.onDark : P.series.current)
        : (dark ? P.brass : P.series.previous));
    });

    series.forEach(function (s, idx) {
      var color = colors[idx];
      var dashed = !!s.dashed || idx > 0;
      var pts = [];
      var areaPts = [];
      var first = true, lastIdx = -1;
      (s.values || []).forEach(function (v, i) {
        if (v == null || isNaN(v)) return;
        var px = x(i), py = y(+v);
        if (first) { areaPts.push([px, pad.top + ih]); first = false; }
        pts.push([px, py]); areaPts.push([px, py]); lastIdx = i;
      });
      if (!pts.length) return;
      if (lastIdx >= 0) areaPts.push([x(lastIdx), pad.top + ih]);

      // Area fill (current series only)
      if (idx === 0 && pts.length > 1) {
        var areaD = areaPts.map(function (p, i) { return (i === 0 ? 'M' : 'L') + p[0] + ' ' + p[1]; }).join(' ') + ' Z';
        root.appendChild(svg('path', {
          d: areaD, fill: 'url(#cy-area-' + container.id + ')', opacity: 0.55
        }));
      }
      // Line
      var d = pts.map(function (p, i) { return (i === 0 ? 'M' : 'L') + p[0] + ' ' + p[1]; }).join(' ');
      var line = svg('path', {
        d: d, fill: 'none', stroke: color, 'stroke-width': 2,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round'
      });
      if (dashed) line.setAttribute('stroke-dasharray', '4 4');
      root.appendChild(line);
    });

    // Gradient defs (for area fill of series 0)
    var defs = svg('defs', null);
    var grad = svg('linearGradient', {
      id: 'cy-area-' + container.id, x1: 0, y1: 0, x2: 0, y2: 1
    });
    grad.appendChild(svg('stop', { offset: '0%', 'stop-color': colors[0], 'stop-opacity': 0.18 }));
    grad.appendChild(svg('stop', { offset: '100%', 'stop-color': colors[0], 'stop-opacity': 0 }));
    defs.appendChild(grad);
    root.appendChild(defs);

    // Crosshair group
    var hover = svg('g', { 'pointer-events': 'none', opacity: 0 });
    var crossLine = svg('line', {
      x1: 0, x2: 0, y1: pad.top, y2: pad.top + ih,
      stroke: dark ? 'rgba(255,255,255,0.45)' : '#272723',
      'stroke-width': 1, 'stroke-dasharray': '3 3'
    });
    hover.appendChild(crossLine);
    series.forEach(function (s, idx) {
      var dot = svg('circle', { r: 4.5, fill: colors[idx], stroke: dark ? '#272723' : '#fffbf4', 'stroke-width': 1.5 });
      dot.setAttribute('data-series-idx', idx);
      hover.appendChild(dot);
    });
    root.appendChild(hover);

    // Hit area
    var hit = svg('rect', {
      x: pad.left, y: pad.top, width: iw, height: ih,
      fill: 'transparent', 'pointer-events': 'all'
    });
    root.appendChild(hit);

    // Per-series formatters
    function seriesFormat(s) {
      if (s.format) return pickFormatter({ format: s.format, currency: s.currency || spec.currency });
      return fmt;
    }

    hit.addEventListener('mousemove', function (ev) {
      var rect = root.getBoundingClientRect();
      var mx = ev.clientX - rect.left;
      // Map back to nearest data index
      var rel = (mx - pad.left) / Math.max(1, iw);
      var i = Math.round(rel * (n - 1));
      i = Math.max(0, Math.min(n - 1, i));
      // Reposition crosshair + dots
      crossLine.setAttribute('x1', x(i));
      crossLine.setAttribute('x2', x(i));
      var lines = [];
      var dots = hover.querySelectorAll('circle');
      series.forEach(function (s, idx) {
        var v = (s.values || [])[i];
        if (v == null || isNaN(v)) {
          if (dots[idx]) dots[idx].setAttribute('r', 0);
          return;
        }
        if (dots[idx]) {
          dots[idx].setAttribute('cx', x(i));
          dots[idx].setAttribute('cy', y(+v));
          dots[idx].setAttribute('r', 4.5);
        }
        var lbl = s.label || ('Serie ' + (idx + 1));
        lines.push(
          '<div style="display:flex;justify-content:space-between;gap:14px;align-items:baseline">' +
          '<span style="display:inline-flex;align-items:center;gap:6px;color:#dfd9c5"><span style="display:inline-block;width:8px;height:8px;background:' + colors[idx] + '"></span>' + lbl + '</span>' +
          '<span style="font-variant-numeric:tabular-nums;font-weight:600">' + seriesFormat(s)(+v) + '</span>' +
          '</div>'
        );
      });
      hover.setAttribute('opacity', 1);
      var html = '<div style="font-weight:600;font-size:12px;color:#fffbf4;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:6px">' + (labels[i] || '') + '</div>' + lines.join('');
      showTooltip(html, ev.clientX, ev.clientY);
    });
    hit.addEventListener('mouseleave', function () { hover.setAttribute('opacity', 0); hideTooltip(); });

    container.appendChild(root);
  }

  // ---- BAR CHART --------------------------------------------------------- //

  function renderBar(container, spec) {
    container.innerHTML = '';
    var dark = darkContext(container);
    var w = container.clientWidth || 600;
    var h = container.clientHeight || 200;
    var pad = { top: 12, right: 18, bottom: 28, left: 44 };
    var iw = Math.max(0, w - pad.left - pad.right);
    var ih = Math.max(0, h - pad.top - pad.bottom);

    var labels = spec.labels || [];
    var series = (spec.series || []).filter(function (s) { return s && s.values; });
    if (!labels.length || !series.length) return;

    var allVals = [];
    series.forEach(function (s) { (s.values || []).forEach(function (v) { if (v != null && !isNaN(v)) allVals.push(+v); }); });
    var dataMax = Math.max.apply(null, allVals);
    var ticks = niceTicks(0, dataMax, 4, !!spec.integer);
    var fmt = pickFormatter(spec);
    var n = labels.length, sCount = series.length;
    var groupW = iw / n;
    var barW = Math.min(18, (groupW - 6) / sCount);
    var y = function (v) {
      var t = v / Math.max(1e-9, ticks.max);
      return pad.top + ih * (1 - t);
    };

    var root = svg('svg', { width: '100%', height: h, viewBox: '0 0 ' + w + ' ' + h });
    root.style.cssText = 'display:block;overflow:visible';

    // Gridlines + Y labels
    ticks.ticks.forEach(function (t) {
      var yy = y(t);
      root.appendChild(svg('line', {
        x1: pad.left, x2: pad.left + iw, y1: yy, y2: yy,
        stroke: dark ? 'rgba(255,255,255,0.08)' : '#eeeae0', 'stroke-width': 1
      }));
      var lbl = svg('text', {
        x: pad.left - 8, y: yy + 4,
        fill: dark ? P.onDarkMuted : P.muted,
        'font-size': 10.5, 'font-family': 'Inter, system-ui, sans-serif',
        'text-anchor': 'end'
      });
      lbl.textContent = fmt(t);
      root.appendChild(lbl);
    });

    var xStep = Math.max(1, Math.ceil(n / Math.max(6, Math.floor(iw / 60))));
    for (var i = 0; i < n; i++) {
      if (i % xStep !== 0 && i !== n - 1) continue;
      var lbl = svg('text', {
        x: pad.left + groupW * (i + 0.5),
        y: pad.top + ih + 16,
        fill: dark ? P.onDarkMuted : P.muted,
        'font-size': 10.5, 'font-family': 'Inter, system-ui, sans-serif',
        'text-anchor': 'middle'
      });
      lbl.textContent = labels[i];
      root.appendChild(lbl);
    }

    // Bars
    series.forEach(function (s, sIdx) {
      var color = s.color || (sIdx === 0 ? (dark ? P.brass : P.series.current) : (dark ? P.onDarkMuted : P.series.previous));
      (s.values || []).forEach(function (v, i) {
        if (v == null || isNaN(v)) return;
        var groupX = pad.left + groupW * i;
        var bx = groupX + (groupW - barW * sCount) / 2 + barW * sIdx;
        var by = y(+v);
        var bh = pad.top + ih - by;
        if (bh < 0.5) return;
        var bar = svg('rect', { x: bx, y: by, width: barW, height: bh, fill: color, rx: 1 });
        bar.style.transition = 'opacity 0.12s';
        bar.addEventListener('mouseenter', function (ev) {
          bar.setAttribute('opacity', 0.78);
          var lblName = s.label || 'Värde';
          showTooltip(
            '<div style="font-weight:600;font-size:12px;color:#fffbf4;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:6px">' + labels[i] + '</div>' +
            '<div style="display:flex;justify-content:space-between;gap:14px"><span style="color:#dfd9c5">' + lblName + '</span><span style="font-variant-numeric:tabular-nums;font-weight:600">' + fmt(+v) + '</span></div>',
            ev.clientX, ev.clientY
          );
        });
        bar.addEventListener('mousemove', function (ev) {
          showTooltip(getTooltip().innerHTML, ev.clientX, ev.clientY);
        });
        bar.addEventListener('mouseleave', function () { bar.setAttribute('opacity', 1); hideTooltip(); });
        root.appendChild(bar);
      });
    });

    container.appendChild(root);
  }

  // ---- DONUT CHART ------------------------------------------------------- //

  function renderDonut(container, spec) {
    container.innerHTML = '';
    var w = container.clientWidth || 200;
    var h = container.clientHeight || 200;
    var size = Math.min(w, h);
    var cx = w / 2, cy = h / 2;
    var rOuter = size * 0.5 - 4;
    var rInner = size * 0.35;
    var labels = spec.labels || [];
    var values = spec.values || [];
    var colors = spec.colors || P.donut;
    var total = values.reduce(function (a, v) { return a + Math.max(0, +v || 0); }, 0);
    if (total <= 0) {
      // empty state
      var emptySvg = svg('svg', { width: '100%', height: h, viewBox: '0 0 ' + w + ' ' + h });
      emptySvg.appendChild(svg('circle', { cx: cx, cy: cy, r: (rOuter + rInner) / 2, fill: 'none', stroke: P.borderSoft, 'stroke-width': rOuter - rInner }));
      container.appendChild(emptySvg);
      return;
    }
    var fmt = pickFormatter(spec);

    var root = svg('svg', { width: '100%', height: h, viewBox: '0 0 ' + w + ' ' + h });
    root.style.cssText = 'display:block;overflow:visible';

    var angle = -Math.PI / 2;
    values.forEach(function (v, i) {
      var frac = Math.max(0, +v || 0) / total;
      if (frac <= 0) return;
      var a0 = angle;
      var a1 = angle + frac * Math.PI * 2;
      angle = a1;
      var large = (a1 - a0) > Math.PI ? 1 : 0;
      var x0 = cx + Math.cos(a0) * rOuter, y0 = cy + Math.sin(a0) * rOuter;
      var x1 = cx + Math.cos(a1) * rOuter, y1 = cy + Math.sin(a1) * rOuter;
      var x2 = cx + Math.cos(a1) * rInner, y2 = cy + Math.sin(a1) * rInner;
      var x3 = cx + Math.cos(a0) * rInner, y3 = cy + Math.sin(a0) * rInner;
      var d = [
        'M' + x0 + ' ' + y0,
        'A' + rOuter + ' ' + rOuter + ' 0 ' + large + ' 1 ' + x1 + ' ' + y1,
        'L' + x2 + ' ' + y2,
        'A' + rInner + ' ' + rInner + ' 0 ' + large + ' 0 ' + x3 + ' ' + y3,
        'Z'
      ].join(' ');
      var seg = svg('path', { d: d, fill: colors[i % colors.length] });
      seg.style.cssText = 'transition: opacity 0.12s ease, transform 0.12s ease; transform-origin: ' + cx + 'px ' + cy + 'px';
      seg.addEventListener('mouseenter', function (ev) {
        seg.setAttribute('opacity', 0.82);
        showTooltip(
          '<div style="font-weight:600;color:#fffbf4;margin-bottom:4px">' + (labels[i] || 'Segment ' + (i + 1)) + '</div>' +
          '<div style="display:flex;justify-content:space-between;gap:14px"><span style="color:#dfd9c5">Värde</span><span style="font-variant-numeric:tabular-nums;font-weight:600">' + fmt(+v) + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;gap:14px"><span style="color:#dfd9c5">Andel</span><span style="font-variant-numeric:tabular-nums;font-weight:600">' + (frac * 100).toFixed(1).replace('.', ',') + '%</span></div>',
          ev.clientX, ev.clientY
        );
      });
      seg.addEventListener('mousemove', function (ev) {
        showTooltip(getTooltip().innerHTML, ev.clientX, ev.clientY);
      });
      seg.addEventListener('mouseleave', function () { seg.setAttribute('opacity', 1); hideTooltip(); });
      root.appendChild(seg);
    });
    container.appendChild(root);
  }

  // ---- SPARKLINE --------------------------------------------------------- //

  function renderSparkline(container, spec) {
    container.innerHTML = '';
    var dark = darkContext(container);
    var w = container.clientWidth || 160;
    var h = container.clientHeight || 60;
    var pad = { top: 4, right: 4, bottom: 4, left: 4 };
    var iw = Math.max(0, w - pad.left - pad.right);
    var ih = Math.max(0, h - pad.top - pad.bottom);

    var series = (spec.series || []).filter(function (s) { return s && s.values; });
    var labels = spec.labels || [];
    if (!series.length) return;

    var allVals = [];
    series.forEach(function (s) { (s.values || []).forEach(function (v) { if (v != null && !isNaN(v)) allVals.push(+v); }); });
    var dataMin = Math.min.apply(null, allVals);
    var dataMax = Math.max.apply(null, allVals);
    if (dataMin === dataMax) { dataMin -= 1; dataMax += 1; }

    var fmt = pickFormatter(spec);
    var root = svg('svg', { width: '100%', height: h, viewBox: '0 0 ' + w + ' ' + h });
    root.style.cssText = 'display:block;overflow:visible';

    series.forEach(function (s, idx) {
      var color = s.color || (idx === 0 ? (dark ? P.onDark : P.series.current) : (dark ? P.brass : P.series.previous));
      var dashed = !!s.dashed || idx > 0;
      var n = (s.values || []).length;
      if (n < 2) return;
      var d = (s.values || []).map(function (v, i) {
        var px = pad.left + iw * i / (n - 1);
        var py = pad.top + ih - ((+v - dataMin) / (dataMax - dataMin)) * ih;
        return (i === 0 ? 'M' : 'L') + px + ' ' + py;
      }).join(' ');
      var line = svg('path', {
        d: d, fill: 'none', stroke: color, 'stroke-width': 1.5,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round'
      });
      if (dashed) line.setAttribute('stroke-dasharray', '3 3');
      root.appendChild(line);
    });

    // Optional simple hover (sparkline-level total)
    var hit = svg('rect', {
      x: 0, y: 0, width: w, height: h, fill: 'transparent', 'pointer-events': 'all'
    });
    hit.addEventListener('mousemove', function (ev) {
      var rect = root.getBoundingClientRect();
      var mx = ev.clientX - rect.left;
      var n = (series[0].values || []).length;
      var i = Math.round((mx - pad.left) / Math.max(1, iw) * (n - 1));
      i = Math.max(0, Math.min(n - 1, i));
      var html = '<div style="font-weight:600;font-size:12px;color:#fffbf4;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:4px">' + (labels[i] || '') + '</div>';
      series.forEach(function (s) {
        var v = (s.values || [])[i];
        if (v == null) return;
        html += '<div style="display:flex;justify-content:space-between;gap:14px"><span style="color:#dfd9c5">' + (s.label || '') + '</span><span style="font-variant-numeric:tabular-nums;font-weight:600">' + fmt(+v) + '</span></div>';
      });
      showTooltip(html, ev.clientX, ev.clientY);
    });
    hit.addEventListener('mouseleave', hideTooltip);
    root.appendChild(hit);

    container.appendChild(root);
  }

  // ---- Public API + hydration ------------------------------------------- //

  function dispatch(target, spec) {
    var container = ensureContainer(target);
    container.style.position = container.style.position || 'relative';
    switch (spec.kind) {
      case 'line': return renderLine(container, spec);
      case 'bar': return renderBar(container, spec);
      case 'donut': return renderDonut(container, spec);
      case 'sparkline': return renderSparkline(container, spec);
      default: console.warn('[cyntora-v2] unknown chart kind:', spec.kind);
    }
  }

  window.cyntoraLine = function (id, spec) { var t = document.getElementById(id); if (t) dispatch(t, Object.assign({ kind: 'line' }, spec)); };
  window.cyntoraBar = function (id, spec) { var t = document.getElementById(id); if (t) dispatch(t, Object.assign({ kind: 'bar' }, spec)); };
  window.cyntoraDonut = function (id, spec) { var t = document.getElementById(id); if (t) dispatch(t, Object.assign({ kind: 'donut' }, spec)); };
  window.cyntoraInlineSparkline = function (id, spec) { var t = document.getElementById(id); if (t) dispatch(t, Object.assign({ kind: 'sparkline' }, spec)); };

  function hydrateAll() {
    document.querySelectorAll('[data-cyntora]').forEach(function (el) {
      try {
        var spec = JSON.parse(el.getAttribute('data-cyntora'));
        dispatch(el, spec);
      } catch (e) {
        console.error('[cyntora-v2] failed to hydrate', el.id || el, e);
      }
    });
  }

  // Re-render on window resize (throttled)
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) cancelAnimationFrame(resizeTimer);
    resizeTimer = requestAnimationFrame(function () { hydrateAll(); });
  }, { passive: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hydrateAll);
  } else {
    hydrateAll();
  }
})();
