const toIco = require('to-ico');
const fs = require('fs');
const path = require('path');

async function generateIcon() {
  try {
    // 读取现有的 PNG 图标
    const iconsDir = path.join(__dirname, '..', '..', 'resources', 'icons');
    const iconPath = path.join(iconsDir, 'icon.png');

    if (!fs.existsSync(iconPath)) {
      console.error('找不到源图标文件:', iconPath);
      return;
    }

    console.log('正在读取源图标:', iconPath);
    const input = fs.readFileSync(iconPath);

    // 生成 ICO 文件（包含多个尺寸）
    console.log('正在生成 ICO 文件...');
    const buf = await toIco([input], {
      resize: true,
      sizes: [16, 24, 32, 48, 64, 128, 256],
    });

    // 保存生成的 ICO 文件
    const outputPath = path.join(iconsDir, 'app.ico');
    fs.writeFileSync(outputPath, buf);

    console.log('✅ ICO 文件已生成:', outputPath);
    console.log('文件大小:', (buf.length / 1024).toFixed(2), 'KB');
  } catch (error) {
    console.error('❌ 生成失败:', error.message);
  }
}

generateIcon();
