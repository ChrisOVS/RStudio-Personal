/*
 * charts.js — hand-rolled SVG charts. No dependencies, no CDN, works offline.
 *
 * Every chart reads its colors from CSS custom properties so light/dark swap in
 * one place. Colors were validated with the dataviz palette validator:
 *   - single-hue bar charts use categorical slot 1 only
 *   - the rate chart uses slots 1 + 2 (blue/orange), which clear the all-pairs
 *     CVD and normal-vision floors in both modes
 *   - the bracket chart uses emphasis (active bracket solid, rest recessive)
 *     rather than a value ramp, so bar length is never double-encoded as hue
 */

(function (root) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  function el(name, attrs) {
    var node = document.createElementNS(NS, name);
    for (var k in attrs) {
      if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    }
    return node;
  }

  function money(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function moneyShort(n) {
    if (Math.abs(n) >= 1000000) return '$' + (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (Math.abs(n) >= 1000) return '$' + Math.round(n / 1000) + 'k';
    return '$' + Math.round(n);
  }

  function pct(n, digits) {
    return (n * 100).toFixed(digits === undefined ? 1 : digits) + '%';
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /* ------------------------------------------------------------- tooltip ---- */

  var tip = null;
  function ensureTip() {
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'viz-tooltip';
      tip.setAttribute('role', 'status');
      document.body.appendChild(tip);
    }
    return tip;
  }

  function showTip(html, evt) {
    var t = ensureTip();
    t.innerHTML = html;
    t.classList.add('is-visible');
    var pad = 14;
    var rect = t.getBoundingClientRect();
    var x = evt.clientX + pad;
    var y = evt.clientY + pad;
    if (x + rect.width > window.innerWidth - 8) x = evt.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - 8) y = evt.clientY - rect.height - pad;
    t.style.left = x + 'px';
    t.style.top = y + 'px';
  }

  function hideTip() {
    if (tip) tip.classList.remove('is-visible');
  }

  /**
   * Attach hover + keyboard focus to a mark. The hit area is a transparent rect
   * bigger than the mark itself, so you don't have to land on a 6px bar.
   */
  function attachHover(svg, hitAttrs, html) {
    var hit = el('rect', Object.assign({ fill: 'transparent', tabindex: '0' }, hitAttrs));
    hit.addEventListener('mousemove', function (e) { showTip(html, e); });
    hit.addEventListener('mouseleave', hideTip);
    hit.addEventListener('focus', function () {
      var b = hit.getBoundingClientRect();
      showTip(html, { clientX: b.left + b.width / 2, clientY: b.top });
    });
    hit.addEventListener('blur', hideTip);
    svg.appendChild(hit);
    return hit;
  }

  /* -------------------------------------------------- 1. where the pay goes -- */

  /**
   * Horizontal bar chart, one bar per component of gross pay. Deliberately not a
   * stacked bar or donut: separate bars compare the components directly, and a
   * single hue keeps bar length as the only encoding.
   */
  function renderBreakdown(svg, rows) {
    clear(svg);
    var W = 640;
    var rowH = 40;
    var gap = 10;
    var labelW = 132;
    var valueW = 96;
    var H = rows.length * (rowH + gap) - gap + 8;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('role', 'img');

    var plotW = W - labelW - valueW;
    var max = Math.max.apply(null, rows.map(function (r) { return r.value; }).concat([1]));

    rows.forEach(function (r, i) {
      var y = i * (rowH + gap);
      var barH = 18;
      var barY = y + (rowH - barH) / 2;
      var w = Math.max(r.value > 0 ? 3 : 0, (r.value / max) * plotW);

      svg.appendChild(el('text', {
        x: labelW - 12, y: y + rowH / 2 + 1, 'text-anchor': 'end',
        class: 'viz-label', 'dominant-baseline': 'middle'
      })).textContent = r.label;

      // Track behind the bar gives the eye a consistent baseline to read against.
      svg.appendChild(el('rect', {
        x: labelW, y: barY, width: plotW, height: barH, rx: 4, class: 'viz-track'
      }));

      svg.appendChild(el('rect', {
        x: labelW, y: barY, width: w, height: barH, rx: 4,
        class: 'viz-bar' + (r.emphasis ? ' is-primary' : '')
      }));

      svg.appendChild(el('text', {
        x: labelW + plotW + 12, y: y + rowH / 2 + 1,
        class: 'viz-value', 'dominant-baseline': 'middle'
      })).textContent = money(r.value);

      attachHover(svg, { x: labelW, y: y, width: plotW, height: rowH },
        '<strong>' + r.label + '</strong><br>' + money(r.value) +
        '<br><span class="viz-tooltip-dim">' + pct(r.share) + ' of gross pay</span>' +
        (r.hint ? '<br><span class="viz-tooltip-dim">' + r.hint + '</span>' : ''));
    });
  }

  /* ---------------------------------------------- 2. federal tax by bracket -- */

  /**
   * Vertical bars: tax generated inside each federal bracket. The bracket the
   * next dollar lands in is emphasised; the rest are recessive. Ordering is
   * carried by the axis, so hue never encodes magnitude.
   */
  function renderBrackets(svg, brackets, marginalRate) {
    clear(svg);
    var W = 640, H = 260;
    var padL = 56, padR = 16, padT = 16, padB = 46;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('role', 'img');

    var filled = brackets.filter(function (b) { return b.incomeInBracket > 0; });
    if (!filled.length) {
      svg.appendChild(el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'viz-empty' }))
        .textContent = 'No federal income tax at this income.';
      return;
    }

    var plotW = W - padL - padR;
    var plotH = H - padT - padB;
    var max = Math.max.apply(null, filled.map(function (b) { return b.tax; }));
    var step = niceStep(max);
    var top = Math.ceil(max / step) * step || step;

    // Gridlines + y axis, hairline and solid.
    for (var g = 0; g <= top + 0.001; g += step) {
      var gy = padT + plotH - (g / top) * plotH;
      svg.appendChild(el('line', { x1: padL, y1: gy, x2: padL + plotW, y2: gy, class: 'viz-grid' }));
      svg.appendChild(el('text', { x: padL - 10, y: gy, 'text-anchor': 'end', 'dominant-baseline': 'middle', class: 'viz-tick' }))
        .textContent = moneyShort(g);
    }

    var slotW = plotW / filled.length;
    var barW = Math.min(46, slotW - 12);

    filled.forEach(function (b, i) {
      var cx = padL + slotW * i + slotW / 2;
      var h = Math.max(b.tax > 0 ? 2 : 0, (b.tax / top) * plotH);
      var y = padT + plotH - h;
      var active = Math.abs(b.rate - marginalRate) < 1e-9;

      svg.appendChild(el('rect', {
        x: cx - barW / 2, y: y, width: barW, height: h, rx: 4,
        class: 'viz-bar' + (active ? ' is-primary' : '')
      }));

      svg.appendChild(el('text', { x: cx, y: padT + plotH + 18, 'text-anchor': 'middle', class: 'viz-tick' }))
        .textContent = pct(b.rate, 0);

      if (active) {
        svg.appendChild(el('text', { x: cx, y: padT + plotH + 34, 'text-anchor': 'middle', class: 'viz-tick is-accent' }))
          .textContent = 'your bracket';
      }

      attachHover(svg, { x: cx - slotW / 2, y: padT, width: slotW, height: plotH },
        '<strong>' + pct(b.rate, 0) + ' bracket</strong><br>' +
        money(b.tax) + ' of federal tax<br>' +
        '<span class="viz-tooltip-dim">' + money(b.incomeInBracket) + ' of income taxed here<br>' +
        money(b.from) + ' – ' + (b.to === Infinity ? 'and up' : money(b.to)) + '</span>');
    });

    svg.appendChild(el('line', {
      x1: padL, y1: padT + plotH, x2: padL + plotW, y2: padT + plotH, class: 'viz-axis'
    }));
  }

  /* --------------------------------------------- 3. effective vs marginal ---- */

  /**
   * Two-series line chart on ONE axis (both series are percentages, so there is
   * no dual-scale sleight of hand). A marker pins where the current salary sits.
   */
  function renderRateCurve(svg, curve, currentSalary, currentEffective) {
    clear(svg);
    var W = 640, H = 280;
    var padL = 52, padR = 74, padT = 18, padB = 44;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('role', 'img');

    if (curve.length < 2) return;

    var plotW = W - padL - padR;
    var plotH = H - padT - padB;
    var maxX = curve[curve.length - 1].salary;
    var maxY = Math.max.apply(null, curve.map(function (p) {
      return Math.max(p.effectiveRate, p.marginalRate);
    }));
    maxY = Math.min(0.65, Math.ceil(maxY / 0.05) * 0.05 + 0.05);

    function sx(v) { return padL + (v / maxX) * plotW; }
    function sy(v) { return padT + plotH - (v / maxY) * plotH; }

    for (var g = 0; g <= maxY + 1e-9; g += 0.1) {
      var gy = sy(g);
      svg.appendChild(el('line', { x1: padL, y1: gy, x2: padL + plotW, y2: gy, class: 'viz-grid' }));
      svg.appendChild(el('text', { x: padL - 10, y: gy, 'text-anchor': 'end', 'dominant-baseline': 'middle', class: 'viz-tick' }))
        .textContent = pct(g, 0);
    }

    var xTicks = 5;
    for (var i = 0; i <= xTicks; i++) {
      var v = (maxX / xTicks) * i;
      svg.appendChild(el('text', { x: sx(v), y: padT + plotH + 20, 'text-anchor': 'middle', class: 'viz-tick' }))
        .textContent = moneyShort(v);
    }

    function path(key, cls) {
      var d = curve.map(function (p, i) {
        return (i ? 'L' : 'M') + sx(p.salary).toFixed(1) + ' ' + sy(p[key]).toFixed(1);
      }).join(' ');
      svg.appendChild(el('path', { d: d, class: cls, fill: 'none' }));
    }

    path('marginalRate', 'viz-line is-series-2');
    path('effectiveRate', 'viz-line is-series-1');

    // Direct labels at the line ends — selective, so no number on every point.
    var last = curve[curve.length - 1];
    svg.appendChild(el('text', { x: sx(last.salary) + 8, y: sy(last.marginalRate), 'dominant-baseline': 'middle', class: 'viz-series-label is-series-2' }))
      .textContent = 'Marginal';
    svg.appendChild(el('text', { x: sx(last.salary) + 8, y: sy(last.effectiveRate), 'dominant-baseline': 'middle', class: 'viz-series-label is-series-1' }))
      .textContent = 'Effective';

    // "You are here" marker.
    if (currentSalary > 0 && currentSalary <= maxX) {
      var mx = sx(currentSalary);
      svg.appendChild(el('line', { x1: mx, y1: padT, x2: mx, y2: padT + plotH, class: 'viz-marker-line' }));
      svg.appendChild(el('circle', { cx: mx, cy: sy(currentEffective), r: 5.5, class: 'viz-marker-dot' }));
      var anchor = mx > padL + plotW * 0.7 ? 'end' : 'start';
      svg.appendChild(el('text', {
        x: mx + (anchor === 'end' ? -10 : 10), y: padT + 12, 'text-anchor': anchor, class: 'viz-marker-label'
      })).textContent = 'You: ' + pct(currentEffective);
    }

    svg.appendChild(el('line', { x1: padL, y1: padT + plotH, x2: padL + plotW, y2: padT + plotH, class: 'viz-axis' }));

    // Crosshair band: one hit rect per sample, nearest-point style.
    var bandW = plotW / (curve.length - 1);
    curve.forEach(function (p) {
      attachHover(svg, { x: sx(p.salary) - bandW / 2, y: padT, width: bandW, height: plotH },
        '<strong>' + money(p.salary) + ' salary</strong><br>' +
        'Effective rate ' + pct(p.effectiveRate) + '<br>' +
        'Marginal rate ' + pct(p.marginalRate) + '<br>' +
        '<span class="viz-tooltip-dim">Take-home ' + money(p.takeHome) + '</span>');
    });
  }

  function niceStep(max) {
    if (max <= 0) return 1;
    var raw = max / 4;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return mult * mag;
  }

  root.Charts = {
    renderBreakdown: renderBreakdown,
    renderBrackets: renderBrackets,
    renderRateCurve: renderRateCurve,
    money: money,
    moneyShort: moneyShort,
    pct: pct,
    hideTip: hideTip
  };
})(typeof self !== 'undefined' ? self : this);
