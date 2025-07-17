#!/usr/bin/env node

// Critical CSS extraction script
// Identifies CSS rules needed for above-the-fold content

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

// Critical CSS for mobile-first rendering
const criticalStyles = `
/* Critical CSS - Inline for fast initial render */

/* Base reset and system fonts */
*, *::before, *::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

/* Prevent layout shift */
img, video {
  max-width: 100%;
  height: auto;
}

/* Critical utility classes from Tailwind that are used above-the-fold */
.min-h-screen { min-height: 100vh; }
.flex { display: flex; }
.flex-col { flex-direction: column; }
.items-center { align-items: center; }
.justify-center { justify-content: center; }
.justify-between { justify-content: space-between; }
.relative { position: relative; }
.fixed { position: fixed; }
.absolute { position: absolute; }
.top-0 { top: 0; }
.left-0 { left: 0; }
.right-0 { right: 0; }
.w-full { width: 100%; }
.max-w-7xl { max-width: 80rem; }
.mx-auto { margin-left: auto; margin-right: auto; }
.p-4 { padding: 1rem; }
.px-4 { padding-left: 1rem; padding-right: 1rem; }
.py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
.mb-4 { margin-bottom: 1rem; }
.text-center { text-align: center; }
.rounded-lg { border-radius: 0.5rem; }
.shadow-lg { box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05); }

/* Critical button styles - structure only, no colors */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  font-weight: 500;
  transition: all 0.2s;
  cursor: pointer;
  min-height: 3rem;
  min-width: 3rem;
  text-decoration: none;
}

/* Hide elements until JS loads */
.js-only {
  display: none;
}

/* Stream container critical styles */
.video-container {
  aspect-ratio: 16/9;
  background-color: #000;
  position: relative;
  overflow: hidden;
}

#stream {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

/* Loading state */
.loading {
  opacity: 0.6;
  pointer-events: none;
}

/* Mobile-specific critical styles */
@media (max-width: 768px) {
  .p-4 { padding: 0.75rem; }
  .text-4xl { font-size: 2rem; }
  .gap-4 { gap: 0.75rem; }
}
`.trim();

// Function to update HTML file with critical CSS
async function injectCriticalCSS(htmlFile) {
  const filePath = join(process.cwd(), 'src/views', htmlFile);
  console.log(`Processing ${htmlFile}...`);
  
  try {
    let html = await readFile(filePath, 'utf-8');
    
    // Check if critical CSS already exists
    if (html.includes('id="critical-css"')) {
      console.log(`  Critical CSS already present, updating...`);
      // Replace existing critical CSS
      html = html.replace(
        /<style id="critical-css">[\s\S]*?<\/style>/,
        `<style id="critical-css">\n${criticalStyles}\n    </style>`
      );
    } else {
      // Find the </head> tag and inject critical CSS before it
      const headEndIndex = html.indexOf('</head>');
      if (headEndIndex === -1) {
        console.error(`  Error: No </head> tag found`);
        return;
      }
      
      // Add critical CSS before </head>
      html = html.slice(0, headEndIndex) + 
        `    <style id="critical-css">\n${criticalStyles}\n    </style>\n` +
        html.slice(headEndIndex);
    }
    
    // Add preload for main CSS files
    if (!html.includes('rel="preload"')) {
      const linkTags = `
    <!-- Preload critical resources -->
    <link rel="preload" href="https://cdn.jsdelivr.net/npm/daisyui@4.12.22/dist/full.min.css" as="style">
    <link rel="preload" href="/js/app.js" as="script" crossorigin>`;
      
      const headEndIndex = html.indexOf('</head>');
      html = html.slice(0, headEndIndex) + linkTags + '\n' + html.slice(headEndIndex);
    }
    
    await writeFile(filePath, html);
    console.log(`  ✓ Critical CSS injected`);
    
  } catch (error) {
    console.error(`  Error processing ${htmlFile}:`, error.message);
  }
}

// Main function
async function main() {
  console.log('Extracting and injecting critical CSS...\n');
  
  const htmlFiles = ['index.html', 'coop.html', 'about.html'];
  
  for (const file of htmlFiles) {
    await injectCriticalCSS(file);
  }
  
  console.log('\nCritical CSS injection complete!');
  console.log('\nBenefits:');
  console.log('- Eliminates render-blocking CSS for above-the-fold content');
  console.log('- Reduces First Contentful Paint (FCP) time');
  console.log('- Improves Cumulative Layout Shift (CLS) score');
  console.log('- Better mobile performance on slow connections');
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});