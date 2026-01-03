/**
 * 一键修改软件版本号脚本
 * 
 * 功能：
 * 1. 修改 package.json 的版本号
 * 2. 修改设置页面显示的版本号
 * 3. 自动处理 v 前缀
 * 
 * 使用方法：
 * node scripts/update-version.js 1.0.8
 * 或者直接运行（会提示输入版本号）：
 * node scripts/update-version.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// 验证版本号格式
function isValidVersion(version) {
  // 支持 1.0.8 或 v1.0.8 格式
  const versionPattern = /^v?\d+\.\d+\.\d+$/;
  return versionPattern.test(version);
}

// 标准化版本号（移除 v 前缀）
function normalizeVersion(version) {
  return version.replace(/^v/, '');
}

// 获取用户输入
function getUserInput(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// 更新 package.json
function updatePackageJson(newVersion) {
  const packagePath = path.join(__dirname, '..', 'package.json');
  
  try {
    const packageContent = fs.readFileSync(packagePath, 'utf8');
    const packageJson = JSON.parse(packageContent);
    const oldVersion = packageJson.version;
    
    packageJson.version = newVersion;
    
    fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n', 'utf8');
    log(`✅ package.json: ${oldVersion} → ${newVersion}`, 'green');
    return true;
  } catch (error) {
    log(`❌ 更新 package.json 失败: ${error.message}`, 'red');
    return false;
  }
}

// 更新设置页面
function updateSettingsPage(newVersion) {
  const settingsPath = path.join(__dirname, '..', 'src', 'renderer', 'pages', 'Settings', 'index.tsx');

  try {
    let content = fs.readFileSync(settingsPath, 'utf8');
    let updated = false;
    let oldVersion = null;

    // 匹配版本号显示行：<p>{t('settings.version')}: V1.0.6</p>
    const versionPattern = /(\{t\('settings\.version'\)\}:\s*V?)([\d\.]+)(<\/p>)/;
    const versionMatch = content.match(versionPattern);

    if (versionMatch) {
      oldVersion = versionMatch[2];
      content = content.replace(versionPattern, `$1${newVersion}$3`);
      updated = true;
    }

    // 匹配许可证对话框中的版本号：<p>版本: V1.0.6</p>
    const licensePattern = /(版本:\s*V?)([\d\.]+)(<\/p>)/;
    const licenseMatch = content.match(licensePattern);

    if (licenseMatch) {
      if (!oldVersion) oldVersion = licenseMatch[2];
      content = content.replace(licensePattern, `$1${newVersion}$3`);
      updated = true;
    }

    if (updated) {
      fs.writeFileSync(settingsPath, content, 'utf8');
      log(`✅ Settings 页面: V${oldVersion} → V${newVersion}`, 'green');
      return true;
    } else {
      log(`⚠️  Settings 页面: 未找到版本号匹配项`, 'yellow');
      return false;
    }
  } catch (error) {
    log(`❌ 更新 Settings 页面失败: ${error.message}`, 'red');
    return false;
  }
}

// 显示当前版本
function showCurrentVersion() {
  const packagePath = path.join(__dirname, '..', 'package.json');
  
  try {
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    return packageJson.version;
  } catch (error) {
    return null;
  }
}

// 主函数
async function main() {
  log('\n╔════════════════════════════════════════╗', 'cyan');
  log('║   USG NAT Manager 版本号更新工具      ║', 'cyan');
  log('╚════════════════════════════════════════╝\n', 'cyan');

  // 显示当前版本
  const currentVersion = showCurrentVersion();
  if (currentVersion) {
    log(`📦 当前版本: v${currentVersion}`, 'yellow');
  }

  // 获取新版本号
  let newVersion = process.argv[2];

  // 如果没有通过命令行参数传入，则提示用户输入
  if (!newVersion) {
    log('');
    newVersion = await getUserInput('🔢 请输入新版本号 (例如: 1.0.8): ');
  }

  // 验证版本号格式
  if (!isValidVersion(newVersion)) {
    log('\n❌ 版本号格式错误！请使用 x.x.x 格式 (例如: 1.0.8)', 'red');
    process.exit(1);
  }

  // 标准化版本号
  newVersion = normalizeVersion(newVersion);

  // 版本对比
  if (currentVersion === newVersion) {
    log(`\n⚠️  新版本号与当前版本相同 (v${newVersion})`, 'yellow');
    const confirm = await getUserInput('是否继续？(y/n): ');
    if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
      log('\n已取消更新', 'yellow');
      process.exit(0);
    }
  }

  log(`\n🎯 目标版本: v${currentVersion} → v${newVersion}`, 'cyan');

  // 确认
  const confirm = await getUserInput('\n确认更新？(y/n): ');
  if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
    log('\n❌ 已取消更新', 'yellow');
    process.exit(0);
  }

  log('\n⏳ 正在更新...\n');

  // 执行更新
  const results = [
    updatePackageJson(newVersion),
    updateSettingsPage(newVersion),
  ];

  // 汇总结果
  const successCount = results.filter(Boolean).length;
  const totalCount = results.length;

  log('\n╔════════════════════════════════════════╗', 'cyan');
  if (successCount === totalCount) {
    log('║            ✅ 更新成功！               ║', 'green');
    log('╚════════════════════════════════════════╝', 'cyan');
    log(`\n📌 新版本: v${newVersion}`, 'green');
    log(`\n💡 后续步骤：`, 'cyan');
    log('   1️⃣  npm run build      # 重新构建', 'yellow');
    log('   2️⃣  npm run package    # 打包发布', 'yellow');
  } else {
    log('║          ⚠️  部分更新失败              ║', 'yellow');
    log('╚════════════════════════════════════════╝', 'cyan');
    log(`\n成功: ${successCount}/${totalCount}`, 'yellow');
  }
  log('');
}

// 运行
main().catch((error) => {
  log(`\n❌ 发生错误: ${error.message}`, 'red');
  process.exit(1);
});

