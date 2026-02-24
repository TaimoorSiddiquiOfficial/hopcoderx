<p align="center">
  <a href="https://HopCoderX.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="HopCoderX logo">
    </picture>
  </a>
</p>
<p align="center">Открытый AI-агент для программирования.</p>
<p align="center">
  <a href="https://HopCoderX.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/HopCoderX-ai"><img alt="npm" src="https://img.shields.io/npm/v/HopCoderX-ai?style=flat-square" /></a>
  <a href="https://github.com/TaimoorSiddiquiOfficial/hopcoderx/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/TaimoorSiddiquiOfficial/hopcoderx/publish.yml?style=flat-square&branch=main" /></a>
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

### Установка

```bash
# YOLO
curl -fsSL https://HopCoderX.ai/install | bash

# Менеджеры пакетов
npm i -g HopCoderX-ai@latest        # или bun/pnpm/yarn
scoop install HopCoderX             # Windows
choco install HopCoderX             # Windows
brew install TaimoorSiddiquiOfficial/tap/hopcoderx # macOS и Linux (рекомендуем, всегда актуально)
brew install HopCoderX              # macOS и Linux (официальная формула brew, обновляется реже)
sudo pacman -S HopCoderX            # Arch Linux (Stable)
paru -S HopCoderX-bin               # Arch Linux (Latest from AUR)
mise use -g HopCoderX               # любая ОС
nix run nixpkgs#HopCoderX           # или github:TaimoorSiddiquiOfficial/hopcoderx для самой свежей ветки dev
```

> [!TIP]
> Перед установкой удалите версии старше 0.1.x.

### Десктопное приложение (BETA)

HopCoderX также доступен как десктопное приложение. Скачайте его со [страницы релизов](https://github.com/TaimoorSiddiquiOfficial/hopcoderx/releases) или с [HopCoderX.ai/download](https://HopCoderX.ai/download).

| Платформа             | Загрузка                              |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `HopCoderX-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `HopCoderX-desktop-darwin-x64.dmg`     |
| Windows               | `HopCoderX-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm` или AppImage           |

```bash
# macOS (Homebrew)
brew install --cask HopCoderX-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/HopCoderX-desktop
```

#### Каталог установки

Скрипт установки выбирает путь установки в следующем порядке приоритета:

1. `$HOPCODERX_INSTALL_DIR` - Пользовательский каталог установки
2. `$XDG_BIN_DIR` - Путь, совместимый со спецификацией XDG Base Directory
3. `$HOME/bin` - Стандартный каталог пользовательских бинарников (если существует или можно создать)
4. `$HOME/.HopCoderX/bin` - Fallback по умолчанию

```bash
# Примеры
HOPCODERX_INSTALL_DIR=/usr/local/bin curl -fsSL https://HopCoderX.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://HopCoderX.ai/install | bash
```

### Agents

В HopCoderX есть два встроенных агента, между которыми можно переключаться клавишей `Tab`.

- **build** - По умолчанию, агент с полным доступом для разработки
- **plan** - Агент только для чтения для анализа и изучения кода
  - По умолчанию запрещает редактирование файлов
  - Запрашивает разрешение перед выполнением bash-команд
  - Идеален для изучения незнакомых кодовых баз или планирования изменений

Также включен сабагент **general** для сложных поисков и многошаговых задач.
Он используется внутренне и может быть вызван в сообщениях через `@general`.

Подробнее об [agents](https://HopCoderX.ai/docs/agents).

### Документация

Больше информации о том, как настроить HopCoderX: [**наши docs**](https://HopCoderX.ai/docs).

### Вклад

Если вы хотите внести вклад в HopCoderX, прочитайте [contributing docs](./CONTRIBUTING.md) перед тем, как отправлять pull request.

### Разработка на базе HopCoderX

Если вы делаете проект, связанный с HopCoderX, и используете "HopCoderX" как часть имени (например, "HopCoderX-dashboard" или "HopCoderX-mobile"), добавьте примечание в README, чтобы уточнить, что проект не создан командой HopCoderX и не аффилирован с нами.

### FAQ

#### Чем это отличается от Claude Code?

По возможностям это очень похоже на Claude Code. Вот ключевые отличия:

- 100% open source
- Не привязано к одному провайдеру. Мы рекомендуем модели из [HopCoderX Bdr](https://HopCoderX.ai/zen); но HopCoderX можно использовать с Claude, OpenAI, Google или даже локальными моделями. По мере развития моделей разрыв будет сокращаться, а цены падать, поэтому важна независимость от провайдера.
- Поддержка LSP из коробки
- Фокус на TUI. HopCoderX построен пользователями neovim и создателями [terminal.shop](https://terminal.shop); мы будем раздвигать границы того, что возможно в терминале.
- Архитектура клиент/сервер. Например, это позволяет запускать HopCoderX на вашем компьютере, а управлять им удаленно из мобильного приложения. Это значит, что TUI-фронтенд - лишь один из возможных клиентов.

---

**Присоединяйтесь к нашему сообществу** [Discord](https://discord.gg/HopCoderX) | [X.com](https://x.com/HopCoderX)
