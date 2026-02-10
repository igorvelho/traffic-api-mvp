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
 * Call Kimi LLM via OpenClaw CLI
 */
async function callLLM(prompt) {
  try {
    // Escape the prompt for shell command
    const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n');
    
    // Call Kimi via openclaw CLI with low thinking mode for speed
    const command = `openclaw ask --model moonshot/kimi-k2.5 --reasoning off "${escapedPrompt}"`;
    
    const { stdout, stderr } = await execAsync(command, { timeout: 15000 });
    
    if (stderr && !stdout) {
      throw new Error(`LLM error: ${stderr}`);
    }
    
    return stdout.trim();
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
 * Create fallback result when LLM fails
 */
function createFallbackResult(trafficData) {
  if (typeof trafficData === 'string') {
    // Try to extract basic info from text
    const roadMatch = trafficData.match(/\b(M\d+|N\d+|A\d+)\b/i);
    const directionMatch = trafficData.match(/\b(Northbound|Southbound|Eastbound|Westbound)\b/i);
    
    return {
      road: roadMatch ? roadMatch[1].toUpperCase() : null,
      direction: directionMatch ? directionMatch[1] : null,
      segment: null,
      landmark: null,
      congestion: null,
      speed: null,
      incidentType: null,
      humanReadable: trafficData.substring(0, 100),
      rawExtracted: false
    };
  }
  
  // Extract from object
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