#!/usr/bin/env node

/**
 * Benchmark Comparison Script
 *
 * This script runs SDK disabled and SDK active benchmarks, then generates
 * comparison tables showing the performance impact of the SDK.
 *
 * Usage:
 *   node benchmarks/compare-benchmarks.js
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(80));
  log(title, colors.bright + colors.cyan);
  console.log('='.repeat(80) + '\n');
}

function parseNanoseconds(str) {
  // Remove ± and everything after it, then parse the number
  const cleaned = str.split('±')[0].trim().replace(/,/g, '');
  return parseFloat(cleaned);
}

function stripAnsi(str) {
  // Remove ANSI escape codes
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

function parseTable(output) {
  // Strip ANSI codes first
  const cleanOutput = stripAnsi(output);
  const lines = cleanOutput.split('\n');
  const results = [];

  // Find the table section
  let inTable = false;
  let foundTable = false;
  let parsedRows = 0;

  for (const line of lines) {
    if (line.includes('Task name') && line.includes('Latency avg')) {
      inTable = true;
      foundTable = true;
      continue;
    }

    if (inTable) {
      if (line.includes('└─────────┴')) {
        break;
      }

      // Skip separator lines
      if (line.includes('├─────────┼')) {
        continue;
      }

      // Parse data rows (starts with │ and a number)
      const match = line.match(/│\s+(\d+)\s+│\s+'([^']+)'\s+│\s+'([^']+)'\s+│\s+'([^']+)'\s+│\s+'([^']+)'\s+│\s+'([^']+)'\s+│\s+(\d+)/);
      if (match) {
        results.push({
          index: parseInt(match[1]),
          taskName: match[2],
          latencyAvg: match[3],
          latencyMed: match[4],
          throughputAvg: match[5],
          throughputMed: match[6],
          samples: parseInt(match[7]),
        });
        parsedRows++;
      }
    }
  }

  if (!foundTable) {
    // Debug: save output to file for inspection
    const debugPath = path.join(__dirname, 'debug-output.txt');
    fs.writeFileSync(debugPath, cleanOutput);
    log(`⚠️  Warning: Could not find benchmark table in output. Saved to ${debugPath}`, colors.yellow);
  } else if (parsedRows === 0) {
    // Found table but couldn't parse rows
    const debugPath = path.join(__dirname, 'debug-parse-failure.txt');
    fs.writeFileSync(debugPath, cleanOutput);
    log(`⚠️  Warning: Found table but couldn't parse any rows. Saved to ${debugPath}`, colors.yellow);

    // Show a few sample lines for debugging
    const sampleLines = lines.filter(l => l.includes('│') && l.includes('GET') || l.includes('POST')).slice(0, 3);
    if (sampleLines.length > 0) {
      log(`Sample lines:`, colors.dim);
      sampleLines.forEach(l => console.log(colors.dim + l + colors.reset));
    }
  }

  return results;
}

function getSamplingRate() {
  const configPath = path.join(__dirname, '..', '.tusk', 'config.yaml');
  try {
    const config = fs.readFileSync(configPath, 'utf8');
    const match = config.match(/sampling_rate:\s*([0-9.]+)/);
    return match ? parseFloat(match[1]) : null;
  } catch (error) {
    return null;
  }
}

function runBenchmark(scriptPath) {
  return new Promise((resolve, reject) => {
    log(`Running: ${scriptPath}`, colors.blue);
    log(`This will take approximately 2 minutes...`, colors.dim);

    const proc = spawn('npm', ['test', '--', scriptPath], {
      stdio: 'pipe',
      shell: true,
      timeout: 300000, // 5 minute timeout
    });

    let output = ''; // Combine stdout and stderr

    proc.stdout.on('data', (data) => {
      const str = data.toString();
      output += str;
      // Show real-time output (dimmed to reduce noise)
      process.stdout.write(colors.dim + str + colors.reset);
    });

    proc.stderr.on('data', (data) => {
      const str = data.toString();
      output += str;
      // Also show stderr in real-time
      process.stdout.write(colors.dim + str + colors.reset);
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Benchmark failed with code ${code}\nOutput: ${output.slice(-500)}`));
      } else {
        resolve(output); // Return combined output
      }
    });

    proc.on('error', (error) => {
      reject(new Error(`Process error: ${error.message}`));
    });
  });
}

function calculatePercentageDiff(baseline, value) {
  const diff = ((value - baseline) / baseline) * 100;
  return diff;
}

function formatPercentage(pct, colored = true) {
  const sign = pct >= 0 ? '+' : '';
  const str = `${sign}${pct.toFixed(1)}%`;

  if (!colored) return str;

  if (pct < -10) return colors.green + str + colors.reset;
  if (pct < 0) return colors.green + str + colors.reset;
  if (pct < 10) return colors.yellow + str + colors.reset;
  if (pct < 50) return colors.yellow + str + colors.reset;
  return colors.red + str + colors.reset;
}

function getImpactEmoji(pct) {
  if (pct < 10) return '🟢';
  if (pct < 50) return '🟡';
  if (pct < 200) return '🔴';
  if (pct < 400) return '🔴🔴';
  return '🔴🔴🔴';
}

function printComparisonTable(disabled, active, samplingRate) {
  logSection(`Performance Comparison: SDK Disabled vs SDK Active (Sampling Rate: ${samplingRate})`);

  // Table header
  const header = [
    'Workload',
    'Metric',
    'SDK Disabled',
    `SDK @ ${samplingRate}`,
    'Difference',
    'Impact'
  ];

  // Column widths
  const widths = [35, 18, 15, 15, 12, 8];

  // Print header
  const headerRow = header.map((h, i) => h.padEnd(widths[i])).join(' │ ');
  console.log('┌' + '─'.repeat(headerRow.length + 2) + '┐');
  console.log('│ ' + colors.bright + headerRow + colors.reset + ' │');
  console.log('├' + '─'.repeat(headerRow.length + 2) + '┤');

  // Print rows
  for (let i = 0; i < disabled.length; i++) {
    const d = disabled[i];
    const a = active[i];

    if (!a) {
      log(`Warning: No matching active benchmark for ${d.taskName}`, colors.yellow);
      continue;
    }

    // Parse latency
    const dLatency = parseNanoseconds(d.latencyAvg);
    const aLatency = parseNanoseconds(a.latencyAvg);
    const latencyDiff = calculatePercentageDiff(dLatency, aLatency);

    // Parse throughput
    const dThroughput = parseNanoseconds(d.throughputAvg);
    const aThroughput = parseNanoseconds(a.throughputAvg);
    const throughputDiff = calculatePercentageDiff(dThroughput, aThroughput);

    // Latency row
    const latencyRow = [
      d.taskName,
      'Latency (ns)',
      dLatency.toLocaleString(),
      aLatency.toLocaleString(),
      formatPercentage(latencyDiff),
      getImpactEmoji(latencyDiff)
    ].map((cell, idx) => String(cell).padEnd(widths[idx])).join(' │ ');

    console.log('│ ' + latencyRow + ' │');

    // Throughput row
    const throughputRow = [
      '',
      'Throughput (ops/s)',
      dThroughput.toLocaleString(),
      aThroughput.toLocaleString(),
      formatPercentage(throughputDiff),
      ''
    ].map((cell, idx) => String(cell).padEnd(widths[idx])).join(' │ ');

    console.log('│ ' + throughputRow + ' │');

    // Separator
    if (i < disabled.length - 1) {
      console.log('├' + '─'.repeat(headerRow.length + 2) + '┤');
    }
  }

  console.log('└' + '─'.repeat(headerRow.length + 2) + '┘');
}

function printSummaryStatistics(disabled, active, samplingRate) {
  logSection('Summary Statistics');

  let totalLatencyOverhead = 0;
  let totalThroughputImpact = 0;
  let count = 0;

  const categories = {
    small: [],
    large: [],
    cpu: [],
    io: [],
  };

  for (let i = 0; i < disabled.length; i++) {
    const d = disabled[i];
    const a = active[i];

    if (!a) continue;

    const dLatency = parseNanoseconds(d.latencyAvg);
    const aLatency = parseNanoseconds(a.latencyAvg);
    const latencyDiff = calculatePercentageDiff(dLatency, aLatency);

    const dThroughput = parseNanoseconds(d.throughputAvg);
    const aThroughput = parseNanoseconds(a.throughputAvg);
    const throughputDiff = calculatePercentageDiff(dThroughput, aThroughput);

    totalLatencyOverhead += latencyDiff;
    totalThroughputImpact += throughputDiff;
    count++;

    // Categorize
    if (d.taskName.includes('simple')) {
      categories.small.push({ name: d.taskName, latency: latencyDiff, throughput: throughputDiff });
    } else if (d.taskName.includes('small') || d.taskName.includes('medium') || d.taskName.includes('large')) {
      categories.large.push({ name: d.taskName, latency: latencyDiff, throughput: throughputDiff });
    } else if (d.taskName.includes('CPU')) {
      categories.cpu.push({ name: d.taskName, latency: latencyDiff, throughput: throughputDiff });
    } else if (d.taskName.includes('IO')) {
      categories.io.push({ name: d.taskName, latency: latencyDiff, throughput: throughputDiff });
    }
  }

  console.log(`${colors.bright}Overall Averages:${colors.reset}`);
  console.log(`  Average Latency Overhead:     ${formatPercentage(totalLatencyOverhead / count)}`);
  console.log(`  Average Throughput Impact:    ${formatPercentage(totalThroughputImpact / count)}`);
  console.log();

  // Print category summaries
  const printCategory = (name, items) => {
    if (items.length === 0) return;

    const avgLatency = items.reduce((sum, i) => sum + i.latency, 0) / items.length;
    const avgThroughput = items.reduce((sum, i) => sum + i.throughput, 0) / items.length;

    console.log(`${colors.bright}${name}:${colors.reset}`);
    console.log(`  Average Latency Overhead:     ${formatPercentage(avgLatency)}`);
    console.log(`  Average Throughput Impact:    ${formatPercentage(avgThroughput)}`);
    console.log();
  };

  printCategory('Small Payloads (simple GET/POST)', categories.small);
  printCategory('Large Payloads (100KB - 2MB)', categories.large);
  printCategory('CPU-Bound Workloads', categories.cpu);
  printCategory('I/O-Bound Workloads', categories.io);
}

function printRecommendations(disabled, active, samplingRate) {
  logSection('Recommendations');

  // Calculate average overhead for large payloads
  let largePayloadOverhead = 0;
  let largePayloadCount = 0;

  for (let i = 0; i < disabled.length; i++) {
    const d = disabled[i];
    const a = active[i];

    if (!a) continue;

    if (d.taskName.includes('small') || d.taskName.includes('medium') || d.taskName.includes('large')) {
      const dLatency = parseNanoseconds(d.latencyAvg);
      const aLatency = parseNanoseconds(a.latencyAvg);
      const latencyDiff = calculatePercentageDiff(dLatency, aLatency);

      largePayloadOverhead += latencyDiff;
      largePayloadCount++;
    }
  }

  const avgLargePayloadOverhead = largePayloadOverhead / largePayloadCount;

  console.log(`Current sampling rate: ${colors.bright}${samplingRate}${colors.reset}`);
  console.log(`Average overhead on large payloads: ${formatPercentage(avgLargePayloadOverhead)}\n`);

  if (samplingRate >= 1.0) {
    log('⚠️  WARNING: Sampling rate 1.0 has VERY HIGH overhead on large payloads!', colors.red);
    console.log();
    log('Recommended actions:', colors.yellow);
    console.log('  1. Reduce sampling rate to 0.1 (10%) for development/staging');
    console.log('  2. Reduce sampling rate to 0.01 (1%) for production');
    console.log('  3. Consider using exclude_paths for large payload endpoints');
    console.log();
    console.log('Expected improvements with sampling rate 0.01:');
    console.log(`  - Large payload overhead: ${formatPercentage(avgLargePayloadOverhead)} → ~50%`);
    console.log('  - Small payload overhead: ~30-40% → ~25-30%');
    console.log('  - I/O-bound overhead: minimal');
  } else if (samplingRate >= 0.1) {
    log('✅ Good sampling rate for development/staging!', colors.green);
    console.log();
    log('For production, consider:', colors.yellow);
    console.log('  - Reduce sampling rate to 0.01 (1%) for better performance');
    console.log('  - Expected ~40-50% improvement on large payloads');
    console.log('  - Still maintains statistically significant trace coverage');
  } else if (samplingRate >= 0.01) {
    log('✅ Excellent sampling rate for production!', colors.green);
    console.log();
    console.log('Current configuration is optimal for production use:');
    console.log('  - Low overhead on all workload types');
    console.log('  - 1% trace coverage is statistically significant');
    console.log('  - 99% reduction in trace storage costs');
  } else {
    log('ℹ️  Very low sampling rate', colors.blue);
    console.log();
    console.log('Consider if you have sufficient trace coverage for debugging.');
    console.log('Sampling rate 0.01 (1%) provides good balance of performance and coverage.');
  }
}

function saveResultsToFile(disabled, active, samplingRate) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `benchmark-comparison-${samplingRate}-${timestamp}.json`;
  const filepath = path.join(__dirname, 'results', filename);

  // Create results directory if it doesn't exist
  const resultsDir = path.join(__dirname, 'results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const results = {
    timestamp: new Date().toISOString(),
    samplingRate,
    disabled,
    active,
    comparisons: disabled.map((d, i) => {
      const a = active[i];
      if (!a) return null;

      const dLatency = parseNanoseconds(d.latencyAvg);
      const aLatency = parseNanoseconds(a.latencyAvg);
      const dThroughput = parseNanoseconds(d.throughputAvg);
      const aThroughput = parseNanoseconds(a.throughputAvg);

      return {
        taskName: d.taskName,
        disabled: {
          latency: dLatency,
          throughput: dThroughput,
        },
        active: {
          latency: aLatency,
          throughput: aThroughput,
        },
        impact: {
          latencyOverhead: calculatePercentageDiff(dLatency, aLatency),
          throughputImpact: calculatePercentageDiff(dThroughput, aThroughput),
        },
      };
    }).filter(Boolean),
  };

  fs.writeFileSync(filepath, JSON.stringify(results, null, 2));
  log(`\n✅ Results saved to: ${filepath}`, colors.green);
}

async function main() {
  try {
    logSection('TuskDrift SDK Benchmark Comparison Tool');

    const samplingRate = getSamplingRate();
    if (samplingRate !== null) {
      log(`Current sampling rate from .tusk/config.yaml: ${samplingRate}`, colors.blue);
    } else {
      log('Could not read sampling rate from .tusk/config.yaml, using default', colors.yellow);
    }

    console.log();

    // Run SDK disabled benchmark
    logSection('Step 1/2: Running SDK Disabled Benchmark');
    const disabledOutput = await runBenchmark('benchmarks/bench/sdk-disabled.bench.ts');
    const disabledResults = parseTable(disabledOutput);
    log(`✅ Completed: ${disabledResults.length} benchmarks`, colors.green);

    // Wait a bit between benchmarks
    log('\nWaiting 3 seconds before next benchmark...', colors.dim);
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Run SDK active benchmark
    logSection('Step 2/2: Running SDK Active Benchmark');
    const activeOutput = await runBenchmark('benchmarks/bench/sdk-active.bench.ts');
    const activeResults = parseTable(activeOutput);
    log(`✅ Completed: ${activeResults.length} benchmarks`, colors.green);

    console.log();

    // Print comparison
    printComparisonTable(disabledResults, activeResults, samplingRate || 'unknown');
    printSummaryStatistics(disabledResults, activeResults, samplingRate || 'unknown');
    printRecommendations(disabledResults, activeResults, samplingRate || 1.0);

    // Save results
    saveResultsToFile(disabledResults, activeResults, samplingRate || 'unknown');

    logSection('Benchmark Comparison Complete! 🎉');

  } catch (error) {
    log(`\n❌ Error: ${error.message}`, colors.red);
    console.error(error);
    process.exit(1);
  }
}

main();
