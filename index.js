import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import Database from 'better-sqlite3';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages] });
const db = new Database('shop.db');

// 데이터베이스 초기화
db.exec(`
  CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, balance INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT, price INTEGER);
  CREATE TABLE IF NOT EXISTS inventory (product_id TEXT, quantity INTEGER);
  CREATE TABLE IF NOT EXISTS purchases (user_id TEXT, product_id TEXT, quantity INTEGER, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);
`);

// 슬래시 명령어 정의
const commands = [
  new SlashCommandBuilder().setName('잔액').setDescription('현재 잔액 확인'),
  new SlashCommandBuilder().setName('충전신청').setDescription('충전 신청'),
  new SlashCommandBuilder().setName('상품목록').setDescription('상품 목록 조회'),
  new SlashCommandBuilder().setName('구매').setDescription('상품 구매').addStringOption(option => option.setName('상품').setDescription('상품명').setRequired(true)),
];

client.once('ready', async () => {
  console.log(`✅ 봇 로그인: ${client.user.tag}`);
  
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  
  try {
    console.log('🔄 슬래시 명령어 등록 중...');
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands.map(cmd => cmd.toJSON()) });
    console.log('✅ 슬래시 명령어 등록 완료!');
  } catch (error) {
    console.error('❌ 명령어 등록 실패:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;
  const commandName = interaction.commandName;

  if (commandName === '잔액') {
    const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
    const balance = user ? user.balance : 0;
    await interaction.reply(`💰 현재 잔액: ${balance}원`);
  } else if (commandName === '충전신청') {
    await interaction.reply('💳 충전 신청이 접수되었습니다.');
  } else if (commandName === '상품목록') {
    const products = db.prepare('SELECT * FROM products').all();
    const list = products.map(p => `${p.name} - ${p.price}원`).join('\n') || '상품이 없습니다.';
    await interaction.reply(`📦 상품 목록:\n${list}`);
  } else if (commandName === '구매') {
    await interaction.reply('✅ 구매 완료!');
  }
});

client.login(process.env.DISCORD_TOKEN);
