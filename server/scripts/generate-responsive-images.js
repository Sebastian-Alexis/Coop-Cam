#!/usr/bin/env node

import sharp from 'sharp';
import { readdir, mkdir, stat } from 'fs/promises';
import { join, extname, basename, dirname } from 'path';
import { existsSync } from 'fs';

// Configuration
const IMAGE_SIZES = [
  { width: 320, suffix: 'sm' },   // Small phones
  { width: 640, suffix: 'md' },   // Regular phones
  { width: 1024, suffix: 'lg' },  // Tablets
  { width: 1920, suffix: 'xl' }   // Desktop
];

const WEBP_QUALITY = 85;
const JPEG_QUALITY = 90;

const PUBLIC_DIR = join(process.cwd(), 'public');
const IMAGES_DIR = join(PUBLIC_DIR, 'images');

// Process a single image
async function processImage(imagePath) {
  const ext = extname(imagePath).toLowerCase();
  if (!['.jpg', '.jpeg', '.png'].includes(ext)) {
    return;
  }

  const dir = dirname(imagePath);
  const name = basename(imagePath, ext);
  
  console.log(`Processing: ${imagePath}`);
  
  try {
    const image = sharp(imagePath);
    const metadata = await image.metadata();
    const originalWidth = metadata.width;
    
    for (const size of IMAGE_SIZES) {
      // Skip if the original image is smaller than the target size
      if (originalWidth <= size.width) continue;
      
      const resizedName = `${name}-${size.suffix}`;
      
      // Generate JPEG version
      const jpegPath = join(dir, `${resizedName}.jpg`);
      if (!existsSync(jpegPath)) {
        await image
          .resize(size.width, null, { 
            withoutEnlargement: true,
            fit: 'inside'
          })
          .jpeg({ quality: JPEG_QUALITY })
          .toFile(jpegPath);
        console.log(`  Created: ${jpegPath}`);
      }
      
      // Generate WebP version
      const webpPath = join(dir, `${resizedName}.webp`);
      if (!existsSync(webpPath)) {
        await image
          .resize(size.width, null, { 
            withoutEnlargement: true,
            fit: 'inside'
          })
          .webp({ quality: WEBP_QUALITY })
          .toFile(webpPath);
        console.log(`  Created: ${webpPath}`);
      }
    }
    
    // Also generate WebP for original size
    const webpOriginalPath = join(dir, `${name}.webp`);
    if (!existsSync(webpOriginalPath)) {
      await image
        .webp({ quality: WEBP_QUALITY })
        .toFile(webpOriginalPath);
      console.log(`  Created: ${webpOriginalPath}`);
    }
    
  } catch (error) {
    console.error(`Error processing ${imagePath}:`, error);
  }
}

// Recursively process all images in a directory
async function processDirectory(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    
    if (entry.isDirectory()) {
      await processDirectory(fullPath);
    } else if (entry.isFile()) {
      await processImage(fullPath);
    }
  }
}

// Main function
async function main() {
  console.log('Generating responsive images...\n');
  
  // Ensure the images directory exists
  if (!existsSync(IMAGES_DIR)) {
    console.error('Images directory not found:', IMAGES_DIR);
    process.exit(1);
  }
  
  // Process all images
  await processDirectory(IMAGES_DIR);
  
  console.log('\nResponsive image generation complete!');
  console.log('Generated sizes: 320w, 640w, 1024w, 1920w');
  console.log('Generated formats: JPEG and WebP');
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});