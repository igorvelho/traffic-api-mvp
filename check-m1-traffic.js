#!/usr/bin/env node
/**
 * M1 Traffic Junction Monitor - Standalone Script
 * 
 * Usage:
 *   node check-m1-traffic.js [southbound|northbound]
 * 
 * Examples:
 *   node check-m1-traffic.js southbound    # Morning commute (Drogheda → Swords)
 *   node check-m1-traffic.js northbound    # Evening commute (Swords → Drogheda)
 * 
 * Environment Variables:
 *   TRAFFIC_API_URL    - Traffic API endpoint (default: https://traffic-api-mvp.onrender.com)
 *   TRAFFIC_API_KEY    - API key (default: argo-traffic-api-key-2026)
 *   TELEGRAM_BOT_TOKEN - Optional: Send report to Telegram
 *   TELEGRAM_CHAT_ID   - Optional: Telegram chat ID
 */

const https = require('https');

// Configuration
const CONFIG = {
  apiUrl: process.env.TRAFFIC_API_URL || 'https://traffic-api-mvp.onrender.com',
  apiKey: process.env.TRAFFIC_API_KEY || 'argo-traffic-api-key-2026',
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID
};

// M1 Junction segments
const SEGMENTS = {
  southbound: [
    { name: 'J10-J9 Drogheda', town: 'Drogheda', normalTime: 5 },
    { name: 'J9-J8 Drogheda-Duleek', town: 'Duleek', normalTime: 8 },
    { name: 'J8-J7 Duleek-Julianstown', town: 'Julianstown', normalTime: 5 },
    { name: 'J7-J6 Julianstown-Balbriggan', town: 'Balbriggan', normalTime: 8 },
    { name: 'J6-J5 Balbriggan', town: 'Balbriggan', normalTime: 3 },
    { name: 'J5-J4 Balbriggan-Donabate', town: 'Donabate', normalTime: 7 },
    { name: 'J4-J3 Donabate-Swords', town: 'Swords', normalTime: 6 },
    { name: 'J3-J1 Swords-M50', town: 'Swords', normalTime: 5 }
  ],
  northbound: [
    { name: 'J3-J1 Swords-M50', town: 'Swords', normalTime: 5 },
    { name: 'J4-J3 Donabate-Swords', town: 'Donabate', normalTime: 6 },
    { name: 'J5-J4 Balbriggan-Donabate', town: 'Balbriggan', normalTime: 7 },
    { name: 'J6-J5 Balbriggan', town: 'Balbriggan', normalTime: 3 },
    { name: 'J7-J6 Julianstown-Balbriggan', town: 'Julianstown', normalTime: 8 },
    { name: 'J8-J7 Duleek-Julianstown', town: 'Duleek', normalTime: 5 },
    { name: 'J9-J8 Drogheda-Duleek', town: 'Drogheda', normalTime: 8 },
    { name: 'J10-J9 Drogheda', town: 'Drogheda', normalTime: 5 }
  ]
};

/**
 * Fetch traffic data from API
 */
function fetchTraffic(town) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${CONFIG.apiUrl}/traffic?road=M1&country=IE&town=${encodeURIComponent(town)}&extract=true`);
    
    const req = https.get(url, {
      headers: {
        'x-api-key': CONFIG.apiKey,
        'Accept': 'application/json'
      },
      timeout: 10000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Process segment data
 */
function processSegment(segment, apiData) {
  const data = apiData.data || [];
  
  if (data.length === 0) {
    return {
      ...segment,
      status: 'clear',
      currentTime: segment.normalTime,
      delayMinutes: 0,
      emoji: '✅'
    };
  }

  const record = data.find(d => d.travelTimeMinutes) || data[0];
  const currentTime = record.travelTimeMinutes || segment.normalTime;
  const delayMinutes = record.delayMinutes || Math.max(0, currentTime - segment.normalTime);
  
  let emoji = '✅';
  if (delayMinutes >= 10) emoji = '🔴';
  else if (delayMinutes >= 5) emoji = '🟠';
  else if (delayMinutes >= 2) emoji = '🟡';

  return {
    ...segment,
    status: delayMinutes >= 5 ? 'delayed' : 'clear',
    currentTime,
    delayMinutes,
    emoji
  };
}

/**
 * Send Telegram message
 */
async function sendTelegram(message) {
  if (!CONFIG.telegramToken || !CONFIG.telegramChatId) {
    console.log('Telegram not configured, skipping notification');
    return;
  }

  return new Promise((resolve, reject) => {
    const url = new URL(`https://api.telegram.org/bot${CONFIG.telegramToken}/sendMessage`);
    
    const postData = JSON.stringify({
      chat_id: CONFIG.telegramChatId,
      text: message,
      parse_mode: 'Markdown'
    });

    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Main execution
 */
async function main() {
  const direction = process.argv[2] || 'southbound';
  
  if (!SEGMENTS[direction]) {
    console.error(`Invalid direction: ${direction}`);
    console.error('Use: southbound (Drogheda → Swords) or northbound (Swords → Drogheda)');
    process.exit(1);
  }

  const isMorning = direction === 'southbound';
  const routeName = isMorning ? 'Drogheda → Swords' : 'Swords → Drogheda';
  const timeEmoji = isMorning ? '🌅' : '🌆';

  console.log(`\n${timeEmoji} Checking M1 ${routeName}...\n`);

  const segments = SEGMENTS[direction];
  const results = [];

  // Check each segment
  for (const segment of segments) {
    try {
      process.stdout.write(`  Checking ${segment.name}... `);
      const data = await fetchTraffic(segment.town);
      const result = processSegment(segment, data);
      results.push(result);
      console.log(`${result.emoji} ${result.currentTime}min${result.delayMinutes > 0 ? ` (+${result.delayMinutes})` : ''}`);
      
      // Small delay between requests
      await new Promise(r => setTimeout(r, 300));
    } catch (error) {
      console.log(`⚪ Error: ${error.message}`);
      results.push({
        ...segment,
        status: 'error',
        currentTime: segment.normalTime,
        delayMinutes: 0,
        emoji: '⚪'
      });
    }
  }

  // Calculate summary
  const totalNormal = results.reduce((sum, s) => sum + s.normalTime, 0);
  const totalCurrent = results.reduce((sum, s) => sum + s.currentTime, 0);
  const totalDelay = totalCurrent - totalNormal;
  const worstSegment = results.reduce((w, c) => c.delayMinutes > w.delayMinutes ? c : w);

  // Build report
  const segmentLines = results.map(s => 
    `${s.emoji} ${s.name}: ${s.currentTime} min${s.delayMinutes > 0 ? ` (+${s.delayMinutes})` : ''}`
  );

  let recommendation;
  if (totalDelay >= 15) {
    recommendation = `🔴 Major delays! Consider alternative route or delay departure.`;
  } else if (totalDelay >= 10) {
    recommendation = `🟠 Significant delays at ${worstSegment.name}. Allow extra ${totalDelay} mins.`;
  } else if (totalDelay >= 5) {
    recommendation = `🟡 Minor delays. Allow extra ${totalDelay} mins.`;
  } else {
    recommendation = `🟢 Route is clear. Normal travel time expected.`;
  }

  const now = new Date().toLocaleString('en-IE', { 
    weekday: 'long', 
    hour: '2-digit', 
    minute: '2-digit',
    timeZone: 'Europe/Dublin'
  });

  const report = `
${timeEmoji} *M1 Traffic Report - ${routeName}*
_${now}_

*Segment Breakdown:*
${segmentLines.join('\n')}

*Summary:*
• Total: ${totalCurrent} min (normal: ${totalNormal} min)
• Delay: ${totalDelay > 0 ? `+${totalDelay} min` : 'None'}
• Worst: ${worstSegment.name} (${worstSegment.delayMinutes} min)

*Recommendation:*
${recommendation}
  `.trim();

  console.log('\n' + '='.repeat(50));
  console.log(report);
  console.log('='.repeat(50) + '\n');

  // Send Telegram notification if configured
  if (totalDelay >= 5) {
    await sendTelegram(report);
  }

  return {
    direction,
    timestamp: new Date().toISOString(),
    segments: results,
    summary: {
      totalNormal,
      totalCurrent,
      totalDelay,
      worstSegment: worstSegment.name
    },
    report
  };
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
