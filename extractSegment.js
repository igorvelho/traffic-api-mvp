/**
 * LLM-powered segment extraction module for traffic data
 * Extracts structured location/segment information from raw traffic descriptions
 * 
 * Supports multiple LLM providers: Gemini (default), OpenAI, Moonshot/Kimi
 * Configure via environment variables:
 *   - LLM_PROVIDER: 'gemini', 'openai', 'kimi' (default: 'gemini')
 *   - LLM_API_KEY: Your API key for the selected provider
 *   - LLM_MODEL: Model name (optional, uses provider defaults)
 */

const axios = require('axios');

// Simple in-memory cache for LLM responses
// TTL: 5 minutes (300000 ms)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

// Provider configurations
const PROVIDER_CONFIGS = {
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    defaultModel: 'gemini-3-flash-preview',
    authType: 'query', // API key in query param
    buildRequest: (prompt, model) => ({
      url: `/${model}:generateContent`,
      data: {
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json'
        }
      }
    }),
    parseResponse: (response) => {
      const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Invalid Gemini response format');
      return text;
    }
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    authType: 'header', // API key in Authorization header
    buildRequest: (prompt, model) => ({
      url: '/chat/completions',
      data: {
        model: model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 500
      }
    }),
    parseResponse: (response) => {
      const text = response.data?.choices?.[0]?.message?.content;
      if (!text) throw new Error('Invalid OpenAI response format');
      return text;
    }
  },
  kimi: {
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    authType: 'header',
    buildRequest: (prompt, model) => ({
      url: '/chat/completions',
      data: {
        model: model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 500
      }
    }),
    parseResponse: (response) => {
      const text = response.data?.choices?.[0]?.message?.content;
      if (!text) throw new Error('Invalid Kimi response format');
      return text;
    }
  }
};

/**
 * Get LLM configuration from environment
 */
function getLLMConfig() {
  const provider = process.env.LLM_PROVIDER?.toLowerCase() || 'gemini';
  const apiKey = process.env.LLM_API_KEY;
  
  if (!apiKey) {
    return { enabled: false, provider, error: 'LLM_API_KEY not set' };
  }
  
  if (!PROVIDER_CONFIGS[provider]) {
    return { enabled: false, provider, error: `Unknown provider: ${provider}` };
  }
  
  const config = PROVIDER_CONFIGS[provider];
  const model = process.env.LLM_MODEL || config.defaultModel;
  
  return {
    enabled: true,
    provider,
    apiKey,
    model,
    baseUrl: config.baseUrl,
    config
  };
}

/**
 * Generate cache key from input data
 */
function getCacheKey(data) {
  const str = typeof data === 'string' ? data : JSON.stringify(data);
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

The data contains traffic information from a road monitoring system. Your task is to:
1. Identify the road name (e.g., "M1", "M50", "A1")
2. Determine the direction of travel (Northbound, Southbound, Eastbound, Westbound)
3. Describe the specific road segment or junction area if coordinates are provided
4. Identify any nearby landmarks, cities, or notable locations
5. Note the congestion level (none, light, moderate, heavy, severe)
6. Include speed information if available
7. Identify incident types (collision, breakdown, roadworks, etc.)

For coordinates (lat/lon):
- Use your knowledge of geography to identify the nearest major city, town, or landmark
- Estimate the closest motorway junction or exit if applicable
- Provide context about the location (e.g., "near Milton Keynes", "south of Dublin")

Traffic Data:
${dataStr}

Return ONLY a valid JSON object with these fields:
{
  "road": "road name like M1, M50, A1",
  "direction": "Northbound/Southbound/Eastbound/Westbound or null",
  "segment": "description of junction or road segment, or null",
  "landmark": "nearby city, town, or landmark, or null",
  "congestion": "none/light/moderate/heavy/severe or null",
  "speed": "speed with units or null",
  "incidentType": "type of incident or null"
}

Respond with ONLY the JSON object, no markdown, no explanation, no code blocks.`;
}

/**
 * Call LLM API with configured provider
 */
async function callLLM(prompt) {
  const llmConfig = getLLMConfig();
  const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';
  
  if (!llmConfig.enabled) {
    throw new Error(`LLM not configured: ${llmConfig.error}`);
  }
  
  const { provider, apiKey, model, baseUrl, config } = llmConfig;
  const request = config.buildRequest(prompt, model);
  
  // Build request configuration
  const axiosConfig = {
    method: 'POST',
    url: `${baseUrl}${request.url}`,
    data: request.data,
    timeout: 30000 // 30 second timeout
  };
  
  // Add authentication
  if (config.authType === 'query') {
    // For Gemini, API key goes in query param
    const separator = request.url.includes('?') ? '&' : '?';
    axiosConfig.url = `${axiosConfig.url}${separator}key=${apiKey}`;
  } else {
    // For OpenAI and Kimi, API key goes in header
    axiosConfig.headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };
  }
  
  // Debug logging
  if (DEBUG) {
    console.log('[DEBUG] LLM Request:');
    console.log('[DEBUG] Provider:', provider);
    console.log('[DEBUG] Model:', model);
    console.log('[DEBUG] URL:', axiosConfig.url);
    console.log('[DEBUG] Request body:', JSON.stringify(request.data, null, 2));
  }
  
  console.log(`Calling ${provider} LLM API...`);
  const startTime = Date.now();
  
  try {
    const response = await axios(axiosConfig);
    const duration = Date.now() - startTime;
    console.log(`LLM call completed in ${duration}ms`);
    
    // Debug logging
    if (DEBUG) {
      console.log('[DEBUG] LLM Response:');
      console.log('[DEBUG] Status:', response.status);
      console.log('[DEBUG] Response data:', JSON.stringify(response.data, null, 2));
    }
    
    const text = config.parseResponse(response);
    
    if (DEBUG) {
      console.log('[DEBUG] Parsed text:', text.substring(0, 500));
    }
    
    return text;
  } catch (error) {
    const duration = Date.now() - startTime;
    
    // Debug logging for errors
    if (DEBUG) {
      console.log('[DEBUG] LLM Error:');
      console.log('[DEBUG] Duration:', duration, 'ms');
      if (error.response) {
        console.log('[DEBUG] Status:', error.response.status);
        console.log('[DEBUG] Error data:', JSON.stringify(error.response.data, null, 2));
      } else {
        console.log('[DEBUG] Error:', error.message);
      }
    }
    
    if (error.response) {
      // API returned an error response
      const status = error.response.status;
      const errorData = error.response.data;
      
      if (status === 401 || status === 403) {
        throw new Error(`LLM API authentication failed: Invalid API key for ${provider}`);
      } else if (status === 429) {
        throw new Error(`LLM API rate limit exceeded for ${provider}`);
      } else {
        throw new Error(`LLM API error (${status}): ${JSON.stringify(errorData)}`);
      }
    } else if (error.code === 'ECONNABORTED') {
      throw new Error(`LLM API timeout after 30s`);
    } else {
      throw new Error(`LLM API call failed: ${error.message}`);
    }
  }
}

/**
 * Parse LLM response into structured object
 * Handles complete JSON, partial JSON, and extracts whatever is available
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
    
    // Try to parse complete JSON first
    try {
      const parsed = JSON.parse(jsonStr);
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
    } catch (parseError) {
      // If JSON is incomplete/truncated, try to extract partial data
      console.log('JSON parse failed, attempting partial extraction...');
      
      const extracted = {
        road: extractField(jsonStr, 'road'),
        direction: extractField(jsonStr, 'direction'),
        segment: extractField(jsonStr, 'segment'),
        landmark: extractField(jsonStr, 'landmark'),
        congestion: extractField(jsonStr, 'congestion'),
        speed: extractField(jsonStr, 'speed'),
        incidentType: extractField(jsonStr, 'incidentType'),
        rawExtracted: true,
        partial: true
      };
      
      // Only return if we got at least one field
      if (Object.values(extracted).some(v => v !== null && v !== true && v !== false)) {
        return extracted;
      }
      
      throw parseError;
    }
  } catch (error) {
    console.error('Failed to parse LLM response:', error.message);
    console.log('Raw response:', response.substring(0, 500));
    return null;
  }
}

/**
 * Extract a field value from partial/incomplete JSON string
 */
function extractField(jsonStr, fieldName) {
  const regex = new RegExp(`"${fieldName}"\\s*:\\s*(?:"([^"]*)"|(null|true|false)|(-?\\d+(?:\\.\\d+)?))`, 'i');
  const match = jsonStr.match(regex);
  
  if (!match) return null;
  
  // Return string value, boolean, number, or null
  if (match[1] !== undefined) return match[1]; // String value
  if (match[2] !== undefined) {
    if (match[2] === 'null') return null;
    if (match[2] === 'true') return true;
    if (match[2] === 'false') return false;
  }
  if (match[3] !== undefined) return parseFloat(match[3]); // Number
  
  return null;
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
      throw new Error('Failed to extract segment data from LLM response');
    }
    
    // Generate human-readable summary
    const humanReadable = generateHumanReadable(extracted, trafficData);
    
    const result = {
      ...extracted,
      humanReadable,
      cached: false,
      llmProvider: getLLMConfig().provider
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
    console.error('LLM segment extraction failed:', error.message);
    
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
 * Uses simple pattern matching without hardcoded coordinates
 */
function createFallbackResult(trafficData) {
  if (typeof trafficData === 'string') {
    // Try to extract basic info from text using patterns
    const roadMatch = trafficData.match(/\b(M\d+|N\d+|A\d+|E\d+|R\d+)\b/i);
    const directionMatch = trafficData.match(/\b(Northbound|Southbound|Eastbound|Westbound|North|South|East|West)\b/i);
    const congestionMatch = trafficData.match(/\b(none|light|moderate|heavy|severe)\s+(traffic|congestion)\b/i);
    const incidentMatch = trafficData.match(/\b(collision|crash|accident|breakdown|roadworks|construction|incident)\b/i);
    // Better speed pattern: look for speed: or at before the number, or km/h/mph after
    const speedMatch = trafficData.match(/(?:speed[:\s]+|at\s+)(\d+)\s*(km\/h|mph|kph)?/i) || 
                       trafficData.match(/(\d+)\s*(km\/h|mph|kph)/i);
    
    const extracted = {
      road: roadMatch ? roadMatch[1].toUpperCase() : null,
      direction: directionMatch ? directionMatch[1] : null,
      segment: null,
      landmark: null,
      congestion: congestionMatch ? congestionMatch[1] : null,
      speed: speedMatch ? `${speedMatch[1]} ${speedMatch[2] || 'km/h'}` : null,
      incidentType: incidentMatch ? incidentMatch[1] : null,
      rawExtracted: false
    };
    
    return {
      ...extracted,
      humanReadable: generateHumanReadable(extracted, trafficData)
    };
  }
  
  // Extract from object
  const lat = trafficData.location?.lat || trafficData.lat;
  const lon = trafficData.location?.lon || trafficData.lon;
  
  const extracted = {
    road: trafficData.road || null,
    direction: trafficData.direction || null,
    segment: lat && lon ? `Coordinates: ${lat.toFixed(3)}, ${lon.toFixed(3)}` : null,
    landmark: null,
    congestion: trafficData.congestionLevel || trafficData.congestion || null,
    speed: trafficData.averageSpeed ? `${trafficData.averageSpeed} km/h` : null,
    incidentType: trafficData.incidentType || null,
    rawExtracted: false
  };
  
  return {
    ...extracted,
    humanReadable: generateHumanReadable(extracted, trafficData)
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
  cleanCache(); // Clean before reporting
  return {
    size: cache.size,
    entries: Array.from(cache.keys()).slice(0, 10) // Limit to first 10 for readability
  };
}

/**
 * Clear the cache
 */
function clearCache() {
  cache.clear();
  console.log('Segment extraction cache cleared');
}

/**
 * Get LLM configuration status
 */
function getLLMStatus() {
  const config = getLLMConfig();
  return {
    enabled: config.enabled,
    provider: config.provider,
    model: config.model,
    error: config.error || null
  };
}

module.exports = {
  extractSegment,
  extractSegmentsBatch,
  getCacheStats,
  clearCache,
  getLLMStatus
};
