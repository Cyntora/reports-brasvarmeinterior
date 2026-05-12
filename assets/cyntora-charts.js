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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hydrateAll);
  } else {
    hydrateAll();
  }
})();
