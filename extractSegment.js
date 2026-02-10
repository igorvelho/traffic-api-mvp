/**
 * LLM-powered segment extraction module for traffic data
 * Extracts structured location/segment information from raw traffic descriptions
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Simple in-memory cache for LLM responses
// TTL: 5 minutes (300000 ms)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Generate cache key from input data
 */
function getCacheKey(data) {
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  // Simple hash for caching
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `segment_${hash}`;
}

/**
 * Clean expired cache entries
 */
function cleanCache() {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      cache.delete(key);
    }
  }
}

// Clean cache every minute
setInterval(cleanCache, 60000);

/**
 * Build the prompt for segment extraction
 */
function buildPrompt(trafficData) {
  const dataStr = typeof trafficData === 'string' 
    ? trafficData 
    : JSON.stringify(trafficData, null, 2);

  return `Extract structured traffic segment information from the following data. 
Return ONLY a valid JSON object with these fields:
- road: The road name (e.g., "M1", "M50", "N7")
- direction: Direction of travel (e.g., "Northbound", "Southbound", "Eastbound", "Westbound")
- segment: Description of the road segment (e.g., "J6 Balbriggan to J7 Drogheda", "between Junction 14 and 15")
- landmark: Specific landmarks or nearby locations if mentioned (e.g., "Near Balbriggan exit", "At Dublin Airport")
- congestion: Congestion level if mentioned (none, light, moderate, heavy, severe)
- speed: Speed information if available (with units)
- incidentType: Type of incident if mentioned (e.g., "collision", "breakdown", "roadworks")

Traffic Data:
${dataStr}

Respond with ONLY the JSON object, no markdown, no explanation.`;
}

/**
 * Call Kimi LLM via OpenClaw using sessions_spawn
 */
async function callLLM(prompt) {
  try {
    // For now, use a simple rule-based extraction as fallback
    // since we can't easily spawn sessions from within a running Node app
    // In production, this would call an LLM API endpoint
    console.log('LLM extraction not available in demo mode, using fallback...');
    throw new Error('LLM not configured - using fallback extraction');
  } catch (error) {
    console.error('LLM call failed:', error.message);
    throw error;
  }
}

/**
 * Parse LLM response into structured object
 */
function parseLLMResponse(response) {
  try {
    // Try to extract JSON from markdown code blocks if present
    let jsonStr = response;
    
    const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }
    
    // Remove any non-JSON text before/after
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
    
    const parsed = JSON.parse(jsonStr);
    
    // Validate required fields
    return {
      road: parsed.road || null,
      direction: parsed.direction || null,
      segment: parsed.segment || null,
      landmark: parsed.landmark || null,
      congestion: parsed.congestion || null,
      speed: parsed.speed || null,
      incidentType: parsed.incidentType || null,
      rawExtracted: true
    };
  } catch (error) {
    console.error('Failed to parse LLM response:', error.message);
    console.log('Raw response:', response);
    return null;
  }
}

/**
 * Generate human-readable summary from extracted data
 */
function generateHumanReadable(extracted, originalData) {
  const parts = [];
  
  if (extracted.road && extracted.direction) {
    parts.push(`${extracted.road} ${extracted.direction}`);
  } else if (extracted.road) {
    parts.push(extracted.road);
  }
  
  if (extracted.segment) {
    parts.push(`- ${extracted.segment}`);
  }
  
  if (extracted.landmark) {
    parts.push(`(${extracted.landmark})`);
  }
  
  if (extracted.congestion) {
    parts.push(`[${extracted.congestion} congestion]`);
  }
  
  if (extracted.speed) {
    parts.push(`at ${extracted.speed}`);
  }
  
  if (extracted.incidentType) {
    parts.push(`- ${extracted.incidentType}`);
  }
  
  return parts.join(' ') || 'Location information unavailable';
}

/**
 * Main extraction function
 * @param {Object|string} trafficData - Raw traffic data or text description
 * @param {Object} options - Extraction options
 * @returns {Promise<Object>} Extracted segment information
 */
async function extractSegment(trafficData, options = {}) {
  const { useCache = true, fallback = true } = options;
  
  // Check cache first
  const cacheKey = getCacheKey(trafficData);
  if (useCache && cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      console.log('Cache hit for segment extraction');
      return {
        ...cached.data,
        cached: true
      };
    }
  }
  
  try {
    const prompt = buildPrompt(trafficData);
    const llmResponse = await callLLM(prompt);
    const extracted = parseLLMResponse(llmResponse);
    
    if (!extracted) {
      throw new Error('Failed to extract segment data');
    }
    
    // Generate human-readable summary
    const humanReadable = generateHumanReadable(extracted, trafficData);
    
    const result = {
      ...extracted,
      humanReadable,
      cached: false
    };
    
    // Cache the result
    if (useCache) {
      cache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });
    }
    
    return result;
    
  } catch (error) {
    console.error('Segment extraction failed:', error.message);
    
    if (fallback) {
      // Return a fallback result with basic info
      const fallbackResult = createFallbackResult(trafficData);
      return {
        ...fallbackResult,
        extractionError: error.message,
        fallback: true
      };
    }
    
    throw error;
  }
}

/**
 * Simple coordinate-based segment lookup for M1 Ireland
 * Maps approximate coordinates to junctions/segments
 */
function getSegmentFromCoordinates(lat, lon, road) {
  // M1 Ireland approximate junction coordinates (south to north)
  const m1Segments = [
    { junction: 'J1', name: 'M50/M1 Interchange', lat: 53.4, lon: -6.25, segment: 'M50 Interchange area' },
    { junction: 'J2', name: 'Dublin Airport', lat: 53.42, lon: -6.24, segment: 'Dublin Airport area' },
    { junction: 'J3', name: 'Swords', lat: 53.45, lon: -6.22, segment: 'Swords area' },
    { junction: 'J4', name: 'Donabate', lat: 53.48, lon: -6.2, segment: 'Donabate area' },
    { junction: 'J5', name: 'Balbriggan', lat: 53.61, lon: -6.18, segment: 'Balbriggan area' },
    { junction: 'J6', name: 'Balbriggan North', lat: 53.63, lon: -6.17, segment: 'Balbriggan North area' },
    { junction: 'J7', name: 'Julianstown', lat: 53.67, lon: -6.28, segment: 'Julianstown area' },
    { junction: 'J8', name: 'Duleek', lat: 53.65, lon: -6.42, segment: 'Duleek area' },
    { junction: 'J9', name: 'Drogheda South', lat: 53.69, lon: -6.35, segment: 'Drogheda South area' },
    { junction: 'J10', name: 'Drogheda North', lat: 53.72, lon: -6.34, segment: 'Drogheda North area' },
    { junction: 'J11', name: 'Drogheda Bypass', lat: 53.74, lon: -6.33, segment: 'Drogheda Bypass area' },
    { junction: 'J12', name: 'Dunleer', lat: 53.78, lon: -6.32, segment: 'Dunleer area' },
    { junction: 'J14', name: 'Dundalk South', lat: 53.96, lon: -6.38, segment: 'Dundalk South area' },
    { junction: 'J16', name: 'Dundalk North', lat: 54.01, lon: -6.4, segment: 'Dundalk North area' }
  ];
  
  if (road !== 'M1') {
    return { segment: null, landmark: null };
  }
  
  // Find closest junction
  let closest = null;
  let minDistance = Infinity;
  
  for (const seg of m1Segments) {
    const distance = Math.sqrt(
      Math.pow(lat - seg.lat, 2) + Math.pow(lon - seg.lon, 2)
    );
    if (distance < minDistance) {
      minDistance = distance;
      closest = seg;
    }
  }
  
  // Only return if within reasonable distance (0.5 degrees ~ 50km)
  if (closest && minDistance < 0.5) {
    return {
      segment: `${closest.junction} ${closest.name}`,
      landmark: closest.segment
    };
  }
  
  return { segment: null, landmark: null };
}

/**
 * Create fallback result when LLM fails
 */
function createFallbackResult(trafficData) {
  if (typeof trafficData === 'string') {
    // Try to extract basic info from text
    const roadMatch = trafficData.match(/\b(M\d+|N\d+|A\d+)\b/i);
    const directionMatch = trafficData.match(/\b(Northbound|Southbound|Eastbound|Westbound)\b/i);
    const congestionMatch = trafficData.match(/\b(none|light|moderate|heavy|severe)\s+(traffic|congestion)\b/i);
    const incidentMatch = trafficData.match(/\b(collision|crash|accident|breakdown|roadworks)\b/i);
    
    return {
      road: roadMatch ? roadMatch[1].toUpperCase() : null,
      direction: directionMatch ? directionMatch[1] : null,
      segment: null,
      landmark: null,
      congestion: congestionMatch ? congestionMatch[1] : null,
      speed: null,
      incidentType: incidentMatch ? incidentMatch[1] : null,
      humanReadable: trafficData.substring(0, 100),
      rawExtracted: false
    };
  }
  
  // Extract from object with coordinate-based segment lookup
  const lat = trafficData.location?.lat;
  const lon = trafficData.location?.lon;
  const road = trafficData.road;
  
  let segmentInfo = { segment: null, landmark: null };
  if (lat && lon && road) {
    segmentInfo = getSegmentFromCoordinates(lat, lon, road);
  }
  
  const congestion = trafficData.congestionLevel || trafficData.congestion;
  const speed = trafficData.averageSpeed;
  
  return {
    road: trafficData.road || null,
    direction: trafficData.direction || null,
    segment: trafficData.location ? `Lat: ${trafficData.location.lat}, Lon: ${trafficData.location.lon}` : null,
    landmark: null,
    congestion: trafficData.congestionLevel || null,
    speed: trafficData.averageSpeed ? `${trafficData.averageSpeed} km/h` : null,
    incidentType: null,
    humanReadable: `${trafficData.road || 'Unknown road'} ${trafficData.direction || ''}`.trim() || 'Location information unavailable',
    rawExtracted: false
  };
}

/**
 * Process multiple traffic records in parallel
 * @param {Array} records - Array of traffic data records
 * @param {Object} options - Extraction options
 * @returns {Promise<Array>} Records with extracted segment info
 */
async function extractSegmentsBatch(records, options = {}) {
  const results = await Promise.all(
    records.map(async (record) => {
      try {
        const extracted = await extractSegment(record, options);
        return {
          ...record,
          segment: extracted,
          humanReadable: extracted.humanReadable
        };
      } catch (error) {
        console.error('Failed to extract for record:', error.message);
        return {
          ...record,
          segment: null,
          humanReadable: 'Segment extraction failed',
          extractionError: error.message
        };
      }
    })
  );
  
  return results;
}

/**
 * Get cache statistics
 */
function getCacheStats() {
  return {
    size: cache.size,
    entries: Array.from(cache.keys())
  };
}

/**
 * Clear the cache
 */
function clearCache() {
  cache.clear();
  console.log('Segment extraction cache cleared');
}

module.exports = {
  extractSegment,
  extractSegmentsBatch,
  getCacheStats,
  clearCache
};