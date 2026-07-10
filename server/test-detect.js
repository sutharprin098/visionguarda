/**
 * Quick end-to-end test: sends a real JPEG to /api/detect and prints result.
 * Run: node test-detect.js
 */
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

const BASE = 'http://localhost:3000';

async function main() {
  console.log('\n=== CamAI E2E Detect Test ===\n');

  // 1. Status check
  console.log('1. Checking /api/status...');
  const status = await axios.get(`${BASE}/api/status`);
  console.log('   Status:', JSON.stringify(status.data, null, 2));
  if (!status.data.localModelReady) {
    console.error('   ❌ Local model not ready!');
    process.exit(1);
  }
  console.log('   ✅ Local model reported ready\n');

  // 2. Find a test image — use any JPEG on the system
  const candidates = [
    path.join(__dirname, 'test.jpg'),
    'C:\\Windows\\Web\\Wallpaper\\Windows\\img0.jpg',
    'C:\\Windows\\Web\\4K\\Wallpapers\\Windows\\img0_1920x1200.jpg',
  ];
  let imgPath = null;
  for (const p of candidates) {
    if (fs.existsSync(p)) { imgPath = p; break; }
  }
  if (!imgPath) {
    console.log('   No local test image found — downloading a sample...');
    // Download a small public domain person image
    const https = require('https');
    imgPath = path.join(__dirname, 'test_download.jpg');
    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(imgPath);
      https.get('https://upload.wikimedia.org/wikipedia/commons/thumb/4/43/Cute_dog.jpg/320px-Cute_dog.jpg', (res) => {
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', reject);
    });
    console.log('   Downloaded test image to', imgPath);
  } else {
    console.log('   Using test image:', imgPath);
  }

  // 3. Send to /api/detect
  console.log('\n2. Sending image to /api/detect (this may take 20-60s on first local model inference)...');
  const start = Date.now();
  const form = new FormData();
  form.append('image', fs.createReadStream(imgPath), {
    filename: 'test.jpg',
    contentType: 'image/jpeg',
  });

  let detectResult;
  try {
    const res = await axios.post(`${BASE}/api/detect`, form, {
      headers: form.getHeaders(),
      timeout: 120000,
    });
    detectResult = res.data;
  } catch (err) {
    const errData = err.response?.data ?? err.message;
    console.error('   ❌ Detect failed:', JSON.stringify(errData, null, 2));
    process.exit(1);
  }

  const elapsed = Date.now() - start;
  console.log(`   ✅ Response received in ${(elapsed / 1000).toFixed(1)}s`);
  console.log('   Result:', JSON.stringify({
    success: detectResult.success,
    people: detectResult.people,
    status: detectResult.status,
    processingTime: detectResult.processingTime,
    yoloLatency: detectResult.yoloLatency,
    samLatency: detectResult.samLatency,
    detectionsCount: detectResult.detections?.length ?? 0,
    hasSegmentedImage: Boolean(detectResult.segmentedImage),
    id: detectResult.id,
  }, null, 2));

  if (detectResult.detections?.length > 0) {
    console.log('\n   Detections:');
    detectResult.detections.forEach((d, i) => {
      console.log(`   [${i}] class=${d.class} confidence=${(d.confidence*100).toFixed(1)}% bbox=${JSON.stringify(d.bbox)}`);
    });
  }

  // 4. Verify history
  console.log('\n3. Checking /api/history...');
  const hist = await axios.get(`${BASE}/api/history`);
  console.log(`   ✅ History count: ${hist.data.count}`);

  console.log('\n=== TEST COMPLETE ✅ ===\n');
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
