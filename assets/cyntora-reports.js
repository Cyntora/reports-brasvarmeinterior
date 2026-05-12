/* Cyntora Reports - period switcher + section nav (scroll-spy)
 *
 * Two interactions on the sticky bar:
 *
 * 1. Period dropdown: loads `reports/index.json` and populates a list of
 *    months. Selecting one navigates to that month's HTML.
 *
 * 2. Section dropdown: discovers every `<div class="section"
 *    data-section-id>` on the page, lists them in document order,
 *    and updates the selected option as the user scrolls so the user
 *    always sees which section is currently in view. Clicking an option
 *    smoothly scrolls to that section.
 */

(function () {
  'use strict';

  // ----- 1. Period switcher --------------------------------------------- //

  function initPeriodSwitcher() {
    var sel = document.querySelector('[data-period-switcher]');
    if (!sel) return;

    var current = sel.getAttribute('data-current'); // e.g. "2026-04"
    var indexUrl = sel.getAttribute('data-index-url') || 'reports/index.json';

    fetch(indexUrl, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('index.json status ' + r.status);
        return r.json();
      })
      .then(function (idx) {
        var reports = (idx && idx.reports) || [];
        sel.innerHTML = '';
        reports.forEach(function (r) {
          var opt = document.createElement('option');
          opt.value = r.file;
          opt.textContent = r.label || r.month;
          if (r.month === current) opt.selected = true;
          sel.appendChild(opt);
        });
        sel.disabled = false;
        sel.addEventListener('change', function () {
          if (sel.value) window.location.href = sel.value;
        });
      })
      .catch(function (err) {
        console.warn('[cyntora] period switcher disabled:', err.message);
        sel.disabled = true;
      });
  }

  // ----- 2. Section nav with scroll-spy --------------------------------- //

  function initSectionNav() {
    var sel = document.querySelector('[data-section-jump]');
    if (!sel) return;

    var sections = Array.prototype.slice.call(
      document.querySelectorAll('[data-section-id]')
    );
    if (!sections.length) {
      sel.disabled = true;
      return;
    }

    // Populate dropdown in document order
    sel.innerHTML = '';
    var topOpt = document.createElement('option');
    topOpt.value = '__top';
    topOpt.textContent = 'Översikt';
    sel.appendChild(topOpt);
    sections.forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s.id || ('section-' + s.getAttribute('data-section-id'));
      opt.textContent = s.getAttribute('data-section-title') || s.getAttribute('data-section-id');
      sel.appendChild(opt);
    });

    // Click -> scroll to section, and pin the active state to the
    // chosen section while smooth-scroll runs so the dropdown matches
    // user intent even when the page can't scroll the section all the
    // way to threshold (near-bottom sections).
    sel.addEventListener('change', function () {
      var v = sel.value;
      if (!v) return;
      if (v === '__top') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      var target = document.getElementById(v);
      if (target) {
        clickPin = v;
        if (clickPinTimer) clearTimeout(clickPinTimer);
        clickPinTimer = setTimeout(function () { clickPin = null; }, 1000);
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    // Scroll-spy: pick the section whose top is closest to (but at or
    // above) the sticky-nav bottom. Two edge cases the simple algorithm
    // gets wrong:
    //   1. Bottom of page: the LAST sections can't scroll their top to
    //      the threshold because there's no content below them, so the
    //      simple "most-recently-above" picks an earlier section. Detect
    //      "at bottom" (within 4px of scrollHeight) and force the last.
    //   2. Click-to-scroll on a near-bottom section: same issue — the
    //      page scrolls as far as it can, but the section's top sits
    //      well below threshold. The click handler now sets the active
    //      state immediately to the clicked section so the dropdown
    //      doesn't lag behind user intent during the smooth-scroll.
    var navHeight = (document.querySelector('.report-nav') || {}).offsetHeight || 56;
    var ticking = false;
    var clickPin = null;
    var clickPinTimer = null;

    function updateActive() {
      ticking = false;
      // If the user just clicked a section link, honour that for ~1s
      // while the smooth-scroll animation runs.
      if (clickPin) { sel.value = clickPin; return; }
      var threshold = navHeight + 24;
      var active = null;
      for (var i = 0; i < sections.length; i++) {
        var rect = sections[i].getBoundingClientRect();
        if (rect.top - threshold <= 0) {
          active = sections[i];
        } else {
          break;
        }
      }
      var atBottom = (window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 4);
      if (atBottom && sections.length) {
        active = sections[sections.length - 1];
      }
      if (active) {
        sel.value = active.id;
      } else if (window.scrollY < 50) {
        sel.value = '__top';
      }
    }

    window.addEventListener('scroll', function () {
      if (!ticking) {
        window.requestAnimationFrame(updateActive);
        ticking = true;
      }
    }, { passive: true });

    updateActive();
  }

  function init() {
    initPeriodSwitcher();
    initSectionNav();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
