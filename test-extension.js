#!/usr/bin/env node

/**
 * Simple test to verify the Chrome extension structure is valid
 */

const fs = require('fs');
const path = require('path');

console.log('🧪 Testing hiREZZIE Extension Structure...\n');

// Test 1: Verify required files exist
const requiredFiles = [
  'manifest.json',
  'background.js', 
  'config.js',
  'popup.html',
  'popup.js',
  'results.html',
  'results.js',
  'shared.css'
];

let allFilesExist = true;
requiredFiles.forEach(file => {
  if (fs.existsSync(file)) {
    console.log(`✅ ${file} exists`);
  } else {
    console.log(`❌ ${file} missing`);
    allFilesExist = false;
  }
});

// Test 2: Verify manifest.json structure
try {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  console.log(`✅ manifest.json is valid JSON`);
  
  if (manifest.manifest_version === 3) {
    console.log(`✅ Using Manifest V3`);
  } else {
    console.log(`⚠️  Not using Manifest V3`);
  }
} catch (error) {
  console.log(`❌ manifest.json invalid:`, error.message);
  allFilesExist = false;
}

// Test 3: Verify config.js has proper structure
try {
  const configContent = fs.readFileSync('config.js', 'utf8');
  if (configContent.includes('const API_CONFIG')) {
    console.log(`✅ config.js has API_CONFIG constant`);
  } else {
    console.log(`❌ config.js missing API_CONFIG`);
    allFilesExist = false;
  }
} catch (error) {
  console.log(`❌ config.js invalid:`, error.message);
  allFilesExist = false;
}

// Test 4: Verify background.js imports config
try {
  const bgContent = fs.readFileSync('background.js', 'utf8');
  if (bgContent.includes('importScripts(\'config.js\')')) {
    console.log(`✅ background.js imports config.js`);
  } else {
    console.log(`❌ background.js doesn't import config.js`);
    allFilesExist = false;
  }
} catch (error) {
  console.log(`❌ background.js invalid:`, error.message);
  allFilesExist = false;
}

console.log(`\n${allFilesExist ? '🎉' : '💥'} Extension structure test ${allFilesExist ? 'PASSED' : 'FAILED'}`);

if (allFilesExist) {
  console.log(`\n📦 Ready to load in Chrome:\n`);
  console.log(`1. Open Chrome and go to chrome://extensions/`);
  console.log(`2. Enable "Developer mode"`);
  console.log(`3. Click "Load unpacked"`);
  console.log(`4. Select this directory`);
  console.log(`\n🔑 Don't forget to run 'npm run build' with your API keys!`);
}

process.exit(allFilesExist ? 0 : 1);