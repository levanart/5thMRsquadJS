import { createCanvas, loadImage } from 'canvas';
import { AttachmentBuilder } from 'discord.js';
import * as fs from 'fs';
import { MongoClient } from 'mongodb';
import calcVehicleKills from './calcVehicleKills.js';
import calcVehicleTime from './calcVehicleTime.js';
import getExp from './getExp.js';

async function loadImageAndDraw(
  ctx,
  imgPath,
  x,
  y,
  width = null,
  height = null,
) {
  try {
    const img = await loadImage(imgPath);

    // Если размеры не указаны, используем размеры изображения
    const imgWidth = width || img.width;
    const imgHeight = height || img.height;

    // Рисуем изображение на холсте
    ctx.drawImage(img, x, y, imgWidth, imgHeight);
  } catch (err) {
    console.log(`Image ${imgPath} not found: ${err}`);
  }
}

async function gettime(time, field) {
  if (field === 'sec') {
    time = time / 1000;
    const h = Math.floor((time % (3600 * 24)) / 3600);
    const m = Math.floor((time % 3600) / 60);
    const hDisplay = h > 0 ? h + 'ч' : '';
    const mDisplay = m > 0 ? m + 'м' : '';
    return hDisplay + mDisplay;
  }
  const d = Math.floor(time / 1440);
  const h = Math.floor((time % 1440) / 60);
  const dDisplay = d > 0 ? d + 'д ' : '';
  const hDisplay = h > 0 ? h + 'ч ' : '';
  return dDisplay + hDisplay;
}

async function getStatsOnDiscord(dblink, steamId, interaction) {
  const clientdb = new MongoClient(dblink);
  const dbName = 'SquadJS';
  const dbCollection = 'mainstats';
  try {
    await clientdb.connect();
    const db = clientdb.db(dbName);
    const collection = db.collection(dbCollection);
    const user = await collection.findOne({
      _id: steamId,
    });
    if (!user) {
      await interaction.editReply({
        content: 'Игрок не найден в базе данных.',
        ephemeral: true,
      });
      return;
    }
    const roles = Object.entries(user.roles);
    let sortRoles = roles.sort((a, b) => b[1] - a[1]);
    const weapons = Object.entries(user.weapons);
    const resultWeapons = {};
    let artillerySum = 0;
    let knifeSum = 0;

    for (const [key, value] of weapons) {
      let [prefix, suffix] = key.split('_')[1].includes('Projectile')
        ? key.split('_').slice(1, 3)
        : [key.split('_')[1]];

      const weaponKey = suffix ? `${prefix} ${suffix}` : prefix;
      if (weaponKey === 'Projectile 155mm' || weaponKey === 'Heavy') {
        artillerySum += value;
      } else {
        resultWeapons[weaponKey] = (resultWeapons[weaponKey] || 0) + value;
      }

      if (
        weaponKey === 'SOCP' ||
        weaponKey === 'AK74Bayonet' ||
        weaponKey === 'M9Bayonet' ||
        weaponKey === 'G3Bayonet' ||
        weaponKey === 'Bayonet2000' ||
        weaponKey === 'AKMBayonet' ||
        weaponKey === 'SA80Bayonet' ||
        weaponKey === 'QNL-95' ||
        weaponKey === 'OKC-3S'
      ) {
        knifeSum += value;
      }
    }

    const resultArray = Object.entries(resultWeapons).sort(
      (a, b) => b[1] - a[1],
    );
    const time = (await gettime(user.squad.timeplayed?.toString())) || 0;
    const roleTime1 = await gettime(sortRoles[0][1].toString());
    const role1Img = sortRoles[0][0].split('_').join('');
    const leader = (await gettime(user.squad.leader?.toString())) || 0;
    const cmd = (await gettime(user.squad.cmd?.toString())) || 0;
    const vehicle = await calcVehicleTime(user.possess);
    const vehicleKills = await calcVehicleKills(user.weapons);
    const heliTime = (await gettime(vehicle[1])) || 0;
    const heavyTime = (await gettime(vehicle[0])) || 0;
    const exp = getExp(user);
    const rank = exp.rankImg;
    const width = 2560;
    const height = 1440;
    let canvas = createCanvas(width, height);
    let ctx = canvas.getContext('2d');

    await loadImageAndDraw(ctx, './img/stats.jpg', 0, 0, 2560, 1440);
    await loadImageAndDraw(ctx, `./img/${rank}.png`, 79, 296, 78, 44);
    await loadImageAndDraw(
      ctx,
      `./img/weapons/${resultArray[0][0].toLowerCase()}.png`,
      93,
      1224,
      260,
      130,
    );
    await loadImageAndDraw(
      ctx,
      `./img/Icon_${role1Img}_kit.png`,
      770,
      1235,
      107,
      107,
    );
    await loadImageAndDraw(ctx, `./img/${exp.img}.png`, 1644, 0);

    const drawText = async (ctx, text, maxWidth, initialFontSize, x, y) => {
      let fontSize = initialFontSize;
      ctx.font = `${fontSize}px Akony`;

      while (ctx.measureText(text).width > maxWidth && fontSize > 0) {
        fontSize -= 0.1;
        ctx.font = `${fontSize}px Akony`;
      }
      ctx.fillText(text, x, y);
    };

    ctx.font = '162px Akony';
    ctx.fillStyle = 'rgba(255, 255, 255, 0)'; // Полностью прозрачный текст
    ctx.strokeStyle = '#E17F38'; // Цвет обводки
    ctx.lineWidth = 3; // Толщина обводки
    ctx.strokeText(user.name, -40, 191); // Имя задний фон

    ctx.fillStyle = '#efefef';
    ctx.font = '111px Akony';
    await drawText(ctx, user.name, 2400, 111, 72, 227); // Имя основное

    ctx.font = '42px Inter-bold';
    ctx.fillText(
      `${exp.rankStr.toUpperCase()} ${user.name.toUpperCase()}`,
      175,
      333,
    ); // Звание + ник

    ctx.font = '48px Inter-light';
    ctx.fillText(exp.expProgress, 1371, 449); // Прогресс экспы

    ctx.font = '40px Inter-bold';
    ctx.fillText('K/D', 111, 583);
    ctx.fillText('УБИЙСТВ', 514, 583);
    ctx.fillText('ВИНРЕЙТ', 917, 583);
    ctx.fillText('ВСЕГО ЧАСОВ', 1320, 583);

    ctx.font = '62px Inter-bold';
    ctx.fillText(user.kd.toString(), 111, 647); // КД
    ctx.fillText(user.kills.toString(), 514, 647); // Убийств
    ctx.fillText(`${~~user.matches.winrate.toString()}%`, 917, 647); // % Побед
    ctx.fillText(time, 1320, 647); // Всего часов

    ctx.font = '38px Inter-bold';
    ctx.fillStyle = '#1E1E1E';
    ctx.fillText('Смертей', 111, 763);
    ctx.fillText('Ножом', 514, 763);
    ctx.fillText('Всего игр', 917, 763);
    ctx.fillText('Сквадной', 1320, 763);

    ctx.fillText('Помощи', 111, 924);
    ctx.fillText('Техникой', 514, 924);
    ctx.fillText('Побед', 917, 924);
    ctx.fillText('CMD', 1320, 924);

    ctx.fillText('Тимкиллы', 111, 1085);
    ctx.fillText('Артилерией', 514, 1085);
    ctx.fillText('Поражений', 917, 1085);
    ctx.fillText('Мехвод', 1320, 1085);
    ctx.fillText('Пилот', 1320, 1246);

    ctx.font = '56px Inter-bold';
    ctx.fillText(user.death.toString(), 111, 827); // Смертей
    ctx.fillText(knifeSum, 514, 827); // Ножом
    ctx.fillText(user.matches.matches, 917, 827); // Всего игр
    ctx.fillText(leader, 1320, 827); // Свадной
    ctx.fillText(user.revives.toString(), 111, 988); // Помощь
    ctx.fillText(`${~~vehicleKills}`, 514, 988); // Техникой
    ctx.fillText(user.matches.won.toString(), 917, 988); //Побед
    ctx.fillText(cmd, 1320, 988); // ЦМД
    ctx.fillText(user.teamkills.toString(), 111, 1149); // Тимкилы
    ctx.fillText(artillerySum, 514, 1149); //Артилерией
    ctx.fillText(user.matches.lose.toString(), 917, 1149); //Поражений
    ctx.fillText(heavyTime, 1320, 1149); // Мехвод
    ctx.fillText(heliTime, 1320, 1310); // Пилот

    ctx.font = '40px Inter-bold';
    ctx.fillStyle = '#D9D9D9';
    ctx.textAlign = 'right';
    ctx.fillText(`${resultArray[0][1]} УБИЙСТВА`, 696, 1280);
    ctx.fillText(`${roleTime1} ВРЕМЯ`, 1200, 1280);

    ctx.font = '40px Inter-regular';
    ctx.fillText(resultArray[0][0], 696, 1327);
    ctx.fillText(sortRoles[0][0].split('_').join('').toUpperCase(), 1200, 1327);

    const x0 = 81;
    const y0 = 409;
    const width1 = 1260;
    const height1 = 44;

    const pct = exp.rankPct;
    ctx.fillStyle = '#E17F38';
    ctx.fillRect(x0, y0, width1 * pct, height1);
    ctx.lineWidth = 2; // Толщина линии обводки
    ctx.strokeRect(x0, y0, width1, height1);

    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync('./stats.jpg', buffer);
    const imageToSend = new AttachmentBuilder('stats.jpg');
    interaction.editReply({ files: [imageToSend] });
    ctx = null;
    canvas = null;
  } catch (e) {
    console.log(e);
    await interaction.editReply({
      content: 'Сыграно слишком мало игр для отображения статистики.',
      ephemeral: true,
    });
  } finally {
    await clientdb.close();
  }
}
export default getStatsOnDiscord;
