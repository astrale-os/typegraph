/**
 * Reports Module
 *
 * Re-exports report generation utilities.
 */

export {
  type LatencyReport,
  type ReportMetadata,
  type ReportConfig,
  type TraceSummary,
  type CompactReport,
  exportToJson,
  saveJsonReport,
  buildReport,
  summarizeTraces,
  buildCompactReport,
  exportCompactJson,
} from './json-exporter'

export { generateHtmlReport, saveHtmlReport } from './html-generator'
