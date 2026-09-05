# 5thMRsquadJS

`5thMRsquadJS` — сервис управления выделенными серверами Squad. Он подключается
к серверам по RCON, читает игровые журналы и запускает плагины модерации,
голосований, балансировки и статистики.

Репозиторий содержит два взаимосвязанных сервиса:

1. Основной сервис `5thMRsquadJS`, который обрабатывает события серверов Squad и
   записывает статистику в MongoDB.
2. Discord-бот в каталоге [`discord-bot`](./discord-bot), который читает эту
   статистику, создаёт карточки игроков и обновляет таблицы лидеров в Discord.

Оба сервиса рассчитаны на Debian 13 и запускаются через PM2 от текущего
пользователя сервера. Отдельный системный пользователь не создаётся.

## Системные требования

- Debian 13, архитектура `amd64`/`x86_64`.
- Строго Node.js `18.18.2`.
- npm `9.8.1`, входящий в Node.js `18.18.2`.
- Yarn Classic `1.22.22` для основного сервиса.
- PM2 для управления процессами.
- MongoDB для `rnsStats`, рейтингов, истории матчей и Discord-бота.
- MariaDB только при использовании `officialKothDb`.
- Сетевой доступ к RCON и журналам серверов Squad.

> **Предупреждение:** Node.js `18.18.2` снята с поддержки и больше не получает
> исправления безопасности. Версия закреплена как требование совместимости
> проекта. Не заменяйте её без полного тестирования обоих сервисов.

## Рекомендуемая структура на сервере

```text
/home/5thMRsquadJS/
├── src/                       исходный код основного сервиса
├── lib/                       результат команды yarn build
├── discord-bot/               Discord-бот статистики
├── config.example.json        пример конфигурации
├── config.json                рабочая конфигурация, не сохраняется в Git
├── .env.example               пример переменных основного сервиса
├── .env                       секреты, не сохраняются в Git
├── package.json
└── yarn.lock
```

## Установка на Debian 13

### 1. Системные пакеты

```bash
sudo apt update

sudo apt install -y \
  ca-certificates \
  curl \
  xz-utils \
  git \
  build-essential \
  python3 \
  pkg-config \
  libcairo2-dev \
  libpango1.0-dev \
  libjpeg-dev \
  libgif-dev \
  librsvg2-dev
```

Библиотеки Cairo, Pango, JPEG, GIF и SVG нужны модулю `canvas`, который
Discord-бот использует для формирования изображений.

### 2. Установка строго Node.js 18.18.2

Не устанавливайте Node.js через `apt install nodejs` или NodeSource: эти способы
не гарантируют точную версию `18.18.2`.

Проверьте архитектуру:

```bash
dpkg --print-architecture
uname -m
```

Для дальнейших команд ожидаются `amd64` и `x86_64`.

Скачайте официальный архив:

```bash
cd /tmp

curl -fLO \
  https://nodejs.org/download/release/v18.18.2/node-v18.18.2-linux-x64.tar.xz
```

Проверьте контрольную сумму:

```bash
echo "75aba25ae76999309fc6c598efe56ce53fbfc221381a44a840864276264ab8ac  node-v18.18.2-linux-x64.tar.xz" \
  | sha256sum --check
```

Ожидаемый результат:

```text
node-v18.18.2-linux-x64.tar.xz: OK
```

Распакуйте Node.js в отдельный каталог:

```bash
sudo mkdir -p /opt/nodejs-18.18.2

sudo tar \
  --extract \
  --xz \
  --file=/tmp/node-v18.18.2-linux-x64.tar.xz \
  --directory=/opt/nodejs-18.18.2 \
  --strip-components=1
```

Создайте системные ссылки:

```bash
sudo ln -sfn /opt/nodejs-18.18.2/bin/node /usr/local/bin/node
sudo ln -sfn /opt/nodejs-18.18.2/bin/npm /usr/local/bin/npm
sudo ln -sfn /opt/nodejs-18.18.2/bin/npx /usr/local/bin/npx
sudo ln -sfn /opt/nodejs-18.18.2/bin/corepack /usr/local/bin/corepack

hash -r
```

Проверьте установку:

```bash
node --version
npm --version
readlink -f "$(command -v node)"
```

Ожидаемые значения:

```text
v18.18.2
9.8.1
/opt/nodejs-18.18.2/bin/node
```

### 3. Установка Yarn и PM2

```bash
sudo /opt/nodejs-18.18.2/bin/npm install \
  --global \
  --prefix /opt/nodejs-18.18.2 \
  yarn@1.22.22 \
  pm2

sudo ln -sfn /opt/nodejs-18.18.2/bin/yarn /usr/local/bin/yarn
sudo ln -sfn /opt/nodejs-18.18.2/bin/yarnpkg /usr/local/bin/yarnpkg
sudo ln -sfn /opt/nodejs-18.18.2/bin/pm2 /usr/local/bin/pm2
sudo ln -sfn /opt/nodejs-18.18.2/bin/pm2-runtime /usr/local/bin/pm2-runtime
```

Проверьте команды:

```bash
node --version
npm --version
yarn --version
pm2 --version
```

## Размещение проекта

Создайте каталог и назначьте владельцем текущего пользователя:

```bash
sudo mkdir -p /home/5thMRsquadJS
sudo chown -R "$(id -un):$(id -gn)" /home/5thMRsquadJS
```

Если проект хранится в Git:

```bash
git clone <адрес-репозитория> /home/5thMRsquadJS
```

Если файлы переданы другим способом, разместите их в `/home/5thMRsquadJS` и
проверьте владельца:

```bash
sudo chown -R "$(id -un):$(id -gn)" /home/5thMRsquadJS
```

Не переносите `node_modules` с другого компьютера. Все зависимости, особенно
нативный модуль `canvas`, должны устанавливаться на целевом сервере.

## Установка зависимостей

Проверьте точную версию Node.js:

```bash
test "$(node --version)" = "v18.18.2" || {
  echo "Ошибка: требуется строго Node.js v18.18.2"
  exit 1
}
```

Установите зависимости основного сервиса:

```bash
cd /home/5thMRsquadJS
HUSKY=0 yarn install --frozen-lockfile
```

Установите зависимости Discord-бота:

```bash
npm --prefix discord-bot ci
```

Основной сервис использует `yarn.lock`, а Discord-бот — свой
`package-lock.json`. Не меняйте менеджеры пакетов местами.

## Настройка основного сервиса

### Переменные окружения

```bash
cd /home/5thMRsquadJS
cp .env.example .env
nano .env
chmod 600 .env
```

| Переменная      | Назначение                                          |
| --------------- | --------------------------------------------------- |
| `RCON_PASSWORD` | Пароль RCON сервера Squad.                          |
| `MONGO_URI`     | Строка подключения к MongoDB.                       |
| `STEAM_API_KEY` | Ключ Steam Web API для использующих его плагинов.   |
| `FTP_USER`      | Имя пользователя для удалённого доступа к журналам. |
| `FTP_PASSWORD`  | Пароль для удалённого доступа к журналам.           |

### Конфигурация серверов

```bash
cd /home/5thMRsquadJS
cp config.example.json config.json
nano config.json
chmod 600 config.json
```

Проверьте синтаксис:

```bash
node -e "JSON.parse(require('fs').readFileSync('/home/5thMRsquadJS/config.json', 'utf8')); console.log('config.json: корректный JSON')"
```

`config.json` — объект, где каждый ключ верхнего уровня является числовым
идентификатором сервера.

| Поле             | Назначение                                       |
| ---------------- | ------------------------------------------------ |
| `host`           | IP-адрес или имя RCON-сервера.                   |
| `port`           | Порт RCON.                                       |
| `password`       | Пароль RCON, рекомендуется `${RCON_PASSWORD}`.   |
| `logFilePath`    | Путь к `SquadGame.log`.                          |
| `adminsFilePath` | Путь к `Admins.cfg`.                             |
| `mapsName`       | Файл с данными карт, например `vanilla.json`.    |
| `db`             | Строка подключения к MongoDB.                    |
| `database`       | Имя базы MongoDB. Discord-бот ожидает `SquadJS`. |
| `mapsRegExp`     | Выражение для разбора названий слоёв.            |
| `ftp`            | Данные удалённого доступа к журналам.            |
| `plugins`        | Массив подключённых плагинов и их параметров.    |

Значения могут ссылаться на переменные из `.env`:

```json
{
  "password": "${RCON_PASSWORD}",
  "db": "${MONGO_URI}"
}
```

Для нескольких серверов добавьте несколько верхнеуровневых ключей:

```json
{
  "1": {
    "host": "127.0.0.1",
    "port": 21114,
    "password": "${RCON_PASSWORD}",
    "plugins": []
  },
  "2": {
    "host": "127.0.0.1",
    "port": 21124,
    "password": "${RCON_PASSWORD}",
    "plugins": []
  }
}
```

Серверы с одинаковыми `db` и `database` используют общее подключение и общую
статистику. Для полностью раздельной статистики укажите разные базы.

## Настройка Discord-бота

Полная инструкция находится в
[`discord-bot/README.md`](./discord-bot/README.md).

Краткая подготовка:

```bash
cd /home/5thMRsquadJS/discord-bot
cp .env.example .env
nano .env
chmod 600 .env
nano config.js
```

Discord-бот должен подключаться к тому же MongoDB-серверу, куда `rnsStats`
записывает коллекции `mainstats` и `tempstats`. Имя базы в Discord-боте
закреплено как `SquadJS`.

В `discord-bot/config.js` проверьте идентификаторы каналов и 12 сообщений таблиц
лидеров. Бот редактирует существующие сообщения и не создаёт их автоматически.

### Прокси Discord

Текущий код всегда использует HTTP-прокси:

```text
http://127.0.0.1:1080
```

Проверка:

```bash
ss -lntp | grep ':1080'

curl --proxy http://127.0.0.1:1080 \
  --connect-timeout 10 \
  https://discord.com/api/v10/gateway
```

Если прокси недоступен, Discord-бот не подключится.

## Сборка и проверка

```bash
cd /home/5thMRsquadJS

test "$(node --version)" = "v18.18.2" || exit 1

yarn test
yarn build
```

Проверьте сборку:

```bash
test -f /home/5thMRsquadJS/lib/index.js \
  && echo "Основной сервис успешно собран"
```

Проверьте Discord-бота и `canvas`:

```bash
cd /home/5thMRsquadJS/discord-bot

node --check index.js

node -e "import('canvas').then(() => console.log('canvas: готов')).catch(error => { console.error(error); process.exit(1); })"
```

## Регистрация команд Discord

Выполняется при первой установке и после изменения структуры команд:

```bash
cd /home/5thMRsquadJS/discord-bot
npm run commands:deploy
```

Удаление зарегистрированных команд:

```bash
npm run commands:remove
```

## Запуск через PM2

Оба процесса запускаются от текущего пользователя. Не используйте `sudo pm2`,
если первоначальный запуск выполнялся без `sudo`: у `root` будет другой список
процессов PM2.

Не используйте кластерный режим и параметр `-i max`. Каждому сервису нужен один
процесс.

Запустите основной сервис:

```bash
pm2 start /home/5thMRsquadJS/lib/index.js \
  --name 5thmr-squad-rcon \
  --cwd /home/5thMRsquadJS \
  --interpreter /opt/nodejs-18.18.2/bin/node \
  --time \
  --restart-delay 5000
```

Запустите Discord-бота:

```bash
pm2 start /home/5thMRsquadJS/discord-bot/index.js \
  --name 5thmr-stats-discord \
  --cwd /home/5thMRsquadJS/discord-bot \
  --interpreter /opt/nodejs-18.18.2/bin/node \
  --time \
  --restart-delay 5000
```

Абсолютный `--interpreter` закрепляет Node.js `18.18.2`. Параметр `--cwd`
обязателен для Discord-бота, потому что изображения и шрифты загружаются через
относительные пути.

Проверьте процессы:

```bash
pm2 status
pm2 describe 5thmr-squad-rcon
pm2 describe 5thmr-stats-discord
pm2 logs --lines 100
```

PM2 перезапустит процесс после программного сбоя, пока работает сам демон PM2.
Автоматический запуск после перезагрузки Debian намеренно не настраивается.

После перезагрузки сервера восстановите ранее сохранленный список вручную:

```bash
pm2 resurrect
pm2 status
```

Перед этим один раз сохраните текущий список после запуска обоих сервисов:

```bash
pm2 save
```

`pm2 save` не включает автоматический запуск при загрузке системы. Он только
создаёт список для последующей ручной команды `pm2 resurrect`.

## Управление процессами

```bash
pm2 status

pm2 logs 5thmr-squad-rcon --lines 100
pm2 logs 5thmr-stats-discord --lines 100

pm2 restart 5thmr-squad-rcon
pm2 restart 5thmr-stats-discord

pm2 stop 5thmr-squad-rcon
pm2 stop 5thmr-stats-discord

pm2 start 5thmr-squad-rcon
pm2 start 5thmr-stats-discord
```

### Ротация журналов PM2

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

## Обновление проекта

```bash
cd /home/5thMRsquadJS

test "$(node --version)" = "v18.18.2" || {
  echo "Обновление остановлено: требуется Node.js v18.18.2"
  exit 1
}

git pull --ff-only

HUSKY=0 yarn install --frozen-lockfile
yarn test
yarn build

npm --prefix discord-bot ci

pm2 restart 5thmr-squad-rcon
pm2 restart 5thmr-stats-discord

pm2 status
pm2 logs --lines 100
```

Если менялась структура команд Discord:

```bash
npm --prefix discord-bot run commands:deploy
```

## Безопасность и сетевой доступ

Серверу нужны исходящие подключения:

- к Discord API и Discord Gateway;
- к Steam Web API;
- к MongoDB;
- к RCON-портам серверов Squad;
- к журналам или FTP/SFTP, если они используются.

Сервисы не открывают собственный веб-порт. Не публикуйте MongoDB для всего
интернета: ограничьте доступ IP-адресом сервера, локальной сетью или VPN.

Не сохраняйте в Git:

```text
/home/5thMRsquadJS/.env
/home/5thMRsquadJS/config.json
/home/5thMRsquadJS/discord-bot/.env
```

## Плагины основного сервиса

Плагин включается через `"enabled": true` в массиве `plugins` нужного сервера.
Примеры параметров находятся в `config.example.json`.

| Плагин               | Назначение                                                        |
| -------------------- | ----------------------------------------------------------------- |
| `rnsStats`           | Статистика, история матчей и рейтинг Glicko-2 в MongoDB.          |
| `rnsLogs`            | Запись игровых событий каждого матча в JSON.                      |
| `rnsTelemetry`       | Телеметрия CSV и обнаружение подозрительных событий.              |
| `officialKothDb`     | Синхронизация статистики KOTH с MariaDB.                          |
| `broadcast`          | Периодические сообщения игрокам.                                  |
| `knifeBroadcast`     | Оповещения об убийствах ножом.                                    |
| `autorestartServers` | Перезапуск пустого сервера после минимального времени работы.     |
| `fobExplosionDamage` | Реакция на подрыв союзных FOB/HAB.                                |
| `adminsReloadConfig` | Перезагрузка `Admins.cfg` после изменения.                        |
| `bonuses`            | Бонусы за время на сервере с ограничениями по числу игроков.      |
| `warnPlayers`        | Предупреждения при подключении, смене роли и командных убийствах. |
| `explosiveDamaged`   | Обработка союзного урона взрывчаткой.                             |
| `squadLeaderRole`    | Проверка комплекта командира отделения.                           |
| `autoKickUnassigned` | Удаление игроков без отделения после предупреждений.              |
| `adminCamBlocker`    | Ограничение возвращения из административной камеры в отделение.   |
| `levelSync`          | Запись уровней KOTH в файл префиксов.                             |
| `autoUpdateMods`     | Проверка обновлений модификаций и перезапуск сервиса.             |
| `voteMap`            | Голосование за обычную карту.                                     |
| `voteMapMods`        | Голосование за модифицированную карту.                            |
| `skipmap`            | Голосование за пропуск текущей карты.                             |
| `chatCommands`       | Игровые команды чата, отчёты, статистика и балансировка.          |
| `randomizerMaps`     | Случайный выбор карт, фракций и типов подразделений.              |
| `smartBalance`       | Балансировка по числу игроков, группам и рейтингу.                |
| `seedKillfeed`       | Личные сообщения об убийствах на Seed-картах.                     |
| `roundTopsBroadcast` | Итоги раунда по убийствам, ножам, поднятиям и смертям.            |

## Рейтинг игроков

`rnsStats` рассчитывает рейтинг Glicko-2. Для игрока хранятся рейтинг `mu`,
неопределённость `rd` и волатильность `sigma`. Результат учитывает личную
эффективность относительно всего сервера, силу убитых противников, поддержку
команды и командные убийства. Seed-карты не участвуют в рейтинге.

| Параметр         | По умолчанию     | Назначение                                       |
| ---------------- | ---------------- | ------------------------------------------------ |
| `eloEnabled`     | `true`           | Обновлять рейтинг в конце раунда.                |
| `eloMinPlayers`  | `10`             | Минимальное число участников рейтингового матча. |
| `eloDisplayMode` | `"conservative"` | Показывать `mu - 2*rd` или чистое `mu`.          |

## Умная балансировка

`smartBalance` выравнивает число игроков, распределяет кланы и группы, а затем
сравнивает рейтинги и силу руководящих ролей. Отделения, найденные группы друзей
и цельные кланы не разделяются между командами.

Основные параметры:

| Параметр                  | По умолчанию | Назначение                                               |
| ------------------------- | ------------ | -------------------------------------------------------- |
| `autoBalance`             | `false`      | Автоматическая балансировка в конце раунда.              |
| `teamCap`                 | `50`         | Максимальное число игроков в команде.                    |
| `skillTolerancePct`       | `0.05`       | Целевой допустимый разрыв рейтинга.                      |
| `balanceLeadership`       | `true`       | Учитывать командиров и лидеров отделений.                |
| `leadTolerance`           | `150`        | Допустимый разрыв рейтинга лидерства.                    |
| `clanMaxStackPerSide`     | `6`          | Максимальная группа одного клана на стороне.             |
| `skillMinGames`           | `3`          | Число матчей до использования рейтинга игрока.           |
| `refreshSkillEachBalance` | `true`       | Обновлять рейтинги перед балансировкой.                  |
| `protectCommander`        | `true`       | Не перемещать командира при ручной балансировке.         |
| `protectSquadLeader`      | `true`       | Не перемещать лидеров отделений при ручной балансировке. |
| `protectAtRoundEnd`       | `false`      | Сохранять защиту ролей в конце раунда.                   |

Ручное управление доступно через `!balance` и `!balanceoff` плагина
`chatCommands`.

## Разработка и локальная проверка

```bash
yarn test
yarn test:coverage
yarn lint:check
yarn lint:format
yarn new:plugin имяПлагина
```

Перед любой проверкой и сборкой убедитесь в точной версии Node.js:

```bash
test "$(node --version)" = "v18.18.2" || exit 1
```
