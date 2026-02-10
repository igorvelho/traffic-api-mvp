const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { extractSegment, extractSegmentsBatch, getCacheStats, clearCache, getLLMStatus } = require('./extractSegment');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests' }
});
app.use(limiter);

const apiKeyAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || !['demo-key-free', 'demo-key-pro', 'demo-key-enterprise'].includes(apiKey)) {
    return res.status(401).json({ error: 'Invalid or missing API key', message: 'Use x-api-key: demo-key-free' });
  }
  next();
};

// Mock traffic data
const mockTrafficData = {
  IE: [
    {
      source: 'TII-Ireland',
      road: 'M1',
      direction: 'Northbound',
      travelTimeMinutes: 28,
      freeFlowTimeMinutes: 22,
      delayMinutes: 6,
      congestionLevel: 'moderate',
      timestamp: new Date().toISOString()
    },
    {
      source: 'TII-Ireland',
      road: 'M1',
      direction: 'Southbound',
      travelTimeMinutes: 26,
      freeFlowTimeMinutes: 22,
      delayMinutes: 4,
      congestionLevel: 'light',
      timestamp: new Date().toISOString()
    }
  ],
  UK: [
    {
      source: 'WebTRIS-UK',
      siteId: '19446',
      road: 'M1',
      direction: 'Southbound',
      location: { lat: 52.198, lon: -0.915 },
      vehicleFlow: 2450,
      averageSpeed: 65,
      congestionLevel: 'light',
      timestamp: new Date().toISOString()
    },
    {
      source: 'WebTRIS-UK',
      siteId: '19450',
      road: 'M1',
      direction: 'Northbound',
      location: { lat: 52.187, lon: -0.898 },
      vehicleFlow: 2180,
      averageSpeed: 72,
      congestionLevel: 'none',
      timestamp: new Date().toISOString()
    },
    {
      source: 'WebTRIS-UK',
      siteId: '19478',
      road: 'M1',
      direction: 'Northbound',
      location: { lat: 52.195, lon: -0.911 },
      vehicleFlow: 2890,
      averageSpeed: 48,
      congestionLevel: 'moderate',
      timestamp: new Date().toISOString()
    }
  ]
};

app.get('/', (req, res) => {
  res.json({
    service: 'Traffic API MVP',
    version: '1.1.0',
    status: 'operational',
    endpoints: {
      traffic: '/traffic?road=M1&country=IE&extract=true (extract=true enables LLM segment analysis)',
      compare: '/compare?road=M1',
      sources: '/sources',
      extract: '/extract (POST - LLM segment extraction demo)',
      cache: '/cache/stats (cache statistics)',
      llmStatus: '/llm/status (LLM configuration)'
    },
    features: [
      'LLM-powered segment extraction',
      'Human-readable location descriptions',
      'Response caching (5min TTL)'
    ]
  });
});

app.get('/sources', (req, res) => {
  res.json({
    sources: [
      { id: 'tii-ireland', name: 'Transport Infrastructure Ireland', country: 'IE', coverage: 'National Roads', updateFrequency: '5 minutes', cost: 'Free' },
      { id: 'webtris-uk', name: 'National Highways WebTRIS', country: 'UK', coverage: 'England Motorways', updateFrequency: '1-15 minutes', cost: 'Free' }
    ]
  });
});

app.get('/traffic', apiKeyAuth, async (req, res) => {
  const { road, country = 'ALL', extract = 'false' } = req.query;
  const shouldExtract = extract === 'true';
  
  if (!road) {
    return res.status(400).json({ error: 'Road parameter required', example: '/traffic?road=M1&country=UK&extract=true' });
  }

  const startTime = Date.now();
  const data = [];

  if ((country === 'ALL' || country === 'IE') && road.toUpperCase() === 'M1') {
    data.push(...mockTrafficData.IE);
  }
  
  if ((country === 'ALL' || country === 'UK') && road.toUpperCase() === 'M1') {
    data.push(...mockTrafficData.UK);
  }

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

  const summary = {
    totalRecords: data.length,
    sources: [...new Set(data.map(d => d.source))],
    countries: country === 'ALL' ? ['IE', 'UK'] : [country],
    congestionBreakdown: {
      heavy: data.filter(d => d.congestionLevel === 'heavy').length,
      moderate: data.filter(d => d.congestionLevel === 'moderate').length,
      light: data.filter(d => d.congestionLevel === 'light').length,
      none: data.filter(d => d.congestionLevel === 'none').length
    }
  };

  const response = {
    query: { road, country, extract: shouldExtract },
    timestamp: new Date().toISOString(),
    data: enhancedData,
    summary,
    responseTimeMs: Date.now() - startTime
  };

  if (extractionInfo) {
    response.extraction = extractionInfo;
  }

  res.json(response);
});

app.get('/compare', apiKeyAuth, (req, res) => {
  const { road } = req.query;
  
  if (!road || road.toUpperCase() !== 'M1') {
    return res.status(400).json({ error: 'Only M1 supported in demo', example: '/compare?road=M1' });
  }

  const irelandData = mockTrafficData.IE;
  const ukData = mockTrafficData.UK;

  res.json({
    road: 'M1',
    timestamp: new Date().toISOString(),
    comparison: {
      ireland: {
        recordCount: irelandData.length,
        averageDelayMinutes: 5,
        congestion: 'light to moderate',
        sample: irelandData
      },
      uk: {
        recordCount: ukData.length,
        averageSpeed: 62,
        congestion: 'light',
        sample: ukData
      }
    },
    insight: 'UK M1 showing better flow than IE M1 at this time'
  });
});

/**
 * POST /extract - LLM-powered segment extraction endpoint
 * Demo endpoint for testing segment extraction on raw traffic text
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
app.post('/extract', apiKeyAuth, express.json(), async (req, res) => {
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
 * GET /cache/stats - Cache statistics
 */
app.get('/cache/stats', apiKeyAuth, (req, res) => {
  const stats = getCacheStats();
  res.json({
    cache: stats,
    ttlMinutes: 5,
    timestamp: new Date().toISOString()
  });
});

/**
 * POST /cache/clear - Clear the cache (admin only)
 */
app.post('/cache/clear', apiKeyAuth, (req, res) => {
  clearCache();
  res.json({
    message: 'Cache cleared successfully',
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

app.listen(PORT, () => {
  console.log(`🚦 Traffic API MVP running on port ${PORT}`);
  console.log(`📖 API Documentation: http://localhost:${PORT}/`);
  console.log(`🔑 Demo API Key: demo-key-free`);
});
