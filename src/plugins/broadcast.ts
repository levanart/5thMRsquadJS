import { z } from 'zod';
import { adminBroadcast } from '../core';
import { definePlugin } from '../core/plugin';
import { getPlayers } from './helpers';

const optionsSchema = z.object({
  texts: z.array(z.string()).default([]),
  interval: z.coerce.number().int().positive().default(180000),
});

export default definePlugin({
  name: 'broadcast',
  description: 'Периодическая рассылка сообщений в эфир сервера.',
  optionsSchema,
  setup({ state, options, logger, registerDisposable }) {
    const { execute } = state;
    const { texts, interval } = options;
    const messages = texts.map((text) => text.trim()).filter(Boolean);

    if (messages.length === 0) {
      logger.warn(
        'broadcast: список "texts" не содержит непустых сообщений — рассылка не запущена.',
      );
      return;
    }

    let index = 0;
    const printText = () => {
      const players = getPlayers(state);
      if (!players || players.length === 0) return;

      void adminBroadcast(execute, messages[index]).catch((error) =>
        logger.error(`broadcast: ошибка отправки сообщения: ${String(error)}`),
      );

      index = (index + 1) % messages.length;
    };

    const timer = setInterval(printText, interval);
    registerDisposable(() => clearInterval(timer));
  },
});
