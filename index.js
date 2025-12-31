const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ] 
});

// ========== UPDATED CONFIGURATION ==========
const CONFIG = {
    confessionChannelId: '1451824050459639930', // Public confession channel
    logsChannelId: '1454962657127039242', // NEW: Confession log channel
    adminRoleId: '1455471042847047701', // Admin role
    storageFile: './confessions.json'
};
// ===========================================

// Storage for confessions
let confessions = [];

// Load existing confessions from file
function loadConfessions() {
    try {
        if (fs.existsSync(CONFIG.storageFile)) {
            const data = fs.readFileSync(CONFIG.storageFile, 'utf8');
            confessions = JSON.parse(data);
            console.log(`📂 Loaded ${confessions.length} confessions from storage`);
        } else {
            fs.writeFileSync(CONFIG.storageFile, '[]');
            console.log('📂 Created new confessions storage file');
        }
    } catch (error) {
        console.error('❌ Error loading confessions:', error);
        confessions = [];
    }
}

// Save confessions to file
function saveConfessions() {
    try {
        fs.writeFileSync(CONFIG.storageFile, JSON.stringify(confessions, null, 2));
    } catch (error) {
        console.error('❌ Error saving confessions:', error);
    }
}

// ========== BOT STARTUP ==========
client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);
    console.log(`📝 Confession Bot Ready!`);
    
    loadConfessions();
    console.log(`📊 Total confessions: ${confessions.length}`);
    
    client.user.setActivity('!confess to confess', { type: 'WATCHING' });
});

// ========== CONFESSION COMMAND ==========
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // Command: !confess
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
            .setDescription('Click the button below to make an anonymous confession.\n\n**Your identity will be completely hidden from everyone.**')
            .addFields(
                { name: '📋 Rules', value: '• Be respectful\n• No personal information\n• No harassment\n• No spam' }
            )
            .setFooter({ text: 'Click the button to begin' });

        await message.reply({ 
            embeds: [embed], 
            components: [row] 
        });
    }

    // ========== ADMIN COMMANDS ==========
    
    // Command: !confessionslog - Get all confessions with user info (ADMIN ONLY)
    if (message.content.toLowerCase() === '!confessionslog') {
        if (!message.member.roles.cache.has(CONFIG.adminRoleId)) {
            return message.reply('❌ You need to be the glorious king Yha to be able to use that command.');
        }
        
        if (confessions.length === 0) {
            return message.reply('📭 No confessions have been made yet.');
        }

        // Create CSV file content
        let csvContent = 'Confession ID,User ID,Username,Timestamp,Confession\n';
        confessions.forEach(conf => {
            const escapedConfession = conf.confession.replace(/"/g, '""').replace(/\n/g, ' ');
            csvContent += `${conf.anonymousId},${conf.userId},${conf.username},${conf.timestamp},"${escapedConfession}"\n`;
        });

        // Save temporary CSV file
        const csvPath = path.join(__dirname, 'temp_confessions.csv');
        fs.writeFileSync(csvPath, csvContent);

        // Send CSV file
        await message.channel.send({
            content: `📊 **All Confessions Log**\n**Total:** ${confessions.length}\nDownload the CSV file below:`,
            files: [{
                attachment: csvPath,
                name: 'confessions_log.csv'
            }]
        });

        // Clean up temp file
        setTimeout(() => {
            if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
        }, 10000);
    }

    // REMOVED: !viewconfession, !deleteconfession, !confessionstats commands
    // Only admins can see logs via !confessionslog CSV
});

// ========== CONFESSION BUTTON HANDLER ==========
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton() || interaction.customId !== 'start_confession') return;

    const modal = new ModalBuilder()
        .setCustomId('confession_modal')
        .setTitle('Anonymous Confession');

    const confessionInput = new TextInputBuilder()
        .setCustomId('confession_text')
        .setLabel('Your Confession')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Type your confession here...')
        .setRequired(true)
        .setMinLength(10)
        .setMaxLength(2000);

    const actionRow = new ActionRowBuilder().addComponents(confessionInput);
    modal.addComponents(actionRow);

    await interaction.showModal(modal);
});

// ========== MODAL SUBMISSION HANDLER ==========
client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit() || interaction.customId !== 'confession_modal') return;

    const confessionText = interaction.fields.getTextInputValue('confession_text');
    
    // Create confession data
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

    // ========== POST TO PUBLIC CHANNEL (JUST THE TEXT) ==========
    try {
        const confessionChannel = await client.channels.fetch(CONFIG.confessionChannelId);
        
        // SIMPLE POST - Just the confession text, no IDs, no metadata
        const confessionEmbed = new EmbedBuilder()
            .setColor(0xE91E63)
            .setDescription(`"${confessionText}"`)
            .setFooter({ text: 'Anonymous Confession' });

        await confessionChannel.send({ embeds: [confessionEmbed] });
    } catch (error) {
        console.error('Error posting confession:', error);
        await interaction.reply({ 
            content: '❌ Error: Could not post confession.', 
            ephemeral: true 
        });
        return;
    }

    // ========== SEND TO LOGS CHANNEL (WITH FULL USER INFO) ==========
    try {
        const logsChannel = await client.channels.fetch(CONFIG.logsChannelId);
        
        const logEmbed = new EmbedBuilder()
            .setColor(0x2B2D31)
            .setTitle('📋 New Confession Log')
            .addFields(
                { name: 'Confession ID', value: confessionData.anonymousId },
                { name: 'User', value: `${confessionData.username}\nID: \`${confessionData.userId}\`` },
                { name: 'Confession', value: confessionText },
                { name: 'Timestamp', value: `<t:${Math.floor(Date.now() / 1000)}:F>` }
            )
            .setFooter({ text: `Total Confessions: ${confessions.length}` })
            .setTimestamp();

        await logsChannel.send({ embeds: [logEmbed] });
    } catch (error) {
        console.error('Error sending to logs channel:', error);
    }

    // Send confirmation to user
    await interaction.reply({ 
        content: '✅ Your confession has been posted anonymously!', 
        ephemeral: true 
    });
});

// ========== ERROR HANDLING ==========
process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('Uncaught exception:', error);
});

// ========== START THE BOT ==========
client.login(process.env.BOT_TOKEN);
