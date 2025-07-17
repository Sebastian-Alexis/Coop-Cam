#!/usr/bin/env node

import { readFile, writeFile } from 'fs/promises';
import { join, basename, extname, dirname } from 'path';

// Function to generate srcset for an image
function generateSrcset(src) {
  const ext = extname(src);
  const name = basename(src, ext);
  const dir = dirname(src);
  
  // For JPEG images
  const jpegSrcset = `
    ${dir}/${name}-sm.jpg 320w,
    ${dir}/${name}-md.jpg 640w,
    ${dir}/${name}-lg.jpg 1024w,
    ${dir}/${name}-xl.jpg 1920w,
    ${src} 2400w
  `.trim().replace(/\s+/g, ' ');
  
  // For WebP images
  const webpSrcset = `
    ${dir}/${name}-sm.webp 320w,
    ${dir}/${name}-md.webp 640w,
    ${dir}/${name}-lg.webp 1024w,
    ${dir}/${name}-xl.webp 1920w,
    ${dir}/${name}.webp 2400w
  `.trim().replace(/\s+/g, ' ');
  
  return { jpegSrcset, webpSrcset };
}

// Function to convert img tag to picture element
function createPictureElement(imgTag) {
  // Extract attributes from img tag
  const srcMatch = imgTag.match(/src="([^"]+)"/);
  const altMatch = imgTag.match(/alt="([^"]+)"/);
  const classMatch = imgTag.match(/class="([^"]+)"/);
  const loadingMatch = imgTag.match(/loading="([^"]+)"/);
  
  if (!srcMatch) return imgTag; // Return original if no src found
  
  const src = srcMatch[1];
  const alt = altMatch ? altMatch[1] : '';
  const className = classMatch ? classMatch[1] : '';
  const loading = loadingMatch ? 'lazy' : 'eager';
  
  // Skip the stream image
  if (src.includes('/api/stream')) return imgTag;
  
  const { jpegSrcset, webpSrcset } = generateSrcset(src);
  
  // Create picture element
  const pictureElement = `
    <picture>
      <source 
        type="image/webp" 
        srcset="${webpSrcset}"
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
      >
      <source 
        type="image/jpeg" 
        srcset="${jpegSrcset}"
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
      >
      <img 
        src="${src}" 
        alt="${alt}"
        ${className ? `class="${className}"` : ''}
        loading="${loading}"
        decoding="async"
      >
    </picture>
  `.trim().replace(/\s+/g, ' ').replace(/> </g, '>\n      <');
  
  return pictureElement;
}

// Process HTML file
async function processHtmlFile(filePath) {
  console.log(`Processing: ${filePath}`);
  
  let html = await readFile(filePath, 'utf-8');
  let changeCount = 0;
  
  // Find all img tags (excluding those already in picture elements)
  const imgRegex = /<img\s+[^>]*(?:src="\/images\/[^"]+")[^>]*>/gi;
  
  html = html.replace(imgRegex, (match) => {
    // Check if this img is already inside a picture element
    const beforeMatch = html.substring(0, html.indexOf(match));
    const lastPictureOpen = beforeMatch.lastIndexOf('<picture');
    const lastPictureClose = beforeMatch.lastIndexOf('</picture>');
    
    if (lastPictureOpen > lastPictureClose) {
      // This img is inside a picture element, skip it
      return match;
    }
    
    const pictureElement = createPictureElement(match);
    if (pictureElement !== match) {
      changeCount++;
      console.log(`  Converted: ${match.substring(0, 50)}...`);
    }
    return pictureElement;
  });
  
  if (changeCount > 0) {
    await writeFile(filePath, html);
    console.log(`  Updated ${changeCount} images\n`);
  } else {
    console.log(`  No changes needed\n`);
  }
}

// Main function
async function main() {
  console.log('Updating HTML files with responsive images...\n');
  
  const htmlFiles = [
    join(process.cwd(), 'src/views/about.html'),
    join(process.cwd(), 'src/views/coop.html'),
    join(process.cwd(), 'src/views/index.html')
  ];
  
  for (const file of htmlFiles) {
    try {
      await processHtmlFile(file);
    } catch (error) {
      console.error(`Error processing ${file}:`, error.message);
    }
  }
  
  console.log('HTML update complete!');
  console.log('\nNotes:');
  console.log('- Images now use <picture> elements with WebP and JPEG sources');
  console.log('- Responsive sizes: 320w, 640w, 1024w, 1920w');
  console.log('- Lazy loading is preserved');
  console.log('- Sizes attribute optimized for mobile-first display');
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});