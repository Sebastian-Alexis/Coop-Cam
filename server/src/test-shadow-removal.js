import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { 
  normalizeIllumination, 
  calculateShadowAwareDifference,
  getTimeBasedThresholds 
} from './utils/shadowRemovalUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Test script for shadow removal functionality
 * Creates synthetic frames with shadows and tests detection
 */

async function createSyntheticFrames() {
  console.log('Creating synthetic test frames...');
  
  //create a base frame (100x100 grayscale)
  const width = 100;
  const height = 100;
  const baseFrame = Buffer.alloc(width * height);
  
  //fill with medium gray background
  baseFrame.fill(128);
  
  //add a bright object (simulating a chicken)
  for (let y = 30; y < 50; y++) {
    for (let x = 30; x < 50; x++) {
      baseFrame[y * width + x] = 200;
    }
  }
  
  //create frame with shadow (object moved, shadow added)
  const shadowFrame = Buffer.from(baseFrame);
  
  //move object to new position
  for (let y = 30; y < 50; y++) {
    for (let x = 30; x < 50; x++) {
      shadowFrame[y * width + x] = 128; //clear old position
    }
  }
  for (let y = 35; y < 55; y++) {
    for (let x = 35; x < 55; x++) {
      shadowFrame[y * width + x] = 200; //new position
    }
  }
  
  //add shadow at old position (darker area)
  for (let y = 30; y < 50; y++) {
    for (let x = 30; x < 50; x++) {
      shadowFrame[y * width + x] = 90; //shadow (darker than background)
    }
  }
  
  return { baseFrame, shadowFrame, width, height };
}

async function testShadowRemoval() {
  console.log('\n=== Shadow Removal Test Suite ===\n');
  
  try {
    //create test frames
    const { baseFrame, shadowFrame, width, height } = await createSyntheticFrames();
    
    //save original frames for visual inspection
    const testDir = './test-output';
    await fs.mkdir(testDir, { recursive: true });
    
    await sharp(baseFrame, { raw: { width, height, channels: 1 } })
      .jpeg()
      .toFile(path.join(testDir, 'test_base_frame.jpg'));
    
    await sharp(shadowFrame, { raw: { width, height, channels: 1 } })
      .jpeg()
      .toFile(path.join(testDir, 'test_shadow_frame.jpg'));
    
    console.log('Test frames saved to ./test-output/');
    
    //test 1: compare without shadow removal
    console.log('\n--- Test 1: Original Motion Detection ---');
    const simpleComparison = calculateSimpleDifference(baseFrame, shadowFrame);
    console.log(`Changed pixels: ${simpleComparison.changedPixels}`);
    console.log(`Normalized difference: ${(simpleComparison.normalizedDifference * 100).toFixed(2)}%`);
    
    //test 2: compare with shadow-aware detection
    console.log('\n--- Test 2: Shadow-Aware Detection ---');
    const shadowAwareComparison = calculateShadowAwareDifference(baseFrame, shadowFrame, {
      baseThreshold: 25,
      shadowThreshold: 40,
      adaptiveThreshold: true
    });
    console.log(`Changed pixels: ${shadowAwareComparison.changedPixels}`);
    console.log(`Shadow pixels: ${shadowAwareComparison.shadowPixels}`);
    console.log(`Non-shadow pixels: ${shadowAwareComparison.nonShadowPixels}`);
    console.log(`Normalized difference: ${(shadowAwareComparison.normalizedDifference * 100).toFixed(2)}%`);
    console.log(`Shadow ratio: ${(shadowAwareComparison.shadowRatio * 100).toFixed(2)}%`);
    
    //test 3: illumination normalization
    console.log('\n--- Test 3: Illumination Normalization ---');
    const normalizedBase = await normalizeIllumination(baseFrame, width, height, 0.7);
    const normalizedShadow = await normalizeIllumination(shadowFrame, width, height, 0.7);
    
    await sharp(normalizedBase, { raw: { width, height, channels: 1 } })
      .jpeg()
      .toFile(path.join(testDir, 'test_normalized_base.jpg'));
    
    await sharp(normalizedShadow, { raw: { width, height, channels: 1 } })
      .jpeg()
      .toFile(path.join(testDir, 'test_normalized_shadow.jpg'));
    
    const normalizedComparison = calculateShadowAwareDifference(normalizedBase, normalizedShadow, {
      baseThreshold: 25,
      shadowThreshold: 40,
      adaptiveThreshold: true
    });
    console.log(`After normalization - Changed pixels: ${normalizedComparison.changedPixels}`);
    console.log(`After normalization - Shadow ratio: ${(normalizedComparison.shadowRatio * 100).toFixed(2)}%`);
    
    //test 4: time-based thresholds
    console.log('\n--- Test 4: Time-Based Thresholds ---');
    const morningThresholds = getTimeBasedThresholds(new Date('2024-01-01 09:00:00'));
    const noonThresholds = getTimeBasedThresholds(new Date('2024-01-01 12:00:00'));
    const duskThresholds = getTimeBasedThresholds(new Date('2024-01-01 18:00:00'));
    
    console.log('Morning thresholds:', morningThresholds);
    console.log('Noon thresholds:', noonThresholds);
    console.log('Dusk thresholds:', duskThresholds);
    
    //test 5: performance measurement
    console.log('\n--- Test 5: Performance Measurement ---');
    const iterations = 100;
    
    const startSimple = Date.now();
    for (let i = 0; i < iterations; i++) {
      calculateSimpleDifference(baseFrame, shadowFrame);
    }
    const simpleTime = Date.now() - startSimple;
    
    const startShadowAware = Date.now();
    for (let i = 0; i < iterations; i++) {
      calculateShadowAwareDifference(baseFrame, shadowFrame);
    }
    const shadowAwareTime = Date.now() - startShadowAware;
    
    const startNormalization = Date.now();
    for (let i = 0; i < iterations; i++) {
      await normalizeIllumination(baseFrame, width, height, 0.7);
    }
    const normalizationTime = Date.now() - startNormalization;
    
    console.log(`Simple comparison: ${simpleTime}ms for ${iterations} iterations (${(simpleTime/iterations).toFixed(2)}ms avg)`);
    console.log(`Shadow-aware comparison: ${shadowAwareTime}ms for ${iterations} iterations (${(shadowAwareTime/iterations).toFixed(2)}ms avg)`);
    console.log(`Illumination normalization: ${normalizationTime}ms for ${iterations} iterations (${(normalizationTime/iterations).toFixed(2)}ms avg)`);
    
    //summary
    console.log('\n=== Test Summary ===');
    const falsePositiveReduction = ((simpleComparison.changedPixels - shadowAwareComparison.nonShadowPixels) / simpleComparison.changedPixels * 100);
    console.log(`False positive reduction: ${falsePositiveReduction.toFixed(2)}%`);
    console.log(`Performance overhead: ${((shadowAwareTime - simpleTime) / simpleTime * 100).toFixed(2)}%`);
    console.log('\nTest completed successfully!');
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

function calculateSimpleDifference(buffer1, buffer2) {
  let changedPixels = 0;
  const length = buffer1.length;
  const pixelThreshold = 25;
  
  for (let i = 0; i < length; i++) {
    const pixelDiff = Math.abs(buffer1[i] - buffer2[i]);
    if (pixelDiff > pixelThreshold) {
      changedPixels++;
    }
  }
  
  return {
    changedPixels,
    normalizedDifference: changedPixels / length
  };
}

//run the test
testShadowRemoval().catch(console.error);