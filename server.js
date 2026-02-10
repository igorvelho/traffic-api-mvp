const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { extractSegment, extractSegmentsBatch, getCacheStats: getLLMCacheStats, clearCache: clearLLMCache, getLLMStatus } = require('./extractSegment');

// Import traffic data adapters
const { fetchTIITraffic, isIrishRoad, getCacheStats: getTIICacheStats, clearCache: clearTIICache } = require('./tiiAdapter');
const { fetchWebTRISTraffic, isUKRoad, getCacheStats: getWebTRISCacheStats, clearCache: clearWebTRISCache } = require('./webtrisAdapter');
const { fetchRoadTraffic, fetchGoogleMapsTraffic, isGoogleMapsPreferred, getAPIStats: getGoogleStats, getCacheStats: getGoogleCacheStats, clearCache: clearGoogleCache } = require('./googleMapsAdapter');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", "https://traffic-api-mvp.onrender.com"],
    },
  },
}));
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests' }
});
app.use(limiter);

// Load valid API keys from environment
const VALID_API_KEYS = (process.env.VALID_API_KEYS || 'demo-key-free,demo-key-pro,demo-key-enterprise').split(',').map(k => k.trim());

const apiKeyAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || !VALID_API_KEYS.includes(apiKey)) {
    return res.status(401).json({ error: 'Invalid or missing API key', message: 'Use x-api-key: demo-key-free' });
  }
  next();
};

/**
 * Smart traffic data fetching with fallback logic
 * Priority: 1. Free sources (TII, WebTRIS) 2. Google Maps fallback
 */
async function fetchTrafficWithFallback(road, country, town) {
  const results = {
    data: [],
    sourcesUsed: [],
    fallbackUsed: false,
    errors: [],
    details: []
  };
  
  const normalizedRoad = road.toUpperCase();
  const normalizedCountry = country ? country.toUpperCase() : 'ALL';
  const isLocalStreet = town && !road.match(/^(M|N|A)[0-9]+/i);
  
  // === SMART ROUTING LOGIC ===
  
  // 1. Try FREE sources based on country/road patterns
  
  // Ireland: Try TII first
  if ((normalizedCountry === 'ALL' || normalizedCountry === 'IE') && (isIrishRoad(road) || normalizedRoad === 'M1')) {
    results.details.push({ step: 'Trying TII (Ireland) for ' + road });
    const tiiResult = await fetchTIITraffic(road);
    results.sourcesUsed.push('TII-Ireland');
    
    if (tiiResult.data && tiiResult.data.length > 0) {
      results.data.push(...tiiResult.data);
      results.details.push({ 
        step: 'TII returned ' + tiiResult.data.length + ' records',
        fromCache: tiiResult.fromCache 
      });
    } else {
      results.details.push({ step: 'TII returned no data', error: tiiResult.error });
    }
  }
  
  // UK: Try WebTRIS first
  if ((normalizedCountry === 'ALL' || normalizedCountry === 'UK') && (isUKRoad(road) || normalizedRoad === 'M1')) {
    results.details.push({ step: 'Trying WebTRIS (UK) for ' + road });
    const webtrisResult = await fetchWebTRISTraffic(road);
    results.sourcesUsed.push('WebTRIS-UK');
    
    if (webtrisResult.data && webtrisResult.data.length > 0) {
      results.data.push(...webtrisResult.data);
      results.details.push({ 
        step: 'WebTRIS returned ' + webtrisResult.data.length + ' records',
        fromCache: webtrisResult.fromCache 
      });
    } else {
      results.details.push({ step: 'WebTRIS returned no data', error: webtrisResult.error });
    }
  }
  
  // 2. If no data from free sources, FALLBACK to Google Maps
  
  const hasFreeData = results.data.length > 0;
  const shouldTryGoogle = !hasFreeData || isLocalStreet || isGoogleMapsPreferred(road, town, country);
  
  if (shouldTryGoogle) {
    results.details.push({ step: 'Falling back to Google Maps for ' + road });
    results.fallbackUsed = true;
    results.sourcesUsed.push('GoogleMaps');
    
    const countryName = normalizedCountry === 'IE' ? 'Ireland' : 
                        normalizedCountry === 'UK' ? 'United Kingdom' : 
                        normalizedCountry === 'ALL' ? '' : normalizedCountry;
    
    const googleResult = await fetchRoadTraffic(road, town, countryName);
    
    if (googleResult.data && googleResult.data.length > 0) {
      results.data.push(...googleResult.data);
      results.details.push({ 
        step: 'Google Maps returned ' + googleResult.data.length + ' records',
        fromCache: googleResult.fromCache 
      });
    } else {
      results.details.push({ step: 'Google Maps returned no data', error: googleResult.error });
      if (googleResult.error) results.errors.push(googleResult.error);
    }
  }
  
  return results;
}

const path = require('path');

// Serve frontend at root, API info at /api
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api', (req, res) => {
  res.json({
    service: 'Traffic API MVP',
    version: '1.2.0',
    status: 'operational',
    endpoints: {
      traffic: '/traffic?road=M1&country=IE&town=Dublin&extract=true',
      compare: '/compare?road=M1',
      sources: '/sources',
      extract: '/extract (POST - LLM segment extraction demo)',
      cache: '/cache/stats (cache statistics)',
      llmStatus: '/llm/status (LLM configuration)',
      googleStats: '/google/stats (Google Maps API usage)'
    },
    features: [
      'Multi-source traffic aggregation (TII, WebTRIS, Google Maps)',
      'Smart routing: Free APIs first, Google fallback',
      'LLM-powered segment extraction',
      'Human-readable location descriptions',
      'Response caching (5min TTL)'
    ]
  });
});

app.get('/sources', (req, res) => {
  res.json({
    sources: [
      { id: 'tii-ireland', name: 'Transport Infrastructure Ireland', country: 'IE', coverage: 'National Roads', updateFrequency: '5 minutes', cost: 'Free', priority: 1 },
      { id: 'webtris-uk', name: 'National Highways WebTRIS', country: 'UK', coverage: 'England Motorways', updateFrequency: '1-15 minutes', cost: 'Free', priority: 1 },
      { id: 'google-maps', name: 'Google Maps Directions API', country: 'Global', coverage: 'All roads', updateFrequency: 'Real-time', cost: 'Pay-per-use', priority: 2 }
    ],
    routingLogic: {
      description: 'Smart routing with fallback',
      steps: [
        '1. Check if road is in Ireland → Try TII API',
        '2. Check if road is in UK → Try WebTRIS API', 
        '3. If no data OR local street → Fallback to Google Maps API',
        '4. Return aggregated data from all successful sources'
      ],
      example: {
        'George\'s Street, Drogheda, IE': {
          step1: 'TII: No data (local street not covered)',
          step2: 'WebTRIS: Skipped (Ireland)',
          step3: 'Google Maps: Returns real data',
          result: 'Distance: 0.6km, Time: 3 mins, Congestion: fluid'
        }
      }
    }
  });
});

app.get('/traffic', apiKeyAuth, async (req, res) => {
  const { road, country = 'ALL', town, extract = 'false' } = req.query;
  const shouldExtract = extract === 'true';
  
  if (!road) {
    return res.status(400).json({ 
      error: 'Road parameter required', 
      examples: [
        '/traffic?road=M1&country=IE (Ireland motorway)',
        '/traffic?road=M1&country=UK (UK motorway)',
        '/traffic?road=George%27s%20Street&town=Drogheda&country=IE (Local street)'
      ]
    });
  }

  const startTime = Date.now();
  
  // Fetch traffic data with smart fallback
  const fetchResults = await fetchTrafficWithFallback(road, country, town);
  let data = fetchResults.data;
  
  // Process LLM extraction if requested
  let enhancedData = data;
  let extractionInfo = null;
  
  if (shouldExtract && data.length > 0) {
    try {
      const extractStart = Date.now();
      enhancedData = await extractSegmentsBatch(data, { useCache: true, fallback: true });
      extractionInfo = {
        processed: data.length,
        extractionTimeMs: Date.now() - extractStart,
        cached: enhancedData.filter(d => d.segment?.cached).length
      };
    } catch (error) {
      console.error('Extraction failed:', error.message);
      extractionInfo = {
        processed: data.length,
        error: error.message,
        fallback: true
      };
    }
  }

  // Build response summary
  const summary = {
    totalRecords: data.length,
    sourcesUsed: fetchResults.sourcesUsed,
    fallbackTriggered: fetchResults.fallbackUsed,
    countries: country === 'ALL' ? [...new Set(data.map(d => {
      if (d.source === 'TII-Ireland') return 'IE';
      if (d.source === 'WebTRIS-UK') return 'UK';
      return 'Unknown';
    }))] : [country],
    congestionBreakdown: {
      heavy: data.filter(d => d.congestionLevel === 'heavy').length,
      moderate: data.filter(d => d.congestionLevel === 'moderate').length,
      light: data.filter(d => d.congestionLevel === 'light').length,
      none: data.filter(d => d.congestionLevel === 'none').length
    }
  };

  const response = {
    query: { road, country, town, extract: shouldExtract },
    timestamp: new Date().toISOString(),
    data: enhancedData,
    summary,
    routing: {
      sourcesTried: fetchResults.sourcesUsed,
      fallbackUsed: fetchResults.fallbackUsed,
      details: fetchResults.details
    },
    responseTimeMs: Date.now() - startTime
  };

  if (extractionInfo) {
    response.extraction = extractionInfo;
  }

  if (fetchResults.errors.length > 0) {
    response.errors = fetchResults.errors;
  }

  res.json(response);
});

app.get('/compare', apiKeyAuth, async (req, res) => {
  const { road } = req.query;
  
  if (!road) {
    return res.status(400).json({ error: 'Road parameter required', example: '/compare?road=M1' });
  }

  const startTime = Date.now();
  
  // Fetch data for both countries
  const [ieResults, ukResults] = await Promise.all([
    fetchTIITraffic(road).catch(() => ({ data: [] })),
    fetchWebTRISTraffic(road).catch(() => ({ data: [] }))
  ]);
  
  const irelandData = ieResults.data || [];
  const ukData = ukResults.data || [];

  res.json({
    road: road.toUpperCase(),
    timestamp: new Date().toISOString(),
    comparison: {
      ireland: {
        recordCount: irelandData.length,
        averageDelayMinutes: irelandData.length > 0 
          ? Math.round(irelandData.reduce((sum, d) => sum + (d.delayMinutes || 0), 0) / irelandData.length * 10) / 10
          : 0,
        congestion: irelandData.length > 0
          ? getDominantCongestion(irelandData)
          : 'no data',
        sample: irelandData.slice(0, 3)
      },
      uk: {
        recordCount: ukData.length,
        averageSpeed: ukData.length > 0
          ? Math.round(ukData.reduce((sum, d) => sum + (d.averageSpeed || 0), 0) / ukData.length)
          : 0,
        congestion: ukData.length > 0
          ? getDominantCongestion(ukData)
          : 'no data',
        sample: ukData.slice(0, 3)
      }
    },
    insight: generateInsight(irelandData, ukData),
    responseTimeMs: Date.now() - startTime
  });
});

/**
 * Get dominant congestion level from data array
 */
function getDominantCongestion(data) {
  const counts = { heavy: 0, moderate: 0, light: 0, none: 0 };
  data.forEach(d => {
    counts[d.congestionLevel] = (counts[d.congestionLevel] || 0) + 1;
  });
  
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted[0][0];
}

/**
 * Generate comparison insight
 */
function generateInsight(ieData, ukData) {
  if (ieData.length === 0 && ukData.length === 0) {
    return 'No data available for comparison';
  }
  if (ieData.length === 0) return 'Only UK data available';
  if (ukData.length === 0) return 'Only Ireland data available';
  
  const ieCongestion = getDominantCongestion(ieData);
  const ukCongestion = getDominantCongestion(ukData);
  
  const levels = { none: 0, light: 1, moderate: 2, heavy: 3 };
  
  if (levels[ieCongestion] > levels[ukCongestion]) {
    return 'Ireland showing higher congestion than UK';
  } else if (levels[ukCongestion] > levels[ieCongestion]) {
    return 'UK showing higher congestion than Ireland';
  } else {
    return 'Both countries showing similar congestion levels';
  }
}

/**
 * POST /extract - LLM-powered segment extraction endpoint
 */
app.post('/extract', apiKeyAuth, express.text({ type: '*/*' }), async (req, res) => {
  const startTime = Date.now();
  
  try {
    const rawText = req.body;
    
    if (!rawText || rawText.trim().length === 0) {
      return res.status(400).json({ 
        error: 'Text body required',
        example: 'curl -X POST -H "x-api-key: demo-key-free" -H "Content-Type: text/plain" -d "Site 19446, M1, lat: 52.198, lon: -0.915, speed: 48, congestion: moderate" http://localhost:3000/extract'
      });
    }

    const extracted = await extractSegment(rawText, { useCache: true, fallback: true });
    
    res.json({
      input: rawText,
      extracted,
      processingTimeMs: Date.now() - startTime,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Extract endpoint error:', error.message);
    res.status(500).json({
      error: 'Extraction failed',
      message: error.message,
      processingTimeMs: Date.now() - startTime
    });
  }
});

// Also support JSON body for /extract
app.post('/extract-json', apiKeyAuth, express.json(), async (req, res) => {
  const startTime = Date.now();
  
  try {
    const data = req.body;
    
    if (!data || Object.keys(data).length === 0) {
      return res.status(400).json({ 
        error: 'JSON body required',
        example: { text: 'Site 19446, M1, speed: 48' }
      });
    }

    const inputText = data.text || JSON.stringify(data);
    const extracted = await extractSegment(inputText, { useCache: true, fallback: true });
    
    res.json({
      input: inputText,
      extracted,
      processingTimeMs: Date.now() - startTime,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Extract endpoint error:', error.message);
    res.status(500).json({
      error: 'Extraction failed',
      message: error.message,
      processingTimeMs: Date.now() - startTime
    });
  }
});

/**
 * GET /cache/stats - Cache statistics for all adapters
 */
app.get('/cache/stats', apiKeyAuth, (req, res) => {
  res.json({
    caches: {
      tii: getTIICacheStats(),
      webtris: getWebTRISCacheStats(),
      google: getGoogleCacheStats(),
      llm: getLLMCacheStats()
    },
    ttlMinutes: 5,
    timestamp: new Date().toISOString()
  });
});

/**
 * POST /cache/clear - Clear all caches (admin only)
 */
app.post('/cache/clear', apiKeyAuth, (req, res) => {
  clearTIICache();
  clearWebTRISCache();
  clearGoogleCache();
  clearLLMCache();
  
  res.json({
    message: 'All caches cleared successfully',
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /llm/status - LLM configuration status
 */
app.get('/llm/status', apiKeyAuth, (req, res) => {
  const status = getLLMStatus();
  res.json({
    llm: status,
    providers: ['gemini', 'openai', 'kimi'],
    setup: status.enabled 
      ? 'LLM extraction is active'
      : 'Set LLM_PROVIDER and LLM_API_KEY in .env to enable LLM extraction',
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /google/stats - Google Maps API usage statistics
 */
app.get('/google/stats', apiKeyAuth, (req, res) => {
  const stats = getGoogleStats();
  res.json({
    googleMaps: stats,
    costOptimization: {
      cacheEnabled: true,
      cacheTTL: '5 minutes',
      fallbackOnly: true,
      description: 'Google Maps API is only called when free sources (TII, WebTRIS) return no data'
    },
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🚦 Traffic API MVP running on port ${PORT}`);
  console.log(`📖 API Documentation: http://localhost:${PORT}/`);
  console.log(`🔑 Demo API Key: demo-key-free`);
  console.log(`🗺️  Google Maps fallback: ${process.env.GOOGLE_MAPS_API_KEY ? 'Enabled' : 'Disabled (set GOOGLE_MAPS_API_KEY)'}`);
});
