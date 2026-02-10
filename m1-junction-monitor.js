/**
 * M1 Traffic Junction Monitor
 * 
 * Checks traffic at multiple junctions along the M1 (Drogheda ↔ Swords)
 * and generates a detailed per-segment report.
 * 
 * Can be deployed as a Supabase Edge Function or run as a standalone script.
 */

// M1 Junction segments configuration
const M1_SEGMENTS = {
  // Southbound: Drogheda → Swords
  southbound: [
    { name: 'J10-J9 Drogheda', from: 'Drogheda North', to: 'Drogheda South', town: 'Drogheda', normalTime: 5 },
    { name: 'J9-J8 Drogheda-Duleek', from: 'Drogheda', to: 'Duleek', town: 'Duleek', normalTime: 8 },
    { name: 'J8-J7 Duleek-Julianstown', from: 'Duleek', to: 'Julianstown', town: 'Julianstown', normalTime: 5 },
    { name: 'J7-J6 Julianstown-Balbriggan', from: 'Julianstown', to: 'Balbriggan North', town: 'Balbriggan', normalTime: 8 },
    { name: 'J6-J5 Balbriggan', from: 'Balbriggan North', to: 'Balbriggan', town: 'Balbriggan', normalTime: 3 },
    { name: 'J5-J4 Balbriggan-Donabate', from: 'Balbriggan', to: 'Donabate', town: 'Donabate', normalTime: 7 },
    { name: 'J4-J3 Donabate-Swords', from: 'Donabate', to: 'Swords', town: 'Swords', normalTime: 6 },
    { name: 'J3-J1 Swords-M50', from: 'Swords', to: 'M50 Interchange', town: 'Swords', normalTime: 5 }
  ],
  // Northbound: Swords → Drogheda (reverse)
  northbound: [
    { name: 'J3-J1 Swords-M50', from: 'M50 Interchange', to: 'Swords', town: 'Swords', normalTime: 5 },
    { name: 'J4-J3 Donabate-Swords', from: 'Swords', to: 'Donabate', town: 'Donabate', normalTime: 6 },
    { name: 'J5-J4 Balbriggan-Donabate', from: 'Donabate', to: 'Balbriggan', town: 'Balbriggan', normalTime: 7 },
    { name: 'J6-J5 Balbriggan', from: 'Balbriggan', to: 'Balbriggan North', town: 'Balbriggan', normalTime: 3 },
    { name: 'J7-J6 Julianstown-Balbriggan', from: 'Balbriggan North', to: 'Julianstown', town: 'Julianstown', normalTime: 8 },
    { name: 'J8-J7 Duleek-Julianstown', from: 'Julianstown', to: 'Duleek', town: 'Duleek', normalTime: 5 },
    { name: 'J9-J8 Drogheda-Duleek', from: 'Duleek', to: 'Drogheda', town: 'Drogheda', normalTime: 8 },
    { name: 'J10-J9 Drogheda', from: 'Drogheda South', to: 'Drogheda North', town: 'Drogheda', normalTime: 5 }
  ]
};

// Traffic API configuration
const TRAFFIC_API_URL = 'https://traffic-api-mvp.onrender.com';
const TRAFFIC_API_KEY = 'argo-traffic-api-key-2026';

/**
 * Fetch traffic data for a specific segment
 */
async function checkSegment(segment) {
  try {
    const url = new URL(`${TRAFFIC_API_URL}/traffic`);
    url.searchParams.append('road', 'M1');
    url.searchParams.append('country', 'IE');
    url.searchParams.append('town', segment.town);
    url.searchParams.append('extract', 'true');

    const response = await fetch(url, {
      headers: {
        'x-api-key': TRAFFIC_API_KEY,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return processSegmentData(segment, data);
  } catch (error) {
    console.error(`Error checking ${segment.name}:`, error.message);
    return {
      ...segment,
      status: 'unknown',
      currentTime: null,
      delayMinutes: 0,
      congestionLevel: 'unknown',
      emoji: '⚪',
      error: error.message
    };
  }
}

/**
 * Process raw API response into segment status
 */
function processSegmentData(segment, apiResponse) {
  const data = apiResponse.data || [];
  
  if (data.length === 0) {
    return {
      ...segment,
      status: 'clear',
      currentTime: segment.normalTime,
      delayMinutes: 0,
      congestionLevel: 'none',
      emoji: '✅',
      source: 'estimate'
    };
  }

  // Find the most relevant record (prefer travel time data)
  const record = data.find(d => d.travelTimeMinutes) || data[0];
  
  const currentTime = record.travelTimeMinutes || segment.normalTime;
  const delayMinutes = record.delayMinutes || Math.max(0, currentTime - segment.normalTime);
  const congestionLevel = record.congestionLevel || 'none';
  
  // Determine status emoji
  let emoji = '✅';
  let status = 'clear';
  
  if (delayMinutes >= 10) {
    emoji = '🔴';
    status = 'heavy';
  } else if (delayMinutes >= 5) {
    emoji = '🟠';
    status = 'moderate';
  } else if (delayMinutes >= 2) {
    emoji = '🟡';
    status = 'light';
  }

  return {
    ...segment,
    status,
    currentTime,
    delayMinutes,
    congestionLevel,
    emoji,
    source: record.source || 'unknown',
    rawData: record
  };
}

/**
 * Check all segments for a direction
 */
async function checkRoute(direction) {
  console.log(`Checking M1 ${direction}...`);
  
  const segments = M1_SEGMENTS[direction];
  const results = [];
  
  // Check segments sequentially to avoid rate limiting
  for (const segment of segments) {
    const result = await checkSegment(segment);
    results.push(result);
    // Small delay between requests
    await new Promise(r => setTimeout(r, 200));
  }
  
  return results;
}

/**
 * Generate traffic report
 */
function generateReport(direction, segmentResults) {
  const isMorning = direction === 'southbound';
  const routeName = isMorning ? 'Drogheda → Swords' : 'Swords → Drogheda';
  const emoji = isMorning ? '🌅' : '🌆';
  
  // Calculate totals
  const totalNormalTime = segmentResults.reduce((sum, s) => sum + s.normalTime, 0);
  const totalCurrentTime = segmentResults.reduce((sum, s) => sum + (s.currentTime || s.normalTime), 0);
  const totalDelay = totalCurrentTime - totalNormalTime;
  
  // Find worst segment
  const worstSegment = segmentResults.reduce((worst, current) => 
    (current.delayMinutes > worst.delayMinutes) ? current : worst
  );
  
  // Build segment lines
  const segmentLines = segmentResults.map(s => {
    const timeStr = s.currentTime ? `${s.currentTime} min` : 'N/A';
    const delayStr = s.delayMinutes > 0 ? ` (+${s.delayMinutes})` : '';
    return `${s.emoji} ${s.name}: ${timeStr}${delayStr}`;
  });
  
  // Generate recommendation
  let recommendation = '';
  if (totalDelay >= 15) {
    recommendation = `🔴 Major delays! Consider alternative route or delay departure by ${Math.ceil(totalDelay / 5) * 5} mins.`;
  } else if (totalDelay >= 10) {
    recommendation = `🟠 Significant delays at ${worstSegment.name}. Allow extra ${totalDelay} minutes.`;
  } else if (totalDelay >= 5) {
    recommendation = `🟡 Minor delays. Allow extra ${totalDelay} minutes, mainly at ${worstSegment.name}.`;
  } else {
    recommendation = `🟢 Route is clear. Normal travel time expected.`;
  }
  
  const report = `
${emoji} **M1 Traffic Report - ${routeName}**
_${new Date().toLocaleString('en-IE', { 
  weekday: 'long', 
  hour: '2-digit', 
  minute: '2-digit',
  timeZone: 'Europe/Dublin'
 })}_

**Segment Breakdown:**
${segmentLines.join('\n')}

**Summary:**
• Total time: ${totalCurrentTime} minutes (normal: ${totalNormalTime} min)
• Delay: ${totalDelay > 0 ? `+${totalDelay} minutes` : 'No delay'}
• Worst segment: ${worstSegment.name} (${worstSegment.delayMinutes} min delay)

**Recommendation:**
${recommendation}
  `.trim();
  
  return report;
}

/**
 * Main handler - can be called as Deno edge function or Node script
 */
async function handleTrafficCheck(direction = 'southbound') {
  try {
    const results = await checkRoute(direction);
    const report = generateReport(direction, results);
    
    console.log('\n' + report);
    
    // Return structured data for potential Telegram integration
    return {
      success: true,
      direction,
      timestamp: new Date().toISOString(),
      report,
      segments: results.map(s => ({
        name: s.name,
        status: s.status,
        normalTime: s.normalTime,
        currentTime: s.currentTime,
        delayMinutes: s.delayMinutes
      })),
      summary: {
        totalNormalTime: results.reduce((sum, s) => sum + s.normalTime, 0),
        totalCurrentTime: results.reduce((sum, s) => sum + (s.currentTime || s.normalTime), 0),
        totalDelay: results.reduce((sum, s) => sum + s.delayMinutes, 0),
        worstSegment: results.reduce((w, c) => c.delayMinutes > w.delayMinutes ? c : w).name
      }
    };
  } catch (error) {
    console.error('Traffic check failed:', error);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// Supabase Edge Function handler
if (typeof Deno !== 'undefined') {
  Deno.serve(async (req) => {
    const { direction = 'southbound' } = await req.json().catch(() => ({}));
    
    const result = await handleTrafficCheck(direction);
    
    return new Response(JSON.stringify(result, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  });
}

// Node.js execution
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { handleTrafficCheck, checkRoute, generateReport };
  
  // Run if called directly
  if (require.main === module) {
    const direction = process.argv[2] || 'southbound';
    handleTrafficCheck(direction).then(result => {
      process.exit(result.success ? 0 : 1);
    });
  }
}

export { handleTrafficCheck, checkRoute, generateReport };
