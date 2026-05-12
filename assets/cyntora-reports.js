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
    // v1 (paginated layout) uses a <select data-section-jump> dropdown.
    // v2 uses an inline <div data-section-links> with anchor links; both
    // discover sections the same way and share scroll-spy logic.
    var dropdown = document.querySelector('[data-section-jump]');
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
      // v1: populate the dropdown
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
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    var links = [];
    if (linkbar) {
      // v2: populate the inline link bar
      linkbar.innerHTML = '';
      sections.forEach(function (s) {
        var a = document.createElement('a');
        a.href = '#' + s.id;
        a.textContent = s.getAttribute('data-section-title') || s.getAttribute('data-section-id');
        a.addEventListener('click', function (e) {
          e.preventDefault();
          var target = document.getElementById(s.id);
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        linkbar.appendChild(a);
        links.push(a);
      });
    }

    // Scroll-spy: pick the section whose top is closest to (but at or
    // above) the sticky-nav bottom. Updates both dropdown.value and
    // link.is-active class so either UI reflects current position.
    var navHeight = (document.querySelector('.report-nav') || {}).offsetHeight || 56;
    var ticking = false;

    function updateActive() {
      ticking = false;
      var threshold = navHeight + 24;
      var activeIdx = -1;
      for (var i = 0; i < sections.length; i++) {
        var rect = sections[i].getBoundingClientRect();
        if (rect.top - threshold <= 0) {
          activeIdx = i;
        } else {
          break;
        }
      }
      // When user has scrolled to (within 4px of) the bottom of the page,
      // force-activate the LAST section. Otherwise short final sections
      // (like "Vad vi gör härnäst") never trip the threshold and the
      // active link stays on the previous section even when the user is
      // clearly reading the last one.
      var atBottom = (window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 4);
      if (atBottom && sections.length) {
        activeIdx = sections.length - 1;
      }
      if (activeIdx >= 0) {
        if (dropdown) dropdown.value = sections[activeIdx].id;
        if (linkbar) {
          links.forEach(function (a, i) { a.classList.toggle('is-active', i === activeIdx); });
        }
      } else if (window.scrollY < 50) {
        if (dropdown) dropdown.value = '__top';
        if (linkbar) links.forEach(function (a) { a.classList.remove('is-active'); });
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
