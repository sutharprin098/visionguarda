const axios = require('axios');

const TOKEN = process.env.REPLICATE_API_TOKEN || require('dotenv').config({ path: require('path').join(__dirname, '.env') }) && process.env.REPLICATE_API_TOKEN;

const headers = { Authorization: `Bearer ${TOKEN}` };

async function getVersions(model) {
  const res = await axios.get(`https://api.replicate.com/v1/models/${model}/versions`, { headers });
  return res.data.results?.slice(0, 3).map(v => ({ id: v.id, created_at: v.created_at })) ?? [];
}

async function testPredict() {
  // Check if the model supports "deployments" style (no version needed)
  const modelsRes = await axios.get('https://api.replicate.com/v1/models/ultralytics/yolo11n', { headers });
  console.log('Model info:', JSON.stringify(modelsRes.data, null, 2));
}

async function main() {
  require('dotenv').config({ path: require('path').join(__dirname, '.env') });
  const TOKEN = process.env.REPLICATE_API_TOKEN;
  console.log('Token:', TOKEN ? TOKEN.slice(0,8)+'...' : 'NOT SET');

  const headers = { Authorization: `Bearer ${TOKEN}` };

  console.log('\n--- ultralytics/yolo11n versions ---');
  try {
    const r1 = await axios.get('https://api.replicate.com/v1/models/ultralytics/yolo11n/versions', { headers });
    const v1 = r1.data.results?.slice(0, 3) ?? [];
    v1.forEach(v => console.log(' ', v.id, v.created_at));
  } catch(e) { console.error('YOLO versions error:', e.response?.data ?? e.message); }

  console.log('\n--- lucataco/sam3-video versions ---');
  try {
    const r2 = await axios.get('https://api.replicate.com/v1/models/lucataco/sam3-video/versions', { headers });
    const v2 = r2.data.results?.slice(0, 3) ?? [];
    v2.forEach(v => console.log(' ', v.id, v.created_at));
  } catch(e) { console.error('SAM3 versions error:', e.response?.data ?? e.message); }

  console.log('\n--- Model info yolo11n ---');
  try {
    const r3 = await axios.get('https://api.replicate.com/v1/models/ultralytics/yolo11n', { headers });
    console.log('  latest_version id:', r3.data.latest_version?.id ?? 'none');
    console.log('  default_example:', r3.data.default_example?.id ?? 'none');
  } catch(e) { console.error('Model info error:', e.response?.data ?? e.message); }
}

main().catch(console.error);
