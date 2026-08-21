/*
 * Wolimons - the 2018 chart.
 *
 * The chart on the 2018 item page is not the one the modern pages draw. It
 * was a Highstock chart with its own furniture, and the archived copy still
 * carries the whole thing as rendered SVG, so this is built from that rather
 * than from memory. Read off the capture:
 *
 *   background            #32383e          axis labels   #E0E0E3, 11px
 *   font                  Lucida Grande stack, 12px
 *   range selector        "Zoom"  1d 3d 1w 1m 3m 6m 1y 2y 3y All
 *                         with the From / To date boxes beside it
 *   range input box       background #333, border #505053, text silver
 *   legend                bottom, #E0E0E3 bold 12px, hidden items #606063
 *   navigator             on, series #A6C7ED, mask rgba(255,255,255,0.1)
 *   series colours        Avg Daily Sales Price #0da800
 *                         RAP                   #990099
 *                         Sales Volume          #cc0000 (column)
 *                         Best Price            #45ea00
 *                         Sellers               #00a2ff
 *                         Favorites             #f6b702
 *
 * The last four were in the capture's legend switched off by default, and
 * they stay switched off here: they are the series Wanwood does not report,
 * and a chart is not the place to start guessing.
 *
 * Highstock itself is loaded by history-chart.js, which the 2018 pages also
 * carry - there is no reason for two copies of that loader.
 */
(() => {
  'use strict';

  const BACKGROUND = '#32383e';
  const X_GRID = '#3a3f45';
  const Y_GRID = '#4a5057';
  const AXIS_LINE = '#707073';
  const LABEL = '#E0E0E3';
  const LEGEND_HIDDEN = '#606063';
  const NAVIGATOR_LINE = '#A6C7ED';
  const BUTTON_FILL = '#505053';
  const BUTTON_TEXT = '#CCC';
  const BUTTON_PRESSED = '#000003';

  const FONT = '"Lucida Grande", "Lucida Sans Unicode", Arial, Helvetica, sans-serif';

  /* The names the capture printed, with the colours it drew them in. */
  const COLOURS = {
    'Avg Daily Sales Price': '#0da800',
    RAP: '#990099',
    'Sales Volume': '#cc0000',
    'Best Price': '#45ea00',
    Sellers: '#00a2ff',
    Favorites: '#f6b702',
    Value: '#00a2ff',
    Copies: '#0da800',
    Owners: '#00a2ff',
    Holders: '#0da800',
  };

  function library() {
    if (window.WolimonsHistoryChart && window.WolimonsHistoryChart.loadLibrary) {
      return window.WolimonsHistoryChart.loadLibrary();
    }
    if (window.Highcharts) return Promise.resolve(window.Highcharts);
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/assets/vendor/highstock.js';
      script.async = true;
      script.addEventListener('load', () => (window.Highcharts
        ? resolve(window.Highcharts)
        : reject(new Error('Highcharts loaded but did not register itself.'))));
      script.addEventListener('error', () => reject(new Error('The charting library did not load.')));
      document.head.appendChild(script);
    });
  }

  /* The same centred notice the rest of the 2018 pages use for "nothing yet". */
  function message(container, words) {
    container.textContent = '';
    const box = document.createElement('div');
    box.className = 'd-flex align-items-center justify-content-center text-muted h-100';
    box.style.minHeight = '220px';
    box.textContent = words;
    container.appendChild(box);
  }

  function options(series, { axis = 'R$', since = 0 } = {}) {
    return {
      chart: {
        backgroundColor: BACKGROUND,
        style: { fontFamily: FONT, fontSize: '12px' },
        spacingBottom: 10,
      },

      credits: { enabled: false },
      exporting: { enabled: false },
      title: { text: null },
      subtitle: { text: null },
      accessibility: { enabled: false },

      /* The capture's own set of buttons, with All selected: an item's chart
       * is there to show the whole of its life, not the last year of it. */
      rangeSelector: {
        selected: 9,
        inputEnabled: true,
        buttons: [
          { type: 'day', count: 1, text: '1d' },
          { type: 'day', count: 3, text: '3d' },
          { type: 'week', count: 1, text: '1w' },
          { type: 'month', count: 1, text: '1m' },
          { type: 'month', count: 3, text: '3m' },
          { type: 'month', count: 6, text: '6m' },
          { type: 'year', count: 1, text: '1y' },
          { type: 'year', count: 2, text: '2y' },
          { type: 'year', count: 3, text: '3y' },
          { type: 'all', text: 'All' },
        ],
        buttonTheme: {
          fill: BUTTON_FILL,
          stroke: 'none',
          style: { color: BUTTON_TEXT, fontWeight: 'normal' },
          states: {
            hover: { fill: '#707073', style: { color: 'white' } },
            select: { fill: BUTTON_PRESSED, style: { color: 'white', fontWeight: 'bold' } },
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
        labels: { style: { color: LABEL, fontSize: '11px' } },
      },

      yAxis: {
        title: { text: axis, style: { color: '#A0A0A3' } },
        gridLineColor: Y_GRID,
        lineColor: AXIS_LINE,
        lineWidth: 0,
        labels: { style: { color: LABEL, fontSize: '11px' } },
        min: 0,
        opposite: false,
      },

      legend: {
        enabled: true,
        itemStyle: { color: LABEL, fontSize: '12px', fontWeight: 'bold' },
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

      series: series.map(line => {
        const points = [...line.data].sort((a, b) => a[0] - b[0]);
        /*
         * Every chart starts where the thing it is about started: the day the
         * item was made, or the day the player joined. Zero is not a
         * placeholder there - nothing has sold on the day an item is created,
         * and a new account owns nothing.
         */
        if (since && points.length && points[0][0] > since) points.unshift([since, 0]);
        return {
          name: line.name,
          type: line.type || 'line',
          color: line.color || COLOURS[line.name] || '#0da800',
          data: points,
          visible: line.visible !== false,
          yAxis: 0,
        };
      }),
    };
  }

  /*
   * Draw (or redraw) a chart.
   *
   * `series` is [{ name, data: [[time, y], ...], type, color, visible }].
   * Anything with fewer than two points across all of its series is not a
   * chart, and says so instead of drawing a dot.
   */
  function render(container, series, settings = {}) {
    if (!container) return Promise.resolve(null);
    const lines = (Array.isArray(series) ? series : [])
      .filter(line => line && Array.isArray(line.data) && line.data.length);
    const points = lines.reduce((sum, line) => sum + line.data.length, 0);

    if (points < 2) {
      message(container, settings.empty || 'There is nothing recorded to plot yet.');
      return Promise.resolve(null);
    }

    return library()
      .then(Highcharts => {
        /* The capture prints "Zoom" in front of the buttons; the modern chart
         * hides it, and that setting is global, so it is set back here. */
        Highcharts.setOptions({ lang: { rangeSelectorZoom: 'Zoom' } });
        container.textContent = '';
        return Highcharts.stockChart(container, options(lines, settings));
      })
      .catch(error => {
        message(container, 'The chart could not be drawn: the charting library did not load.');
        console.error(error);
        return null;
      });
  }

  window.WolimonsChart2018 = { render, COLOURS };
})();
