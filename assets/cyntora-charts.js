/* Cyntora Reports - Chart.js helpers
 *
 * Loads after Chart.js v4 from CDN. Provides four constructor functions:
 *   cyntoraLine(canvasId, spec)
 *   cyntoraBar(canvasId, spec)
 *   cyntoraDonut(canvasId, spec)
 *   cyntoraInlineSparkline(canvasId, spec)
 *
 * Each `spec` is the JSON the renderer embedded next to the canvas. The
 * helpers apply the palette and defaults from chart-defaults.json without
 * needing the JSON file at runtime - the values are inlined here.
 */

(function () {
  'use strict';

  if (typeof Chart === 'undefined') {
    console.error('[cyntora] Chart.js not loaded.');
    return;
  }

  var P = {
    current:  '#1f4e4a',
    previous: '#b9d2cf',
    orange:   '#f7a528',
    donut: [
      '#4285F4', '#34A853', '#FBBC04', '#EA4335',
      '#AB47BC', '#00ACC1', '#FF7043', '#9E9E9E',
      '#7E57C2', '#26A69A'
    ],
    grid: '#eeeeee',
    tick: '#bdbdbd',
    axisColor: '#7a7a7a',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
  };

  var noAnim = window.matchMedia && window.matchMedia('print').matches;

  Chart.defaults.font.family = P.fontFamily;
  Chart.defaults.color = '#2c2c2c';
  Chart.defaults.responsive = true;
  Chart.defaults.maintainAspectRatio = false;
  if (noAnim) Chart.defaults.animation = false;

  function fmtNumber(v) {
    if (v == null) return '';
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return Math.round(v).toLocaleString('sv-SE');
  }

  function fmtCurrency(v, ccy) {
    var symbols = { USD: '$', EUR: '€', GBP: '£', SEK: 'kr', NOK: 'kr', DKK: 'kr', CHF: 'CHF', CAD: 'C$' };
    var s = symbols[ccy] || ccy + ' ';
    if (Math.abs(v) >= 1e6) return s + (v / 1e6).toFixed(2) + 'M';
    if (Math.abs(v) >= 1e3) return s + (v / 1e3).toFixed(2) + 'K';
    return s + (Math.round(v * 100) / 100).toLocaleString('sv-SE');
  }

  function fmtDuration(seconds) {
    if (seconds == null) return '-';
    var s = Math.round(seconds);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    if (h) return h + 'h ' + m + 'm ' + sec + 's';
    return m + 'm ' + sec + 's';
  }

  function pickFormatter(spec) {
    if (spec.format === 'currency') return function (v) { return fmtCurrency(v, spec.currency || 'SEK'); };
    if (spec.format === 'duration') return fmtDuration;
    if (spec.format === 'percent')  return function (v) { return (v * 100).toFixed(1) + '%'; };
    return fmtNumber;
  }

  function commonScales(opts) {
    var yTickFmt = (opts && opts.yFormatter) || fmtNumber;
    var yTicks = { color: P.axisColor, font: { size: 11 }, callback: function (v) { return yTickFmt(v); } };
    // Integer-only metrics (orders, clicks, sessions) need precision=0 —
    // otherwise Chart.js auto-picks fractional ticks like 0.2, 0.4, 0.6
    // when all values are 0/1. We deliberately DO NOT force stepSize=1
    // because that would draw 16 gridlines when max=15. Chart.js's auto
    // step-picker already picks "nice" round values (0, 5, 10, 15);
    // precision=0 just makes those values whole numbers.
    if (opts && opts.integer) {
      yTicks.precision = 0;
    }
    return {
      x: {
        grid: { display: false, drawBorder: false },
        ticks: { color: P.axisColor, maxRotation: 0, autoSkip: true, autoSkipPadding: 12, font: { size: 11 } }
      },
      y: {
        beginAtZero: !!(opts && opts.zero),
        grid: { color: P.grid, drawBorder: false },
        ticks: yTicks
      }
    };
  }

  function tooltip(label_format) {
    return {
      backgroundColor: '#222',
      titleFont: { size: 12, weight: '600' },
      bodyFont: { size: 12 },
      padding: 8,
      callbacks: {
        label: function (ctx) {
          var v = ctx.parsed.y != null ? ctx.parsed.y : ctx.parsed;
          var name = ctx.dataset.label ? ctx.dataset.label + ': ' : '';
          return name + (label_format ? label_format(v) : fmtNumber(v));
        }
      }
    };
  }

  function applyDataset(ds, color) {
    return Object.assign({
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      tension: 0.35,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointBackgroundColor: color,
      fill: false
    }, ds);
  }

  // --- public ----------------------------------------------------------------

  window.cyntoraLine = function (canvasId, spec) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return null;

    var dualAxis = !!spec.dual_axis;
    var datasets = (spec.series || []).map(function (s, i) {
      var color = s.color || (i === 0 ? P.current : P.previous);
      var ds = applyDataset({
        label: s.label,
        data: s.values,
        borderColor: color,
        backgroundColor: color,
        borderDash: s.dashed ? [4, 4] : []
      }, color);
      // Per-dataset format makes hover show the right unit on the right axis.
      if (s.format) ds._cyntoraFormat = s.format;
      if (s.currency) ds._cyntoraCurrency = s.currency;
      if (dualAxis) ds.yAxisID = i === 0 ? 'y' : 'y1';
      return ds;
    });

    var fmtMain = pickFormatter(spec);
    var fmtRight = dualAxis && spec.series && spec.series[1]
      ? pickFormatter({ format: spec.series[1].format || spec.format, currency: spec.series[1].currency || spec.currency })
      : fmtMain;

    var perDatasetTooltip = {
      backgroundColor: '#222',
      titleFont: { size: 12, weight: '600' },
      bodyFont: { size: 12 },
      padding: 8,
      callbacks: {
        label: function (ctx) {
          var v = ctx.parsed.y != null ? ctx.parsed.y : ctx.parsed;
          var ds = ctx.dataset || {};
          var localFmt = ds._cyntoraFormat
            ? pickFormatter({ format: ds._cyntoraFormat, currency: ds._cyntoraCurrency || spec.currency })
            : fmtMain;
          var name = ds.label ? ds.label + ': ' : '';
          return name + localFmt(v);
        }
      }
    };

    var integerY = spec.integer === true;
    var scales = dualAxis
      ? {
          x: { grid: { display: false, drawBorder: false }, ticks: { color: P.axisColor, maxRotation: 0, autoSkip: true, autoSkipPadding: 12, font: { size: 11 } } },
          y:  { position: 'left',  beginAtZero: spec.zero !== false, grid: { color: P.grid, drawBorder: false }, ticks: Object.assign({ color: P.axisColor, font: { size: 11 }, callback: function (v) { return fmtMain(v); } }, integerY ? { precision: 0 } : {}) },
          y1: { position: 'right', beginAtZero: spec.zero !== false, grid: { display: false }, ticks: { color: P.axisColor, font: { size: 11 }, callback: function (v) { return fmtRight(v); } } }
        }
      : commonScales({ zero: spec.zero !== false, yFormatter: fmtMain, integer: integerY });

    return new Chart(canvas, {
      type: 'line',
      data: { labels: spec.labels, datasets: datasets },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: spec.legend !== false, position: 'bottom', labels: { boxWidth: 8, boxHeight: 8, font: { size: 12 } } },
          tooltip: perDatasetTooltip
        },
        scales: scales,
        elements: { line: { borderJoinStyle: 'round' } }
      }
    });
  };

  window.cyntoraBar = function (canvasId, spec) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return null;

    var datasets = (spec.series || []).map(function (s, i) {
      var color = s.color || (i === 0 ? P.previous : P.current);
      return {
        label: s.label,
        data: s.values,
        backgroundColor: color,
        borderRadius: 2,
        maxBarThickness: 18
      };
    });

    var fmt = pickFormatter(spec);

    return new Chart(canvas, {
      type: 'bar',
      data: { labels: spec.labels, datasets: datasets },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: spec.legend === true, position: 'bottom', labels: { boxWidth: 8, boxHeight: 8, font: { size: 12 } } },
          tooltip: tooltip(fmt)
        },
        scales: commonScales({ zero: true, yFormatter: fmt, integer: spec.integer === true })
      }
    });
  };

  window.cyntoraDonut = function (canvasId, spec) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return null;

    var colors = spec.colors || P.donut;

    var fmt = pickFormatter(spec);

    return new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: spec.labels,
        datasets: [{
          data: spec.values,
          backgroundColor: spec.values.map(function (_, i) { return colors[i % colors.length]; }),
          borderColor: '#ffffff',
          borderWidth: 2
        }]
      },
      options: {
        cutout: '70%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#222',
            padding: 8,
            callbacks: {
              label: function (ctx) {
                return ctx.label + ': ' + fmt(ctx.parsed);
              }
            }
          }
        }
      }
    });
  };

  window.cyntoraInlineSparkline = function (canvasId, spec) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return null;

    var datasets = (spec.series || []).map(function (s, i) {
      var color = s.color || (i === 0 ? P.current : P.previous);
      return applyDataset({
        label: s.label,
        data: s.values,
        borderColor: color,
        pointHoverRadius: 5
      }, color);
    });

    var fmt = pickFormatter(spec);

    return new Chart(canvas, {
      type: 'line',
      data: { labels: spec.labels, datasets: datasets },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: tooltip(fmt)
        },
        scales: {
          x: { display: true, grid: { display: false }, ticks: { color: P.axisColor, font: { size: 9 }, maxTicksLimit: 4 } },
          y: { display: true, grid: { color: P.grid, drawBorder: false }, ticks: { color: P.axisColor, font: { size: 9 }, maxTicksLimit: 4, callback: function (v) { return fmt(v); } } }
        }
      }
    });
  };

  // ---- utility: hydrate every <canvas data-cyntora="{...}"> on the page ----

  function hydrateAll() {
    document.querySelectorAll('canvas[data-cyntora]').forEach(function (c) {
      try {
        var spec = JSON.parse(c.getAttribute('data-cyntora'));
        var fn = ({
          line:       window.cyntoraLine,
          bar:        window.cyntoraBar,
          donut:      window.cyntoraDonut,
          sparkline:  window.cyntoraInlineSparkline
        })[spec.kind];
        if (fn) fn(c.id, spec);
        else console.warn('[cyntora] unknown chart kind:', spec.kind);
      } catch (e) {
        console.error('[cyntora] failed to hydrate chart', c.id, e);
      }
    });
    attachChartObservers();
  }

  // Robust responsive resize. Chart.js v4's built-in `responsive:true`
  // listens to window resize, but in practice when a CSS grid changes
  // breakpoint (e.g. 2-col → 1-col at 1024px) the container width can
  // change much more than the window did, and Chart.js sometimes measures
  // the parent BEFORE the new layout has been committed. The reliable
  // fix here is destructive: on each container size change, fully tear
  // down the existing chart instance and rebuild it from its `data-cyntora`
  // spec — that way Chart.js measures the parent FRESH at its current
  // dimensions, with no cached size assumptions from init.
  function rebuildChart(canvas) {
    var existing = (typeof Chart.getChart === 'function') ? Chart.getChart(canvas) : null;
    if (existing) {
      try { existing.destroy(); } catch (e) { /* ignore */ }
    }
    // CRITICAL — break the canvas/parent feedback loop on large→small reflows.
    //
    // Chart.js with `responsive:true; maintainAspectRatio:false` sets
    // explicit `width="691"` and `style.width: 691px` on the canvas tag at
    // init. After the user shrinks the window, the canvas KEEPS those 691px
    // dimensions. Because the canvas is 691px wide as a DOM element, it
    // FORCES its parent (.chart-wrap → .chart-card → .card-grid → .wrap)
    // to stay 691px wide too — pushing the whole page wider than the
    // viewport. The user sees content cut off on the right.
    //
    // If we just `destroy()` and re-init, Chart.js measures `parentElement`
    // again — but parent is STILL 691px wide because the canvas hasn't
    // shrunk yet. So the new chart spawns at 691px again. Endless loop.
    //
    // The fix: collapse the canvas to 0×0 FIRST, force a layout reflow on
    // the parent so it shrinks to its CSS-driven natural width without
    // the canvas pushing it wide, THEN clear the styles and let Chart.js
    // re-measure parent. Now parent reports its true viewport-fitted width
    // and the new chart spawns at the correct size.
    canvas.removeAttribute('width');
    canvas.removeAttribute('height');
    canvas.style.width = '0px';
    canvas.style.height = '0px';
    canvas.style.maxWidth = '0px';
    canvas.style.maxHeight = '0px';
    // Force a synchronous layout pass so the parent reflows without the
    // canvas occupying any space.
    void canvas.parentElement.offsetWidth;
    // Now reset to let CSS govern dimensions again.
    canvas.style.width = '';
    canvas.style.height = '';
    canvas.style.maxWidth = '';
    canvas.style.maxHeight = '';
    try {
      var spec = JSON.parse(canvas.getAttribute('data-cyntora') || '{}');
    } catch (e) { return; }
    var fn = ({
      line: window.cyntoraLine,
      bar: window.cyntoraBar,
      donut: window.cyntoraDonut,
      sparkline: window.cyntoraInlineSparkline,
    })[spec.kind];
    if (fn) { try { fn(canvas.id, spec); } catch (e) { /* ignore */ } }
  }

  var pending = false;
  function rebuildAllCharts() {
    pending = false;
    document.querySelectorAll('canvas[data-cyntora]').forEach(rebuildChart);
  }
  function scheduleRebuild() {
    if (pending) return;
    pending = true;
    // Two rAF ticks: the first waits for the browser to commit any in-flight
    // layout reflow, the second waits for that paint to settle. Empirically
    // single-rAF still measured pre-reflow on some viewport changes.
    requestAnimationFrame(function () {
      requestAnimationFrame(rebuildAllCharts);
    });
  }

  var observedSet = new WeakSet();
  function attachChartObservers() {
    if (typeof ResizeObserver !== 'function') {
      // Old browser — fall back to window resize only.
      return;
    }
    // Observe EVERY canvas[data-cyntora]'s direct parent (the chart-wrap).
    // Watching the parent catches any layout reflow that changes the
    // canvas's available width, regardless of which wrapper class the
    // chart uses (chart-card, donut-row half, KPI-strip sparkline cell).
    // Belt-and-braces: also observe the .wrap container so we catch the
    // global container width changing too.
    document.querySelectorAll('canvas[data-cyntora]').forEach(function (canvas) {
      var parent = canvas.parentElement;
      if (!parent || observedSet.has(parent)) return;
      observedSet.add(parent);
      var ro = new ResizeObserver(scheduleRebuild);
      ro.observe(parent);
    });
    // Also observe each .wrap so any container-level reflow triggers a
    // rebuild even if the chart's immediate parent didn't get a clean
    // size-change event (some browsers coalesce nested-element resizes).
    document.querySelectorAll('.wrap, .section').forEach(function (el) {
      if (observedSet.has(el)) return;
      observedSet.add(el);
      var ro2 = new ResizeObserver(scheduleRebuild);
      ro2.observe(el);
    });
  }

  window.addEventListener('resize', scheduleRebuild);

  // Font-loading completion can also shift layout dimensions slightly. After
  // each font finishes loading, force one final rebuild so chart labels
  // match the post-font measurements.
  if (document.fonts && typeof document.fonts.ready !== 'undefined') {
    document.fonts.ready.then(scheduleRebuild);
  }

  // Belt-and-braces poll: every 800ms, find any canvas whose displayed width
  // has drifted from its parent's width by more than 5px and rebuild it.
  // This catches the rare case where ResizeObserver doesn't fire for a
  // specific element (some browsers skip nested-element resize events
  // during continuous drag-resize, especially when the parent is inside
  // a grid that itself is inside another grid).
  setInterval(function () {
    document.querySelectorAll('canvas[data-cyntora]').forEach(function (canvas) {
      var parent = canvas.parentElement;
      if (!parent) return;
      var pW = parent.getBoundingClientRect().width;
      var cW = canvas.getBoundingClientRect().width;
      if (pW > 0 && Math.abs(pW - cW) > 5) {
        rebuildChart(canvas);
      }
    });
  }, 800);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hydrateAll);
  } else {
    hydrateAll();
  }
})();
