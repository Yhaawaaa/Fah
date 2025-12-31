require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');

// ========== WEB SERVER FOR RENDER ==========
const app = express();
app.get('/', (req, res) => {
  res.send('Discord Bot is running!');
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Web server running on port ${PORT}`);
});

// ========== DISCORD BOT ==========
const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ] 
});

// Configuration
const CONFIG = {
  confessionChannelId: process.env.CONFESSION_CHANNEL,
  logsChannelId: process.env.LOG_CHANNEL,
  adminRoleId: process.env.ADMIN_ROLE,
  storageFile: './confessions.json'
};

let confessions = [];

function loadConfessions() {
  try {
    if (fs.existsSync(CONFIG.storageFile)) {
      const data = fs.readFileSync(CONFIG.storageFile, 'utf8');
      confessions = JSON.parse(data);
      console.log(`📂 Loaded ${confessions.length} confessions`);
    } else {
      fs.writeFileSync(CONFIG.storageFile, '[]');
    }
  } catch (error) {
    console.error('❌ Error loading confessions:', error);
    confessions = [];
  }
}

function saveConfessions() {
  try {
    fs.writeFileSync(CONFIG.storageFile, JSON.stringify(confessions, null, 2));
  } catch (error) {
    console.error('❌ Error saving confessions:', error);
  }
}

// Bot startup
client.once('ready', () => {
  console.log(`🤖 Logged in as ${client.user.tag}!`);
  console.log(`🔗 Invite: https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=2147485696&scope=bot`);
  loadConfessions();
  console.log(`📊 Total confessions: ${confessions.length}`);
  client.user.setActivity('!confess', { type: 'WATCHING' });
});

// Commands
client.on('messageCreate', async message => {
  if (message.author.bot) return;

  if (message.content.toLowerCase() === '!confess') {
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('start_confession')
          .setLabel('Make Anonymous Confession')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('📝')
      );

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Anonymous Confession')
      .setDescription('Click below to confess anonymously.')
      .addFields(
        { name: 'Rules', value: '• Be respectful\n• No personal info\n• No harassment' }
      )
      .setFooter({ text: 'Your identity is completely hidden' });

    await message.reply({ embeds: [embed], components: [row] });
  }

  if (message.content.toLowerCase() === '!confessionslog') {
    if (!message.member.roles.cache.has(CONFIG.adminRoleId)) {
      return message.reply('❌ Admin only.');
    }
    
    if (confessions.length === 0) return message.reply('📭 No confessions yet.');
    
    let csvContent = 'Confession ID,User ID,Username,Timestamp,Confession\n';
    confessions.forEach(conf => {
      const escaped = conf.confession.replace(/"/g, '""').replace(/\n/g, ' ');
      csvContent += `${conf.anonymousId},${conf.userId},${conf.username},${conf.timestamp},"${escaped}"\n`;
    });

    const csvPath = './temp_confessions.csv';
    fs.writeFileSync(csvPath, csvContent);

    await message.channel.send({
      content: `📊 Total: ${confessions.length}`,
      files: [{ attachment: csvPath, name: 'confessions_log.csv' }]
    });

    fs.unlinkSync(csvPath);
  }
});

// Button handler
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton() || interaction.customId !== 'start_confession') return;

  const modal = new ModalBuilder()
    .setCustomId('confession_modal')
    .setTitle('Anonymous Confession');

  const confessionInput = new TextInputBuilder()
    .setCustomId('confession_text')
    .setLabel('Your Confession')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Type your confession...')
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(2000);

  const actionRow = new ActionRowBuilder().addComponents(confessionInput);
  modal.addComponents(actionRow);

  await interaction.showModal(modal);
});

// Modal handler
client.on('interactionCreate', async interaction => {
  if (!interaction.isModalSubmit() || interaction.customId !== 'confession_modal') return;

  const confessionText = interaction.fields.getTextInputValue('confession_text');
  
  const confessionData = {
    id: Date.now(),
    userId: interaction.user.id,
    username: interaction.user.tag,
    confession: confessionText,
    timestamp: new Date().toISOString(),
    anonymousId: `CONF-${Date.now().toString(36).toUpperCase()}`
  };

  confessions.push(confessionData);
  saveConfessions();

  // Post to confession channel
  try {
    const confessionChannel = await client.channels.fetch(CONFIG.confessionChannelId);
    const confessionEmbed = new EmbedBuilder()
      .setColor(0xE91E63)
      .setDescription(`"${confessionText}"`)
      .setFooter({ text: 'Anonymous Confession' });

    await confessionChannel.send({ embeds: [confessionEmbed] });
  } catch (error) {
    console.error('Error posting confession:', error);
    await interaction.reply({ content: '❌ Error posting confession.', ephemeral: true });
    return;
  }

  // Send to logs channel
  try {
    const logsChannel = await client.channels.fetch(CONFIG.logsChannelId);
    const logEmbed = new EmbedBuilder()
      .setColor(0x2B2D31)
      .setTitle('📋 New Confession Log')
      .addFields(
        { name: 'Confession ID', value: confessionData.anonymousId },
        { name: 'User', value: `${confessionData.username} (${confessionData.userId})` },
        { name: 'Confession', value: confessionText.length > 1000 ? confessionText.substring(0, 1000) + '...' : confessionText },
        { name: 'Timestamp', value: `<t:${Math.floor(Date.now() / 1000)}:F>` }
      )
      .setFooter({ text: `Total: ${confessions.length}` })
      .setTimestamp();

    await logsChannel.send({ embeds: [logEmbed] });
  } catch (error) {
    console.error('Error sending to logs:', error);
  }

  await interaction.reply({ 
    content: `✅ Confession posted!`, 
    ephemeral: true 
  });
});

// Start bot
client.login(process.env.BOT_TOKEN);
