const { execFileSync } = require('node:child_process');
const path = require('node:path');

// Local ad-hoc signing seals the completed bundle. It is not Apple notarization.
module.exports = async (context) => {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('/usr/bin/codesign', ['--deep', '--force', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
