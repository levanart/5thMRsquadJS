import { createCanvas, loadImage } from 'canvas';
import { AttachmentBuilder } from 'discord.js';
import { imagePath } from './paths.js';
import sortUsers from './sortUsers.js';

const CANVAS_WIDTH = 2560;
const CANVAS_HEIGHT = 1440;

const STATS = [
  'kills',
  'death',
  'revives',
  'teamkills',
  'kd',
  'matches',
  'squad.seed',
];

const STAT_LABELS = {
  kills: 'Убийств',
  death: 'Смертей',
  revives: 'Помощь',
  teamkills: 'ТК',
  kd: 'У/С',
  matches: 'Матчей',
  'squad.seed': 'Время',
};

const COORDINATES = [
  { x: 298, y: 729, maxWidth: 515, fontSize: 26 },
  { x: 298, y: 910, maxWidth: 515, fontSize: 26 },
  { x: 298, y: 1091, maxWidth: 515, fontSize: 26 },
  { x: 1074, y: 418, maxWidth: 515, fontSize: 33 },
  { x: 1074, y: 543, maxWidth: 515, fontSize: 33 },
  { x: 1074, y: 668, maxWidth: 515, fontSize: 33 },
  { x: 1074, y: 793, maxWidth: 515, fontSize: 33 },
  { x: 1074, y: 918, maxWidth: 515, fontSize: 33 },
  { x: 1074, y: 1043, maxWidth: 515, fontSize: 33 },
  { x: 1074, y: 1168, maxWidth: 515, fontSize: 33 },
  { x: 1074, y: 1293, maxWidth: 515, fontSize: 33 },
  { x: 1885, y: 418, maxWidth: 515, fontSize: 33 },
  { x: 1885, y: 543, maxWidth: 515, fontSize: 33 },
  { x: 1885, y: 668, maxWidth: 515, fontSize: 33 },
  { x: 1885, y: 793, maxWidth: 515, fontSize: 33 },
  { x: 1885, y: 918, maxWidth: 515, fontSize: 33 },
  { x: 1885, y: 1043, maxWidth: 515, fontSize: 33 },
  { x: 1885, y: 1168, maxWidth: 515, fontSize: 33 },
  { x: 1885, y: 1293, maxWidth: 515, fontSize: 33 },
];

const normalizeSort = (sort) => (sort ? sort.replace(/^squad\./, '') : '');

const formatMinutes = (v) => {
  const m = Number(v) || 0;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h > 0 ? `${h}ч ${mm}м` : `${mm}м`;
};

const formatStatValue = (sort, val) => {
  if (sort === 'squad.seed') return formatMinutes(val);
  return val;
};

const safeText = (v) => (v === null || v === undefined ? '-' : String(v));

const getNickname = (player) => {
  if (!player) return '';
  const tokens = player.trim().split(/\s+/);
  let numsFound = 0;
  let startIdxOfTail = tokens.length;
  for (let i = tokens.length - 1; i >= 0 && numsFound < 7; i--) {
    if (!isNaN(tokens[i])) {
      numsFound++;
      startIdxOfTail = i;
    }
  }
  return tokens.slice(0, startIdxOfTail).join(' ');
};

const getLast7Numbers = (player) => {
  const splitData = player?.trim().split(/\s+/) ?? [];
  const statsNumbers = [];
  for (let i = splitData.length - 1; i >= 0 && statsNumbers.length < 7; i--) {
    if (!isNaN(splitData[i])) {
      statsNumbers.unshift(splitData[i]);
    }
  }
  return statsNumbers.length === 7 ? statsNumbers : null;
};

const getStats = (player, sort) => {
  if (!player) return '';
  const nums = getLast7Numbers(player);
  if (!nums) return null;

  const idx = STATS.indexOf(sort);
  if (idx === -1) return null;
  return nums[idx];
};

const getColumnName = (sort) => {
  if (!sort) return null;
  if (STAT_LABELS[sort]) return STAT_LABELS[sort];
  const normalized = normalizeSort(sort);
  return STAT_LABELS[normalized] || null;
};

// ——— drawing ———

const drawText = async (ctx, text, maxWidth, initialFontSize, x, y) => {
  let fontSize = initialFontSize;
  ctx.font = `${fontSize}px Akony`;
  while (ctx.measureText(text).width > maxWidth && fontSize > 0) {
    fontSize -= 0.1;
    ctx.font = `${fontSize}px Akony`;
  }
  ctx.fillText(text, x, y);
};

const drawPlayerStats = async (
  ctx,
  player,
  sort,
  { x, y, maxWidth, fontSize },
) => {
  const nickname = getNickname(player);
  const statValRaw = getStats(player, sort);
  const matchesVal = getStats(player, 'matches');

  ctx.textAlign = 'left';
  ctx.font = `${fontSize}px Akony`;
  ctx.fillStyle = '#D9D9D9';
  await drawText(ctx, nickname, maxWidth, fontSize, x, y);

  ctx.font = '22px Inter-bold';
  ctx.fillStyle = '#E2E2E2';
  const statVal = formatStatValue(sort, statValRaw);
  ctx.fillText(
    `${safeText(statVal)} ${getColumnName(sort) ?? ''}     ${safeText(
      matchesVal,
    )} Матчей`,
    x,
    y + 38,
  );
};

const leaderboard = async ({
  channel,
  db,
  sort,
  messageId,
  authorName,
  seconds,
  status,
}) => {
  setTimeout(async () => {
    const [players, message, img] = await Promise.all([
      sortUsers(db, sort, status),
      channel.messages.fetch(messageId),
      loadImage(imagePath('leaderboard.jpg')),
    ]);

    const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const ctx = canvas.getContext('2d');

    ctx.drawImage(img, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const firstPlayer = players[0];
    const firstNickname = getNickname(firstPlayer);

    ctx.font = '162px Akony';
    ctx.strokeStyle = '#E17F38';
    ctx.lineWidth = 3;
    ctx.strokeText(firstNickname, -40, 191);

    ctx.fillStyle = '#efefef';
    await drawText(ctx, firstNickname, 2400, 111, 72, 227);

    await drawText(ctx, firstNickname, 747, 41, 101, 519);
    ctx.fillText(authorName, 106, 1300);

    ctx.font = '36px Inter-bold';
    ctx.fillStyle = '#E2E2E2';

    const firstStat = formatStatValue(sort, getStats(firstPlayer, sort));
    const firstMatches = getStats(firstPlayer, 'matches');

    ctx.fillText(
      `${safeText(firstStat)} ${getColumnName(sort) ?? ''}     ${safeText(
        firstMatches,
      )} Матчей`,
      101,
      576,
    );

    for (let i = 1; i < players.length && i <= COORDINATES.length; i++) {
      await drawPlayerStats(ctx, players[i], sort, COORDINATES[i - 1]);
    }

    const buffer = canvas.toBuffer('image/png');
    const imageToSend = new AttachmentBuilder(buffer, {
      name: 'leaderboard.png',
    });
    message.edit({ files: [imageToSend] });
  }, seconds);
};

export default leaderboard;
