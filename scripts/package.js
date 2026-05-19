const { packager } = require('@electron/packager');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.resolve(PROJECT_ROOT, '..', 'ExocadBuild');

const options = {
  dir: PROJECT_ROOT,
  name: 'Exocad Serial Manager',
  platform: 'win32',
  arch: 'x64',
  out: OUTPUT_DIR,
  overwrite: true,
  asar: false,
  ignore: [
    /^\/src/,
    /^\/release/,
    /^\/scripts/,
    /^\/\.git/,
    /^\/\.claude/,
    /^\/tsconfig/,
    /^\/vite\.config/,
    /^\/electron-builder/,
    /^\/README/,
    /^\/\.electron-packager-ignore/,
    /node_modules\/electron$/,
    /node_modules\/electron-builder/,
    /node_modules\/typescript/,
    /node_modules\/vite/,
    /node_modules\/@vitejs/,
    /node_modules\/@types/,
    /node_modules\/concurrently/,
    /node_modules\/wait-on/,
    /node_modules\/cross-env/,
    /node_modules\/@electron\/rebuild/,
    /node_modules\/@electron\/packager/,
  ],
};

(async () => {
  try {
    console.log('패키징 시작...');
    const appPaths = await packager(options);
    console.log('패키징 완료:', appPaths);
  } catch (err) {
    console.error('패키징 실패:', err);
    process.exit(1);
  }
})();
