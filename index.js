import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import Database from 'better-sqlite3';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages] });
const db = new Database('shop.db');

// 데이터베이스 초기화
db.exec(`
  CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, balance INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT, price INTEGER);
  CREATE TABLE IF NOT EXISTS inventory (product_id TEXT, quantity INTEGER);
  CREATE TABLE IF NOT EXISTS purchases (user_id TEXT, product_id TEXT, quantity INTEGER, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS charges (user_id TEXT, amount INTEGER, status TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);
`);

// 슬래시 명령어 정의
const commands = [
  new SlashCommandBuilder().setName('잔액').setDescription('현재 잔액 확인'),
  new SlashCommandBuilder().setName('충전신청').setDescription('충전 신청').addIntegerOption(opt => opt.setName('금액').setDescription('충전할 금액').setRequired(true)),
  new SlashCommandBuilder().setName('충전완료').setDescription('충전 완료 (관리자)').addUserOption(opt => opt.setName('사용자').setDescription('사용자').setRequired(true)).addIntegerOption(opt => opt.setName('금액').setDescription('충전 금액').setRequired(true)),
  new SlashCommandBuilder().setName('충전승인').setDescription('충전 승인 (관리자)').addIntegerOption(opt => opt.setName('요청id').setDescription('요청 ID').setRequired(true)),
  new SlashCommandBuilder().setName('충전거절').setDescription('충전 거절 (관리자)').addIntegerOption(opt => opt.setName('요청id').setDescription('요청 ID').setRequired(true)),
  new SlashCommandBuilder().setName('상품추가').setDescription('상품 추가 (관리자)').addStringOption(opt => opt.setName('이름').setDescription('상품명').setRequired(true)).addIntegerOption(opt => opt.setName('가격').setDescription('가격').setRequired(true)),
  new SlashCommandBuilder().setName('상품삭제').setDescription('상품 삭제 (관리자)').addStringOption(opt => opt.setName('상품id').setDescription('상품 ID').setRequired(true)),
  new SlashCommandBuilder().setName('재고추가').setDescription('재고 추가 (관리자)').addStringOption(opt => opt.setName('상품id').setDescription('상품 ID').setRequired(true)).addIntegerOption(opt => opt.setName('수량').setDescription('수량').setRequired(true)),
  new SlashCommandBuilder().setName('재고확인').setDescription('재고 확인 (관리자)').addStringOption(opt => opt.setName('상품id').setDescription('상품 ID').setRequired(true)),
  new SlashCommandBuilder().setName('상품목록').setDescription('상품 목록 조회'),
  new SlashCommandBuilder().setName('구매').setDescription('상품 구매').addStringOption(opt => opt.setName('상품id').setDescription('상품 ID').setRequired(true)).addIntegerOption(opt => opt.setName('수량').setDescription('수량').setRequired(true)),
  new SlashCommandBuilder().setName('랜덤지급').setDescription('랜덤 재고 지급 (관리자)').addUserOption(opt => opt.setName('사용자').setDescription('사용자').setRequired(true)).addStringOption(opt => opt.setName('상품id').setDescription('상품 ID').setRequired(true)),
  new SlashCommandBuilder().setName('구매로그').setDescription('구매 로그 (관리자)'),
  new SlashCommandBuilder().setName('충전로그').setDescription('충전 로그 (관리자)'),
  new SlashCommandBuilder().setName('구매내역').setDescription('내 구매 내역'),
];

const ADMIN_ROLE = 'Admin'; // 관리자 역할 이름

function isAdmin(interaction) {
  return interaction.member.roles.cache.some(role => role.name === ADMIN_ROLE);
}

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

  try {
    // 사용자 초기화
    db.prepare('INSERT OR IGNORE INTO users (id, balance) VALUES (?, 0)').run(userId);

    if (commandName === '잔액') {
      const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
      const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('💰 잔액 조회')
        .setDescription(`현재 잔액: **${user.balance}원**`);
      await interaction.reply({ embeds: [embed] });

    } else if (commandName === '충전신청') {
      const amount = interaction.options.getInteger('금액');
      if (amount <= 0) return await interaction.reply('❌ 0원 이상의 금액을 입력해주세요.');
      
      db.prepare('INSERT INTO charges (user_id, amount, status) VALUES (?, ?, ?)').run(userId, amount, 'pending');
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('💳 충전 신청')
        .setDescription(`**${amount}원** 충전이 신청되었습니다.\n관리자의 승인을 기다려주세요.`);
      await interaction.reply({ embeds: [embed] });

    } else if (commandName === '충전완료') {
      if (!isAdmin(interaction)) return await interaction.reply('❌ 관리자만 사용 가능합니다.');
      
      const targetUser = interaction.options.getUser('사용자');
      const amount = interaction.options.getInteger('금액');
      
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amount, targetUser.id);
      db.prepare('INSERT INTO charges (user_id, amount, status) VALUES (?, ?, ?)').run(targetUser.id, amount, 'completed');
      
      const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('✅ 충전 완료')
        .setDescription(`<@${targetUser.id}>님에게 **${amount}원**이 충전되었습니다.`);
      await interaction.reply({ embeds: [embed] });

    } else if (commandName === '충전승인') {
      if (!isAdmin(interaction)) return await interaction.reply('❌ 관리자만 사용 가능합니다.');
      
      const requestId = interaction.options.getInteger('요청id');
      const charge = db.prepare('SELECT * FROM charges WHERE rowid = ?').get(requestId);
      
      if (!charge) return await interaction.reply('❌ 요청을 찾을 수 없습니다.');
      if (charge.status !== 'pending') return await interaction.reply('❌ 대기 중인 요청이 아닙니다.');
      
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(charge.amount, charge.user_id);
      db.prepare('UPDATE charges SET status = ? WHERE rowid = ?').run('approved', requestId);
      
      const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('✅ 충전 승인')
        .setDescription(`<@${charge.user_id}>님의 **${charge.amount}원** 충전이 승인되었습니다.`);
      await interaction.reply({ embeds: [embed] });

    } else if (commandName === '충전거절') {
      if (!isAdmin(interaction)) return await interaction.reply('❌ 관리자만 사용 가능합니다.');
      
      const requestId = interaction.options.getInteger('요청id');
      const charge = db.prepare('SELECT * FROM charges WHERE rowid = ?').get(requestId);
      
      if (!charge) return await interaction.reply('❌ 요청을 찾을 수 없습니다.');
      if (charge.status !== 'pending') return await interaction.reply('❌ 대기 중인 요청이 아닙니다.');
      
      db.prepare('UPDATE charges SET status = ? WHERE rowid = ?').run('rejected', requestId);
      
      const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('❌ 충전 거절')
        .setDescription(`<@${charge.user_id}>님의 **${charge.amount}원** 충전이 거절되었습니다.`);
      await interaction.reply({ embeds: [embed] });

    } else if (commandName === '상품추가') {
      if (!isAdmin(interaction)) return await interaction.reply('❌ 관리자만 사용 가능합니다.');
      
      const name = interaction.options.getString('이름');
      const price = interaction.options.getInteger('가격');
      const productId = `prod_${Date.now()}`;
      
      db.prepare('INSERT INTO products (id, name, price) VALUES (?, ?, ?)').run(productId, name, price);
      db.prepare('INSERT INTO inventory (product_id, quantity) VALUES (?, ?)').run(productId, 0);
      
      const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('✅ 상품 추가')
        .setDescription(`**${name}** (${price}원)\nID: \`${productId}\``);
      await interaction.reply({ embeds: [embed] });

    } else if (commandName === '상품삭제') {
      if (!isAdmin(interaction)) return await interaction.reply('❌ 관리자만 사용 가능합니다.');
      
      const productId = interaction.options.getString('상품id');
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
      
      if (!product) return await interaction.reply('❌ 상품을 찾을 수 없습니다.');
      
      db.prepare('DELETE FROM products WHERE id = ?').run(productId);
      db.prepare('DELETE FROM inventory WHERE product_id = ?').run(productId);
      
      const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('✅ 상품 삭제')
        .setDescription(`**${product.name}**이 삭제되었습니다.`);
      await interaction.reply({ embeds: [embed] });

    } else if (commandName === '재고추가') {
      if (!isAdmin(interaction)) return await interaction.reply('❌ 관리자만 사용 가능합니다.');
      
      const productId = interaction.options.getString('상품id');
      const quantity = interaction.options.getInteger('수량');
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
      
      if (!product) return await interaction.reply('❌ 상품을 찾을 수 없습니다.');
      
      db.prepare('UPDATE inventory SET quantity = quantity + ? WHERE product_id = ?').run(quantity, productId);
      
      const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('✅ 재고 추가')
        .setDescription(`**${product.name}** +${quantity}개\n현재 재고: ${db.prepare('SELECT quantity FROM inventory WHERE product_id = ?').get(productId).quantity}개`);
      await interaction.reply({ embeds: [embed] });

    } else if (commandName === '재고확인') {
      if (!isAdmin(interaction)) return await interaction.reply('❌ 관리자만 사용 가능합니다.');
      
      const productId = interaction.options.getString('상품id');
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
      const inventory = db.prepare('SELECT quantity FROM inventory WHERE product_id = ?').get(productId);
      
      if (!product) return await interaction.reply('❌ 상품을 찾을 수 없습니다.');
      
      const embed = new EmbedBuilder()
        .setColor('#0099FF')
        .setTitle('📦 재고 확인')
        .setDescription(`**${product.name}**\n현재 재고: **${inventory.quantity}개**`);
      await interaction.reply({ embeds: [embed] });

    } else if (commandName === '상품목록') {
      const products = db.prepare('SELECT * FROM products').all();
      
      if (products.length === 0) {
        return await interaction.reply('❌ 등록된 상품이 없습니다.');
      }
      
      const productList = products.map(p => {
        const inv = db.prepare('SELECT quantity FROM inventory WHERE product_id = ?').get(p.id);
        const stock = inv ? inv.quantity : 0;
        return `**${p.name}** - ${p.price}원 (재고: ${stock}개)`;
      }).join('\n');
      
      const embed = new EmbedBuilder()
        .setColor('#0099FF')
        .setTitle('📦 상품 목록')
        .setDescription(productList);
      await interaction.reply({ embeds: [embed] });

    } else if (commandName === '구매') {
      const productId = interaction.options.getString('상품id');
      const quantity = interaction.options.getInteger('수량');
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
      const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
      const inventory = db.prepare('SELECT quantity FROM inventory WHERE product_id = ?').get(productId);
      
      if (!product) return await interaction.reply('❌ 상품을 찾을 수 없습니다.');
      if (quantity <= 0) return await interaction.reply('❌ 1개 이상 구매해주세요.');
      if (!inventory || inventory.quantity < quantity) return await interaction.reply('❌ 재고가 부족합니다.');
      
      const totalPrice = product.price * quantity;
      if (user.balance < totalPrice) return await interaction.reply(`❌ 잔액이 부족합니다. (필요: ${totalPrice}원, 보유: ${user.balance}원)`);
      
      db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(totalPrice, userId);
      db.prepare('UPDATE inventory SET quantity = quantity - ? WHERE product_id = ?').run(quantity, productId);
      db.prepare('INSERT INTO purchases (user_id, product_id, quantity) VALUES (?, ?, ?)').run(userId, productId, quantity);
      
      const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('✅ 구매 완료')
        .setDescription(`**${product.name}** x${quantity}\n결제액: **${totalPrice}원**\n남은 잔액: **${user.balance - totalPrice}원**`);
      await interaction.reply({ embeds: [embed] });
      
      // DM 발송
      try {
        const dmEmbed = new EmbedBuilder()
          .setColor('#00FF00')
          .setTitle('🛍️ 구매 확인')
          .setDescription(`상품: **${product.name}**\n수량: **${quantity}개**\n결제액: **${totalPrice}원**`);
        await interaction.user.send({ embeds: [dmEmbed] });
      } catch (err) {
        console.log('DM 발송 실패:', err);
      }

    } else if (commandName === '랜덤지급') {
      if (!isAdmin(interaction)) return await interaction.reply('❌ 관리자만 사용 가능합니다.');
      
      const targetUser = interaction.options.getUser('사용자');
      const productId = interaction.options.getString('상품id');
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
      
      if (!product) return await interaction.reply('❌ 상품을 찾을 수 없습니다.');
      
      const randomQty = Math.floor(Math.random() * 10) + 1;
      db.prepare('INSERT INTO purchases (user_id, product_id, quantity) VALUES (?, ?, ?)').run(targetUser.id, productId, randomQty);
      
      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('🎁 랜덤 지급')
        .setDescription(`<@${targetUser.id}>님에게 **${product.name}** x${randomQty}개가 지급되었습니다!`);
      await interaction.reply({ embeds: [embed] });

    } else if (commandName === '구매로그') {
      if (!isAdmin(interaction)) return await interaction.reply('❌ 관리자만 사용 가능합니다.');
      
      const purchases = db.prepare('SELECT * FROM purchases ORDER BY timestamp DESC LIMIT 10').all();
      
      if (purchases.length === 0) {
        return await interaction.reply('❌ 구매 기록이 없습니다.');
      }
      
      const logs = purchases.map(p => {
        const product = db.prepare('SELECT name FROM products WHERE id = ?').get(p.product_id);
        return `<@${p.user_id}> - **${product.name}** x${p.quantity} (${p.timestamp})`;
      }).join('\n');
      
      const embed = new EmbedBuilder()
        .setColor('#0099FF')
        .setTitle('📋 구매 로그')
        .setDescription(logs);
      await interaction.reply({ embeds: [embed] });

    } else if (commandName === '충전로그') {
      if (!isAdmin(interaction)) return await interaction.reply('❌ 관리자만 사용 가능합니다.');
      
      const charges = db.prepare('SELECT * FROM charges ORDER BY timestamp DESC LIMIT 10').all();
      
      if (charges.length === 0) {
        return await interaction.reply('❌ 충전 기록이 없습니다.');
      }
      
      const logs = charges.map(c => {
        const statusEmoji = c.status === 'approved' ? '✅' : c.status === 'rejected' ? '❌' : '⏳';
        return `${statusEmoji} <@${c.user_id}> - **${c.amount}원** (${c.status}) (${c.timestamp})`;
      }).join('\n');
      
      const embed = new EmbedBuilder()
        .setColor('#0099FF')
        .setTitle('📋 충전 로그')
        .setDescription(logs);
      await interaction.reply({ embeds: [embed] });

    } else if (commandName === '구매내역') {
      const purchases = db.prepare('SELECT * FROM purchases WHERE user_id = ? ORDER BY timestamp DESC', userId).all();
      
      if (purchases.length === 0) {
        return await interaction.reply('❌ 구매 내역이 없습니다.');
      }
      
      const logs = purchases.map(p => {
        const product = db.prepare('SELECT name, price FROM products WHERE id = ?').get(p.product_id);
        const totalPrice = product.price * p.quantity;
        return `**${product.name}** x${p.quantity} - ${totalPrice}원 (${p.timestamp})`;
      }).join('\n');
      
      const embed = new EmbedBuilder()
        .setColor('#0099FF')
        .setTitle('📋 내 구매 내역')
        .setDescription(logs);
      await interaction.reply({ embeds: [embed] });
    }
  } catch (error) {
    console.error('❌ 명령어 실행 오류:', error);
    await interaction.reply('❌ 오류가 발생했습니다.');
  }
});

client.login(process.env.DISCORD_TOKEN);
