/**
 * Detection Region Utilities
 * Helper functions for limiting motion detection to specific regions of the frame
 */

/**
 * Check if a Y coordinate is within the configured detection region
 * @param {number} y - Y coordinate (0 to height-1)
 * @param {number} height - Total frame height
 * @param {Object} regionConfig - Detection region configuration
 * @returns {boolean} True if pixel is in detection region
 */
export function isPixelInDetectionRegion(y, height, regionConfig) {
  if (!regionConfig || regionConfig.mode === 'full') {
    return true;
  }
  
  //convert pixel Y to percentage (0-100)
  const yPercent = (y / height) * 100;
  
  switch (regionConfig.mode) {
    case 'top_half':
      return yPercent < 50;
      
    case 'bottom_half':
      return yPercent >= 50;
      
    case 'custom':
      return yPercent >= regionConfig.yStart && yPercent < regionConfig.yEnd;
      
    default:
      return true; //default to full frame if unknown mode
  }
}

/**
 * Get the normalized bounds of the detection region
 * @param {Object} regionConfig - Detection region configuration
 * @returns {Object} Object with yStart and yEnd as percentages (0-100)
 */
export function getDetectionRegionBounds(regionConfig) {
  if (!regionConfig) {
    return { yStart: 0, yEnd: 100 };
  }
  
  switch (regionConfig.mode) {
    case 'top_half':
      return { yStart: 0, yEnd: 50 };
      
    case 'bottom_half':
      return { yStart: 50, yEnd: 100 };
      
    case 'custom':
      return { 
        yStart: regionConfig.yStart || 0, 
        yEnd: regionConfig.yEnd || 100 
      };
      
    case 'full':
    default:
      return { yStart: 0, yEnd: 100 };
  }
}

/**
 * Calculate the number of pixels within the detection region
 * @param {number} width - Frame width
 * @param {number} height - Frame height
 * @param {Object} regionConfig - Detection region configuration
 * @returns {number} Number of pixels in the detection region
 */
export function calculateActivePixelCount(width, height, regionConfig) {
  const bounds = getDetectionRegionBounds(regionConfig);
  
  //calculate pixel rows in the region
  const yStartPixel = Math.floor((bounds.yStart / 100) * height);
  const yEndPixel = Math.ceil((bounds.yEnd / 100) * height);
  const activeRows = yEndPixel - yStartPixel;
  
  return width * activeRows;
}

/**
 * Check if a buffer index is within the detection region
 * @param {number} index - Linear buffer index
 * @param {number} width - Frame width
 * @param {number} height - Frame height
 * @param {Object} regionConfig - Detection region configuration
 * @returns {boolean} True if pixel at index is in detection region
 */
export function isIndexInDetectionRegion(index, width, height, regionConfig) {
  const y = Math.floor(index / width);
  return isPixelInDetectionRegion(y, height, regionConfig);
}

/**
 * Get a human-readable description of the detection region
 * @param {Object} regionConfig - Detection region configuration
 * @returns {string} Description of the region
 */
export function getDetectionRegionDescription(regionConfig) {
  if (!regionConfig) {
    return 'Full frame';
  }
  
  switch (regionConfig.mode) {
    case 'top_half':
      return 'Top half only';
      
    case 'bottom_half':
      return 'Bottom half only';
      
    case 'custom':
      return `Custom region: Y ${regionConfig.yStart}% to ${regionConfig.yEnd}%`;
      
    case 'full':
    default:
      return 'Full frame';
  }
}

/**
 * Adjust a pixel count for the detection region
 * Used to normalize motion percentages when not analyzing the full frame
 * @param {number} changedPixels - Number of changed pixels
 * @param {number} totalPixels - Total pixels in full frame
 * @param {Object} regionConfig - Detection region configuration
 * @returns {Object} Object with adjusted counts and normalization factor
 */
export function adjustPixelCountsForRegion(changedPixels, totalPixels, regionConfig) {
  const bounds = getDetectionRegionBounds(regionConfig);
  const regionPercent = (bounds.yEnd - bounds.yStart) / 100;
  const pixelsInRegion = Math.floor(totalPixels * regionPercent);
  
  return {
    changedPixels,
    totalPixelsInRegion: pixelsInRegion,
    normalizedDifference: changedPixels / pixelsInRegion,
    regionCoverage: regionPercent
  };
}

/**
 * Check if a region (from RegionAnalyzer) overlaps with the detection region
 * @param {Object} region - Region object with x, y, width, height
 * @param {number} frameHeight - Total frame height
 * @param {Object} regionConfig - Detection region configuration
 * @returns {boolean} True if region overlaps with detection region
 */
export function doesRegionOverlapDetection(region, frameHeight, regionConfig) {
  const bounds = getDetectionRegionBounds(regionConfig);
  
  //convert region Y coordinates to percentages
  const regionYStartPercent = (region.y / frameHeight) * 100;
  const regionYEndPercent = ((region.y + region.height) / frameHeight) * 100;
  
  //check for overlap
  return regionYEndPercent > bounds.yStart && regionYStartPercent < bounds.yEnd;
}

/**
 * Calculate what percentage of a region is within the detection area
 * @param {Object} region - Region object with x, y, width, height
 * @param {number} frameHeight - Total frame height
 * @param {Object} regionConfig - Detection region configuration
 * @returns {number} Percentage of region within detection area (0-1)
 */
export function calculateRegionOverlapPercentage(region, frameHeight, regionConfig) {
  const bounds = getDetectionRegionBounds(regionConfig);
  
  //convert to pixel coordinates
  const detectionYStart = (bounds.yStart / 100) * frameHeight;
  const detectionYEnd = (bounds.yEnd / 100) * frameHeight;
  
  const regionYStart = region.y;
  const regionYEnd = region.y + region.height;
  
  //calculate overlap
  const overlapStart = Math.max(regionYStart, detectionYStart);
  const overlapEnd = Math.min(regionYEnd, detectionYEnd);
  
  if (overlapEnd <= overlapStart) {
    return 0; //no overlap
  }
  
  const overlapHeight = overlapEnd - overlapStart;
  return overlapHeight / region.height;
}