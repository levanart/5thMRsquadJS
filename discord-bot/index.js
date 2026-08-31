import { Client, Collection, Events, GatewayIntentBits } from 'discord.js';
import { config } from 'dotenv';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import getCommands from './commands/getCommands.js';
import options from './config.js';
import './utility/fonts.js';
import getSteamIdFormSubmit from './utility/getSteamIdFormSubmit.js';
import getSteamIdModal from './utility/getSteamIdModal.js';
import top20StatsMain from './utility/top20StatsMain.js';
import top20StatsTemp from './utility/top20StatsTemp.js';

config();
const proxyUrl = 'http://127.0.0.1:1080';

// REST-клиент Discord (undici) будет ходить через этот SOCKS
const restProxy = new ProxyAgent(proxyUrl);
setGlobalDispatcher(restProxy);

// Для WebSocket (gateway.discord.gg) делаем отдельный агент
const wsProxyAgent = new HttpsProxyAgent(proxyUrl);

const steamApi = process.env.STEAM_API;
let updateInterval;
let isUpdating = false;

const client = new Client({
  intents: [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  ws: {
    agent: wsProxyAgent,
  },
});

client.commands = new Collection();

async function initialize() {
  try {
    const commands = await getCommands();

    for (const command of commands) {
      if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
      } else {
        console.log(`The command missing required properties in index.js`);
      }
    }

    client.on('ready', async () => {
      console.log(`Logged in as ${client.user.tag}!`);

      async function updateLeaderboards() {
        if (isUpdating) {
          console.log('Previous update still in progress, skipping...');
          return;
        }

        isUpdating = true;

        try {
          const mainChannel = await client.channels
            .fetch(options.leaderboadChannelIdMain)
            .catch((err) =>
              console.error('Ошибка при поиске основного канала:', err),
            );

          if (mainChannel) {
            await top20StatsMain(mainChannel, process.env.DBLINK).catch((err) =>
              console.error('Ошибка в top20StatsMain:', err),
            );
          }

          const tempChannel = await client.channels
            .fetch(options.leaderboadChannelIdTemp)
            .catch((err) =>
              console.error('Ошибка при поиске временного канала:', err),
            );

          if (tempChannel) {
            await top20StatsTemp(tempChannel, process.env.DBLINK).catch((err) =>
              console.error('Ошибка в top20StatsTemp:', err),
            );
          }
        } catch (e) {
          console.error('Global update error:', e);
        } finally {
          isUpdating = false;
        }
      }

      updateLeaderboards();

      if (updateInterval) clearInterval(updateInterval);
      updateInterval = setInterval(updateLeaderboards, 300000);
    });

    client.on(Events.InteractionCreate, async (interaction) => {
      if (interaction.isChatInputCommand()) {
        const command = interaction.client.commands.get(
          interaction.commandName,
        );
        if (!command) return;

        try {
          await command.execute(interaction);
        } catch (error) {
          console.error('Command execution error:', error);
          try {
            if (interaction.replied || interaction.deferred) {
              await interaction.followUp({
                content: 'There was an error while executing this command!',
                ephemeral: true,
              });
            } else {
              await interaction.reply({
                content: 'There was an error while executing this command!',
                ephemeral: true,
              });
            }
          } catch (e) {
            console.error('Failed to send error message:', e);
          }
        }
      }

      if (interaction.isModalSubmit()) {
        const steamIdField = interaction.fields.fields.get('steamid64input');
        if (steamIdField) {
          try {
            await getSteamIdFormSubmit(
              interaction,
              steamIdField.value,
              process.env.DBLINK,
              steamApi,
            );
          } catch (e) {
            console.error('Steam ID submit error:', e);
            await interaction.reply({
              content: 'An error occurred while processing your Steam ID.',
              ephemeral: true,
            });
          }
        }
      }

      if (interaction.isButton() && interaction.customId === 'AddSteam') {
        try {
          await getSteamIdModal(interaction);
        } catch (e) {
          console.error('Steam modal error:', e);
        }
      }
    });

    await client.login(process.env.CLIENT_TOKEN);
  } catch (error) {
    console.error('Initialization error:', error);
    process.exit(1);
  }
}

initialize();
