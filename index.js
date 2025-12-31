require('dotenv').config();
const express = require('express');
const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  ChannelType,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits
} = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

// ========== WEB SERVER FOR RENDER ==========
const app = express();
app.get('/', (req, res) => res.send('🤖 Discord Confession Bot Online'));
app.get('/health', (req, res) => res.json({ status: 'online', timestamp: new Date().toISOString() }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Web server ready on port ${PORT}`));

// ========== DISCORD BOT ==========
const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ] 
});

// ========== CONFIGURATION ==========
const CONFIG = {
  confessionChannelId: process.env.CONFESSION_CHANNEL,
  logsChannelId: process.env.LOG_CHANNEL,
  adminRoleId: process.env.ADMIN_ROLE,
  storageFile: './data/confessions.json',
  maxConfessionLength: 1500,
  cooldownMinutes: 2
};

// ========== SLASH COMMANDS ==========
const commands = [
  new SlashCommandBuilder()
    .setName('confess')
    .setDescription('Start an anonymous confession')
    .addStringOption(option =>
      option.setName('confession')
        .setDescription('Your confession (optional, can use button instead)')
        .setRequired(false)
        .setMaxLength(1000)
    ),
  
  new SlashCommandBuilder()
    .setName('confesshelp')
    .setDescription('Get help about the confession system'),
  
  new SlashCommandBuilder()
    .setName('confessstats')
    .setDescription('View confession statistics'),
  
  new SlashCommandBuilder()
    .setName('confesslog')
    .setDescription('[ADMIN] Get all confession logs as CSV')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  
  new SlashCommandBuilder()
    .setName('confessview')
    .setDescription('[ADMIN] View a specific confession')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option.setName('id')
        .setDescription('Confession ID (e.g., CONF-ABC123)')
        .setRequired(true)
    ),
  
  new SlashCommandBuilder()
    .setName('confesssetup')
    .setDescription('[ADMIN] Setup confession channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Channel for confessions')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText)
    )
].map(command => command.toJSON());

// Register slash commands
const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

async function registerCommands() {
  try {
    console.log('🔧 Registering slash commands...');
    await rest.put(
      Routes.applicationCommands(client.user?.id || process.env.CLIENT_ID),
      { body: commands }
    );
    console.log('✅ Slash commands registered!');
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }
}

// ========== STORAGE & UTILITIES ==========
class ConfessionManager {
  constructor() {
    this.confessions = [];
    this.cooldowns = new Map();
    this.ensureDataDir();
  }

  async ensureDataDir() {
    try {
      await fs.mkdir('./data', { recursive: true });
      await this.loadConfessions();
    } catch (error) {
      console.error('❌ Storage setup failed:', error);
    }
  }

  async loadConfessions() {
    try {
      const data = await fs.readFile(CONFIG.storageFile, 'utf8');
      this.confessions = JSON.parse(data);
      console.log(`📂 Loaded ${this.confessions.length} confessions`);
    } catch {
      this.confessions = [];
      await this.saveConfessions();
    }
  }

  async saveConfessions() {
    try {
      await fs.writeFile(CONFIG.storageFile, JSON.stringify(this.confessions, null, 2));
    } catch (error) {
      console.error('❌ Save failed:', error);
    }
  }

  addConfession(userId, username, confession, anonymousId) {
    const confessionData = {
      id: Date.now(),
      userId,
      username,
      confession,
      anonymousId,
      timestamp: new Date().toISOString(),
      stats: { views: 0, reactions: {} }
    };
    
    this.confessions.push(confessionData);
    this.saveConfessions();
    return confessionData;
  }

  checkCooldown(userId) {
    const lastConfession = this.cooldowns.get(userId);
    if (!lastConfession) return false;
    
    const cooldownMs = CONFIG.cooldownMinutes * 60 * 1000;
    return (Date.now() - lastConfession) < cooldownMs;
  }

  setCooldown(userId) {
    this.cooldowns.set(userId, Date.now());
  }

  getConfessionById(confessionId) {
    return this.confessions.find(c => c.anonymousId === confessionId);
  }
}

const manager = new ConfessionManager();

// ========== BOT STARTUP ==========
client.once('ready', async () => {
  console.log(`\n✨ ===== BOT ONLINE ===== ✨`);
  console.log(`🤖 Logged in as: ${client.user.tag}`);
  console.log(`🆔 Bot ID: ${client.user.id}`);
  console.log(`📊 Servers: ${client.guilds.cache.size}`);
  console.log(`📝 Confessions: ${manager.confessions.length}`);
  console.log(`🌐 Dashboard: http://localhost:${PORT}`);
  console.log(`✨ ======================= ✨\n`);

  // Register slash commands
  await registerCommands();

  client.user.setActivity({
    name: '/confess to confess',
    type: 3 // WATCHING
  });
});

// ========== SLASH COMMAND HANDLER ==========
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName, user, member, options } = interaction;

  // /confess command
  if (commandName === 'confess') {
    const confessionText = options.getString('confession');
    
    if (manager.checkCooldown(user.id)) {
      const remaining = CONFIG.cooldownMinutes - Math.floor((Date.now() - manager.cooldowns.get(user.id)) / 60000);
      return interaction.reply({ 
        content: `⏳ Please wait ${remaining} more minute(s) before confessing again.`, 
        ephemeral: true 
      });
    }

    if (confessionText) {
      // Direct confession via slash command
      await handleConfession(interaction, confessionText);
    } else {
      // Show button modal
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('confess_start')
          .setLabel('Start Anonymous Confession')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('📝'),
        new ButtonBuilder()
          .setCustomId('confess_rules')
          .setLabel('Read Rules')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('📜')
      );

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🕊️ Anonymous Confessions')
        .setDescription('Share your thoughts anonymously. Click below to begin.')
        .addFields(
          { name: '🔒 Privacy', value: '• Your identity is completely hidden\n• Only admins see logs (for moderation)', inline: false },
          { name: '📋 Quick Rules', value: '• Be respectful to everyone\n• No personal information\n• No hate speech or harassment\n• Keep it appropriate', inline: false }
        )
        .setFooter({ text: `All confessions are reviewed | Cooldown: ${CONFIG.cooldownMinutes}min` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }
  }

  // /confesshelp command
  else if (commandName === 'confesshelp') {
    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('❓ Confession Bot Help')
      .addFields(
        { name: 'Slash Commands', value: '• `/confess` - Start a confession\n• `/confesshelp` - Show this help\n• `/confessstats` - View statistics\n• `/confesslog` - Admin: Get all logs\n• `/confessview` - Admin: View specific confession', inline: false },
        { name: 'Legacy Commands', value: '• `!confess` - Start a confession (old way)\n• `!confesshelp` - Show help\n• `!confessstats` - View statistics', inline: false },
        { name: 'How It Works', value: '1. Use `/confess` or click the button\n2. Type your confession\n3. It posts anonymously\n4. Admins can view logs', inline: false },
        { name: 'Privacy', value: 'Your username is hidden from everyone except server admins in private logs.', inline: false }
      )
      .setFooter({ text: 'Need help? Contact server staff' });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // /confessstats command
  else if (commandName === 'confessstats') {
    const today = new Date().toISOString().split('T')[0];
    const todayConfessions = manager.confessions.filter(c => c.timestamp.startsWith(today)).length;
    const uniqueUsers = [...new Set(manager.confessions.map(c => c.userId))].length;

    const embed = new EmbedBuilder()
      .setColor(0xFFA500)
      .setTitle('📊 Confession Statistics')
      .addFields(
        { name: 'Total Confessions', value: `**${manager.confessions.length}**`, inline: true },
        { name: 'Today\'s Confessions', value: `**${todayConfessions}**`, inline: true },
        { name: 'Unique Users', value: `**${uniqueUsers}**`, inline: true },
        { name: 'First Confession', value: manager.confessions[0] ? `<t:${Math.floor(new Date(manager.confessions[0].timestamp).getTime() / 1000)}:D>` : 'None', inline: true },
        { name: 'Latest Confession', value: manager.confessions.length > 0 ? `<t:${Math.floor(Date.now() / 1000)}:R>` : 'None', inline: true }
      )
      .setFooter({ text: `Bot: ${client.user.tag}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // /confesslog command (admin)
  else if (commandName === 'confesslog') {
    if (!member.roles.cache.has(CONFIG.adminRoleId)) {
      return interaction.reply({ content: '❌ You need admin role to use this command.', ephemeral: true });
    }

    if (manager.confessions.length === 0) {
      return interaction.reply({ content: '📭 No confessions have been submitted yet.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    // Create CSV
    let csv = 'ID,AnonymousID,UserID,Username,Timestamp,Confession\n';
    manager.confessions.forEach(c => {
      const escaped = c.confession.replace(/"/g, '""').replace(/\n/g, ' ');
      csv += `${c.id},${c.anonymousId},${c.userId},${c.username},${c.timestamp},"${escaped}"\n`;
    });

    const tempFile = `./data/temp_export_${Date.now()}.csv`;
    await fs.writeFile(tempFile, csv);

    const embed = new EmbedBuilder()
      .setColor(0x2B2D31)
      .setTitle('📋 Confession Logs Export')
      .setDescription(`**Total Confessions:** ${manager.confessions.length}`)
      .addFields(
        { name: 'Export Info', value: 'Download the CSV file below. It contains all confession data including user information.' }
      )
      .setFooter({ text: `Requested by ${user.tag} | ${new Date().toLocaleDateString()}` })
      .setTimestamp();

    await interaction.editReply({ 
      embeds: [embed], 
      files: [{ attachment: tempFile, name: 'confessions_export.csv' }] 
    });

    // Cleanup
    setTimeout(() => fs.unlink(tempFile).catch(() => {}), 10000);
  }

  // /confessview command (admin)
  else if (commandName === 'confessview') {
    if (!member.roles.cache.has(CONFIG.adminRoleId)) {
      return interaction.reply({ content: '❌ You need admin role to use this command.', ephemeral: true });
    }

    const confessionId = options.getString('id');
    const confession = manager.getConfessionById(confessionId);

    if (!confession) {
      return interaction.reply({ content: '❌ Confession not found. Check the ID.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setColor(0x9C27B0)
      .setTitle(`🔍 Confession ${confessionId}`)
      .addFields(
        { name: 'User', value: `${confession.username}\n\`${confession.userId}\``, inline: true },
        { name: 'Submitted', value: `<t:${Math.floor(new Date(confession.timestamp).getTime() / 1000)}:F>`, inline: true },
        { name: 'Confession', value: confession.confession.length > 1000 ? confession.confession.substring(0, 1000) + '...' : confession.confession }
      )
      .setFooter({ text: `Confession ID: ${confessionId}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // /confesssetup command (admin)
  else if (commandName === 'confesssetup') {
    if (!member.roles.cache.has(CONFIG.adminRoleId)) {
      return interaction.reply({ content: '❌ You need admin role to use this command.', ephemeral: true });
    }

    const channel = options.getChannel('channel');
    
    // Update config
    CONFIG.confessionChannelId = channel.id;
    
    const embed = new EmbedBuilder()
      .setColor(0x4CAF50)
      .setTitle('✅ Confession Channel Set')
      .setDescription(`Confession channel has been set to ${channel}`)
      .addFields(
        { name: 'Channel', value: `${channel} (\`${channel.id}\`)`, inline: true },
        { name: 'Next Steps', value: '1. Make sure the bot has permission to send messages\n2. Test with `/confess`\n3. Check logs in the log channel', inline: false }
      )
      .setFooter({ text: 'You can change this anytime with /confesssetup' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

// ========== LEGACY COMMANDS (still work) ==========
client.on('messageCreate', async (message) => {
  if (message.author.bot || message.channel.type === ChannelType.DM) return;

  const { content, author, member } = message;
  const command = content.toLowerCase().trim();

  // !confess command (legacy)
  if (command === '!confess') {
    if (manager.checkCooldown(author.id)) {
      const remaining = CONFIG.cooldownMinutes - Math.floor((Date.now() - manager.cooldowns.get(author.id)) / 60000);
      return message.reply({
        content: `⏳ Please wait ${remaining} more minute(s) before confessing again.`,
        ephemeral: true
      });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('confess_start')
        .setLabel('Start Anonymous Confession')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📝'),
      new ButtonBuilder()
        .setCustomId('confess_rules')
        .setLabel('Read Rules')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('📜')
    );

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🕊️ Anonymous Confessions')
      .setDescription('Share your thoughts anonymously. Click below to begin.')
      .addFields(
        { name: '🔒 Privacy', value: '• Your identity is completely hidden\n• Only admins see logs (for moderation)', inline: false },
        { name: '📋 Quick Rules', value: '• Be respectful to everyone\n• No personal information\n• No hate speech or harassment\n• Keep it appropriate', inline: false }
      )
      .setFooter({ text: `All confessions are reviewed | Cooldown: ${CONFIG.cooldownMinutes}min` })
      .setTimestamp();

    await message.reply({ embeds: [embed], components: [row] });
  }

  // !confesshelp command (legacy)
  else if (command === '!confesshelp') {
    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('❓ Confession Bot Help')
      .addFields(
        { name: 'Slash Commands', value: '• `/confess` - Start a confession\n• `/confesshelp` - Show this help\n• `/confessstats` - View statistics', inline: false },
        { name: 'Legacy Commands', value: '• `!confess` - Start a confession (old way)\n• `!confesshelp` - Show help\n• `!confessstats` - View statistics', inline: false }
      )
      .setFooter({ text: 'Need help? Contact server staff' });

    await message.reply({ embeds: [embed] });
  }

  // !confessstats command (legacy)
  else if (command === '!confessstats') {
    const today = new Date().toISOString().split('T')[0];
    const todayConfessions = manager.confessions.filter(c => c.timestamp.startsWith(today)).length;
    const uniqueUsers = [...new Set(manager.confessions.map(c => c.userId))].length;

    const embed = new EmbedBuilder()
      .setColor(0xFFA500)
      .setTitle('📊 Confession Statistics')
      .addFields(
        { name: 'Total Confessions', value: `**${manager.confessions.length}**`, inline: true },
        { name: 'Today\'s Confessions', value: `**${todayConfessions}**`, inline: true },
        { name: 'Unique Users', value: `**${uniqueUsers}**`, inline: true }
      )
      .setFooter({ text: `Bot: ${client.user.tag}` })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  }
});

// ========== BUTTON HANDLERS ==========
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  // Rules button
  if (interaction.customId === 'confess_rules') {
    const embed = new EmbedBuilder()
      .setColor(0xFFD700)
      .setTitle('📜 Confession Rules & Guidelines')
      .setDescription('Please read these rules before submitting a confession:')
      .addFields(
        { name: '1. Respect Everyone', value: 'No hate speech, racism, sexism, homophobia, or discrimination of any kind.' },
        { name: '2. No Personal Info', value: 'Do not share names, addresses, phone numbers, emails, or any identifying information.' },
        { name: '3. Keep It Appropriate', value: 'No NSFW content, explicit material, or inappropriate topics.' },
        { name: '4. No Harassment', value: 'Do not target, bully, or harass individuals or groups.' },
        { name: '5. No Illegal Content', value: 'Do not discuss or promote illegal activities.' },
        { name: '6. Be Honest', value: 'Confessions should be genuine. No spam or trolling.' }
      )
      .setFooter({ text: 'Violations may result in confession removal and user action' });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // Start confession button
  else if (interaction.customId === 'confess_start') {
    if (manager.checkCooldown(interaction.user.id)) {
      const remaining = CONFIG.cooldownMinutes - Math.floor((Date.now() - manager.cooldowns.get(interaction.user.id)) / 60000);
      return interaction.reply({ 
        content: `⏳ Please wait ${remaining} more minute(s) before confessing again.`, 
        ephemeral: true 
      });
    }

    const modal = new ModalBuilder()
      .setCustomId('confession_modal')
      .setTitle('🕊️ Anonymous Confession');

    const input = new TextInputBuilder()
      .setCustomId('confession_text')
      .setLabel('What\'s on your mind?')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Type your confession here... (Be respectful and follow the rules)')
      .setRequired(true)
      .setMinLength(10)
      .setMaxLength(CONFIG.maxConfessionLength);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
  }
});

// ========== CONFESSION HANDLER ==========
async function handleConfession(interaction, confessionText) {
  await interaction.deferReply({ ephemeral: true });
  
  const anonymousId = `CONF-${Date.now().toString(36).toUpperCase()}`;

  // Add cooldown
  manager.setCooldown(interaction.user.id);
  
  // Store confession
  const confessionData = manager.addConfession(
    interaction.user.id,
    interaction.user.tag,
    confessionText,
    anonymousId
  );

  try {
    // Post to confession channel
    const confessionChannel = await client.channels.fetch(CONFIG.confessionChannelId);
    const confessionEmbed = new EmbedBuilder()
      .setColor(0xE91E63)
      .setDescription(`"${confessionText}"`)
      .setFooter({ text: `Anonymous Confession #${anonymousId} • Use /confess to submit yours` })
      .setTimestamp();

    const confessionMessage = await confessionChannel.send({ embeds: [confessionEmbed] });
    
    // Add reactions
    await confessionMessage.react('💖');
    await confessionMessage.react('🤝');
    await confessionMessage.react('💭');

    // Send to logs channel
    const logsChannel = await client.channels.fetch(CONFIG.logsChannelId);
    const logEmbed = new EmbedBuilder()
      .setColor(0x2B2D31)
      .setTitle('📝 New Confession Logged')
      .addFields(
        { name: 'Confession ID', value: anonymousId, inline: true },
        { name: 'User', value: `${interaction.user.tag}\n\`${interaction.user.id}\``, inline: true },
        { name: 'Via', value: interaction.isCommand() ? 'Slash Command' : 'Button', inline: true },
        { name: 'Confession', value: confessionText.length > 800 ? confessionText.substring(0, 800) + '...' : confessionText },
        { name: 'Links', value: `[Jump to Confession](${confessionMessage.url})`, inline: true }
      )
      .setFooter({ text: `Total: ${manager.confessions.length} | User's ${manager.confessions.filter(c => c.userId === interaction.user.id).length} confession` })
      .setTimestamp();

    await logsChannel.send({ embeds: [logEmbed] });

    // Success message to user
    await interaction.editReply({
      content: `✅ **Confession Submitted Successfully!**\n\n` +
               `• Your confession ID: \`${anonymousId}\`\n` +
               `• Posted anonymously in <#${CONFIG.confessionChannelId}>\n` +
               `• You can confess again in ${CONFIG.cooldownMinutes} minutes\n` +
               `• [View your confession](${confessionMessage.url})`,
      ephemeral: true
    });

    console.log(`📝 New confession from ${interaction.user.tag} (${anonymousId})`);

  } catch (error) {
    console.error('❌ Confession failed:', error);
    await interaction.editReply({
      content: '❌ Failed to post confession. Please try again or contact an admin.',
      ephemeral: true
    });
  }
}

// ========== MODAL HANDLER ==========
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isModalSubmit() || interaction.customId !== 'confession_modal') return;
  
  const confessionText = interaction.fields.getTextInputValue('confession_text');
  await handleConfession(interaction, confessionText);
});

// ========== ERROR HANDLING ==========
client.on('error', (error) => {
  console.error('🤖 Discord Client Error:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('⚠️ Unhandled Promise Rejection:', error);
});

// ========== START BOT ==========
client.login(process.env.BOT_TOKEN).catch(error => {
  console.error('🔑 Failed to login:', error);
  process.exit(1);
});

// ========== AUTO-SAVE ==========
setInterval(() => {
  manager.saveConfessions();
  console.log('💾 Auto-saved confessions');
}, 5 * 60 * 1000);
