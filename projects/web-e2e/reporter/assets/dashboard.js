/* Business QA Dashboard: progressive enhancement only (filters, drill-down navigation, local times).
   The page is fully readable without this script. Plain ES2017, no dependencies. */
(function () {
  'use strict';
  var doc = document;

  // Show timestamps in the viewer's local time zone (the server-rendered text is UTC).
  Array.prototype.forEach.call(doc.querySelectorAll('time[data-local]'), function (t) {
    var d = new Date(t.getAttribute('datetime') || '');
    if (isNaN(d.getTime())) return;
    try {
      t.textContent = t.getAttribute('data-local') === 'time'
        ? d.toLocaleTimeString()
        : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
    } catch (e) {
      t.textContent = d.toLocaleString();
    }
    t.title = (t.getAttribute('datetime') || '') + ' (UTC)';
  });

  // Wide trend tables start scrolled to the newest run (the right edge).
  Array.prototype.forEach.call(doc.querySelectorAll('[data-scroll-end]'), function (el) {
    el.scrollLeft = el.scrollWidth;
  });

  // ---- Scenario explorer filters -------------------------------------------------------------
  var explorer = doc.getElementById('explorer');
  var rows = Array.prototype.slice.call(doc.querySelectorAll('.scn'));
  var controls = Array.prototype.slice.call(doc.querySelectorAll('[data-filter]'));
  var countEl = doc.querySelector('[data-count]');
  var noResults = doc.querySelector('[data-no-results]');
  var tagCache = new Map();

  function tagsOf(row) {
    var tags = tagCache.get(row);
    if (!tags) {
      try { tags = JSON.parse(row.getAttribute('data-tags') || '[]'); } catch (e) { tags = []; }
      tagCache.set(row, tags);
    }
    return tags;
  }

  function control(key) {
    for (var i = 0; i < controls.length; i++) if (controls[i].getAttribute('data-filter') === key) return controls[i];
    return null;
  }

  function apply() {
    var active = {};
    controls.forEach(function (c) {
      var v = c.value.trim();
      c.classList.toggle('active', v !== '');
      if (v !== '') active[c.getAttribute('data-filter')] = c.getAttribute('data-filter') === 'q' ? v.toLowerCase() : v;
    });
    var shown = 0;
    rows.forEach(function (row) {
      var ok = true;
      for (var key in active) {
        if (!Object.prototype.hasOwnProperty.call(active, key)) continue;
        var want = active[key];
        if (key === 'q') ok = (row.getAttribute('data-search') || '').indexOf(want) !== -1;
        else if (key === 'tag') ok = tagsOf(row).indexOf(want) !== -1;
        else ok = row.getAttribute('data-' + key) === want;
        if (!ok) break;
      }
      row.hidden = !ok;
      if (ok) shown++;
    });
    if (countEl) countEl.textContent = shown.toLocaleString('en-US');
    if (noResults) noResults.hidden = shown !== 0;
  }

  function resetFilters() {
    controls.forEach(function (c) { c.value = ''; });
    apply();
  }

  controls.forEach(function (c) {
    c.addEventListener(c.tagName === 'INPUT' ? 'input' : 'change', apply);
  });

  doc.addEventListener('click', function (ev) {
    var target = ev.target instanceof Element ? ev.target : null;
    if (!target) return;

    // Feature / capability names: filter the explorer and scroll to it.
    var filterLink = target.closest('[data-filter-key]');
    if (filterLink && explorer && rows.length) {
      ev.preventDefault();
      controls.forEach(function (c) { c.value = ''; });
      var sel = control(filterLink.getAttribute('data-filter-key'));
      if (sel) sel.value = filterLink.getAttribute('data-filter-value') || '';
      apply();
      if (history.replaceState) history.replaceState(null, '', '#explorer');
      explorer.scrollIntoView({ block: 'start' });
      return;
    }

    var action = target.closest('[data-action]');
    if (action) {
      var a = action.getAttribute('data-action');
      if (a === 'reset') resetFilters();
      else if (a === 'expand') rows.forEach(function (r) { if (!r.hidden) r.open = true; });
      else if (a === 'collapse') rows.forEach(function (r) { r.open = false; });
      return;
    }

    var copy = target.closest('[data-copy]');
    if (copy) {
      var text = copy.getAttribute('data-copy') || '';
      var done = function () {
        var old = copy.textContent;
        copy.textContent = 'Copied';
        setTimeout(function () { copy.textContent = old; }, 1400);
      };
      var fallback = function () {
        var code = copy.parentNode && copy.parentNode.querySelector('code');
        if (code && window.getSelection) {
          var range = doc.createRange();
          range.selectNodeContents(code);
          var s = window.getSelection();
          s.removeAllRanges();
          s.addRange(range);
          try { if (doc.execCommand('copy')) done(); } catch (e) { /* text stays selected for manual copy */ }
        }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
      return;
    }

    // Re-clicking a scenario link whose hash is already current does not fire hashchange.
    var link = target.closest('a[href^="#scenario-"]');
    if (link && link.getAttribute('href') === location.hash) {
      ev.preventDefault();
      openFromHash();
    }
  });

  // ---- Deep links: #scenario-<id> opens and reveals that row ----------------------------------
  function openFromHash() {
    var id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) { return; }
    if (id.indexOf('scenario-') !== 0) return;
    var row = doc.getElementById(id);
    if (!row) return;
    if (row.hidden) resetFilters();
    row.open = true;
    row.scrollIntoView({ block: 'start' });
    row.classList.add('flash');
    setTimeout(function () { row.classList.remove('flash'); }, 2200);
    var summary = row.querySelector('summary');
    if (summary) summary.focus({ preventScroll: true });
  }

  window.addEventListener('hashchange', openFromHash);
  if (location.hash) openFromHash();
})();
