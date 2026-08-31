import { MongoClient } from 'mongodb';
import getSteamId64 from './getSteamID64.js';

async function getSteamIdFormSubmit(interaction, steamLink, dbLink, steamApi) {
  const clientdb = new MongoClient(dbLink);
  const dbName = 'SquadJS';
  const dbCollection = 'mainstats';
  const discordId = interaction.user.id;
  try {
    const steamId = await getSteamId64(steamApi, steamLink);
    if (!steamId) {
      return interaction.reply({
        content:
          'Проверьте правильность ввода STEAMID64 / Ссылки на профиль STEAM!',
        ephemeral: true,
      });
    }
    if (steamId) {
      await clientdb.connect();
      const db = clientdb.db(dbName);
      const collection = db.collection(dbCollection);
      const existingDiscord = await collection.findOne({
        discordid: discordId,
      });
      const existingSteam = await collection.findOne({ _id: steamId });

      if (!existingSteam) {
        return interaction.reply({
          content:
            'Пользователь не найден в списках игроков, проверьте правильность ввода Steam профиля',
          ephemeral: true,
        });
      }

      if (existingSteam && existingSteam.discordid === discordId) {
        return interaction.reply({
          content:
            'Указанный Steam профиль уже привязан к вашему Discord аккаунту!',
          ephemeral: true,
        });
      }

      if (existingSteam && existingSteam.discordid) {
        return interaction.reply({
          content:
            'Указанный Steam профиль уже привязан к другому Discord аккаунту. Если это ваш SteamID, обратитесь к администратору сервера.',
          ephemeral: true,
        });
      }

      if (existingDiscord && existingDiscord._id) {
        return interaction.reply({
          content: 'Ваш Discord аккаунт уже привязан к другому Steam профилю!',
          ephemeral: true,
        });
      }

      const filter = {
        _id: steamId,
      };

      const update = {
        $set: {
          discordid: discordId,
        },
      };

      await collection.updateOne(filter, update, {
        upsert: true,
      });

      await clientdb.close();

      return interaction.reply({
        content:
          'Steam профиль успешно привязан к аккаунту. Теперь вы можете получить статистику командой /stats в канале статистики.',
        ephemeral: true,
      });
    }
  } catch (e) {
    console.log('Error in steamIdFormSubmit:', e);
  }
}

export default getSteamIdFormSubmit;
