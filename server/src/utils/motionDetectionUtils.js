/**
 * Utility functions for motion detection
 */

/**
 * Check if a pixel at the given index should be ignored based on Y-coordinate ranges
 * @param {number} index - Linear buffer index of the pixel
 * @param {number} width - Frame width
 * @param {Array} ignoredRanges - Array of {start, end} objects defining Y ranges to ignore
 * @returns {boolean} True if the pixel should be ignored
 */
export function shouldIgnorePixel(index, width, ignoredRanges) {
  if (!ignoredRanges || ignoredRanges.length === 0) {
    return false;
  }
  
  //convert linear index to Y coordinate
  const y = Math.floor(index / width);
  
  //check if Y is within any ignored range
  for (const range of ignoredRanges) {
    if (y >= range.start && y <= range.end) {
      return true;
    }
  }
  
  return false;
}

/**
 * Calculate the total number of pixels that should be ignored in a frame
 * @param {number} width - Frame width
 * @param {number} height - Frame height
 * @param {Array} ignoredRanges - Array of {start, end} objects defining Y ranges to ignore
 * @returns {number} Total number of ignored pixels
 */
export function calculateIgnoredPixelCount(width, height, ignoredRanges) {
  if (!ignoredRanges || ignoredRanges.length === 0) {
    return 0;
  }
  
  let ignoredCount = 0;
  
  for (const range of ignoredRanges) {
    //ensure range is within frame bounds
    const startY = Math.max(0, range.start);
    const endY = Math.min(height - 1, range.end);
    
    if (startY <= endY) {
      //number of rows in this range times the width
      ignoredCount += (endY - startY + 1) * width;
    }
  }
  
  return ignoredCount;
}

/**
 * Check if a Y coordinate is within any ignored range
 * @param {number} y - Y coordinate to check
 * @param {Array} ignoredRanges - Array of {start, end} objects defining Y ranges to ignore
 * @returns {boolean} True if the Y coordinate should be ignored
 */
export function isYCoordinateIgnored(y, ignoredRanges) {
  if (!ignoredRanges || ignoredRanges.length === 0) {
    return false;
  }
  
  for (const range of ignoredRanges) {
    if (y >= range.start && y <= range.end) {
      return true;
    }
  }
  
  return false;
}