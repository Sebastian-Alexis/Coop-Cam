import { describe, it, expect } from 'vitest';
import { 
  shouldIgnorePixel, 
  calculateIgnoredPixelCount,
  isYCoordinateIgnored 
} from '../utils/motionDetectionUtils.js';

describe('Motion Detection Utils', () => {
  describe('shouldIgnorePixel', () => {
    it('should return false when no ignored ranges are provided', () => {
      expect(shouldIgnorePixel(50, 100, [])).toBe(false);
      expect(shouldIgnorePixel(50, 100, null)).toBe(false);
      expect(shouldIgnorePixel(50, 100, undefined)).toBe(false);
    });

    it('should correctly identify pixels in ignored Y ranges', () => {
      const ignoredRanges = [
        { start: 0, end: 20 },    // top 21 pixels
        { start: 80, end: 99 }    // bottom 20 pixels
      ];
      const width = 100;

      // pixels in first ignored range (Y = 0-20)
      expect(shouldIgnorePixel(0, width, ignoredRanges)).toBe(true);     // Y=0
      expect(shouldIgnorePixel(1000, width, ignoredRanges)).toBe(true); // Y=10
      expect(shouldIgnorePixel(2000, width, ignoredRanges)).toBe(true); // Y=20

      // pixels outside ignored ranges (Y = 21-79)
      expect(shouldIgnorePixel(2100, width, ignoredRanges)).toBe(false); // Y=21
      expect(shouldIgnorePixel(5000, width, ignoredRanges)).toBe(false); // Y=50
      expect(shouldIgnorePixel(7900, width, ignoredRanges)).toBe(false); // Y=79

      // pixels in second ignored range (Y = 80-99)
      expect(shouldIgnorePixel(8000, width, ignoredRanges)).toBe(true);  // Y=80
      expect(shouldIgnorePixel(9000, width, ignoredRanges)).toBe(true);  // Y=90
      expect(shouldIgnorePixel(9900, width, ignoredRanges)).toBe(true);  // Y=99
    });
  });

  describe('calculateIgnoredPixelCount', () => {
    it('should return 0 when no ignored ranges are provided', () => {
      expect(calculateIgnoredPixelCount(100, 100, [])).toBe(0);
      expect(calculateIgnoredPixelCount(100, 100, null)).toBe(0);
      expect(calculateIgnoredPixelCount(100, 100, undefined)).toBe(0);
    });

    it('should calculate correct pixel count for single range', () => {
      const ignoredRanges = [{ start: 0, end: 9 }]; // 10 rows
      expect(calculateIgnoredPixelCount(100, 100, ignoredRanges)).toBe(1000); // 10 rows × 100 width
    });

    it('should calculate correct pixel count for multiple ranges', () => {
      const ignoredRanges = [
        { start: 0, end: 9 },    // 10 rows
        { start: 90, end: 99 }   // 10 rows
      ];
      expect(calculateIgnoredPixelCount(100, 100, ignoredRanges)).toBe(2000); // 20 rows × 100 width
    });

    it('should handle ranges outside frame bounds', () => {
      const ignoredRanges = [
        { start: -10, end: 9 },   // should clip to 0-9 (10 rows)
        { start: 90, end: 110 }   // should clip to 90-99 (10 rows)
      ];
      expect(calculateIgnoredPixelCount(100, 100, ignoredRanges)).toBe(2000);
    });

    it('should handle invalid ranges gracefully', () => {
      const ignoredRanges = [
        { start: 50, end: 40 },   // end < start, should be ignored
        { start: 0, end: 9 }      // valid range (10 rows)
      ];
      expect(calculateIgnoredPixelCount(100, 100, ignoredRanges)).toBe(1000);
    });
  });

  describe('isYCoordinateIgnored', () => {
    it('should return false when no ignored ranges are provided', () => {
      expect(isYCoordinateIgnored(50, [])).toBe(false);
      expect(isYCoordinateIgnored(50, null)).toBe(false);
      expect(isYCoordinateIgnored(50, undefined)).toBe(false);
    });

    it('should correctly identify Y coordinates in ignored ranges', () => {
      const ignoredRanges = [
        { start: 0, end: 20 },
        { start: 80, end: 99 }
      ];

      // in first range
      expect(isYCoordinateIgnored(0, ignoredRanges)).toBe(true);
      expect(isYCoordinateIgnored(10, ignoredRanges)).toBe(true);
      expect(isYCoordinateIgnored(20, ignoredRanges)).toBe(true);

      // outside ranges
      expect(isYCoordinateIgnored(21, ignoredRanges)).toBe(false);
      expect(isYCoordinateIgnored(50, ignoredRanges)).toBe(false);
      expect(isYCoordinateIgnored(79, ignoredRanges)).toBe(false);

      // in second range
      expect(isYCoordinateIgnored(80, ignoredRanges)).toBe(true);
      expect(isYCoordinateIgnored(90, ignoredRanges)).toBe(true);
      expect(isYCoordinateIgnored(99, ignoredRanges)).toBe(true);
    });

    it('should handle edge cases at range boundaries', () => {
      const ignoredRanges = [{ start: 10, end: 20 }];

      expect(isYCoordinateIgnored(9, ignoredRanges)).toBe(false);
      expect(isYCoordinateIgnored(10, ignoredRanges)).toBe(true);  // inclusive start
      expect(isYCoordinateIgnored(20, ignoredRanges)).toBe(true);  // inclusive end
      expect(isYCoordinateIgnored(21, ignoredRanges)).toBe(false);
    });
  });
});