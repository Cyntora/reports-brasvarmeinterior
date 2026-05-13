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
    // v1 uses a dropdown only. v2 has BOTH an inline link bar AND a
    // hidden dropdown that swaps in when the link bar can't fit all
    // section names side-by-side.
    var dropdown = document.querySelector('[data-section-jump]');
    var dropdownWrap = document.querySelector('[data-section-dropdown-wrap]');
    var linkbar = document.querySelector('[data-section-links]');
    if (!dropdown && !linkbar) return;

    var sections = Array.prototype.slice.call(
      document.querySelectorAll('[data-section-id]')
    );
    if (!sections.length) {
      if (dropdown) dropdown.disabled = true;
      return;
    }

    if (dropdown) {
      dropdown.innerHTML = '';
      var topOpt = document.createElement('option');
      topOpt.value = '__top';
      topOpt.textContent = 'Översikt';
      dropdown.appendChild(topOpt);
      sections.forEach(function (s) {
        var opt = document.createElement('option');
        opt.value = s.id || ('section-' + s.getAttribute('data-section-id'));
        opt.textContent = s.getAttribute('data-section-title') || s.getAttribute('data-section-id');
        dropdown.appendChild(opt);
      });
      dropdown.addEventListener('change', function () {
        var v = dropdown.value;
        if (!v) return;
        if (v === '__top') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
        var target = document.getElementById(v);
        if (target) {
          clickPin = v;
          if (clickPinTimer) clearTimeout(clickPinTimer);
          clickPinTimer = setTimeout(function () { clickPin = null; }, 1000);
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    }

    var links = [];
    if (linkbar) {
      linkbar.innerHTML = '';
      sections.forEach(function (s) {
        var a = document.createElement('a');
        a.href = '#' + s.id;
        a.textContent = s.getAttribute('data-section-title') || s.getAttribute('data-section-id');
        a.addEventListener('click', function (e) {
          e.preventDefault();
          var target = document.getElementById(s.id);
          if (target) {
            clickPin = s.id;
            if (clickPinTimer) clearTimeout(clickPinTimer);
            clickPinTimer = setTimeout(function () { clickPin = null; }, 1000);
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
        linkbar.appendChild(a);
        links.push(a);
      });
    }

    // Toggle link-bar vs dropdown based on whether the link bar
    // overflows. Run on load and on every resize.
    function syncNavMode() {
      if (!linkbar || !dropdownWrap) return;
      linkbar.classList.remove('report-nav__links--collapsed');
      dropdownWrap.classList.remove('is-active');
      var overflows = linkbar.scrollWidth > linkbar.clientWidth + 2;
      if (overflows) {
        linkbar.classList.add('report-nav__links--collapsed');
        dropdownWrap.classList.add('is-active');
      }
    }
    if (linkbar && dropdownWrap) {
      syncNavMode();
      window.addEventListener('resize', syncNavMode);
    }

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
    var ticking = false;
    var clickPin = null;
    var clickPinTimer = null;
    var navEl = document.querySelector('.report-nav');

    function setActive(id) {
      if (dropdown) dropdown.value = id;
      if (linkbar) {
        links.forEach(function (a) {
          a.classList.toggle('is-active', a.getAttribute('href') === '#' + id);
        });
      }
    }

    function updateActive() {
      ticking = false;
      // If the user just clicked a section link, honour that for ~1s
      // while the smooth-scroll animation runs.
      if (clickPin) { setActive(clickPin); return; }
      // Recompute nav height each frame — the sticky nav wraps to 2 rows
      // on mobile (dropdown gets its own line), so the cached value from
      // init would be wrong on resize. Cheap getBoundingClientRect call.
      var navHeight = navEl ? navEl.offsetHeight : 56;
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
      // At-bottom override: when scrolled to (or within 60px of) the
      // bottom of the page, force-activate the last section. Mobile
      // browsers can off-by-a-few-px the scrollHeight calculation due
      // to dynamic URL bars, so we use a generous threshold.
      var docHeight = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight
      );
      var atBottom = (window.innerHeight + window.scrollY) >= (docHeight - 60);
      if (atBottom && sections.length) {
        active = sections[sections.length - 1];
      }
      var activeIdx = active ? sections.indexOf(active) : -1;
      if (activeIdx >= 0) {
        if (dropdown) dropdown.value = sections[activeIdx].id;
        if (linkbar) links.forEach(function (a, i) { a.classList.toggle('is-active', i === activeIdx); });
      } else if (window.scrollY < 50) {
        if (dropdown) dropdown.value = '__top';
        if (linkbar) links.forEach(function (a) { a.classList.remove('is-active'); });
      }
    }
    // Recompute on resize (handles nav wrapping)
    window.addEventListener('resize', function () {
      if (!ticking) {
        window.requestAnimationFrame(updateActive);
        ticking = true;
      }
    }, { passive: true });

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
