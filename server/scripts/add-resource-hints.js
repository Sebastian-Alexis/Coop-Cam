#!/usr/bin/env node

// Resource hints optimization script
// Adds preconnect, dns-prefetch, and prefetch hints for faster loading

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

// Resource hints to add
const resourceHints = `
    <!-- Resource Hints for Performance -->
    <link rel="dns-prefetch" href="//cdn.jsdelivr.net">
    <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
    <link rel="preconnect" href="https://cdn.tailwindcss.com" crossorigin>
    
    <!-- Prefetch JavaScript modules that will be needed -->
    <link rel="prefetch" href="/js/modules/stream-manager.js" as="script">
    <link rel="prefetch" href="/js/modules/flashlight-control.js" as="script">
    <link rel="prefetch" href="/js/modules/weather-widget.js" as="script">
    <link rel="prefetch" href="/js/modules/carousel.js" as="script">
    
    <!-- Prefetch commonly viewed images -->
    <link rel="prefetch" href="/images/chickens/marshmallow/marshmallow-1-md.webp" as="image">
    <link rel="prefetch" href="/images/chickens/charcoal/charcoal-1-md.webp" as="image">
    
    <!-- Additional performance optimizations -->
    <meta name="theme-color" content="#ffffff">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    
    <!-- Preload mobile CSS fixes -->
    <link rel="preload" href="/css/mobile-fixes.css" as="style">`;

// Add script loading optimization
const scriptLoadingOptimization = `
  <!-- Async load non-critical scripts -->
  <script>
    // Load non-critical resources after page load
    window.addEventListener('load', function() {
      // Prefetch next page resources
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => {
          // Prefetch likely next navigation targets
          const links = document.querySelectorAll('a[href^="/"]');
          links.forEach(link => {
            const url = link.getAttribute('href');
            if (url && !url.includes('#')) {
              const prefetchLink = document.createElement('link');
              prefetchLink.rel = 'prefetch';
              prefetchLink.href = url;
              document.head.appendChild(prefetchLink);
            }
          });
        });
      }
      
      // Enable service worker when ready (Phase 4)
      if ('serviceWorker' in navigator) {
        // Placeholder for future service worker registration
      }
    });
  </script>`;

// Function to update HTML file with resource hints
async function addResourceHints(htmlFile) {
  const filePath = join(process.cwd(), 'src/views', htmlFile);
  console.log(`Processing ${htmlFile}...`);
  
  try {
    let html = await readFile(filePath, 'utf-8');
    
    // Check if resource hints already exist
    if (html.includes('<!-- Resource Hints for Performance -->')) {
      console.log(`  Resource hints already present, updating...`);
      // Replace existing resource hints
      html = html.replace(
        /<!-- Resource Hints for Performance -->[\s\S]*?<!-- Additional performance optimizations -->[\s\S]*?<link rel="preload" href="\/css\/mobile-fixes.css" as="style">/,
        resourceHints.trim()
      );
    } else {
      // Find where to insert resource hints (after viewport meta tag)
      const viewportIndex = html.indexOf('</title>');
      if (viewportIndex === -1) {
        console.error(`  Error: No </title> tag found`);
        return;
      }
      
      // Add resource hints after title
      html = html.slice(0, viewportIndex + 8) + '\n' + resourceHints + html.slice(viewportIndex + 8);
    }
    
    // Add script loading optimization before closing body tag
    if (!html.includes('Load non-critical resources after page load')) {
      const bodyEndIndex = html.lastIndexOf('</body>');
      if (bodyEndIndex !== -1) {
        html = html.slice(0, bodyEndIndex) + scriptLoadingOptimization + '\n' + html.slice(bodyEndIndex);
      }
    }
    
    // Optimize external script loading
    // Convert blocking scripts to async/defer where appropriate
    html = html.replace(
      /<script src="https:\/\/cdn.tailwindcss.com"><\/script>/g,
      '<script src="https://cdn.tailwindcss.com" defer></script>'
    );
    
    await writeFile(filePath, html);
    console.log(`  ✓ Resource hints added`);
    
  } catch (error) {
    console.error(`  Error processing ${htmlFile}:`, error.message);
  }
}

// Main function
async function main() {
  console.log('Adding resource hints for performance optimization...\n');
  
  const htmlFiles = ['index.html', 'coop.html', 'about.html'];
  
  for (const file of htmlFiles) {
    await addResourceHints(file);
  }
  
  console.log('\nResource hints optimization complete!');
  console.log('\nBenefits:');
  console.log('- DNS prefetching for faster domain resolution');
  console.log('- Preconnect for early connection establishment');
  console.log('- Module prefetching for instant navigation');
  console.log('- Adaptive prefetching based on user behavior');
  console.log('- Progressive enhancement for modern browsers');
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});