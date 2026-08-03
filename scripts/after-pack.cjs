// Chromium кладёт в сборку 54 файла локализаций. Приложение русское, интерфейс
// Chromium виден разве что в контекстном меню, так что оставляем русский
// и английский. На macOS то же самое делает опция electronLanguages,
// а для Windows своей опции нет.
const fs = require('node:fs');
const path = require('node:path');

const KEEP = new Set(['ru.pak', 'en-US.pak']);

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const localesDir = path.join(context.appOutDir, 'locales');
  if (!fs.existsSync(localesDir)) return;

  let removed = 0;
  let freed = 0;
  for (const file of fs.readdirSync(localesDir)) {
    if (!file.endsWith('.pak') || KEEP.has(file)) continue;
    const full = path.join(localesDir, file);
    freed += fs.statSync(full).size;
    fs.unlinkSync(full);
    removed += 1;
  }

  console.log(`  • убрано локализаций Chromium  количество=${removed} освобождено=${(freed / 1048576).toFixed(1)} МБ`);
};
