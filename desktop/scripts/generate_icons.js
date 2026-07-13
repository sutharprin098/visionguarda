const icongen = require('icon-gen');
const path = require('path');
const fs = require('fs');

const svgPath = path.join(__dirname, '../public/favicon.svg');
const outDir = path.join(__dirname, '../build');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

console.log('Generating icons from:', svgPath);
icongen(svgPath, outDir, {
  report: true,
  ico: {
    name: 'icon',
    sizes: [16, 24, 32, 48, 64, 128, 256]
  },
  favicon: {
    name: 'favicon-',
    pngSizes: [32, 57, 72, 96, 120, 128, 144, 152, 180, 195, 228],
    icoSizes: [16, 24, 32, 48]
  }
})
  .then((results) => {
    console.log('Icon generation finished. Results:', results);
    // Copy generated icon to any other locations if needed
    const generatedIco = path.join(outDir, 'icon.ico');
    if (fs.existsSync(generatedIco)) {
      console.log('icon.ico successfully created at:', generatedIco);
    }
  })
  .catch((err) => {
    console.error('Error generating icons:', err);
    process.exit(1);
  });
