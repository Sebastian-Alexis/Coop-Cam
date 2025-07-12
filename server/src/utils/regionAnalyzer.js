/**
 * Multi-Region Frame Analysis
 * Divides frames into grid regions for independent motion detection
 * Helps identify localized motion vs. widespread shadow movement
 */

import { isYCoordinateIgnored } from './motionDetectionUtils.js';
import { config } from '../config.js';

/**
 * Represents a single region in the analysis grid
 */
class Region {
  constructor(x, y, width, height, index) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.index = index;
    
    //motion statistics
    this.motionHistory = [];
    this.shadowFrequency = 0;
    this.lastMotionTime = 0;
    this.isActive = false;
  }

  /**
   * Update region with motion data
   */
  updateMotion(hasMotion, isShadow, timestamp) {
    this.motionHistory.push({
      hasMotion,
      isShadow,
      timestamp
    });
    
    //keep only recent history (last 10 frames)
    if (this.motionHistory.length > 10) {
      this.motionHistory.shift();
    }
    
    //update shadow frequency
    if (isShadow) {
      this.shadowFrequency = Math.min(1, this.shadowFrequency + 0.1);
    } else {
      this.shadowFrequency = Math.max(0, this.shadowFrequency - 0.05);
    }
    
    if (hasMotion) {
      this.lastMotionTime = timestamp;
      this.isActive = true;
    }
  }

  /**
   * Get region weight based on historical data
   * Regions with frequent shadows get lower weight
   */
  getWeight() {
    return Math.max(0.1, 1 - this.shadowFrequency);
  }

  /**
   * Check if region has recent motion
   */
  hasRecentMotion(currentTime, threshold = 5000) {
    return currentTime - this.lastMotionTime < threshold;
  }
}

/**
 * Main region analyzer class
 */
export class RegionAnalyzer {
  constructor(options = {}) {
    this.frameWidth = options.width || 100;
    this.frameHeight = options.height || 100;
    this.gridSize = options.gridSize || 4;
    this.enabled = options.enabled !== false;
    
    //calculate region dimensions
    this.regionWidth = Math.floor(this.frameWidth / this.gridSize);
    this.regionHeight = Math.floor(this.frameHeight / this.gridSize);
    
    //initialize regions
    this.regions = [];
    this.initializeRegions();
    
    //configuration
    this.motionThreshold = options.motionThreshold || 0.05;
    this.minActiveRegions = options.minActiveRegions || 2;
    this.shadowRegionThreshold = options.shadowRegionThreshold || 0.6;
  }

  /**
   * Initialize the region grid
   */
  initializeRegions() {
    let index = 0;
    for (let row = 0; row < this.gridSize; row++) {
      for (let col = 0; col < this.gridSize; col++) {
        const x = col * this.regionWidth;
        const y = row * this.regionHeight;
        const region = new Region(
          x, y, 
          this.regionWidth, 
          this.regionHeight, 
          index++
        );
        this.regions.push(region);
      }
    }
    
    console.log(`[RegionAnalyzer] Initialized ${this.regions.length} regions (${this.gridSize}x${this.gridSize} grid)`);
  }

  /**
   * Analyze a frame divided into regions
   * @param {Buffer} currentFrame - Current frame buffer
   * @param {Buffer} previousFrame - Previous frame buffer
   * @param {Object} shadowData - Shadow detection data from Phase 1
   * @returns {Object} Regional analysis results
   */
  analyzeRegions(currentFrame, previousFrame, shadowData = {}) {
    if (!this.enabled || !previousFrame) {
      return { 
        regionsAnalyzed: false,
        activeRegions: 0,
        motionDetected: false
      };
    }

    const timestamp = Date.now();
    const regionResults = [];
    let activeRegionCount = 0;
    let shadowRegionCount = 0;
    
    //analyze each region
    for (const region of this.regions) {
      const result = this.analyzeRegion(
        region, 
        currentFrame, 
        previousFrame,
        shadowData
      );
      
      regionResults.push(result);
      
      if (result.hasMotion) {
        activeRegionCount++;
        if (result.isShadow) {
          shadowRegionCount++;
        }
      }
      
      //update region statistics
      region.updateMotion(
        result.hasMotion, 
        result.isShadow, 
        timestamp
      );
    }

    //determine overall motion based on regional voting
    const motionDecision = this.makeMotionDecision(
      regionResults, 
      activeRegionCount, 
      shadowRegionCount
    );

    return {
      regionsAnalyzed: true,
      totalRegions: this.regions.length,
      activeRegions: activeRegionCount,
      shadowRegions: shadowRegionCount,
      motionDetected: motionDecision.detected,
      confidence: motionDecision.confidence,
      regionResults,
      analysis: {
        gridSize: `${this.gridSize}x${this.gridSize}`,
        regionDimensions: `${this.regionWidth}x${this.regionHeight}`,
        shadowDominant: shadowRegionCount > activeRegionCount * this.shadowRegionThreshold
      }
    };
  }

  /**
   * Analyze a single region
   */
  analyzeRegion(region, currentFrame, previousFrame, shadowData) {
    let changedPixels = 0;
    let totalPixels = 0;
    const ignoredRanges = config.motionDetection.ignoredYRanges;
    
    //analyze pixels within the region
    for (let y = region.y; y < region.y + region.height; y++) {
      //skip Y coordinates in ignored ranges
      if (isYCoordinateIgnored(y, ignoredRanges)) {
        continue;
      }
      
      for (let x = region.x; x < region.x + region.width; x++) {
        if (x < this.frameWidth && y < this.frameHeight) {
          const idx = y * this.frameWidth + x;
          const diff = Math.abs(currentFrame[idx] - previousFrame[idx]);
          
          if (diff > 25) { //use base threshold
            changedPixels++;
          }
          totalPixels++;
        }
      }
    }
    
    const changeRatio = totalPixels > 0 ? changedPixels / totalPixels : 0;
    const hasMotion = changeRatio > this.motionThreshold;
    
    //determine if this is likely a shadow region
    const isShadow = this.isShadowRegion(
      region, 
      changeRatio, 
      shadowData
    );
    
    return {
      regionIndex: region.index,
      hasMotion,
      isShadow,
      changeRatio,
      changedPixels,
      weight: region.getWeight()
    };
  }

  /**
   * Determine if a region contains shadow movement
   */
  isShadowRegion(region, changeRatio, shadowData) {
    //check historical shadow frequency
    if (region.shadowFrequency > 0.5) {
      return true;
    }
    
    //check if region matches shadow patterns
    if (shadowData.shadowRatio && shadowData.shadowRatio > 0.6) {
      //edges more likely to have shadows
      const isEdgeRegion = 
        region.x === 0 || 
        region.y === 0 || 
        region.x + region.width >= this.frameWidth ||
        region.y + region.height >= this.frameHeight;
      
      if (isEdgeRegion && changeRatio > 0.03) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Make final motion decision based on regional voting
   */
  makeMotionDecision(regionResults, activeRegions, shadowRegions) {
    //filter out shadow-dominated regions
    const nonShadowRegions = regionResults.filter(r => 
      r.hasMotion && !r.isShadow
    );
    
    //weighted voting
    let totalWeight = 0;
    let motionWeight = 0;
    
    for (const result of regionResults) {
      const weight = this.regions[result.regionIndex].getWeight();
      totalWeight += weight;
      
      if (result.hasMotion && !result.isShadow) {
        motionWeight += weight * result.changeRatio;
      }
    }
    
    const weightedMotion = totalWeight > 0 ? motionWeight / totalWeight : 0;
    
    //decision criteria
    const detected = 
      nonShadowRegions.length >= this.minActiveRegions ||
      (weightedMotion > this.motionThreshold && shadowRegions < activeRegions);
    
    //calculate confidence
    let confidence = 0;
    if (detected) {
      confidence = Math.min(1, nonShadowRegions.length / this.minActiveRegions);
      confidence *= (1 - shadowRegions / Math.max(activeRegions, 1));
    }
    
    return {
      detected,
      confidence,
      weightedMotion,
      criteria: {
        nonShadowRegions: nonShadowRegions.length,
        minRequired: this.minActiveRegions,
        weightedMotion,
        threshold: this.motionThreshold
      }
    };
  }

  /**
   * Get region at specific coordinates
   */
  getRegionAt(x, y) {
    const col = Math.floor(x / this.regionWidth);
    const row = Math.floor(y / this.regionHeight);
    const index = row * this.gridSize + col;
    
    return this.regions[index] || null;
  }

  /**
   * Get summary of region analysis
   */
  getSummary() {
    const activeRegions = this.regions.filter(r => r.isActive).length;
    const shadowyRegions = this.regions.filter(r => r.shadowFrequency > 0.5).length;
    
    return {
      enabled: this.enabled,
      gridSize: `${this.gridSize}x${this.gridSize}`,
      totalRegions: this.regions.length,
      activeRegions,
      shadowyRegions,
      regionDimensions: `${this.regionWidth}x${this.regionHeight}px`
    };
  }

  /**
   * Reset all region statistics
   */
  reset() {
    for (const region of this.regions) {
      region.motionHistory = [];
      region.shadowFrequency = 0;
      region.lastMotionTime = 0;
      region.isActive = false;
    }
  }
}

export default RegionAnalyzer;