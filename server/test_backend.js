const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('Sending detection request to local backend...');
  const imgPath = path.join(__dirname, 'test.jpg');
  if (!fs.existsSync(imgPath)) {
    console.error('test.jpg not found');
    return;
  }

  const imgBuffer = fs.readFileSync(imgPath);
  const blob = new Blob([imgBuffer], { type: 'image/jpeg' });

  const formData = new FormData();
  formData.append('image', blob, 'test.jpg');

  try {
    const response = await axios.post('http://localhost:3000/api/detect', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      timeout: 120000
    });

    console.log('Response status:', response.status);
    console.log('Response keys:', Object.keys(response.data));
    console.log('Status:', response.data.status);
    console.log('People count:', response.data.people);
    console.log('Detections count:', response.data.detections.length);
    console.log('Segmented Image present:', !!response.data.segmentedImage);
    if (response.data.segmentedImage) {
      console.log('Segmented Image length:', response.data.segmentedImage.length);
    }
  } catch (err) {
    console.error('API Error:', err.response ? err.response.data : err.message);
  }
}

main();
