//color-aware shadow removal utilities
import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { shouldIgnorePixel, calculateIgnoredPixelCount } from './motionDetectionUtils.js';

/**
 * Normalize illumination in a color image to reduce shadow effects
 * Works on RGB channels while preserving color information
 */
export async function normalizeColorIllumination(buffer, width, height, intensity = 0.7) {
  try {
    //use sharp's pipeline for efficient processing
    const normalized = await sharp(buffer, {
      raw: {
        width,
        height,
        channels: 3
      }
    })
      //normalize histogram per channel to reduce extreme shadows
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
    console.error('[ColorShadowRemoval] Error normalizing illumination:', error);
    //return original buffer on error
    return buffer;
  }
}

/**
 * Calculate shadow-aware difference between two color frames
 * Uses ratio-based comparison to distinguish shadows from actual motion
 */
export function calculateColorShadowAwareDifference(currentBuffer, previousBuffer, options = {}) {
  const {
    baseThreshold = 30,
    shadowThreshold = 50,
    colorThreshold = 40,  //threshold for color channel differences
    width,
    ignoredRanges = []
  } = options;

  let changedPixels = 0;
  let shadowPixels = 0;
  const totalPixels = currentBuffer.length / 3; //RGB has 3 channels
  
  //process each pixel
  for (let i = 0; i < currentBuffer.length; i += 3) {
    const pixelIndex = i / 3;
    
    //skip pixels in ignored Y ranges
    if (shouldIgnorePixel(pixelIndex, width, ignoredRanges)) {
      continue;
    }
    
    //get RGB values
    const r1 = currentBuffer[i];
    const g1 = currentBuffer[i + 1];
    const b1 = currentBuffer[i + 2];
    
    const r2 = previousBuffer[i];
    const g2 = previousBuffer[i + 1];
    const b2 = previousBuffer[i + 2];
    
    //calculate luminance for shadow detection
    const lum1 = 0.299 * r1 + 0.587 * g1 + 0.114 * b1;
    const lum2 = 0.299 * r2 + 0.587 * g2 + 0.114 * b2;
    
    //calculate color differences
    const rDiff = Math.abs(r1 - r2);
    const gDiff = Math.abs(g1 - g2);
    const bDiff = Math.abs(b1 - b2);
    
    //calculate max color channel difference
    const maxColorDiff = Math.max(rDiff, gDiff, bDiff);
    
    //calculate hue change (more robust for shadow vs real object)
    const hueChange = calculateHueChange(r1, g1, b1, r2, g2, b2);
    
    //determine if it's likely a shadow
    const lumDiff = Math.abs(lum1 - lum2);
    const lumRatio = Math.min(lum1, lum2) / (Math.max(lum1, lum2) + 1);
    
    //shadow detection: significant luminance change but small hue change
    const isShadow = lumDiff > shadowThreshold && 
                     hueChange < 20 && 
                     lumRatio > 0.5;
    
    if (isShadow) {
      shadowPixels++;
    } else if (maxColorDiff > colorThreshold || lumDiff > baseThreshold) {
      changedPixels++;
    }
  }
  
  //calculate effective pixel count (excluding ignored ranges)
  const ignoredPixelCount = calculateIgnoredPixelCount(width, currentBuffer.length / (width * 3), ignoredRanges);
  const effectivePixelCount = totalPixels - ignoredPixelCount;
  
  return {
    changedPixels,
    shadowPixels,
    totalPixels,
    effectivePixelCount,
    normalizedDifference: effectivePixelCount > 0 ? changedPixels / effectivePixelCount : 0,
    shadowRatio: effectivePixelCount > 0 ? shadowPixels / effectivePixelCount : 0
  };
}

/**
 * Calculate hue change between two RGB colors
 * Returns degrees of hue change (0-180)
 */
function calculateHueChange(r1, g1, b1, r2, g2, b2) {
  const hue1 = rgbToHue(r1, g1, b1);
  const hue2 = rgbToHue(r2, g2, b2);
  
  //handle hue wraparound
  let hueDiff = Math.abs(hue1 - hue2);
  if (hueDiff > 180) {
    hueDiff = 360 - hueDiff;
  }
  
  return hueDiff;
}

/**
 * Convert RGB to hue (0-360 degrees)
 */
function rgbToHue(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const diff = max - min;
  
  if (diff === 0) return 0;
  
  let h;
  if (max === r) {
    h = ((g - b) / diff) % 6;
  } else if (max === g) {
    h = (b - r) / diff + 2;
  } else {
    h = (r - g) / diff + 4;
  }
  
  h *= 60;
  if (h < 0) h += 360;
  
  return h;
}

/**
 * Save debug frame for analysis (color version)
 */
export async function saveColorDebugFrame(buffer, metadata, debugPath) {
  try {
    const timestamp = metadata.timestamp || Date.now();
    const type = metadata.type || 'color_frame';
    const filename = `${type}_${timestamp}.jpg`;
    const filepath = path.join(debugPath, filename);
    
    //ensure debug directory exists
    await fs.mkdir(debugPath, { recursive: true });
    
    //save as JPEG for color visualization
    await sharp(buffer, {
      raw: {
        width: metadata.width,
        height: metadata.height,
        channels: 3
      }
    })
      .jpeg({ quality: 90 })
      .toFile(filepath);
    
    console.log(`[ColorDebug] Saved debug frame: ${filename}`);
  } catch (error) {
    console.error('[ColorDebug] Error saving debug frame:', error);
  }
}