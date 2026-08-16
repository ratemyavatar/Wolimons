/*
 * Wolimons - the Value & RAP history chart.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * The profile page used to draw its own SVG by hand: a path per series, a few
 * gridlines, three date labels and a homemade hover rule. It worked, but it
 * was not the chart from the snapshot, and it showed - no navigator strip to
 * drag, no scrollbar, no date inputs, axis labels that only appeared at three
 * fixed positions, and a tooltip that had to be re-derived from pointer
 * coordinates on every mousemove.
 *
 * The snapshot's chart is Highcharts Stock 10.3.3. Every <g> in the captured
 * markup carries a highcharts-* class, the <desc> reads "Created with
 * Highcharts 10.3.3", and the range selector, navigator and scrollbar are all
 * standard Highstock furniture. So this file uses the real library, pinned to
 * the same version, vendored at /assets/vendor/highstock.js - no CDN, in
 * keeping with the rest of the site.
 *
 * ---------------------------------------------------------------------------
 * THE THEME
 * ---------------------------------------------------------------------------
 * Highcharts' stock defaults are light. Every colour below was read straight
 * off the captured SVG so the rendered chart matches the snapshot rather than
 * merely resembling it:
 *
 *   chart background          #32383e     highcharts-background
 *   plot band                 #2a2f35     highcharts-plot-band
 *   x gridlines               #3a3f45     y gridlines #4a5057
 *   axis lines and ticks      #707073
 *   x labels  rgb(202,202,207)   y labels rgb(224,224,227)   both 11px
 *   y axis title "R$"         rgb(160,160,163)
 *   legend text               rgb(224,224,227) 12px bold
 *   Value series              #05bde4     RAP series #0da800
 *   navigator series          #A6C7ED     mask rgba(255,255,255,.1)
 *   navigator outline         #4a5057
 *   scrollbar track #404043   thumb #808083   buttons #606063   arrows #CCC
 *   range buttons  #505053 / rgb(204,204,204), pressed #000003 / white bold
 *   range inputs   silver text, #505053 border, #333 background
 *
 * The range selector is the snapshot's: 1w, 1m, 3m, 6m, 1y, All, with 1y
 * selected. The old hand-rolled RANGES array and the #chart_range_buttons
 * strip it filled are gone - the buttons live inside the chart now, which is
 * where the snapshot has them.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NOT HERE, AND WHY
 * ---------------------------------------------------------------------------
 * The snapshot's chart carries a third series, "Collectibles" - the number of
 * items held on each day - drawn against a second y axis on the right, and
 * hidden by default. Wanwood exposes no ownership history: resale-data gives
 * per-item daily prices and nothing about who held what and when. That series
 * would have to be invented, so it is left out along with its axis, rather
 * than drawn from made-up numbers.
 *
 * The exporting context menu is also absent. It is one button in the
 * snapshot, and it works by posting the chart to Highcharts' export server -
 * an off-site request this project has no reason to make.
 */
(() => {
  'use strict';

  /* Read off the captured SVG - see the table in the header comment. */
  const BACKGROUND = '#32383e';
  const PLOT_BAND = '#2a2f35';
  const X_GRID = '#3a3f45';
  const Y_GRID = '#4a5057';
  const AXIS_LINE = '#707073';
  const X_LABEL = 'rgb(202,202,207)';
  const Y_LABEL = 'rgb(224,224,227)';
  const AXIS_TITLE = 'rgb(160,160,163)';
  const LEGEND_TEXT = 'rgb(224,224,227)';
  const LEGEND_HIDDEN = 'rgb(96,96,99)';
  const VALUE_COLOR = '#05bde4';
  const RAP_COLOR = '#0da800';
  const NAVIGATOR_LINE = '#A6C7ED';
  const BUTTON_FILL = '#505053';
  const BUTTON_TEXT = 'rgb(204,204,204)';
  const BUTTON_PRESSED = '#000003';

  const FONT = '"Lucida Grande", "Lucida Sans Unicode", Arial, Helvetica, sans-serif';

  /*
   * Highcharts is a big file and only two pages want it, so it is loaded on
   * demand the first time a chart is asked for rather than blocking every
   * page. The promise is cached: a second caller waits on the same <script>.
   */
  let loading = null;

  function loadLibrary() {
    if (window.Highcharts) return Promise.resolve(window.Highcharts);
    if (loading) return loading;

    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/assets/vendor/highstock.js';
      script.async = true;
      script.addEventListener('load', () => {
        if (!window.Highcharts) {
          reject(new Error('Highcharts loaded but did not register itself.'));
          return;
        }
        /* lang is a global setting rather than a per-chart option, so it has
         * to be applied here. The snapshot's range-selector label is empty:
         * the buttons start flush at the left of the plot with no "Zoom"
         * caption in front of them. */
        window.Highcharts.setOptions({ lang: { rangeSelectorZoom: '' } });
        resolve(window.Highcharts);
      });
      script.addEventListener('error', () => reject(new Error('Could not load the charting library.')));
      document.head.appendChild(script);
    });
    return loading;
  }

  /* One message, styled like the rest of the page's empty states. The chart
   * container has a fixed height, so the notice is centred inside it. */
  function message(container, words) {
    container.textContent = '';
    const box = document.createElement('div');
    box.className = 'd-flex align-items-center justify-content-center text-muted h-100';
    box.style.minHeight = '220px';
    box.textContent = words;
    container.appendChild(box);
  }

  /*
   * Build the options object. Kept separate from render() so the shape of the
   * chart is readable in one piece, without the loading and error handling
   * wrapped around it.
   *
   * `rows` is [{ time, value, rap }, ...] in ascending time order.
   *
   * `names` renames the two series and their y axis. The profile page leaves
   * it alone and gets Value and RAP in Robux, which is what this chart was
   * built for. The item page's Copies and Ownership tabs plot a different
   * pair of numbers into the same two slots, and calling those "Value" and
   * "RAP" would be a lie - so they pass their own labels rather than this
   * file being forked or a second chart being written.
   */
  function options(rows, names = {}) {
    const valueName = names.value || 'Value';
    const rapName = names.rap || 'RAP';
    /* Robux unless the caller says otherwise; a copy count is not currency. */
    const axisTitle = names.axis === undefined ? 'R$' : names.axis;
    const valueSeries = rows.map(row => [row.time, row.value]);
    const rapSeries = rows.map(row => [row.time, row.rap]);

    return {
      chart: {
        backgroundColor: BACKGROUND,
        style: { fontFamily: FONT, fontSize: '12px' },
        /* The container is sized by CSS - 468px on desktop, shorter on a
         * phone - and Highcharts reflows into it on its own, so no height is
         * set here and the resize observer the old code needed is gone. */
        spacingBottom: 10,
      },

      credits: { enabled: false },
      exporting: { enabled: false },
      title: { text: null },
      subtitle: { text: null },

      /* The accessibility module is a separate file and is not vendored, so
       * Highcharts is told not to warn about its absence. The chart is a
       * supplement to figures that are all printed as text elsewhere on the
       * page, so nothing is only available through it. */
      accessibility: { enabled: false },

      /* Highstock's own range buttons, in the snapshot's order, with 1y
       * selected the way the capture has it. */
      rangeSelector: {
        selected: 4,
        buttons: [
          { type: 'week', count: 1, text: '1w' },
          { type: 'month', count: 1, text: '1m' },
          { type: 'month', count: 3, text: '3m' },
          { type: 'month', count: 6, text: '6m' },
          { type: 'year', count: 1, text: '1y' },
          { type: 'all', text: 'All' },
        ],
        buttonTheme: {
          fill: BUTTON_FILL,
          stroke: 'none',
          style: { color: BUTTON_TEXT, fontWeight: 'normal' },
          states: {
            hover: { fill: '#707073', style: { color: 'white' } },
            select: {
              fill: BUTTON_PRESSED,
              style: { color: 'white', fontWeight: 'bold' },
            },
          },
        },
        inputBoxBorderColor: BUTTON_FILL,
        inputStyle: { backgroundColor: '#333', color: 'silver' },
        labelStyle: { color: 'silver' },
      },

      xAxis: {
        type: 'datetime',
        lineColor: AXIS_LINE,
        tickColor: AXIS_LINE,
        gridLineColor: X_GRID,
        gridLineWidth: 1,
        labels: { style: { color: X_LABEL, fontSize: '11px' } },
        /* The snapshot paints a band down the left edge of the plot; it is
         * the zero-width marker Highstock draws at the series start. */
        plotBands: [],
      },

      yAxis: {
        title: { text: axisTitle, style: { color: AXIS_TITLE } },
        gridLineColor: Y_GRID,
        lineColor: AXIS_LINE,
        lineWidth: 0,
        labels: { style: { color: Y_LABEL, fontSize: '11px' } },
        /* Both series are Robux totals and belong on one scale; forcing the
         * floor to zero stops a quiet week from looking like a collapse. */
        min: 0,
        opposite: false,
      },

      legend: {
        enabled: true,
        itemStyle: { color: LEGEND_TEXT, fontSize: '12px', fontWeight: 'bold' },
        itemHoverStyle: { color: 'white' },
        itemHiddenStyle: { color: LEGEND_HIDDEN },
      },

      navigator: {
        outlineColor: Y_GRID,
        maskFill: 'rgba(255,255,255,0.1)',
        series: { color: NAVIGATOR_LINE, lineWidth: 1 },
        xAxis: {
          gridLineColor: '#505053',
          labels: { style: { color: '#999999', fontSize: '11px' } },
        },
      },

      scrollbar: {
        barBackgroundColor: '#808083',
        barBorderColor: '#808083',
        buttonArrowColor: '#CCC',
        buttonBackgroundColor: '#606063',
        buttonBorderColor: '#606063',
        rifleColor: '#FFF',
        trackBackgroundColor: '#404043',
        trackBorderColor: '#404043',
      },

      tooltip: {
        shared: true,
        backgroundColor: 'rgba(18,22,26,0.92)',
        borderColor: '#454b52',
        borderRadius: 4,
        style: { color: '#e6e6e6' },
        valueDecimals: 0,
        xDateFormat: '%b %e, %Y',
      },

      plotOptions: {
        series: {
          lineWidth: 2,
          marker: { enabled: false, radius: 3 },
          states: { hover: { lineWidthPlus: 0 } },
        },
      },

      series: [
        { name: valueName, data: valueSeries, color: VALUE_COLOR },
        { name: rapName, data: rapSeries, color: RAP_COLOR },
      ],
    };
  }

  /*
   * Draw (or redraw) the chart in `container`.
   *
   * Returns a promise so a caller can tell a failure apart from an empty
   * dataset; the failure is already reported inside the container either way.
   */
  function render(container, rows, names) {
    if (!container) return Promise.resolve(null);

    const points = Array.isArray(rows) ? rows.filter(row => row && Number.isFinite(row.time)) : [];
    if (points.length < 2) {
      message(container, points.length
        ? 'Not enough sale history yet to draw a chart.'
        : 'No sale history recorded for this player\u2019s items yet.');
      return Promise.resolve(null);
    }
    points.sort((a, b) => a.time - b.time);

    return loadLibrary()
      .then(Highcharts => {
        container.textContent = '';
        return Highcharts.stockChart(container, options(points, names));
      })
      .catch(error => {
        message(container, 'The chart could not be drawn: the charting library did not load.');
        console.error(error);
        return null;
      });
  }

  window.WolimonsHistoryChart = { render, loadLibrary };
})();
