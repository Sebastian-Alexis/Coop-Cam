//chicken-specific color detection utilities
import { config } from '../config.js';

//chicken color profiles in HSV space
//hue: 0-180, saturation: 0-255, value: 0-255
export const CHICKEN_COLOR_PROFILES = {
  white: {
    name: 'white',
    hsv: { 
      h: [0, 180],    //any hue (white is achromatic)
      s: [0, 30],     //very low saturation
      v: [200, 255]   //high brightness
    }
  },
  brown: {
    name: 'brown',
    hsv: {
      h: [10, 25],    //orange-brown hues
      s: [30, 150],   //medium saturation
      v: [50, 150]    //medium brightness
    }
  },
  orange: {
    name: 'orange',
    hsv: {
      h: [0, 20],     //red-orange hues
      s: [100, 255],  //high saturation
      v: [100, 255]   //medium-high brightness
    }
  },
  red: {
    name: 'red',     //for combs and wattles
    hsv: {
      h: [0, 10],     //red hues
      s: [150, 255],  //high saturation
      v: [100, 255]   //medium-high brightness
    }
  }
};

//convert RGB to HSV
export function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const diff = max - min;

  let h = 0;
  let s = max === 0 ? 0 : diff / max;
  let v = max;

  if (diff !== 0) {
    if (max === r) {
      h = ((g - b) / diff) % 6;
    } else if (max === g) {
      h = (b - r) / diff + 2;
    } else {
      h = (r - g) / diff + 4;
    }
    h *= 30; //convert to degrees / 2 (OpenCV convention)
    if (h < 0) h += 180;
  }

  return {
    h: Math.round(h),
    s: Math.round(s * 255),
    v: Math.round(v * 255)
  };
}

//check if HSV values match a color profile
export function matchesColorProfile(hsv, profile) {
  const { h, s, v } = hsv;
  const range = profile.hsv;

  //handle hue wraparound for red colors
  let hueMatch = false;
  if (range.h[0] <= range.h[1]) {
    hueMatch = h >= range.h[0] && h <= range.h[1];
  } else {
    //wraparound case (e.g., red: 170-180, 0-10)
    hueMatch = h >= range.h[0] || h <= range.h[1];
  }

  return hueMatch &&
         s >= range.s[0] && s <= range.s[1] &&
         v >= range.v[0] && v <= range.v[1];
}

//analyze a pixel buffer for chicken colors
export function analyzeChickenColors(buffer, width, height) {
  const colorCounts = {
    white: 0,
    brown: 0,
    orange: 0,
    red: 0,
    other: 0
  };

  //process each pixel (assuming RGB format)
  for (let i = 0; i < buffer.length; i += 3) {
    const r = buffer[i];
    const g = buffer[i + 1];
    const b = buffer[i + 2];

    const hsv = rgbToHsv(r, g, b);
    let matched = false;

    //check against each color profile
    for (const [colorName, profile] of Object.entries(CHICKEN_COLOR_PROFILES)) {
      if (matchesColorProfile(hsv, profile)) {
        colorCounts[colorName]++;
        matched = true;
        break;
      }
    }

    if (!matched) {
      colorCounts.other++;
    }
  }

  const totalPixels = buffer.length / 3;
  const chickenPixels = totalPixels - colorCounts.other;
  const chickenRatio = chickenPixels / totalPixels;

  return {
    colorCounts,
    totalPixels,
    chickenPixels,
    chickenRatio,
    dominantColor: Object.entries(colorCounts)
      .filter(([color]) => color !== 'other')
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'none'
  };
}

//blob detection for connected color regions
export class ColorBlobDetector {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }

  //detect blobs of chicken colors in RGB buffer
  detectChickenBlobs(buffer, minBlobSize = 50) {
    const labels = new Int32Array(this.width * this.height);
    const chickenMask = new Uint8Array(this.width * this.height);
    
    //create binary mask of chicken-colored pixels
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const idx = y * this.width + x;
        const bufferIdx = idx * 3;
        
        const r = buffer[bufferIdx];
        const g = buffer[bufferIdx + 1];
        const b = buffer[bufferIdx + 2];
        
        const hsv = rgbToHsv(r, g, b);
        
        //check if pixel matches any chicken color
        let isChickenColor = false;
        for (const profile of Object.values(CHICKEN_COLOR_PROFILES)) {
          if (matchesColorProfile(hsv, profile)) {
            isChickenColor = true;
            break;
          }
        }
        
        chickenMask[idx] = isChickenColor ? 1 : 0;
      }
    }

    //connected component labeling using 8-connectivity
    let nextLabel = 1;
    const equivalences = new Map();

    //first pass - assign labels
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const idx = y * this.width + x;
        
        if (chickenMask[idx] === 0) continue;

        const neighbors = [];
        
        //check 8 neighbors that have been processed
        if (y > 0) {
          if (x > 0 && labels[(y-1) * this.width + (x-1)] > 0) 
            neighbors.push(labels[(y-1) * this.width + (x-1)]);
          if (labels[(y-1) * this.width + x] > 0)
            neighbors.push(labels[(y-1) * this.width + x]);
          if (x < this.width - 1 && labels[(y-1) * this.width + (x+1)] > 0)
            neighbors.push(labels[(y-1) * this.width + (x+1)]);
        }
        if (x > 0 && labels[y * this.width + (x-1)] > 0)
          neighbors.push(labels[y * this.width + (x-1)]);

        if (neighbors.length === 0) {
          labels[idx] = nextLabel++;
        } else {
          const minLabel = Math.min(...neighbors);
          labels[idx] = minLabel;
          
          //record equivalences
          for (const label of neighbors) {
            if (label !== minLabel) {
              this.addEquivalence(equivalences, label, minLabel);
            }
          }
        }
      }
    }

    //resolve equivalences
    const finalLabels = this.resolveEquivalences(equivalences, nextLabel);

    //second pass - relabel with final labels
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] > 0) {
        labels[i] = finalLabels[labels[i]];
      }
    }

    //extract blob properties
    const blobs = this.extractBlobProperties(buffer, labels, minBlobSize);
    
    return blobs;
  }

  addEquivalence(equivalences, label1, label2) {
    const root1 = this.findRoot(equivalences, label1);
    const root2 = this.findRoot(equivalences, label2);
    
    if (root1 !== root2) {
      equivalences.set(Math.max(root1, root2), Math.min(root1, root2));
    }
  }

  findRoot(equivalences, label) {
    if (!equivalences.has(label)) {
      return label;
    }
    const root = this.findRoot(equivalences, equivalences.get(label));
    equivalences.set(label, root); //path compression
    return root;
  }

  resolveEquivalences(equivalences, maxLabel) {
    const finalLabels = new Array(maxLabel);
    for (let i = 0; i < maxLabel; i++) {
      finalLabels[i] = this.findRoot(equivalences, i);
    }
    
    //renumber labels to be consecutive
    const uniqueLabels = [...new Set(finalLabels)].sort((a, b) => a - b);
    const labelMap = new Map();
    uniqueLabels.forEach((label, idx) => labelMap.set(label, idx));
    
    return finalLabels.map(label => labelMap.get(label));
  }

  extractBlobProperties(buffer, labels, minBlobSize) {
    const blobMap = new Map();
    
    //accumulate blob properties
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const idx = y * this.width + x;
        const label = labels[idx];
        
        if (label === 0) continue;
        
        if (!blobMap.has(label)) {
          blobMap.set(label, {
            id: label,
            pixels: [],
            colorCounts: { white: 0, brown: 0, orange: 0, red: 0 },
            minX: x,
            maxX: x,
            minY: y,
            maxY: y,
            area: 0,
            centroidX: 0,
            centroidY: 0
          });
        }
        
        const blob = blobMap.get(label);
        blob.pixels.push({ x, y });
        blob.minX = Math.min(blob.minX, x);
        blob.maxX = Math.max(blob.maxX, x);
        blob.minY = Math.min(blob.minY, y);
        blob.maxY = Math.max(blob.maxY, y);
        blob.area++;
        blob.centroidX += x;
        blob.centroidY += y;
        
        //analyze pixel color
        const bufferIdx = idx * 3;
        const r = buffer[bufferIdx];
        const g = buffer[bufferIdx + 1];
        const b = buffer[bufferIdx + 2];
        const hsv = rgbToHsv(r, g, b);
        
        for (const [colorName, profile] of Object.entries(CHICKEN_COLOR_PROFILES)) {
          if (matchesColorProfile(hsv, profile)) {
            blob.colorCounts[colorName]++;
            break;
          }
        }
      }
    }
    
    //filter and finalize blobs
    const blobs = [];
    for (const blob of blobMap.values()) {
      if (blob.area < minBlobSize) continue;
      
      blob.centroidX = Math.round(blob.centroidX / blob.area);
      blob.centroidY = Math.round(blob.centroidY / blob.area);
      blob.width = blob.maxX - blob.minX + 1;
      blob.height = blob.maxY - blob.minY + 1;
      blob.aspectRatio = blob.width / blob.height;
      
      //determine dominant color
      blob.dominantColor = Object.entries(blob.colorCounts)
        .sort((a, b) => b[1] - a[1])[0][0];
      
      blobs.push(blob);
    }
    
    return blobs;
  }
}

//check if detected motion contains chicken colors
export function validateChickenMotion(motionBuffer, width, height, options = {}) {
  const {
    minChickenRatio = 0.1,    //minimum ratio of chicken-colored pixels
    minBlobSize = 50,         //minimum blob size in pixels
    requireBlob = true        //require connected blob, not just scattered pixels
  } = options;

  //analyze color distribution
  const colorAnalysis = analyzeChickenColors(motionBuffer, width, height);
  
  //quick check - enough chicken-colored pixels?
  if (colorAnalysis.chickenRatio < minChickenRatio) {
    return {
      isChicken: false,
      reason: 'insufficient_chicken_colors',
      colorAnalysis
    };
  }

  //if blob detection required, check for connected regions
  if (requireBlob) {
    const blobDetector = new ColorBlobDetector(width, height);
    const blobs = blobDetector.detectChickenBlobs(motionBuffer, minBlobSize);
    
    if (blobs.length === 0) {
      return {
        isChicken: false,
        reason: 'no_significant_blobs',
        colorAnalysis,
        blobs: []
      };
    }

    //check blob characteristics
    const validBlobs = blobs.filter(blob => {
      //filter by aspect ratio (chickens are roughly 1:1 to 2:1)
      if (blob.aspectRatio < 0.3 || blob.aspectRatio > 3.0) return false;
      
      //filter by size relative to frame
      const frameSizeRatio = blob.area / (width * height);
      if (frameSizeRatio < 0.001 || frameSizeRatio > 0.5) return false;
      
      return true;
    });

    return {
      isChicken: validBlobs.length > 0,
      reason: validBlobs.length > 0 ? 'chicken_detected' : 'invalid_blob_characteristics',
      colorAnalysis,
      blobs: validBlobs,
      totalBlobs: blobs.length
    };
  }

  return {
    isChicken: true,
    reason: 'chicken_colors_detected',
    colorAnalysis
  };
}

//adjust color thresholds based on time of day
export function getTimeAdjustedProfiles() {
  const hour = new Date().getHours();
  const profiles = JSON.parse(JSON.stringify(CHICKEN_COLOR_PROFILES));
  
  //dawn/dusk adjustments (6-8 AM, 5-7 PM)
  if ((hour >= 6 && hour <= 8) || (hour >= 17 && hour <= 19)) {
    //reduce value requirements due to lower light
    for (const profile of Object.values(profiles)) {
      if (profile.name !== 'black') {
        profile.hsv.v[0] = Math.max(0, profile.hsv.v[0] - 30);
      }
    }
  }
  
  //midday adjustments (11 AM - 2 PM)
  if (hour >= 11 && hour <= 14) {
    //increase value requirements due to bright light
    for (const profile of Object.values(profiles)) {
      if (profile.name === 'white') {
        profile.hsv.v[0] = Math.min(255, profile.hsv.v[0] + 20);
      }
    }
  }
  
  return profiles;
}