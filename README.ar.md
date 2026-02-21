<p align="center">
  <a href="https://HopCoderX.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="شعار HopCoderX">
    </picture>
  </a>
</p>
<p align="center">وكيل برمجة بالذكاء الاصطناعي مفتوح المصدر.</p>
<p align="center">
  <a href="https://HopCoderX.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/HopCoderX-ai"><img alt="npm" src="https://img.shields.io/npm/v/HopCoderX-ai?style=flat-square" /></a>
  <a href="https://github.com/TaimoorSiddiquiOfficial/hopcoderx/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/TaimoorSiddiquiOfficial/hopcoderx/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a>
</p>

[![HopCoderX Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://HopCoderX.ai)

---

### التثبيت

```bash
# YOLO
curl -fsSL https://HopCoderX.ai/install | bash

# مديري الحزم
npm i -g HopCoderX-ai@latest        # او bun/pnpm/yarn
scoop install HopCoderX             # Windows
choco install HopCoderX             # Windows
brew install TaimoorSiddiquiOfficial/tap/hopcoderx # macOS و Linux (موصى به، دائما محدث)
brew install HopCoderX              # macOS و Linux (صيغة brew الرسمية، تحديث اقل)
sudo pacman -S HopCoderX            # Arch Linux (Stable)
paru -S HopCoderX-bin               # Arch Linux (Latest from AUR)
mise use -g HopCoderX               # اي نظام
nix run nixpkgs#HopCoderX           # او github:TaimoorSiddiquiOfficial/hopcoderx لاحدث فرع dev
```

> [!TIP]
> احذف الاصدارات الاقدم من 0.1.x قبل التثبيت.

### تطبيق سطح المكتب (BETA)

يتوفر HopCoderX ايضا كتطبيق سطح مكتب. قم بالتنزيل مباشرة من [صفحة الاصدارات](https://github.com/TaimoorSiddiquiOfficial/hopcoderx/releases) او من [HopCoderX.ai/download](https://HopCoderX.ai/download).

| المنصة                | التنزيل                               |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `HopCoderX-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `HopCoderX-desktop-darwin-x64.dmg`     |
| Windows               | `HopCoderX-desktop-windows-x64.exe`    |
| Linux                 | `.deb` او `.rpm` او AppImage          |

```bash
# macOS (Homebrew)
brew install --cask HopCoderX-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/HopCoderX-desktop
```

#### مجلد التثبيت

يحترم سكربت التثبيت ترتيب الاولوية التالي لمسار التثبيت:

1. `$HOPCODERX_INSTALL_DIR` - مجلد تثبيت مخصص
2. `$XDG_BIN_DIR` - مسار متوافق مع مواصفات XDG Base Directory
3. `$HOME/bin` - مجلد الثنائيات القياسي للمستخدم (ان وجد او امكن انشاؤه)
4. `$HOME/.HopCoderX/bin` - المسار الافتراضي الاحتياطي

```bash
# امثلة
HOPCODERX_INSTALL_DIR=/usr/local/bin curl -fsSL https://HopCoderX.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://HopCoderX.ai/install | bash
```

### Agents

يتضمن HopCoderX وكيليْن (Agents) مدمجين يمكنك التبديل بينهما باستخدام زر `Tab`.

- **build** - الافتراضي، وكيل بصلاحيات كاملة لاعمال التطوير
- **plan** - وكيل للقراءة فقط للتحليل واستكشاف الكود
  - يرفض تعديل الملفات افتراضيا
  - يطلب الاذن قبل تشغيل اوامر bash
  - مثالي لاستكشاف قواعد كود غير مألوفة او لتخطيط التغييرات

بالاضافة الى ذلك يوجد وكيل فرعي **general** للبحث المعقد والمهام متعددة الخطوات.
يستخدم داخليا ويمكن استدعاؤه بكتابة `@general` في الرسائل.

تعرف على المزيد حول [agents](https://HopCoderX.ai/docs/agents).

### التوثيق

لمزيد من المعلومات حول كيفية ضبط HopCoderX، [**راجع التوثيق**](https://HopCoderX.ai/docs).

### المساهمة

اذا كنت مهتما بالمساهمة في HopCoderX، يرجى قراءة [contributing docs](./CONTRIBUTING.md) قبل ارسال pull request.

### البناء فوق HopCoderX

اذا كنت تعمل على مشروع مرتبط بـ HopCoderX ويستخدم "HopCoderX" كجزء من اسمه (مثل "HopCoderX-dashboard" او "HopCoderX-mobile")، يرجى اضافة ملاحظة في README توضح انه ليس مبنيا بواسطة فريق HopCoderX ولا يرتبط بنا بأي شكل.

### FAQ

#### ما الفرق عن Claude Code؟

هو مشابه جدا لـ Claude Code من حيث القدرات. هذه هي الفروقات الاساسية:

- 100% مفتوح المصدر
- غير مقترن بمزود معين. نوصي بالنماذج التي نوفرها عبر [HopCoderX Zen](https://HopCoderX.ai/zen)؛ لكن يمكن استخدام HopCoderX مع Claude او OpenAI او Google او حتى نماذج محلية. مع تطور النماذج ستتقلص الفجوات وستنخفض الاسعار، لذا من المهم ان يكون مستقلا عن المزود.
- دعم LSP جاهز للاستخدام
- تركيز على TUI. تم بناء HopCoderX بواسطة مستخدمي neovim ومنشئي [terminal.shop](https://terminal.shop)؛ وسندفع حدود ما هو ممكن داخل الطرفية.
- معمارية عميل/خادم. على سبيل المثال، يمكن تشغيل HopCoderX على جهازك بينما تقوده عن بعد من تطبيق جوال. هذا يعني ان واجهة TUI هي واحدة فقط من العملاء الممكنين.

---

**انضم الى مجتمعنا** [Discord](https://discord.gg/HopCoderX) | [X.com](https://x.com/HopCoderX)
