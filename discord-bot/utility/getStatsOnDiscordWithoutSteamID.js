import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { MongoClient } from 'mongodb';
import getStatsOnDiscord from './getStatsOnDiscord.js';

async function getStatsOnDiscordWithoutSteamID(dblink, discordid, interaction) {
  const clientdb = new MongoClient(dblink);
  const dbName = 'SquadJS';
  const dbCollection = 'mainstats';
  let steamID;

  try {
    await clientdb.connect();
    const db = clientdb.db(dbName);
    const collection = db.collection(dbCollection);
    const user = await collection.findOne({ discordid: discordid });

    if (!user) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('AddSteam')
          .setLabel('Привязать Steam ID')
          .setStyle(ButtonStyle.Success),
      );

      await interaction.editReply({
        content:
          'Игрок не найден в базе данных. Пожалуйста, привяжите свой Steam ID к Discord, нажав кнопку ниже.',
        components: [row],
        ephemeral: true,
      });
      try {
        await clientdb.close();
      } catch (e) {
        console.error('Error closing MongoDB connection:', e);
      }
      return;
    }

    steamID = user._id;
    await getStatsOnDiscord(dblink, steamID, interaction);
  } catch (e) {
    console.error('Error in getStatsOnDiscordWithoutSteamID:', e);
    await interaction.editReply({
      content: 'Ошибка при получении статистики.',
      ephemeral: true,
    });
  } finally {
    try {
      await clientdb.close();
    } catch (e) {
      console.error('Error closing MongoDB connection:', e);
    }
  }
}

export default getStatsOnDiscordWithoutSteamID;
