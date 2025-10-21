const fs = require('fs');
const path = require('path');
const SupportEstimator = require('./support_cost_calculator');

const vendorPath = path.join(__dirname, 'vendors.example.json');
const vendors = JSON.parse(fs.readFileSync(vendorPath, 'utf8'));

const exchangeRates = { USD: 1, EUR: 1.08, GBP: 1.25 };

const baseInput = {
  monthly_tickets_total: 420,
  tickets_by_severity: { sev1: 42, sev2: 168, sev3: 210 },
  current_cloud_spend: 75000,
  current_agents: 14,
  hours_of_coverage: '16x5',
  channels: ['email', 'chat', 'phone'],
  languages_count: 3,
  required_response_SLA_minutes: { sev1: 30, sev2: 120, sev3: 720 },
  required_resolution_SLA_hours: { sev1: 8, sev2: 24, sev3: 120 },
  growth_rate_percent: 0,
  spend_growth_rate_percent: 3,
  months_to_project: 12,
  planned_agents_change: 2,
  currency: 'USD',
  exchange_rates: exchangeRates,
  channel_mix_percent: undefined,
};

const scenarios = [
  {
    ...baseInput,
    scenario_name: 'Current Run-Rate',
  },
  {
    ...baseInput,
    scenario_name: 'Growth + 24x7 Coverage',
    growth_rate_percent: 20,
    hours_of_coverage: '24x7',
    required_response_SLA_minutes: { sev1: 20, sev2: 90, sev3: 360 },
    required_resolution_SLA_hours: { sev1: 6, sev2: 18, sev3: 72 },
  },
];

const scenarioResults = SupportEstimator.runScenarios(vendors, scenarios);

scenarioResults.forEach((comparison) => {
  console.log(`\n=== Scenario: ${comparison.scenario_name} ===`);
  if (!comparison.validation.valid) {
    console.error('Input validation errors:', comparison.validation.errors);
    return;
  }

  const tableRows = SupportEstimator.toComparisonTable(comparison);
  console.table(
    tableRows.map(({ __meta, ...display }) => display)
  );

  const gapSummary = comparison.results
    .filter((r) => r.sla_gaps.length)
    .map((r) => `${r.vendor_name}: ${r.sla_gaps.join(' | ')}`);

  if (gapSummary.length) {
    console.log('SLA Gaps:');
    gapSummary.forEach((line) => console.log(` - ${line}`));
  } else {
    console.log('All vendors meet requested SLAs.');
  }

  const chartSeries = SupportEstimator.buildMonthlyCostSeries(comparison);
  console.log('Bar Chart Series Preview:', chartSeries);
});
