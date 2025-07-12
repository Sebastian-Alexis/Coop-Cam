import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { shouldIgnorePixel, calculateIgnoredPixelCount } from './motionDetectionUtils.js';

/**
 * Shadow removal utilities for motion detection
 * Uses illumination normalization and ratio-based comparison
 */

/**
 * Normalize illumination in a grayscale image to reduce shadow effects
 * @param {Buffer} buffer - Raw grayscale pixel buffer
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {number} intensity - Normalization intensity (0.0-1.0)
 * @returns {Promise<Buffer>} Normalized pixel buffer
 */
export async function normalizeIllumination(buffer, width, height, intensity = 0.7) {
  try {
    //use sharp's pipeline for efficient processing
    const normalized = await sharp(buffer, {
      raw: {
        width,
        height,
        channels: 1
      }
    })
      //normalize histogram to reduce extreme shadows
      .normalise({ 
        lower: 2,  //clip bottom 2% of pixels
        upper: 98  //clip top 2% of pixels
      })
      //apply linear transformation to boost contrast
      .linear(
        1.0 + (0.3 * intensity),  //contrast multiplier
        -15 * intensity           //brightness offset
      )
      //apply slight median filter to reduce noise
      .median(3)
      .raw()
      .toBuffer();
    
    return normalized;
  } catch (error) {
    console.error('[ShadowRemoval] Error normalizing illumination:', error);
    //return original buffer on error
    return buffer;
  }
}

/**
 * Calculate difference between frames with shadow awareness
 * Uses brightness ratios to distinguish shadows from actual motion
 * @param {Buffer} buffer1 - First frame buffer
 * @param {Buffer} buffer2 - Second frame buffer
 * @param {Object} options - Comparison options
 * @returns {Object} Comparison results with shadow statistics
 */
export function calculateShadowAwareDifference(buffer1, buffer2, options = {}) {
  const {
    baseThreshold = 25,      //base pixel difference threshold
    shadowThreshold = 40,    //threshold for shadow regions
    shadowRatioMin = 0.3,    //minimum ratio to consider as shadow
    shadowRatioMax = 0.8,    //maximum ratio to consider as shadow
    adaptiveThreshold = true, //use adaptive thresholds
    width = 100,             //frame width for Y-coordinate calculation
    ignoredRanges = []       //Y-coordinate ranges to ignore
  } = options;

  let changedPixels = 0;
  let shadowPixels = 0;
  let totalDifference = 0;
  const length = buffer1.length;
  
  //calculate average brightness for adaptive thresholding
  let avgBrightness1 = 0;
  let avgBrightness2 = 0;
  
  //calculate ignored pixel count
  const ignoredPixelCount = calculateIgnoredPixelCount(width, length / width, ignoredRanges);
  const effectivePixelCount = length - ignoredPixelCount;
  
  if (adaptiveThreshold) {
    let nonIgnoredPixelCount = 0;
    for (let i = 0; i < length; i++) {
      //skip ignored pixels for brightness calculation
      if (shouldIgnorePixel(i, width, ignoredRanges)) {
        continue;
      }
      avgBrightness1 += buffer1[i];
      avgBrightness2 += buffer2[i];
      nonIgnoredPixelCount++;
    }
    if (nonIgnoredPixelCount > 0) {
      avgBrightness1 /= nonIgnoredPixelCount;
      avgBrightness2 /= nonIgnoredPixelCount;
    }
  }
  
  //adaptive threshold based on scene brightness
  const sceneBrightness = (avgBrightness1 + avgBrightness2) / 2;
  const brightnessMultiplier = adaptiveThreshold ? 
    Math.max(0.5, Math.min(1.5, sceneBrightness / 128)) : 1.0;
  
  //process each pixel
  for (let i = 0; i < length; i++) {
    //skip pixels in ignored Y ranges
    if (shouldIgnorePixel(i, width, ignoredRanges)) {
      continue;
    }
    
    const val1 = buffer1[i];
    const val2 = buffer2[i];
    
    //calculate brightness ratio (avoid division by zero)
    const ratio = val2 / (val1 + 10);
    
    //detect if this is likely a shadow
    const isShadow = ratio > shadowRatioMin && ratio < shadowRatioMax;
    
    //adjust threshold based on shadow detection and scene brightness
    const threshold = isShadow ? 
      shadowThreshold * brightnessMultiplier : 
      baseThreshold * brightnessMultiplier;
    
    const pixelDiff = Math.abs(val1 - val2);
    totalDifference += pixelDiff;
    
    if (pixelDiff > threshold) {
      changedPixels++;
      if (isShadow) {
        shadowPixels++;
      }
    }
  }
  
  return {
    changedPixels,
    shadowPixels,
    nonShadowPixels: changedPixels - shadowPixels,
    totalPixels: length,
    effectivePixels: effectivePixelCount,
    normalizedDifference: effectivePixelCount > 0 ? changedPixels / effectivePixelCount : 0,
    shadowRatio: shadowPixels / changedPixels || 0,
    avgDifference: effectivePixelCount > 0 ? totalDifference / effectivePixelCount : 0,
    sceneBrightness: adaptiveThreshold ? sceneBrightness : null,
    ignoredPixels: ignoredPixelCount
  };
}

/**
 * Save debug frame for analysis
 * @param {Buffer} buffer - Raw pixel buffer
 * @param {Object} metadata - Frame metadata
 * @param {string} debugPath - Directory to save debug frames
 */
export async function saveDebugFrame(buffer, metadata, debugPath) {
  const {
    width,
    height,
    type,
    timestamp = Date.now()
  } = metadata;
  
  try {
    //ensure debug directory exists
    await fs.mkdir(debugPath, { recursive: true });
    
    const filename = `debug_${type}_${timestamp}.jpg`;
    const filepath = path.join(debugPath, filename);
    
    await sharp(buffer, {
      raw: {
        width,
        height,
        channels: 1
      }
    })
      .jpeg({ quality: 90 })
      .toFile(filepath);
    
    console.log(`[ShadowRemoval] Debug frame saved: ${filename}`);
  } catch (error) {
    console.error('[ShadowRemoval] Error saving debug frame:', error);
  }
}

/**
 * Get time-based threshold profile for outdoor lighting conditions
 * @param {Date} date - Current date/time
 * @returns {Object} Threshold configuration
 */
export function getTimeBasedThresholds(date = new Date()) {
  const hour = date.getHours();
  
  //threshold profiles for different times of day
  const profiles = {
    dawn: { base: 30, shadow: 50, hours: [5, 6, 7] },
    morning: { base: 25, shadow: 40, hours: [8, 9, 10] },
    noon: { base: 20, shadow: 35, hours: [11, 12, 13] },
    afternoon: { base: 25, shadow: 40, hours: [14, 15, 16] },
    dusk: { base: 30, shadow: 50, hours: [17, 18, 19] },
    night: { base: 35, shadow: 55, hours: [20, 21, 22, 23, 0, 1, 2, 3, 4] }
  };
  
  //find matching profile
  for (const [period, profile] of Object.entries(profiles)) {
    if (profile.hours.includes(hour)) {
      return {
        period,
        baseThreshold: profile.base,
        shadowThreshold: profile.shadow
      };
    }
  }
  
  //default profile
  return {
    period: 'default',
    baseThreshold: 25,
    shadowThreshold: 40
  };
}