import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";

import { config } from "./config.js";
import { chunkForDiscord, discordTime, truncate } from "./format.js";

const ACCENT = 0xc7f56d;
const MAX_FIELDS = 10;

const state = {
  enabled: Boolean(config.discord.token),
  ready: false,
  user: null,
  channelName: "",
  error: config.discord.token ? "" : "Set DISCORD_BOT_TOKEN to turn the bot on.",
  commandsRegistered: false,
};

let client = null;
let handlers = null;
let cachedChannel = null;
let readyPromise = null;

function commandDefinitions() {
  return [
    new SlashCommandBuilder()
      .setName("due")
      .setDescription("What's due soon")
      .addIntegerOption((option) =>
        option
          .setName("days")
          .setDescription("Look-ahead window in days (default 7)")
          .setMinValue(1)
          .setMaxValue(30),
      ),
    new SlashCommandBuilder()
      .setName("next")
      .setDescription("The assignments you should do first")
      .addIntegerOption((option) =>
        option
          .setName("count")
          .setDescription("How many to show (default 3)")
          .setMinValue(1)
          .setMaxValue(8),
      ),
    new SlashCommandBuilder()
      .setName("brief")
      .setDescription("Get a full priority briefing"),
    new SlashCommandBuilder()
      .setName("sync")
      .setDescription("Refresh Google Classroom right now"),
  ].map((command) => command.toJSON());
}

function assignmentLine(assignment) {
  const bits = [assignment.courseName, assignment.duePhrase];
  if (assignment.maxPoints) bits.push(`${assignment.maxPoints} pts`);
  return `**${truncate(assignment.title, 120)}**\n${bits.join(" · ")}`;
}

function dueEmbed(data, days) {
  const now = Date.now();
  const horizon = now + days * 24 * 60 * 60 * 1000;
  const items = data.assignments
    .filter((assignment) => {
      if (assignment.submitted) return false;
      if (!assignment.dueAt) return false;
      const due = new Date(assignment.dueAt).getTime();
      return due <= horizon;
    })
    .slice(0, MAX_FIELDS);

  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle(`Due in the next ${days} day${days === 1 ? "" : "s"}`)
    .setFooter({ text: "Classroom Copilot · /next for priorities" })
    .setTimestamp(new Date());

  if (!items.length) {
    embed.setDescription("Nothing is due in that window. Nice.");
    return embed;
  }

  for (const assignment of items) {
    embed.addFields({
      name: truncate(assignment.courseName, 80),
      value: assignmentLine(assignment),
    });
  }
  return embed;
}

function prioritiesEmbed(data, count) {
  const items = data.assignments
    .filter((assignment) => !assignment.submitted)
    .slice(0, count);
  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle("Do these first")
    .setTimestamp(new Date());

  if (!items.length) {
    embed.setDescription("No open assignments. You're clear.");
    return embed;
  }

  items.forEach((assignment, index) => {
    const reason = assignment.priority?.reasons?.join(" · ") || assignment.duePhrase;
    embed.addFields({
      name: `${index + 1}. ${truncate(assignment.title, 200)}`,
      value: `${truncate(assignment.courseName, 100)}\n${truncate(reason, 200)}`,
    });
  });
  return embed;
}

async function safeReply(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply(payload);
    }
    return await interaction.reply(payload);
  } catch (error) {
    console.warn("[classroom-copilot] Discord reply failed:", error.message);
    return null;
  }
}

async function handleCommand(interaction) {
  const name = interaction.commandName;

  if (name === "due") {
    const days = interaction.options.getInteger("days") || 7;
    const data = await handlers.getDashboard();
    await safeReply(interaction, { embeds: [dueEmbed(data, days)] });
    return;
  }

  if (name === "next") {
    const count = interaction.options.getInteger("count") || 3;
    const data = await handlers.getDashboard();
    await safeReply(interaction, { embeds: [prioritiesEmbed(data, count)] });
    return;
  }

  if (name === "sync") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const result = await handlers.sync();
      const newCount = result.newAssignments?.length || 0;
      await interaction.editReply(
        `Synced **${result.courses}** courses and **${result.assignments}** assignments.` +
          (newCount ? ` ${newCount} new item${newCount === 1 ? "" : "s"}.` : " Nothing new."),
      );
    } catch (error) {
      await interaction.editReply(
        error?.code === "needs_google"
          ? "Google Classroom isn't connected yet. Open Classroom Copilot → Settings to connect it."
          : `Sync failed: ${truncate(error.message, 300)}`,
      );
    }
    return;
  }

  if (name === "brief") {
    await interaction.deferReply();
    try {
      const briefing = await handlers.briefing({ force: true });
      const chunks = chunkForDiscord(briefing.text);
      await interaction.editReply({
        content: chunks[0] || "No briefing available yet.",
      });
      for (const chunk of chunks.slice(1)) {
        await interaction.followUp({ content: chunk });
      }
      if (briefing.source !== "ai") {
        await interaction.followUp({
          content:
            "-# Local planner: add an AI key to .env for a model-written briefing.",
          flags: MessageFlags.SuppressEmbeds,
        });
      }
    } catch (error) {
      await interaction.editReply(
        error?.code === "needs_google"
          ? "Google Classroom isn't connected yet. Open Classroom Copilot → Settings to connect it."
          : `Couldn't build a briefing: ${truncate(error.message, 300)}`,
      );
    }
  }
}

async function registerCommands() {
  if (!client?.user) return;
  const rest = new REST({ version: "10" }).setToken(config.discord.token);
  const body = commandDefinitions();
  try {
    if (config.discord.guildId) {
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, config.discord.guildId),
        { body },
      );
    } else {
      await rest.put(Routes.applicationCommands(client.user.id), { body });
    }
    state.commandsRegistered = true;
  } catch (error) {
    state.error = `Slash commands could not be registered: ${error.message}`;
    console.warn("[classroom-copilot]", state.error);
  }
}

async function resolveChannel() {
  if (cachedChannel?.isTextBased?.()) return cachedChannel;
  if (!config.discord.channelId || !client?.isReady()) return null;
  const channel = await client.channels.fetch(config.discord.channelId).catch(() => null);
  if (!channel?.isTextBased()) return null;
  cachedChannel = channel;
  state.channelName = channel.name || "";
  return channel;
}

export function discordStatus() {
  return {
    configured: Boolean(config.discord.token),
    ready: Boolean(client?.isReady()),
    user: state.user,
    channelConfigured: Boolean(config.discord.channelId),
    channelName: state.channelName,
    commandsRegistered: state.commandsRegistered,
    digestTime: config.discord.digestTime
      ? `${String(config.discord.digestTime.hours).padStart(2, "0")}:${String(
          config.discord.digestTime.minutes,
        ).padStart(2, "0")}`
      : "off",
    alerts: config.discord.alerts,
    error: state.error,
    inviteUrl: client?.user
      ? `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=2048&scope=bot%20applications.commands`
      : "",
  };
}

export async function sendDiscordTest() {
  const channel = await resolveChannel();
  if (!channel) {
    return {
      ok: false,
      error: config.discord.token
        ? "The bot is not in a server with DISCORD_CHANNEL_ID visible yet."
        : "DISCORD_BOT_TOKEN is not set.",
    };
  }
  try {
    await channel.send(
      "**Classroom Copilot is connected.** Try `/due`, `/next`, `/brief` or `/sync`.",
    );
    return { ok: true, channel: channel.name || "" };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export async function sendDailyDigest(data) {
  const channel = await resolveChannel();
  if (!channel) return { ok: false, error: "Discord channel is not available." };
  const top = data.assignments.filter((assignment) => !assignment.submitted).slice(0, 3);
  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle("Today's Classroom plan")
    .setDescription(
      top.length
        ? top
            .map(
              (assignment, index) =>
                `**${index + 1}. ${truncate(assignment.title, 120)}**\n${truncate(
                  assignment.courseName,
                  80,
                )} · ${assignment.duePhrase}${assignment.maxPoints ? ` · ${assignment.maxPoints} pts` : ""}`,
            )
            .join("\n\n")
        : "Nothing due. You're clear.",
    )
    .addFields({
      name: "Snapshot",
      value: `${data.stats.overdue} overdue · ${data.stats.due48h} due in 48h · ${data.stats.done}/${data.stats.total} turned in`,
    })
    .setFooter({ text: "Classroom Copilot · /brief for the full plan" })
    .setTimestamp(new Date());
  if (config.appOrigin) embed.setURL(config.appOrigin);

  try {
    await channel.send({ embeds: [embed] });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export async function sendNewAssignmentAlerts(assignments) {
  const channel = await resolveChannel();
  if (!channel || !assignments.length) return { ok: false, error: "No channel or items." };
  const embed = new EmbedBuilder()
    .setColor(0xffc46b)
    .setTitle(
      `${assignments.length} new assignment${assignments.length === 1 ? "" : "s"} in Classroom`,
    )
    .setDescription(
      assignments
        .slice(0, 6)
        .map(
          (assignment) =>
            `**${truncate(assignment.title, 120)}**\n${truncate(
              assignment.courseName,
              80,
            )}${discordTime(assignment.dueAt) ? ` · due ${discordTime(assignment.dueAt)}` : ""}`,
        )
        .join("\n\n"),
    )
    .setFooter({ text: "Classroom Copilot" })
    .setTimestamp(new Date());
  try {
    await channel.send({ embeds: [embed] });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/**
 * Start the bot in the server process. Handlers are injected so the bot shares
 * the same sync + briefing code (and cache) as the web app.
 */
export async function startDiscordBot(botHandlers) {
  handlers = botHandlers;
  if (!config.discord.token) {
    console.log("[classroom-copilot] Discord bot off (no DISCORD_BOT_TOKEN).");
    return null;
  }

  readyPromise = (async () => {
    client = new Client({
      intents: [GatewayIntentBits.Guilds],
      // Assignment titles and model-written briefings should never ping a
      // role or @everyone.
      allowedMentions: { parse: [] },
    });
    client.on(Events.Error, (error) => {
      state.error = `Discord client error: ${error.message}`;
      console.warn("[classroom-copilot]", state.error);
    });

    client.once(Events.ClientReady, async (readyClient) => {
      state.ready = true;
      state.user = {
        id: readyClient.user.id,
        tag: readyClient.user.tag,
        name: readyClient.user.username,
        avatar: readyClient.user.displayAvatarURL({ size: 64 }),
      };
      state.error = "";
      console.log(`[classroom-copilot] Discord ready as ${readyClient.user.tag}`);
      await registerCommands();
      if (!config.discord.channelId) {
        state.error =
          "Set DISCORD_CHANNEL_ID to receive scheduled digests and alerts.";
      } else {
        const channel = await resolveChannel();
        if (!channel) {
          state.error =
            "DISCORD_CHANNEL_ID was not found or the bot cannot post there.";
        }
      }
    });

    client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      try {
        await handleCommand(interaction);
      } catch (error) {
        console.warn("[classroom-copilot] Discord command failed:", error.message);
        await safeReply(interaction, {
          content:
            error?.code === "needs_google"
              ? "Google Classroom isn't connected yet. Open Classroom Copilot → Settings to connect it."
              : `Something went wrong: ${truncate(error.message, 300)}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    });

    try {
      await client.login(config.discord.token);
    } catch (error) {
      state.ready = false;
      state.error = `Discord login failed: ${error.message}`;
      console.warn("[classroom-copilot]", state.error);
    }
  })();

  await readyPromise;
  return client;
}

export async function stopDiscordBot() {
  if (!client) return;
  try {
    await client.destroy();
  } catch {
    // Shutdown is best-effort.
  }
  client = null;
  state.ready = false;
}
