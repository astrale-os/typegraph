/**
 * HTML Report Generator
 *
 * Generates interactive HTML reports with Chart.js visualizations.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { LatencyReport } from './json-exporter'
import type { ScenarioResult } from '../scenarios'
import type { Trace, TraceMetrics, Phase } from '../profiling'
import { formatMicros } from '../profiling'

// =============================================================================
// HTML GENERATION
// =============================================================================

/**
 * Generate an interactive HTML report.
 */
export function generateHtmlReport(report: LatencyReport): string {
  const jsonData = JSON.stringify(report, null, 2)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Latency Profiling Report - authz-v2</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    :root {
      --bg-primary: #0f172a;
      --bg-secondary: #1e293b;
      --bg-tertiary: #334155;
      --text-primary: #f1f5f9;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;
      --accent-green: #22c55e;
      --accent-red: #ef4444;
      --accent-amber: #f59e0b;
      --accent-blue: #3b82f6;
      --accent-purple: #8b5cf6;
      --border-color: #475569;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      background: var(--bg-primary);
      color: var(--text-primary);
      font-size: 12px;
      line-height: 1.5;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 20px;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border-color);
    }

    h1 {
      font-size: 18px;
      font-weight: 600;
    }

    .meta {
      color: var(--text-secondary);
      font-size: 11px;
    }

    .tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 16px;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 8px;
    }

    .tab {
      padding: 6px 12px;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 4px 4px 0 0;
      color: var(--text-secondary);
      cursor: pointer;
      font-family: inherit;
      font-size: 11px;
    }

    .tab:hover {
      background: var(--bg-secondary);
    }

    .tab.active {
      background: var(--bg-secondary);
      border-color: var(--border-color);
      border-bottom-color: var(--bg-secondary);
      color: var(--text-primary);
    }

    .panel {
      display: none;
    }

    .panel.active {
      display: block;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }

    .summary-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 12px;
    }

    .summary-card h3 {
      font-size: 10px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }

    .summary-card .value {
      font-size: 20px;
      font-weight: 600;
    }

    .summary-card .value.success { color: var(--accent-green); }
    .summary-card .value.error { color: var(--accent-red); }
    .summary-card .value.warning { color: var(--accent-amber); }

    .chart-container {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 16px;
    }

    .chart-title {
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 12px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th, td {
      text-align: left;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border-color);
    }

    th {
      background: var(--bg-tertiary);
      color: var(--text-secondary);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    tr:hover {
      background: var(--bg-secondary);
    }

    .status-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
    }

    .status-badge.pass { background: rgba(34, 197, 94, 0.2); color: var(--accent-green); }
    .status-badge.fail { background: rgba(239, 68, 68, 0.2); color: var(--accent-red); }

    .timeline-bar {
      height: 16px;
      background: var(--bg-tertiary);
      border-radius: 2px;
      position: relative;
      overflow: hidden;
    }

    .timeline-segment {
      height: 100%;
      position: absolute;
      top: 0;
    }

    .timeline-segment.trust { background: var(--accent-blue); }
    .timeline-segment.decode { background: #06b6d4; }
    .timeline-segment.resolve { background: var(--accent-purple); }
    .timeline-segment.decide { background: var(--accent-green); }
    .timeline-segment.query { background: var(--accent-amber); }

    .legend {
      display: flex;
      gap: 16px;
      margin-top: 8px;
      font-size: 10px;
      color: var(--text-secondary);
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .legend-dot {
      width: 8px;
      height: 8px;
      border-radius: 2px;
    }

    .expandable {
      cursor: pointer;
    }

    .expandable-content {
      display: none;
      padding: 12px;
      background: var(--bg-tertiary);
      margin: 4px 0;
      border-radius: 4px;
    }

    .expandable.expanded .expandable-content {
      display: block;
    }

    pre {
      background: var(--bg-tertiary);
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 11px;
    }

    .export-buttons {
      display: flex;
      gap: 8px;
    }

    button {
      padding: 6px 12px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      color: var(--text-primary);
      cursor: pointer;
      font-family: inherit;
      font-size: 11px;
    }

    button:hover {
      background: var(--bg-tertiary);
    }

    .row {
      display: flex;
      gap: 16px;
    }

    .col {
      flex: 1;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>Latency Profiling Report</h1>
        <div class="meta">authz-v2 • Generated ${report.metadata.generatedAt}</div>
      </div>
      <div class="export-buttons">
        <button onclick="exportJson()">Export JSON</button>
        <button onclick="window.print()">Print</button>
      </div>
    </header>

    <!-- Summary Cards -->
    <div class="summary-grid">
      <div class="summary-card">
        <h3>Total Scenarios</h3>
        <div class="value">${report.metadata.totalScenarios}</div>
      </div>
      <div class="summary-card">
        <h3>Passed</h3>
        <div class="value success">${report.metadata.passedScenarios}</div>
      </div>
      <div class="summary-card">
        <h3>Failed</h3>
        <div class="value ${report.metadata.failedScenarios > 0 ? 'error' : ''}">${report.metadata.failedScenarios}</div>
      </div>
      <div class="summary-card">
        <h3>Mean Latency</h3>
        <div class="value">${formatMicros(report.aggregateMetrics.overall.mean)}</div>
      </div>
      <div class="summary-card">
        <h3>P95 Latency</h3>
        <div class="value warning">${formatMicros(report.aggregateMetrics.overall.p95)}</div>
      </div>
      <div class="summary-card">
        <h3>P99 Latency</h3>
        <div class="value warning">${formatMicros(report.aggregateMetrics.overall.p99)}</div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="tabs">
      <button class="tab active" data-tab="overview">Overview</button>
      <button class="tab" data-tab="scenarios">Scenarios</button>
      <button class="tab" data-tab="timeline">Timeline</button>
      <button class="tab" data-tab="breakdown">Breakdown</button>
      <button class="tab" data-tab="queries">Queries</button>
    </div>

    <!-- Overview Panel -->
    <div id="overview" class="panel active">
      <div class="row">
        <div class="col">
          <div class="chart-container">
            <div class="chart-title">Phase Distribution</div>
            <canvas id="phaseChart"></canvas>
          </div>
        </div>
        <div class="col">
          <div class="chart-container">
            <div class="chart-title">Method Breakdown</div>
            <canvas id="methodChart"></canvas>
          </div>
        </div>
      </div>
      <div class="chart-container">
        <div class="chart-title">Latency Distribution (all scenarios)</div>
        <canvas id="latencyHistogram"></canvas>
      </div>
    </div>

    <!-- Scenarios Panel -->
    <div id="scenarios" class="panel">
      <div class="chart-container">
        <div class="chart-title">Scenario Comparison</div>
        <table>
          <thead>
            <tr>
              <th>Scenario</th>
              <th>Status</th>
              <th>Mean</th>
              <th>P95</th>
              <th>P99</th>
              <th>Traces</th>
            </tr>
          </thead>
          <tbody>
            ${report.scenarios
              .map(
                (s) => `
              <tr class="expandable" onclick="this.classList.toggle('expanded')">
                <td>
                  <strong>${escapeHtml(s.scenario.name)}</strong><br>
                  <span style="color: var(--text-muted)">${escapeHtml(s.scenario.description)}</span>
                </td>
                <td>
                  <span class="status-badge ${s.passed && s.passedThresholds ? 'pass' : 'fail'}">
                    ${s.passed && s.passedThresholds ? 'PASS' : 'FAIL'}
                  </span>
                </td>
                <td>${formatMicros(s.metrics.overall.mean)}</td>
                <td>${formatMicros(s.metrics.overall.p95)}</td>
                <td>${formatMicros(s.metrics.overall.p99)}</td>
                <td>${s.traces.length}</td>
              </tr>
              <tr>
                <td colspan="6" class="expandable-content">
                  <pre>${JSON.stringify(s.metrics, null, 2)}</pre>
                </td>
              </tr>
            `,
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Timeline Panel -->
    <div id="timeline" class="panel">
      <div class="chart-container">
        <div class="chart-title">Execution Timeline</div>
        <div class="legend">
          <div class="legend-item"><div class="legend-dot" style="background: var(--accent-blue)"></div> Trust</div>
          <div class="legend-item"><div class="legend-dot" style="background: #06b6d4"></div> Decode</div>
          <div class="legend-item"><div class="legend-dot" style="background: var(--accent-purple)"></div> Resolve</div>
          <div class="legend-item"><div class="legend-dot" style="background: var(--accent-green)"></div> Decide</div>
          <div class="legend-item"><div class="legend-dot" style="background: var(--accent-amber)"></div> Query</div>
        </div>
        <div id="timelineContainer" style="margin-top: 16px;"></div>
      </div>
    </div>

    <!-- Breakdown Panel -->
    <div id="breakdown" class="panel">
      <div class="row">
        <div class="col">
          <div class="chart-container">
            <div class="chart-title">Phase Time (avg per scenario)</div>
            <canvas id="phaseBarChart"></canvas>
          </div>
        </div>
        <div class="col">
          <div class="chart-container">
            <div class="chart-title">Cache Performance</div>
            <canvas id="cacheChart"></canvas>
          </div>
        </div>
      </div>
    </div>

    <!-- Queries Panel -->
    <div id="queries" class="panel">
      <div class="chart-container">
        <div class="chart-title">Cypher Query Details</div>
        <div id="queryList"></div>
      </div>
    </div>
  </div>

  <script>
    // Report data
    const report = ${jsonData};

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');
      });
    });

    // Export JSON
    function exportJson() {
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'latency-report.json';
      a.click();
      URL.revokeObjectURL(url);
    }

    // Phase distribution chart
    const phaseData = report.aggregateMetrics.phaseDistribution;
    new Chart(document.getElementById('phaseChart'), {
      type: 'doughnut',
      data: {
        labels: ['Trust', 'Decode', 'Resolve', 'Decide', 'Query'],
        datasets: [{
          data: [phaseData.trust, phaseData.decode, phaseData.resolve, phaseData.decide, phaseData.query],
          backgroundColor: ['#3b82f6', '#06b6d4', '#8b5cf6', '#22c55e', '#f59e0b'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#94a3b8', font: { family: 'monospace', size: 10 } }
          }
        }
      }
    });

    // Method breakdown chart
    const methodData = report.aggregateMetrics.byMethod;
    const methodLabels = Object.keys(methodData);
    const methodMeans = methodLabels.map(m => methodData[m].mean / 1000);
    new Chart(document.getElementById('methodChart'), {
      type: 'bar',
      data: {
        labels: methodLabels,
        datasets: [{
          label: 'Mean (ms)',
          data: methodMeans,
          backgroundColor: '#3b82f6',
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        indexAxis: 'y',
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: {
            grid: { color: '#334155' },
            ticks: { color: '#94a3b8', font: { family: 'monospace', size: 10 } }
          },
          y: {
            grid: { display: false },
            ticks: { color: '#94a3b8', font: { family: 'monospace', size: 10 } }
          }
        }
      }
    });

    // Latency histogram
    const allLatencies = report.scenarios.flatMap(s => s.traces.map(t => t.totalMicros / 1000));
    const buckets = Array(20).fill(0);
    const max = Math.max(...allLatencies) || 1;
    const bucketSize = max / 20;
    allLatencies.forEach(l => {
      const idx = Math.min(Math.floor(l / bucketSize), 19);
      buckets[idx]++;
    });
    new Chart(document.getElementById('latencyHistogram'), {
      type: 'bar',
      data: {
        labels: buckets.map((_, i) => (i * bucketSize).toFixed(1) + 'ms'),
        datasets: [{
          label: 'Count',
          data: buckets,
          backgroundColor: '#8b5cf6',
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            grid: { color: '#334155' },
            ticks: { color: '#94a3b8', font: { family: 'monospace', size: 9 }, maxRotation: 45 }
          },
          y: {
            grid: { color: '#334155' },
            ticks: { color: '#94a3b8', font: { family: 'monospace', size: 10 } }
          }
        }
      }
    });

    // Phase bar chart
    const phases = ['trust', 'decode', 'resolve', 'decide', 'query'];
    const phaseByPhase = report.aggregateMetrics.byPhase;
    new Chart(document.getElementById('phaseBarChart'), {
      type: 'bar',
      data: {
        labels: phases.map(p => p.charAt(0).toUpperCase() + p.slice(1)),
        datasets: [{
          label: 'Mean (µs)',
          data: phases.map(p => phaseByPhase[p]?.mean || 0),
          backgroundColor: ['#3b82f6', '#06b6d4', '#8b5cf6', '#22c55e', '#f59e0b'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#94a3b8' } },
          y: { grid: { color: '#334155' }, ticks: { color: '#94a3b8' } }
        }
      }
    });

    // Cache chart
    const cache = report.aggregateMetrics.cache;
    new Chart(document.getElementById('cacheChart'), {
      type: 'doughnut',
      data: {
        labels: ['Hits', 'Misses'],
        datasets: [{
          data: [cache.hits, cache.misses],
          backgroundColor: ['#22c55e', '#ef4444'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#94a3b8', font: { family: 'monospace', size: 10 } }
          },
          title: {
            display: true,
            text: 'Hit Rate: ' + cache.hitRate.toFixed(1) + '%',
            color: '#f1f5f9',
            font: { family: 'monospace', size: 12 }
          }
        }
      }
    });

    // Timeline visualization
    const timelineContainer = document.getElementById('timelineContainer');
    report.scenarios.slice(0, 5).forEach(scenario => {
      const trace = scenario.traces[0];
      if (!trace || !trace.spans.length) return;

      const div = document.createElement('div');
      div.style.marginBottom = '12px';

      const label = document.createElement('div');
      label.style.fontSize = '11px';
      label.style.color = '#94a3b8';
      label.style.marginBottom = '4px';
      label.textContent = scenario.scenario.name + ' (' + (trace.totalMicros / 1000).toFixed(2) + 'ms)';
      div.appendChild(label);

      const bar = document.createElement('div');
      bar.className = 'timeline-bar';

      const minStart = Math.min(...trace.spans.map(s => s.startMicros));
      const maxEnd = Math.max(...trace.spans.map(s => s.endMicros));
      const totalDuration = maxEnd - minStart || 1;

      trace.spans.forEach(span => {
        const seg = document.createElement('div');
        seg.className = 'timeline-segment ' + span.phase;
        seg.style.left = ((span.startMicros - minStart) / totalDuration * 100) + '%';
        seg.style.width = (span.durationMicros / totalDuration * 100) + '%';
        seg.title = span.name + ': ' + (span.durationMicros / 1000).toFixed(3) + 'ms';
        bar.appendChild(seg);
      });

      div.appendChild(bar);
      timelineContainer.appendChild(div);
    });

    // Query list
    const queryList = document.getElementById('queryList');
    const queries = [];
    report.scenarios.forEach(s => {
      s.traces.forEach(t => {
        t.spans.forEach(span => {
          if (span.metadata?.query) {
            queries.push({
              scenario: s.scenario.name,
              method: span.name,
              duration: span.durationMicros,
              cypher: span.metadata.query.cypher,
              params: span.metadata.query.params
            });
          }
        });
      });
    });

    // Dedupe and show unique queries
    const uniqueQueries = [...new Map(queries.map(q => [q.cypher, q])).values()];
    uniqueQueries.slice(0, 10).forEach(q => {
      const div = document.createElement('div');
      div.style.marginBottom = '12px';
      div.style.padding = '12px';
      div.style.background = '#334155';
      div.style.borderRadius = '4px';

      div.innerHTML = \`
        <div style="font-size: 11px; color: #94a3b8; margin-bottom: 8px;">
          <strong>\${q.method}</strong> • \${(q.duration / 1000).toFixed(3)}ms
        </div>
        <pre style="margin: 0; white-space: pre-wrap; word-break: break-all;">\${q.cypher}</pre>
      \`;
      queryList.appendChild(div);
    });

    if (uniqueQueries.length === 0) {
      queryList.innerHTML = '<div style="color: #64748b;">No query data available</div>';
    }
  </script>
</body>
</html>`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * Save an HTML report to a file.
 */
export function saveHtmlReport(report: LatencyReport, filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(filePath, generateHtmlReport(report), 'utf-8')
}
