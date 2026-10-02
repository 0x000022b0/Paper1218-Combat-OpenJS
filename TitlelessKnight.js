/*
 * TitlelessKnight.js —— 自定义 BOSS「无爵骑士」（OpenJS 1.5.0 / Paper 1.21.8）
 *
 * 获取方式：/call boss 无爵骑士
 * 召唤方式：手持名为「无爵骑士」的绿宝石右键地面 → 6 秒倒计时 → spawn
 *
 * 机制摘要：
 *   外观：真实尸壳（Husk）本体，头 / 胸 / 腿 / 脚 全套铁甲，主手 下界合金剑（锋利 V）
 *   数据：HP 200；移动速度 0.24 格/tick（玩家步行约 0.215，略快约 11%）；
 *         击退抗性 1.0（完全免疫击退）；免疫火焰 / 爆炸 / 摔落 / 中毒等环境伤害，
 *         只接受玩家造成的伤害
 *   朝向：追击 / 行走时本体与头部都持续看向目标玩家（含俯仰）
 *   大剑（主武器，攻击冷却 2 秒，每次从三种攻击里随机挑一种）：
 *     · 挥砍  ：前摇 0.3 秒后连续 2 段判定，单段 6 点，两段间隔 12 tick；
 *               举盾可完全挡下（不掉血、不击退）
 *     · 劈砍  ：1 秒前摇（可躲避），单段 14 点高伤害；按「斧头破盾」原理——
 *               举盾能挡下本次伤害，但盾牌会被击碎并进入 5 秒冷却
 *     · 眩晕击：前摇 0.5 秒后单段 7 点；只有真正造成伤害才附加 缓慢 III 5 秒，
 *               被盾牌挡下或未命中则不产生任何效果
 *   恐惧战吼：32 格内玩家 虚弱 II 30 秒；冷却 60 秒（0.5 秒蓄力 + 冲击环）；
 *             被吼中的玩家用盾牌成功格挡 3 次攻击即可提前驱散虚弱
 *   冲锋    ：向玩家方向冲刺最多 14 格，途经玩家 10 点伤害 + 击退；
 *               可被盾牌防下；冷却 10 秒（需求未指定冷却，本脚本自行设定）
 *
 * 契约依据：《OpenJS脚本数据契约.md》v1.0.0
 *   - 第 2 节  IIFE + "use strict" 作用域隔离
 *   - 第 5 节  单 1 tick 主循环 + 主线程同步延迟队列（禁止 task.delay 触碰世界）
 *   - M-1 跨引擎只共享 Java 值（注册只传基本值 + 函数）
 *   - M-2 事件注册推迟到主线程第一个 tick，避开并行加载抢锁
 *   - M-5 world.spawn 必须传 Class.forName(...) 得到的 java.lang.Class
 *   - M-9a 枚举常量在顶层预检，避免「加载成功但技能期才抛错」
 */

// 作用域隔离：所有变量、常量和函数都封装在本 IIFE 内，
// 避免与其他 OpenJS 脚本的全局名称互相覆盖。
(function () {
    "use strict";

    // -----------------------------------------------------------------------
    // Java / API 类型
    // -----------------------------------------------------------------------
    var Class = Java.type("java.lang.Class");
    var Material = Java.type("org.bukkit.Material");
    var ItemStack = Java.type("org.bukkit.inventory.ItemStack");
    var Location = Java.type("org.bukkit.Location");
    var Vector = Java.type("org.bukkit.util.Vector");
    var Bukkit = Java.type("org.bukkit.Bukkit");
    var ChatColor = Java.type("org.bukkit.ChatColor");
    var NamespacedKey = Java.type("org.bukkit.NamespacedKey");
    var PersistentDataType = Java.type("org.bukkit.persistence.PersistentDataType");
    var Attribute = Java.type("org.bukkit.attribute.Attribute");
    var Enchantment = Java.type("org.bukkit.enchantments.Enchantment");
    var Particle = Java.type("org.bukkit.Particle");
    var Sound = Java.type("org.bukkit.Sound");
    var PotionEffect = Java.type("org.bukkit.potion.PotionEffect");
    var PotionEffectType = Java.type("org.bukkit.potion.PotionEffectType");
    var BarColor = Java.type("org.bukkit.boss.BarColor");
    var BarStyle = Java.type("org.bukkit.boss.BarStyle");
    var GameMode = Java.type("org.bukkit.GameMode");
    var PlayerClass = Java.type("org.bukkit.entity.Player");
    var ArrayList = Java.type("java.util.ArrayList");
    var UUIDClass = Java.type("java.util.UUID");

    // M-5：Java.type(...) 返回 Nashorn StaticClass，不能当 java.lang.Class 传给 world.spawn。
    var EntityClass = Class.forName("org.bukkit.entity.Entity");
    var HuskClass = Class.forName("org.bukkit.entity.Husk");

    // -----------------------------------------------------------------------
    // 数值配置
    // -----------------------------------------------------------------------
    var BOSS_ID = "titleless_knight";
    var BOSS_NAME = "无爵骑士";
    var BOSS_ALIASES = ["无爵", "knight", "titleless", "titlelessknight"];
    var BOSS_LORE = [
        "生命值：200",
        "全身铁甲，手持下界合金剑（锋利 V）（尸壳本体）",
        "免疫击退；免疫火焰、爆炸、摔落等环境伤害",
        "只接受玩家造成的伤害",
        "————————————————",
        "大剑（攻击冷却 2 秒，三选一）：",
        "· 挥砍：2 段均衡伤害，可被盾牌挡下",
        "· 劈砍：1 秒前摇的高伤害，举盾可挡下但盾会被击碎（5 秒无法格挡）",
        "· 眩晕击：命中后附加 缓慢 III 5 秒；被盾牌挡下则无任何效果",
        "————————————————",
        "恐惧战吼：32 格内 虚弱 II 30 秒，冷却 60 秒",
        "· 被吼中后用盾牌成功格挡 3 次攻击，可提前驱散虚弱",
        "冲锋：向玩家方向冲撞，途经玩家受伤，可被盾牌挡下，冷却 10 秒"
    ];

    // 生命 / 移动
    var MAX_HEALTH = 200.0;
    var KNOCKBACK_RESISTANCE = 1.0;       // 需求：免疫击退（属性满值 = 完全免疫）
    // 速度：玩家步行速度属性 0.1 ≈ 0.215 格/tick。
    // 本 BOSS 由脚本逐 tick 位移移动（无 AI 实体不吃移动速度属性），
    // 因此 WALK_SPEED 的单位是 格/tick：0.24 ≈ 比玩家步行快约 11%，仍慢于疾跑（0.28）。
    var PLAYER_WALK_ATTRIBUTE = 0.1;
    var SPEED_MULTIPLIER = 1.11;
    var WALK_SPEED = 0.24;
    var MAX_STEP_UP = 1;                  // 逐 tick 位移时允许自动上台阶的格数
    var MAX_STEP_DOWN = 3;                // 允许跟随地形下落的格数
    var KEEP_DISTANCE = 2.0;              // 近于此距离不再前进，避免把玩家顶进方块
    var TARGET_RANGE = 48.0;              // 索敌半径
    var BAR_VIEW_RANGE = TARGET_RANGE;    // BossBar 显示半径
    var SPAWN_GROUND_SEARCH = 5;          // 生成点向下找地面的最大格数

    // 大剑：三选一的攻击权重（挥砍最常见，劈砍 / 眩晕击稍少）
    var SLASH_WEIGHT = 3;
    var CLEAVE_WEIGHT = 2;
    var STUN_WEIGHT = 2;

    // 大剑：公共参数
    var MELEE_COOLDOWN_TICKS = 40;        // 需求：攻击冷却 2 秒
    var MELEE_TRIGGER_RANGE = 3.4;        // 进入该距离才会发动大剑攻击
    var MELEE_ARC_DOT_MIN = -0.34;        // 正面约 ±110° 扇形，绕后可躲

    // 挥砍：一次攻击 2 下，可被盾牌防御，伤害较为均衡
    var SLASH_DAMAGE = 6.0;
    var SLASH_HIT_COUNT = 2;
    var SLASH_HIT_GAP_TICKS = 12;         // 大于玩家无敌帧 10 tick，保证两段都生效
    var SLASH_WINDUP_TICKS = 6;
    var SLASH_RANGE = 3.6;
    var SLASH_VERTICAL_TOLERANCE = 2.5;
    var SLASH_KNOCKBACK = 0.35;

    // 劈砍：一次攻击 1 下，1 秒前摇，破盾（斧头原理），伤害较高
    var CLEAVE_DAMAGE = 14.0;
    var CLEAVE_WINDUP_TICKS = 20;         // 需求：攻击前 1 秒前摇
    var CLEAVE_RANGE = 4.3;
    var CLEAVE_VERTICAL_TOLERANCE = 2.8;
    var CLEAVE_KNOCKBACK = 0.25;
    var SHIELD_DISABLE_TICKS = 100;       // 盾牌被击碎后的冷却 5 秒

    // 眩晕击：一次攻击 1 下，可被盾牌防御；造成伤害才给 缓慢 III 5 秒
    var STUN_DAMAGE = 7.0;
    var STUN_WINDUP_TICKS = 10;
    var STUN_RANGE = 3.5;
    var STUN_VERTICAL_TOLERANCE = 2.5;
    var STUN_SLOW_TICKS = 100;            // 需求：缓慢 5 秒
    var STUN_SLOW_AMPLIFIER = 2;          // amplifier 2 = 缓慢 III
    var STUN_KNOCKBACK = 0.2;

    // 恐惧战吼：在场玩家 虚弱 II 30 秒，冷却 60 秒
    var ROAR_COOLDOWN_TICKS = 1200;       // 需求：冷却 60 秒
    var ROAR_WEAKNESS_TICKS = 600;        // 需求：虚弱 30 秒
    var ROAR_WEAKNESS_AMPLIFIER = 1;      // amplifier 1 = 虚弱 II
    var ROAR_RADIUS = 32.0;               // 「在场」判定半径（覆盖整个练功房）
    var ROAR_WINDUP_TICKS = 10;           // 0.5 秒蓄力
    var ROAR_SHOCKWAVE_TICKS = 14;        // 冲击环扩散时长
    // 恐惧战吼的虚弱可以被「盾牌格挡」驱散：被吼中后成功格挡 N 次即可解除
    var ROAR_WEAKNESS_BLOCKS_TO_CLEAR = 3;

    // 冲锋：向玩家方向位移一段距离，途经玩家受伤，可被盾牌防御
    var CHARGE_COOLDOWN_TICKS = 200;      // 需求未指定，自行设定 10 秒
    var CHARGE_MIN_DISTANCE = 4.0;
    var CHARGE_MAX_DISTANCE = 26.0;
    var CHARGE_WINDUP_TICKS = 15;         // 0.75 秒预警
    var CHARGE_STEP = 0.85;               // 每 tick 位移（约 17 格/秒）
    var CHARGE_MAX_TRAVEL = 14.0;         // 单次冲锋最大位移
    var CHARGE_MAX_TICKS = 30;            // 单次冲锋最长 tick 数（兜底，正常由位移上限结束）
    var CHARGE_HIT_RADIUS = 1.8;
    var CHARGE_VERTICAL_TOLERANCE = 2.0;
    var CHARGE_DAMAGE = 10.0;
    var CHARGE_KNOCKBACK = 0.6;
    var CHARGE_BLOCK_KNOCKBACK = 0.15;
    var CHARGE_RECOVER_TICKS = 10;        // 冲锋结束后的收招时间

    // 朝向：追击 / 行走时本体与头部都看向目标的视线高度
    var TARGET_EYE_HEIGHT = 1.6;          // 玩家眼睛大致高度
    var MAX_FACE_PITCH = 35.0;            // 抬头 / 低头最大角度，避免怪异姿势
    // 主手武器的附魔（需求：下界合金剑 锋利 V）
    var SWORD_SHARPNESS_LEVEL = 5;

    // 初始技能时间（刚召唤出来给玩家一点准备时间）
    var INITIAL_MELEE_DELAY_TICKS = 20;
    var INITIAL_ROAR_DELAY_TICKS = 100;
    var INITIAL_CHARGE_DELAY_TICKS = 80;

    // 死亡
    var DEATH_SEQUENCE_TICKS = 30;

    // Tag / PDC key 必须带 BOSS id 前缀，避免跨 BOSS 冲突
    var BOSS_TAG = "titleless_knight_boss";
    var bossKey = new NamespacedKey(plugin, "titleless_knight_boss_type");
    var barKey = new NamespacedKey(plugin, "titleless_knight_bar");

    // 攻击种类标识
    var KIND_SLASH = "slash";
    var KIND_CLEAVE = "cleave";
    var KIND_STUN = "stun";
    var KIND_ROAR = "roar";
    var KIND_CHARGE = "charge";

    // 需要免疫的伤害原因（玩家造成的伤害不受此表影响）
    var IGNORED_CAUSE_LIST = "|LAVA|HOT_FLOOR|MELTING|FALL|DROWNING|SUFFOCATION|STARVATION"
        + "|CRAMMING|CONTACT|POISON|WITHER|MAGIC|DRAGON_BREATH|CAMPFIRE|FREEZE|LIGHTNING"
        + "|SONIC_BOOM|VOID|";

    // -----------------------------------------------------------------------
    // 枚举 / 常量预检（M-9a）
    // 写错常量名时 /oj reload 阶段就会报加载错误，而不是等到技能释放那一刻。
    // -----------------------------------------------------------------------
    var PREFLIGHT_CONSTANTS = [
        String(Material.IRON_HELMET), String(Material.IRON_CHESTPLATE),
        String(Material.IRON_LEGGINGS), String(Material.IRON_BOOTS),
        String(Material.NETHERITE_SWORD), String(Material.EMERALD), String(Material.SHIELD),
        String(Enchantment.SHARPNESS),
        String(Particle.CRIT), String(Particle.ENCHANTED_HIT), String(Particle.SWEEP_ATTACK),
        String(Particle.LARGE_SMOKE), String(Particle.SOUL), String(Particle.SMOKE),
        String(Sound.ENTITY_PLAYER_ATTACK_SWEEP), String(Sound.ENTITY_PLAYER_ATTACK_STRONG),
        String(Sound.ENTITY_PLAYER_ATTACK_CRIT), String(Sound.ITEM_SHIELD_BLOCK),
        String(Sound.ITEM_SHIELD_BREAK), String(Sound.BLOCK_ANVIL_LAND),
        String(Sound.BLOCK_ANVIL_PLACE), String(Sound.BLOCK_NOTE_BLOCK_HAT),
        String(Sound.ENTITY_RAVAGER_ROAR), String(Sound.ENTITY_ENDER_DRAGON_GROWL),
        String(Sound.ENTITY_IRON_GOLEM_ATTACK), String(Sound.ENTITY_IRON_GOLEM_HURT),
        String(Sound.ENTITY_IRON_GOLEM_DEATH), String(Sound.ENTITY_ZOMBIE_DEATH),
        String(Sound.ENTITY_GENERIC_EXPLODE), String(Sound.ENTITY_ZOMBIE_VILLAGER_CURE),
        String(Particle.HAPPY_VILLAGER),
        String(PotionEffectType.SLOWNESS), String(PotionEffectType.WEAKNESS),
        String(Attribute.MAX_HEALTH), String(Attribute.KNOCKBACK_RESISTANCE),
        String(Attribute.MOVEMENT_SPEED), String(Attribute.ATTACK_DAMAGE),
        String(BarColor.RED), String(BarStyle.SOLID), String(GameMode.SPECTATOR),
        String(PersistentDataType.STRING)
    ];

    // -----------------------------------------------------------------------
    // 运行时状态
    // -----------------------------------------------------------------------
    var activeBosses = {};      // uuid -> boss 状态对象
    var syncDelayedTasks = [];  // 契约 5.1：主线程同步延迟队列
    var globalTick = 0;

    // 恐惧战吼的「虚弱驱散」进度：playerUuid -> 已用盾牌格挡次数
    // 只在玩家身上确实带着战吼虚弱时才有条目；效果消失 / 驱散完成即删除。
    var roarWeaknessBlocks = {};

    // 头部旋转是否可以直接通过 NMS 设置（Paper 的 CraftEntity#getHandle()）。
    //   null = 还没试过，true = 可用，false = 不可用（退化为 setRotation + lookAt）
    var headRotationViaNms = null;

    // -----------------------------------------------------------------------
    // 工具函数
    // -----------------------------------------------------------------------
    function logError(tag, e) {
        // 契约 9.2：异常日志必须带 e.stack，不能只写 e。
                try { log.error(tag + "：" + e + (e && e.stack ? "\n" + e.stack : "")); } catch (ignored) { }
    }

    function clamp(value, lo, hi) {
        return value < lo ? lo : (value > hi ? hi : value);
    }

    function scheduleSync(delayTicks, callback) {
        syncDelayedTasks.push({ at: globalTick + Math.max(0, delayTicks), fn: callback });
    }

    function processSyncDelayedTasks() {
        if (syncDelayedTasks.length === 0) return;
        var current = syncDelayedTasks;
        syncDelayedTasks = [];
        for (var i = 0; i < current.length; i++) {
            if (globalTick >= current[i].at) {
                try {
                    current[i].fn();
                } catch (e) {
                    logError("TitlelessKnight 延迟任务异常", e);
                }
            } else {
                syncDelayedTasks.push(current[i]);
            }
        }
    }

    function getAttributeSafe(entity, attribute) {
        try {
            var inst = entity.getAttribute(attribute);
            if (inst != null) return inst;
        } catch (ignored) { }
        try {
            entity.registerAttribute(attribute);
            return entity.getAttribute(attribute);
        } catch (ignored2) { }
        return null;
    }

    // M-3：spawnParticle 的 6 参数重载在 Nashorn 下有歧义，统一走 7 参数并强制 double。
    function spawnParticleSafe(world, particle, loc, count, ox, oy, oz, extra) {
        try {
            world.spawnParticle(particle, loc, count, ox + 0.0, oy + 0.0, oz + 0.0, extra + 0.0);
        } catch (ignored) { }
    }

    function playSoundSafe(world, loc, sound, volume, pitch) {
        try {
            world.playSound(loc, sound, volume, pitch);
        } catch (ignored) { }
    }

    function isEngageablePlayer(player) {
        // 创造模式玩家也纳入索敌：创造模式打不动是原版机制，
        // 但 BOSS 仍然要追击 / 释放技能，方便在练功房里直接观察表现。
        if (player == null) return false;
        try {
            if (!player.isOnline() || player.isDead()) return false;
            return player.getGameMode() !== GameMode.SPECTATOR;
        } catch (e) {
            return false;
        }
    }

    function findNearestPlayer(boss) {
        var best = null;
        var bestDist = TARGET_RANGE * TARGET_RANGE;
        try {
            var players = boss.world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var p = players.get(i);
                if (!isEngageablePlayer(p)) continue;
                var d = p.getLocation().distanceSquared(boss.carrier.getLocation());
                if (d < bestDist) {
                    bestDist = d;
                    best = p;
                }
            }
        } catch (e) {
            logError("TitlelessKnight 查找最近玩家异常", e);
        }
        return best;
    }

    function getBossByEntity(entity) {
        if (entity == null) return null;
        try {
            if (!entity.getScoreboardTags().contains(BOSS_TAG)) return null;
            var uuid = String(entity.getUniqueId().toString());
            return activeBosses[uuid] == null ? null : activeBosses[uuid];
        } catch (e) {
            return null;
        }
    }

    function isIgnoredDamageCause(cause) {
        if (cause == null) return false;
        var n = String(cause.name());
        if (n.indexOf("FIRE") >= 0 || n.indexOf("EXPLOSION") >= 0) return true;
        return IGNORED_CAUSE_LIST.indexOf("|" + n + "|") >= 0;
    }

    function yawTowards(from, to) {
        var dx = to.getX() - from.getX();
        var dz = to.getZ() - from.getZ();
        return Math.atan2(-dx, dz) * 180.0 / Math.PI;
    }

    function resolveGroundY(world, x, y, z) {
        // 以 CallBoss 给出的生成点 Y 为基准向下找实体方块；
        // 找不到就用原 Y（交给重力自然落地），避免把 BOSS 送到房顶上。
        var bx = Math.floor(x);
        var bz = Math.floor(z);
        var top = Math.floor(y);
        try {
            if (world.getBlockAt(bx, top - 1, bz).getType().isSolid()) return top;
        } catch (ignored) { }
        for (var dy = 1; dy <= SPAWN_GROUND_SEARCH; dy++) {
            try {
                if (world.getBlockAt(bx, top - 1 - dy, bz).getType().isSolid()) return top - dy;
            } catch (ignored2) {
                break;
            }
        }
        return top;
    }

    // -----------------------------------------------------------------------
    // 生命周期：生成 / 清理
    // -----------------------------------------------------------------------
    function createKnightSword() {
        var sword = new ItemStack(Material.NETHERITE_SWORD);
        // 需求：下界合金剑附魔 锋利 V（1.21 起附魔字段名是 Enchantment.SHARPNESS）
        try {
            sword.addUnsafeEnchantment(Enchantment.SHARPNESS, SWORD_SHARPNESS_LEVEL);
        } catch (e) {
            logError("TitlelessKnight 给下界合金剑附魔失败", e);
        }
        return sword;
    }

    function equipKnight(carrier) {
        try {
            var equipment = carrier.getEquipment();
            if (equipment == null) return;
            // 需求：护甲由下界合金甲改为铁甲
            equipment.setHelmet(new ItemStack(Material.IRON_HELMET));
            equipment.setChestplate(new ItemStack(Material.IRON_CHESTPLATE));
            equipment.setLeggings(new ItemStack(Material.IRON_LEGGINGS));
            equipment.setBoots(new ItemStack(Material.IRON_BOOTS));
            equipment.setItemInMainHand(createKnightSword());
            // 掉落率为 0：BOSS 死亡不掉装备
            equipment.setHelmetDropChance(0.0);
            equipment.setChestplateDropChance(0.0);
            equipment.setLeggingsDropChance(0.0);
            equipment.setBootsDropChance(0.0);
            equipment.setItemInMainHandDropChance(0.0);
        } catch (e) {
            logError("TitlelessKnight 穿戴铁甲 / 下界合金剑失败", e);
        }
    }

    function createBossBar() {
        var bar = null;
        try {
            Bukkit.removeBossBar(barKey);
            bar = Bukkit.createBossBar(barKey, BOSS_NAME, BarColor.RED, BarStyle.SOLID);
            bar.setProgress(1.0);
            bar.setVisible(true);
        } catch (e) {
            logError("TitlelessKnight 创建 BossBar 失败", e);
            bar = null;
        }
        return bar;
    }

    function spawnTitlelessKnight(location, player) {
        try {
            if (location == null) return false;
            var world = location.getWorld();
            if (world == null) return false;

            var groundY = resolveGroundY(world, location.getX(), location.getY(), location.getZ());
            var spawnLoc = new Location(world, location.getX(), groundY, location.getZ(), 0, 0);

            // M-5：必须传 Class.forName(...) 得到的 java.lang.Class。
            var carrier = world.spawn(spawnLoc, HuskClass);
            if (carrier == null) {
                logError("TitlelessKnight 生成失败", "world.spawn 返回 null");
                return false;
            }

            carrier.setAI(false);              // 移动 / 攻击完全由脚本接管
            carrier.setInvisible(false);       // 本体就是要显示出来的全甲尸壳
            // 重力关闭：Y 轴完全由 resolveWalkY 控制，避免逐 tick 位移与重力互相抖动
            carrier.setGravity(false);
            carrier.setPersistent(true);
            carrier.setRemoveWhenFarAway(false);
            carrier.setCanPickupItems(false);
            carrier.setCollidable(true);
            carrier.setMaximumNoDamageTicks(0);
            carrier.setNoDamageTicks(0);
            carrier.setCustomName(ChatColor.GOLD + BOSS_NAME);
            carrier.setCustomNameVisible(false);
            try { carrier.setShouldBurnInDay(false); } catch (ignored) { }
            carrier.addScoreboardTag(BOSS_TAG);
            carrier.getPersistentDataContainer().set(bossKey, PersistentDataType.STRING, BOSS_ID);

            var maxHealth = getAttributeSafe(carrier, Attribute.MAX_HEALTH);
            if (maxHealth != null) maxHealth.setBaseValue(MAX_HEALTH);
            var knockback = getAttributeSafe(carrier, Attribute.KNOCKBACK_RESISTANCE);
            if (knockback != null) knockback.setBaseValue(KNOCKBACK_RESISTANCE);
            // 移动速度属性：本 BOSS 无 AI，属性不参与移动；填一个「略快于步行」的值只为可读性。
            var moveSpeed = getAttributeSafe(carrier, Attribute.MOVEMENT_SPEED);
            if (moveSpeed != null) moveSpeed.setBaseValue(PLAYER_WALK_ATTRIBUTE * SPEED_MULTIPLIER);
            // 攻击力基础值归零：装备的下界合金剑仍会给属性加成，但本 BOSS 无 AI，
            // 不会发动原版攻击；所有伤害都由脚本结算（见 resolveSlashHit 等）。
            var attackDamage = getAttributeSafe(carrier, Attribute.ATTACK_DAMAGE);
            if (attackDamage != null) attackDamage.setBaseValue(0.0);
            try {
                carrier.setHealth(MAX_HEALTH);
            } catch (e) {
                logError("TitlelessKnight 设置生命值失败", e);
            }
            equipKnight(carrier);

            var uuid = String(carrier.getUniqueId().toString());
            var bar = createBossBar();
            if (bar != null && player != null) {
                try { bar.addPlayer(player); } catch (ignored) { }
            }

            activeBosses[uuid] = {
                id: BOSS_ID,
                uuid: uuid,
                carrier: carrier,
                world: world,
                bar: bar,
                barKey: barKey,
                barTick: 0,
                spawnTick: globalTick,
                target: null,
                action: null,
                nextMeleeTick: globalTick + INITIAL_MELEE_DELAY_TICKS,
                nextRoarTick: globalTick + INITIAL_ROAR_DELAY_TICKS,
                nextChargeTick: globalTick + INITIAL_CHARGE_DELAY_TICKS,
                lastMeleeKind: null,
                dead: false,
                deathStartTick: 0,
                deathEndTick: 0,
                deathLocation: null
            };

            playSoundSafe(world, spawnLoc, Sound.ENTITY_IRON_GOLEM_ATTACK, 1.6, 0.6);
            playSoundSafe(world, spawnLoc, Sound.BLOCK_ANVIL_LAND, 1.2, 0.7);
            spawnParticleSafe(world, Particle.LARGE_SMOKE, spawnLoc, 30, 1.0, 1.0, 1.0, 0.05);
            spawnParticleSafe(world, Particle.CRIT, spawnLoc, 25, 1.2, 1.0, 1.2, 0.15);
            log.info("TitlelessKnight 生成成功：" + uuid + " @ " + world.getName()
                + " (" + Math.round(spawnLoc.getX()) + "," + Math.round(spawnLoc.getY())
                + "," + Math.round(spawnLoc.getZ()) + ")");
            return true;
        } catch (e) {
            logError("TitlelessKnight 生成失败", e);
            return false;
        }
    }

    function removeBossBar(boss) {
        try {
            if (boss.bar != null) {
                boss.bar.removeAll();
                boss.bar.setVisible(false);
            }
            Bukkit.removeBossBar(boss.barKey);
        } catch (ignored) { }
    }

    function cleanupBoss(boss) {
        if (boss == null) return;
        removeBossBar(boss);
        try {
            if (boss.carrier != null && boss.carrier.isValid() && !boss.carrier.isDead()) {
                boss.carrier.remove();
            }
        } catch (ignored) { }
        delete activeBosses[boss.uuid];
        log.info("TitlelessKnight 已清理 BOSS：" + boss.uuid);
    }

    // 本脚本实例当前活着的载具 UUID 集合：
    // 周期性 cleanupOrphans 必须跳过这些实体，否则会把正在战斗的 BOSS 一起删掉
    // （本机实测：600 tick 周期清理直接删除了刚召唤出来的 BOSS）。
    function isOwnedEntity(uuid) {
        return activeBosses[String(uuid)] != null;
    }


    function removeTaggedEntities(world, tag) {
        var removed = 0;
        try {
            var it = world.getEntitiesByClass(EntityClass).iterator();
            while (it.hasNext()) {
                var ent = it.next();
                if (!ent.getScoreboardTags().contains(tag)) continue;
                if (isOwnedEntity(String(ent.getUniqueId().toString()))) continue;
                ent.remove();
                removed++;
            }
        } catch (e) {
            logError("TitlelessKnight 清理带 Tag 实体异常", e);
        }
        return removed;
    }

    // 本 BOSS 只使用一个固定 key 的 KeyedBossBar，因此清理孤儿血条不需要遍历。
    //
    // 实测（旁路测试服）：Bukkit.getBossBars() 在 Nashorn 下返回的是
    // java.util.HashMap$Values 这类**非公开**集合实现，Nashorn 无法解析它的方法，
    // bars.size() / bars.iterator() 都会抛 TypeError（"is not a function"），
    // 所以「遍历 getBossBars() 找自家 key」这种写法在本服是无效的（会静默失败）。
    // 改用公开 API：Bukkit.removeBossBar(KeyedBossBar 对应的 NamespacedKey)。
    function cleanupOrphanBossBars() {
        if (Object.keys(activeBosses).length > 0) return;   // 本实例还有活着的 BOSS，血条在用
        try {
            Bukkit.removeBossBar(barKey);
        } catch (e) {
            logError("TitlelessKnight 清理孤儿 BossBar 异常", e);
        }
    }

    // 脚本重载 / 启动时清理上一次实例遗留的实体与血条（M-2：必须等主线程第一个 tick）
    function cleanupOrphans() {
        try {
            var removed = 0;
            var worlds = Bukkit.getWorlds();
            for (var i = 0; i < worlds.size(); i++) {
                removed += removeTaggedEntities(worlds.get(i), BOSS_TAG);
            }
            cleanupOrphanBossBars();
            if (removed > 0) log.info("TitlelessKnight 清理孤儿实体：" + removed + " 个。");
        } catch (e) {
            logError("TitlelessKnight 清理孤儿实体异常", e);
        }
    }

    // -----------------------------------------------------------------------
    // 外观 / 朝向 / 移动
    // -----------------------------------------------------------------------
    // 让本体 + 头部一起看向某个点（含俯仰），返回本次算出的 yaw。
    //
    // 三个层次，逐层兜底：
    //   1) Entity#setRotation(yaw,pitch) —— 设置实体本体朝向（一定可用）；
    //   2) Mob#lookAt(x,y,z)            —— 让 LookControl 把头部转向该点；
    //   3) NMS getHandle().setYHeadRot / setYBodyRot / setXRot
    //      —— 无 AI 实体不会被 LookControl 推进头部旋转，直接写 NMS 字段最保险，
    //         失败一次就永久退化为前两层（不会刷屏报错）。
    //
    // 返回值必须被调用方拿去 teleport：teleport(Location) 会连同 yaw/pitch 一起写入实体，
    // 若继续沿用 teleport 之前读到的旧 yaw，就会把刚设置好的朝向又覆盖回旧值（本机实测踩过：
    // BOSS 一路"横着走"，朝向永远停在出生角度）。
    function lookAtPoint(boss, targetX, targetY, targetZ) {
        var yaw = boss.carrier.getLocation().getYaw();
        var pitch = 0.0;
        try {
            var loc = boss.carrier.getLocation();
            var dx = targetX - loc.getX();
            var dz = targetZ - loc.getZ();
            var dy = targetY - (loc.getY() + TARGET_EYE_HEIGHT);
            var horizontal = Math.sqrt(dx * dx + dz * dz);
            yaw = Math.atan2(-dx, dz) * 180.0 / Math.PI;
            pitch = (horizontal < 0.001) ? 0.0
                : clamp(-Math.atan2(dy, horizontal) * 180.0 / Math.PI, -MAX_FACE_PITCH, MAX_FACE_PITCH);

            try { boss.carrier.setRotation(yaw, pitch); } catch (ignored) { }
            try { boss.carrier.lookAt(targetX, targetY, targetZ); } catch (ignored) { }

            if (headRotationViaNms !== false) {
                try {
                    var handle = boss.carrier.getHandle();
                    handle.setYHeadRot(yaw);
                    handle.setYBodyRot(yaw);
                    handle.setXRot(pitch);
                    if (headRotationViaNms === null) {
                        headRotationViaNms = true;
                        log.info("TitlelessKnight 头部朝向：已启用 NMS 直接写入（setYHeadRot/setYBodyRot）。");
                    }
                } catch (e) {
                    if (headRotationViaNms === null) {
                        headRotationViaNms = false;
                        log.warn("TitlelessKnight 头部朝向：NMS 通道不可用，退化为 setRotation + lookAt（"
                            + e + "）。");
                    }
                }
            }
        } catch (e) {
            logError("TitlelessKnight 朝向计算异常", e);
        }
        boss.faceYaw = yaw;
        boss.facePitch = pitch;
        return yaw;
    }

    // 看向目标玩家的视线高度（移动 / 追击时每 tick 调用）
    function faceTarget(boss, targetLocation) {
        return lookAtPoint(boss, targetLocation.getX(),
            targetLocation.getY() + TARGET_EYE_HEIGHT, targetLocation.getZ());
    }

    // 走到目标格时该站在哪一层：先尝试上台阶（最多 MAX_STEP_UP 格），
    // 再尝试下台阶（最多 MAX_STEP_DOWN 格）；都不行返回 null 表示"这一格走不进去"。
    // 本 BOSS 与其它自定义 BOSS 一致，采用「关闭重力 + 逐 tick 位移」的移动方式：
    // 本机实测（旁路测试服）无 AI 实体在无玩家区块里不会被物理推进，逐 tick 位移最稳。
    function resolveWalkY(world, x, currentY, z) {
        try {
            var bx = Math.floor(x);
            var bz = Math.floor(z);
            var base = Math.floor(currentY);
            var lift;
            for (lift = 0; lift <= MAX_STEP_UP; lift++) {
                var y = base + lift;
                var support = world.getBlockAt(bx, y - 1, bz);
                var feet = world.getBlockAt(bx, y, bz);
                var head = world.getBlockAt(bx, y + 1, bz);
                if (support.getType().isSolid() && !feet.getType().isSolid()
                        && !head.getType().isSolid()) {
                    return y;
                }
            }
            for (var drop = 1; drop <= MAX_STEP_DOWN; drop++) {
                var low = base - drop;
                if (world.getBlockAt(bx, low - 1, bz).getType().isSolid()
                        && !world.getBlockAt(bx, low, bz).getType().isSolid()
                        && !world.getBlockAt(bx, low + 1, bz).getType().isSolid()) {
                    return low;
                }
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    function updateMovement(boss, target) {
        if (boss.action != null) return;   // 出招期间站定，给玩家反应时间
        if (target == null) return;
        try {
            var loc = boss.carrier.getLocation();
            var tgt = target.getLocation();
            var dx = tgt.getX() - loc.getX();
            var dz = tgt.getZ() - loc.getZ();
            var dist = Math.sqrt(dx * dx + dz * dz);
            // 追击时始终看向目标玩家（本体 + 头部 + 俯仰）
            var faceYaw = lookAtPoint(boss, tgt.getX(), tgt.getY() + TARGET_EYE_HEIGHT, tgt.getZ());
            if (dist <= KEEP_DISTANCE || dist < 0.0001) return;

            var step = Math.min(WALK_SPEED, dist - KEEP_DISTANCE);
            var nextX = loc.getX() + (dx / dist) * step;
            var nextZ = loc.getZ() + (dz / dist) * step;
            var nextY = resolveWalkY(boss.world, nextX, loc.getY(), nextZ);
            if (nextY == null) return;   // 前方是墙：原地不动，等待绕行 / 出招
            // 注意：这里必须用刚算出的 yaw/pitch，不能用 teleport 之前读到的旧朝向
            boss.carrier.teleport(new Location(boss.world, nextX, nextY, nextZ,
                faceYaw, boss.facePitch));
        } catch (e) {
            logError("TitlelessKnight 移动异常", e);
        }
    }

    function snapToGround(boss) {
        try {
            var loc = boss.carrier.getLocation();
            var groundY = resolveWalkY(boss.world, loc.getX(), loc.getY(), loc.getZ());
            if (groundY == null) groundY = resolveGroundY(boss.world, loc.getX(), loc.getY(), loc.getZ());
            if (Math.abs(loc.getY() - groundY) > 0.001) {
                boss.carrier.teleport(new Location(boss.world, loc.getX(), groundY, loc.getZ(),
                    loc.getYaw(), 0));
            }
        } catch (ignored) { }
    }

    // -----------------------------------------------------------------------
    // 盾牌与伤害底层
    // -----------------------------------------------------------------------
    // 玩家是否"真的"在用盾牌格挡：举盾中 且 盾牌不在冷却中。
    // 盾牌被劈砍击碎后的 5 秒内，即使按住右键也挡不住任何攻击。
    function isPlayerGuarding(player) {
        if (player == null) return false;
        var blocking = false;
        try {
            blocking = player.isBlocking();
        } catch (e) {
            return false;
        }
        if (!blocking) return false;
        try {
            if (player.getCooldown(Material.SHIELD) > 0) return false;
        } catch (ignored) { }
        return true;
    }

    function playShieldBlockFeedback(player) {
        try {
            var loc = player.getLocation();
            var world = loc.getWorld();
            if (world == null) return;
            playSoundSafe(world, loc, Sound.ITEM_SHIELD_BLOCK, 1.3, 1.0);
            var dir = loc.getDirection().normalize().multiply(-1.0);
            for (var i = 0; i < 10; i++) {
                spawnParticleSafe(world, Particle.CRIT, new Location(world,
                    loc.getX() + dir.getX() * 0.7 + (Math.random() - 0.5) * 0.5,
                    loc.getY() + 1.2 + (Math.random() - 0.5) * 0.5,
                    loc.getZ() + dir.getZ() * 0.7 + (Math.random() - 0.5) * 0.5),
                    1, 0.0, 0.0, 0.0, 0.05);
            }
        } catch (ignored) { }
        // 成功格挡也是「恐惧战吼虚弱」的驱散进度来源
        registerShieldBlock(player);
    }

    // -----------------------------------------------------------------------
    // 恐惧战吼的虚弱：被吼中的玩家用盾牌成功格挡 3 次即可提前驱散
    // -----------------------------------------------------------------------
    function isRoarWeaknessTracked(player) {
        try {
            return roarWeaknessBlocks[String(player.getUniqueId().toString())] != null;
        } catch (e) {
            return false;
        }
    }

    function playerHasWeakness(player) {
        // 拿不到效果信息时按「仍有虚弱」处理，避免误清进度
        try {
            return player.hasPotionEffect(PotionEffectType.WEAKNESS);
        } catch (e) {
            return true;
        }
    }

    // 玩家成功用盾牌挡下一次攻击时调用
    function registerShieldBlock(player) {
        if (player == null) return;
        try {
            var uuid = String(player.getUniqueId().toString());
            if (roarWeaknessBlocks[uuid] == null) return;      // 身上没有战吼虚弱的进度记录
            if (!playerHasWeakness(player)) {                  // 虚弱已经自然结束
                delete roarWeaknessBlocks[uuid];
                return;
            }
            var count = roarWeaknessBlocks[uuid] + 1;
            if (count < ROAR_WEAKNESS_BLOCKS_TO_CLEAR) {
                roarWeaknessBlocks[uuid] = count;
                try {
                    player.sendActionBar(ChatColor.GOLD + "盾牌格挡 " + ChatColor.YELLOW + count
                        + ChatColor.GRAY + "/" + ROAR_WEAKNESS_BLOCKS_TO_CLEAR
                        + ChatColor.GRAY + " —— 可驱散恐惧战吼的虚弱");
                } catch (ignored) { }
                return;
            }

            // 达标：驱散虚弱
            delete roarWeaknessBlocks[uuid];
            try { player.removePotionEffect(PotionEffectType.WEAKNESS); } catch (ignored) { }
            try {
                var loc = player.getLocation();
                var world = loc.getWorld();
                if (world != null) {
                    playSoundSafe(world, loc, Sound.ENTITY_ZOMBIE_VILLAGER_CURE, 1.2, 1.3);
                    spawnParticleSafe(world, Particle.HAPPY_VILLAGER,
                        new Location(world, loc.getX(), loc.getY() + 1.2, loc.getZ()),
                        20, 0.6, 0.6, 0.6, 0.02);
                }
            } catch (ignored) { }
            try {
                player.sendMessage(ChatColor.DARK_RED + "[" + BOSS_NAME + "] " + ChatColor.GREEN
                    + "你用盾牌连续挡下 " + ROAR_WEAKNESS_BLOCKS_TO_CLEAR
                    + " 次攻击，恐惧战吼的虚弱已被驱散。");
            } catch (ignored) { }
        } catch (e) {
            logError("TitlelessKnight 盾牌格挡驱散虚弱异常", e);
        }
    }

    // 周期性清理进度表：虚弱已消失 / 玩家已下线的条目直接删除
    function decayRoarWeakness() {
        var uuids = Object.keys(roarWeaknessBlocks);
        if (uuids.length === 0) return;
        for (var i = 0; i < uuids.length; i++) {
            var uuid = uuids[i];
            try {
                var player = Bukkit.getPlayer(UUIDClass.fromString(uuid));
                if (player == null || !player.isOnline() || !playerHasWeakness(player)) {
                    delete roarWeaknessBlocks[uuid];
                }
            } catch (e) {
                delete roarWeaknessBlocks[uuid];
            }
        }
    }

    // 斧头式破盾：清掉举盾状态 + 盾牌进入 5 秒冷却 + 破碎音效与提示
    function breakPlayerShield(player) {
        try { player.clearActiveItem(); } catch (ignored) { }
        try { player.setCooldown(Material.SHIELD, SHIELD_DISABLE_TICKS); } catch (ignored) { }
        try {
            playSoundSafe(player.getWorld(), player.getLocation(), Sound.ITEM_SHIELD_BREAK, 1.5, 0.9);
        } catch (ignored) { }
        try {
            player.sendMessage(ChatColor.DARK_RED + "[" + BOSS_NAME + "] " + ChatColor.RED
                + "劈砍击碎了你的盾牌！" + ChatColor.GRAY + "（"
                + (SHIELD_DISABLE_TICKS / 20) + " 秒内无法格挡）");
        } catch (ignored) { }
    }

    // 对玩家造成伤害，返回"是否真的掉血"。
    // 创造模式 / 无敌 / 已死亡的玩家会返回 false —— 眩晕击的缓慢效果以此为判据。
    function dealPlayerDamage(player, amount, boss) {
        var before = -1.0;
        try {
            before = player.getHealth();
        } catch (e) {
            return false;
        }
        try { player.setNoDamageTicks(0); } catch (ignored) { }   // 清无敌帧，保证每段判定生效
        try {
            if (boss != null && boss.carrier != null && boss.carrier.isValid()) {
                player.damage(amount, boss.carrier);
            } else {
                player.damage(amount);
            }
        } catch (e) {
            logError("TitlelessKnight 造成伤害失败", e);
            return false;
        }
        try {
            return player.getHealth() < before - 0.001;
        } catch (e) {
            return false;
        }
    }

    function knockbackPlayer(boss, player, strength, vertical) {
        try {
            var push = player.getLocation().toVector()
                .subtract(boss.carrier.getLocation().toVector());
            push.setY(0.0);
            if (push.lengthSquared() > 0.0001) {
                push.normalize().multiply(strength);
            } else {
                push = new Vector(0.0, 0.0, 0.0);
            }
            push.setY(vertical);
            player.setVelocity(push);
        } catch (ignored) { }
    }

    // 命中判定：水平距离 + 垂直容差 + 正面扇形（绕后可躲）
    function isInMeleeArc(boss, player, range, verticalTolerance) {
        try {
            var loc = boss.carrier.getLocation();
            var pl = player.getLocation();
            var dx = pl.getX() - loc.getX();
            var dz = pl.getZ() - loc.getZ();
            var dy = (pl.getY() + 0.9) - (loc.getY() + 1.0);
            if (Math.abs(dy) > verticalTolerance) return false;
            var horizontalSq = dx * dx + dz * dz;
            if (horizontalSq > range * range) return false;
            if (horizontalSq < 0.09) return true;
            var yawRad = loc.getYaw() * Math.PI / 180.0;
            var forwardX = -Math.sin(yawRad);
            var forwardZ = Math.cos(yawRad);
            var dot = (dx * forwardX + dz * forwardZ) / Math.sqrt(horizontalSq);
            return dot >= MELEE_ARC_DOT_MIN;
        } catch (e) {
            return false;
        }
    }

    function collectTargetsInArc(boss, range, verticalTolerance) {
        var result = [];
        try {
            var players = boss.world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var p = players.get(i);
                if (!isEngageablePlayer(p)) continue;
                if (isInMeleeArc(boss, p, range, verticalTolerance)) result.push(p);
            }
        } catch (e) {
            logError("TitlelessKnight 近战目标收集异常", e);
        }
        return result;
    }

    // -----------------------------------------------------------------------
    // 大剑三式：单目标结算（返回 "blocked" / "hit" / "noeffect"）
    // -----------------------------------------------------------------------
    // 挥砍：可被盾牌完全防下
    function resolveSlashHit(boss, player) {
        if (isPlayerGuarding(player)) {
            playShieldBlockFeedback(player);
            return "blocked";
        }
        var dealt = dealPlayerDamage(player, SLASH_DAMAGE, boss);
        knockbackPlayer(boss, player, SLASH_KNOCKBACK, 0.24);
        return dealt ? "hit" : "noeffect";
    }

    // 劈砍：斧头原理破盾（举盾能挡下本次伤害，但盾牌被击碎并冷却 5 秒）
    function resolveCleaveHit(boss, player) {
        if (isPlayerGuarding(player)) {
            playShieldBlockFeedback(player);
            breakPlayerShield(player);
            return "blocked";
        }
        var dealt = dealPlayerDamage(player, CLEAVE_DAMAGE, boss);
        knockbackPlayer(boss, player, CLEAVE_KNOCKBACK, -0.2);   // 劈砍把玩家压向地面
        return dealt ? "hit" : "noeffect";
    }

    // 眩晕击：可被盾牌防下；只有真正造成伤害才附加 缓慢 III 5 秒
    function resolveStunHit(boss, player) {
        if (isPlayerGuarding(player)) {
            playShieldBlockFeedback(player);
            return "blocked";
        }
        var dealt = dealPlayerDamage(player, STUN_DAMAGE, boss);
        if (!dealt) return "noeffect";
        try {
            player.addPotionEffect(new PotionEffect(PotionEffectType.SLOWNESS,
                STUN_SLOW_TICKS, STUN_SLOW_AMPLIFIER, false, true, true));
        } catch (ignored) { }
        knockbackPlayer(boss, player, STUN_KNOCKBACK, 0.18);
        try {
            player.sendMessage(ChatColor.DARK_RED + "[" + BOSS_NAME + "] " + ChatColor.GRAY
                + "你被眩晕击命中：缓慢 III " + (STUN_SLOW_TICKS / 20) + " 秒。");
            player.sendActionBar(ChatColor.DARK_RED + "眩晕！" + ChatColor.GRAY + "缓慢 III "
                + (STUN_SLOW_TICKS / 20) + "s");
        } catch (ignored) { }
        return "hit";
    }

    // 冲锋命中：可被盾牌防下
    function resolveChargeHit(boss, player) {
        if (isPlayerGuarding(player)) {
            playShieldBlockFeedback(player);
            knockbackPlayer(boss, player, CHARGE_BLOCK_KNOCKBACK, 0.1);
            return "blocked";
        }
        var dealt = dealPlayerDamage(player, CHARGE_DAMAGE, boss);
        knockbackPlayer(boss, player, CHARGE_KNOCKBACK, 0.35);
        try {
            player.sendMessage(ChatColor.DARK_RED + "[" + BOSS_NAME + "] " + ChatColor.GRAY
                + "你被冲锋撞飞了！");
        } catch (ignored) { }
        return dealt ? "hit" : "noeffect";
    }

    // -----------------------------------------------------------------------
    // 攻击状态机
    // -----------------------------------------------------------------------
    function pickMeleeKind() {
        var total = SLASH_WEIGHT + CLEAVE_WEIGHT + STUN_WEIGHT;
        var roll = Math.random() * total;
        if (roll < SLASH_WEIGHT) return KIND_SLASH;
        roll -= SLASH_WEIGHT;
        if (roll < CLEAVE_WEIGHT) return KIND_CLEAVE;
        return KIND_STUN;
    }

    function meleeWindupTicks(kind) {
        if (kind === KIND_CLEAVE) return CLEAVE_WINDUP_TICKS;
        if (kind === KIND_STUN) return STUN_WINDUP_TICKS;
        return SLASH_WINDUP_TICKS;
    }

    function meleeRange(kind) {
        if (kind === KIND_CLEAVE) return CLEAVE_RANGE;
        if (kind === KIND_STUN) return STUN_RANGE;
        return SLASH_RANGE;
    }

    function meleeVerticalTolerance(kind) {
        if (kind === KIND_CLEAVE) return CLEAVE_VERTICAL_TOLERANCE;
        if (kind === KIND_STUN) return STUN_VERTICAL_TOLERANCE;
        return SLASH_VERTICAL_TOLERANCE;
    }

    function startMelee(boss, target) {
        var kind = pickMeleeKind();
        var windup = meleeWindupTicks(kind);
        var hitCount = (kind === KIND_SLASH) ? SLASH_HIT_COUNT : 1;
        var gap = SLASH_HIT_GAP_TICKS;
        var tail = (kind === KIND_SLASH) ? 8 : 10;

        var act = {
            kind: kind,
            startTick: globalTick,
            windupEndTick: globalTick + windup,
            nextHitTick: globalTick + windup,
            endTick: globalTick + windup + (hitCount - 1) * gap + tail,
            hitCount: hitCount,
            hitIndex: 0,
            gap: gap,
            blockedCount: 0,
            hitOk: 0
        };
        boss.action = act;
        boss.lastMeleeKind = kind;
        // 需求：攻击冷却 2 秒（从本次出招开始计算）
        boss.nextMeleeTick = act.startTick + MELEE_COOLDOWN_TICKS;

        if (target != null) faceTarget(boss, target.getLocation());

        var loc = boss.carrier.getLocation();
        if (kind === KIND_CLEAVE) {
            playSoundSafe(boss.world, loc, Sound.ENTITY_IRON_GOLEM_ATTACK, 1.3, 0.6);
            playSoundSafe(boss.world, loc, Sound.BLOCK_ANVIL_PLACE, 1.1, 0.7);
        } else if (kind === KIND_STUN) {
            playSoundSafe(boss.world, loc, Sound.ENTITY_PLAYER_ATTACK_SWEEP, 1.1, 1.5);
        } else {
            playSoundSafe(boss.world, loc, Sound.ENTITY_PLAYER_ATTACK_SWEEP, 1.2, 0.9);
        }
        return act;
    }

    function startRoar(boss) {
        var act = {
            kind: KIND_ROAR,
            startTick: globalTick,
            windupEndTick: globalTick + ROAR_WINDUP_TICKS,
            endTick: globalTick + ROAR_WINDUP_TICKS + ROAR_SHOCKWAVE_TICKS,
            nextHitTick: globalTick + ROAR_WINDUP_TICKS,
            hitCount: 1,
            hitIndex: 0,
            gap: 0,
            shockRadius: 0.0
        };
        boss.action = act;
        boss.nextRoarTick = act.startTick + ROAR_COOLDOWN_TICKS;
        log.info("TitlelessKnight 恐惧战吼开始蓄力。");
        return act;
    }

    function startCharge(boss, target) {
        var act = {
            kind: KIND_CHARGE,
            phase: "windup",
            startTick: globalTick,
            windupEndTick: globalTick + CHARGE_WINDUP_TICKS,
            endTick: globalTick + CHARGE_WINDUP_TICKS + CHARGE_MAX_TICKS,
            nextHitTick: 0,
            hitCount: 1,
            hitIndex: 0,
            gap: 0,
            dirX: 0.0,
            dirZ: 1.0,
            yaw: 0.0,
            travelled: 0.0,
            hitPlayers: {},
            targetRef: target,
            targetUuid: (target != null) ? String(target.getUniqueId().toString()) : null
        };
        boss.action = act;
        boss.nextChargeTick = act.startTick + CHARGE_COOLDOWN_TICKS;
        playSoundSafe(boss.world, boss.carrier.getLocation(), Sound.ENTITY_RAVAGER_ROAR, 1.5, 0.8);
        log.info("TitlelessKnight 冲锋蓄力。");
        return act;
    }

    function finishAction(boss, act) {
        if (boss.action === act) boss.action = null;
        if (act.kind === KIND_CHARGE) {
            snapToGround(boss);
            boss.nextMeleeTick = Math.max(boss.nextMeleeTick, globalTick + CHARGE_RECOVER_TICKS);
        }
        return null;
    }

    function updateAction(boss) {
        var act = boss.action;
        if (act == null) return;
        if (act.kind === KIND_CHARGE) {
            updateChargeAction(boss, act);
            return;
        }
        if (act.kind === KIND_ROAR) {
            updateRoarAction(boss, act);
            return;
        }
        // ---- 大剑三式 ----
        if (globalTick < act.windupEndTick) {
            spawnWindupEffect(boss, act);
            return;
        }
        if (act.hitIndex < act.hitCount && globalTick >= act.nextHitTick) {
            act.hitIndex++;
            act.nextHitTick = globalTick + act.gap;
            performMeleeHit(boss, act);
        }
        if (globalTick >= act.endTick) finishAction(boss, act);
    }

    function spawnWindupEffect(boss, act) {
        if (globalTick % 2 !== 0) return;
        var loc = boss.carrier.getLocation();
        var center = new Location(boss.world, loc.getX(), loc.getY() + 1.5, loc.getZ());
        var particle = Particle.ENCHANTED_HIT;
        if (act.kind === KIND_CLEAVE) particle = Particle.CRIT;
        spawnParticleSafe(boss.world, particle, center, 6, 0.5, 0.5, 0.5, 0.02);
        var left = act.windupEndTick - globalTick;
        // 最后 4 tick 打两下节拍，提示"下一 tick 就要落刀"
        if (left === 4) playSoundSafe(boss.world, loc, Sound.BLOCK_NOTE_BLOCK_HAT, 0.9, 1.8);
        if (left === 2) playSoundSafe(boss.world, loc, Sound.BLOCK_NOTE_BLOCK_HAT, 0.9, 2.0);
    }

    function performMeleeHit(boss, act) {
        try { boss.carrier.swingMainHand(); } catch (ignored) { }
        var kind = act.kind;
        var targets = collectTargetsInArc(boss, meleeRange(kind), meleeVerticalTolerance(kind));
        for (var i = 0; i < targets.length; i++) {
            var player = targets[i];
            var status;
            if (kind === KIND_CLEAVE) status = resolveCleaveHit(boss, player);
            else if (kind === KIND_STUN) status = resolveStunHit(boss, player);
            else status = resolveSlashHit(boss, player);
            if (status === "blocked") act.blockedCount++;
            else if (status === "hit") act.hitOk++;
        }
        spawnMeleeEffect(boss, act);
    }

    function spawnMeleeEffect(boss, act) {
        var loc = boss.carrier.getLocation();
        var yaw = loc.getYaw() * Math.PI / 180.0;
        var forwardX = -Math.sin(yaw);
        var forwardZ = Math.cos(yaw);
        for (var i = 0; i < 14; i++) {
            var t = (i / 13.0 - 0.5);
            var angle = yaw + t * 1.2;
            spawnParticleSafe(boss.world, Particle.SWEEP_ATTACK, new Location(boss.world,
                loc.getX() - Math.sin(angle) * 2.2,
                loc.getY() + 1.1,
                loc.getZ() + Math.cos(angle) * 2.2),
                1, 0.0, 0.0, 0.0, 0.0);
        }
        if (act.kind === KIND_CLEAVE) {
            for (var m = 0; m < 16; m++) {
                var u = m / 15.0;
                spawnParticleSafe(boss.world, Particle.ENCHANTED_HIT, new Location(boss.world,
                    loc.getX() + forwardX * (1.0 + u * 2.0),
                    loc.getY() + 2.0 - u * 1.6,
                    loc.getZ() + forwardZ * (1.0 + u * 2.0)),
                    1, 0.0, 0.0, 0.0, 0.0);
            }
            playSoundSafe(boss.world, loc, Sound.ENTITY_PLAYER_ATTACK_CRIT, 1.6, 0.7);
            playSoundSafe(boss.world, loc, Sound.BLOCK_ANVIL_LAND, 1.0, 0.8);
        } else if (act.kind === KIND_STUN) {
            spawnParticleSafe(boss.world, Particle.CRIT,
                new Location(boss.world, loc.getX(), loc.getY() + 1.3, loc.getZ()),
                18, 0.6, 0.5, 0.6, 0.1);
            playSoundSafe(boss.world, loc, Sound.ENTITY_PLAYER_ATTACK_STRONG, 1.3, 0.8);
        } else {
            playSoundSafe(boss.world, loc, Sound.ENTITY_PLAYER_ATTACK_SWEEP, 1.2, 1.0);
        }
    }

    // ---- 恐惧战吼 ----
    function updateRoarAction(boss, act) {
        var loc = boss.carrier.getLocation();
        if (globalTick < act.windupEndTick) {
            if (globalTick % 2 === 0) {
                var total = Math.max(1, act.windupEndTick - act.startTick);
                var progress = clamp((globalTick - act.startTick) / total, 0.0, 1.0);
                var radius = 0.7 + progress * 1.9;
                for (var i = 0; i < 10; i++) {
                    var angle = (i / 10.0) * Math.PI * 2.0 + globalTick * 0.2;
                    spawnParticleSafe(boss.world, Particle.SOUL, new Location(boss.world,
                        loc.getX() + Math.cos(angle) * radius,
                        loc.getY() + 1.2 + Math.sin(progress * Math.PI) * 0.5,
                        loc.getZ() + Math.sin(angle) * radius),
                        1, 0.0, 0.0, 0.0, 0.0);
                }
            }
            if (globalTick === act.windupEndTick - 1) {
                playSoundSafe(boss.world, loc, Sound.ENTITY_RAVAGER_ROAR, 2.2, 0.6);
            }
            return;
        }

        if (act.hitIndex === 0) {
            act.hitIndex = 1;
            applyFearRoar(boss);
        }
        // 冲击环扩散
        var ringTotal = Math.max(1, act.endTick - act.windupEndTick);
        act.shockRadius = ROAR_RADIUS
            * clamp((globalTick - act.windupEndTick) / ringTotal, 0.0, 1.0);
        drawShockwaveRing(boss, loc, act.shockRadius);
        if (globalTick >= act.endTick) finishAction(boss, act);
    }

    function drawShockwaveRing(boss, center, radius) {
        if (radius <= 0.2) return;
        var points = 36;
        for (var i = 0; i < points; i++) {
            var angle = (i / points) * Math.PI * 2.0;
            spawnParticleSafe(boss.world, Particle.SMOKE, new Location(boss.world,
                center.getX() + Math.cos(angle) * radius,
                center.getY() + 0.35,
                center.getZ() + Math.sin(angle) * radius),
                1, 0.0, 0.02, 0.0, 0.01);
        }
    }

    function applyFearRoar(boss) {
        var loc = boss.carrier.getLocation();
        playSoundSafe(boss.world, loc, Sound.ENTITY_ENDER_DRAGON_GROWL, 2.0, 0.7);
        playSoundSafe(boss.world, loc, Sound.ENTITY_RAVAGER_ROAR, 2.6, 0.5);
        spawnParticleSafe(boss.world, Particle.LARGE_SMOKE,
            new Location(boss.world, loc.getX(), loc.getY() + 1.2, loc.getZ()),
            40, 1.6, 1.0, 1.6, 0.08);

        var affected = 0;
        try {
            var players = boss.world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var p = players.get(i);
                if (!isEngageablePlayer(p)) continue;
                if (p.getLocation().distanceSquared(loc) > ROAR_RADIUS * ROAR_RADIUS) continue;
                try {
                    p.addPotionEffect(new PotionEffect(PotionEffectType.WEAKNESS,
                        ROAR_WEAKNESS_TICKS, ROAR_WEAKNESS_AMPLIFIER, false, true, true));
                    // 开启「盾牌格挡 3 次可驱散」的进度记录
                    roarWeaknessBlocks[String(p.getUniqueId().toString())] = 0;
                } catch (ignored) { }
                try {
                    p.sendMessage(ChatColor.DARK_RED + "[" + BOSS_NAME + "] " + ChatColor.GRAY
                        + "恐惧战吼令你虚弱无力：虚弱 II " + (ROAR_WEAKNESS_TICKS / 20) + " 秒。"
                        + ChatColor.YELLOW + "（用盾牌成功格挡 " + ROAR_WEAKNESS_BLOCKS_TO_CLEAR
                        + " 次攻击可提前驱散）");
                    p.sendActionBar(ChatColor.DARK_RED + "恐惧战吼！" + ChatColor.GRAY + "虚弱 II "
                        + (ROAR_WEAKNESS_TICKS / 20) + "s" + ChatColor.YELLOW + " · 盾挡 0/"
                        + ROAR_WEAKNESS_BLOCKS_TO_CLEAR + " 可驱散");
                } catch (ignored) { }
                affected++;
            }
        } catch (e) {
            logError("TitlelessKnight 恐惧战吼结算异常", e);
        }
        log.info("TitlelessKnight 恐惧战吼命中 " + affected + " 名玩家。");
    }

    // ---- 冲锋 ----
    function updateChargeAction(boss, act) {
        var loc = boss.carrier.getLocation();
        if (act.phase === "windup") {
            var target = act.targetRef;
            if (target != null && isEngageablePlayer(target)) faceTarget(boss, target.getLocation());
            if (globalTick % 2 === 0) {
                spawnParticleSafe(boss.world, Particle.LARGE_SMOKE,
                    new Location(boss.world, loc.getX(), loc.getY() + 0.2, loc.getZ()),
                    6, 0.5, 0.15, 0.5, 0.02);
            }
            if (globalTick >= act.windupEndTick) beginChargeDash(boss, act);
            return;
        }

        // 冲刺：逐 tick 位移（与普通移动同一套 Y 轴解算，撞墙即中止）
        var nextX = loc.getX() + act.dirX * CHARGE_STEP;
        var nextZ = loc.getZ() + act.dirZ * CHARGE_STEP;
        var nextY = resolveWalkY(boss.world, nextX, loc.getY(), nextZ);
        var hitWall = (nextY == null);
        if (!hitWall) {
            try {
                boss.carrier.teleport(new Location(boss.world, nextX, nextY, nextZ,
                    act.yaw, 0));
            } catch (ignored) { }
            act.travelled += CHARGE_STEP;
        }
        checkChargeHits(boss, act);
        spawnChargeTrail(boss, loc);

        if (hitWall) {
            playSoundSafe(boss.world, loc, Sound.BLOCK_ANVIL_LAND, 1.2, 0.6);
            spawnParticleSafe(boss.world, Particle.CRIT,
                new Location(boss.world, loc.getX(), loc.getY() + 1.0, loc.getZ()),
                20, 0.6, 0.6, 0.6, 0.15);
            finishAction(boss, act);
            return;
        }
        if (act.travelled >= CHARGE_MAX_TRAVEL || globalTick >= act.endTick) {
            finishAction(boss, act);
        }
    }

    function beginChargeDash(boss, act) {
        var loc = boss.carrier.getLocation();
        var dirX = -Math.sin(loc.getYaw() * Math.PI / 180.0);
        var dirZ = Math.cos(loc.getYaw() * Math.PI / 180.0);
        var target = act.targetRef;
        if (target != null && isEngageablePlayer(target)) {
            var tl = target.getLocation();
            var dx = tl.getX() - loc.getX();
            var dz = tl.getZ() - loc.getZ();
            var dist = Math.sqrt(dx * dx + dz * dz);
            if (dist > 0.001) {
                dirX = dx / dist;
                dirZ = dz / dist;
            }
        }
        act.dirX = dirX;
        act.dirZ = dirZ;
        act.yaw = Math.atan2(-dirX, dirZ) * 180.0 / Math.PI;
        act.phase = "dash";
        try { boss.carrier.setRotation(act.yaw, 0); } catch (ignored) { }
        playSoundSafe(boss.world, loc, Sound.ENTITY_IRON_GOLEM_ATTACK, 1.8, 0.7);
        playSoundSafe(boss.world, loc, Sound.ENTITY_PLAYER_ATTACK_SWEEP, 1.5, 0.6);
    }

    function checkChargeHits(boss, act) {
        try {
            var loc = boss.carrier.getLocation();
            var players = boss.world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var p = players.get(i);
                if (!isEngageablePlayer(p)) continue;
                var uuid = String(p.getUniqueId().toString());
                if (act.hitPlayers[uuid]) continue;
                var pl = p.getLocation();
                var dx = pl.getX() - loc.getX();
                var dz = pl.getZ() - loc.getZ();
                if (dx * dx + dz * dz > CHARGE_HIT_RADIUS * CHARGE_HIT_RADIUS) continue;
                var dy = (pl.getY() + 0.9) - (loc.getY() + 1.0);
                if (Math.abs(dy) > CHARGE_VERTICAL_TOLERANCE) continue;
                act.hitPlayers[uuid] = true;
                resolveChargeHit(boss, p);
            }
        } catch (e) {
            logError("TitlelessKnight 冲锋命中判定异常", e);
        }
    }

    function spawnChargeTrail(boss, loc) {
        spawnParticleSafe(boss.world, Particle.SMOKE,
            new Location(boss.world, loc.getX(), loc.getY() + 0.5, loc.getZ()),
            6, 0.3, 0.3, 0.3, 0.02);
        spawnParticleSafe(boss.world, Particle.CRIT,
            new Location(boss.world, loc.getX(), loc.getY() + 1.0, loc.getZ()),
            4, 0.3, 0.3, 0.3, 0.05);
    }

    // -----------------------------------------------------------------------
    // 战斗总控
    // -----------------------------------------------------------------------
    function updateCombat(boss) {
        var target = findNearestPlayer(boss);
        boss.target = target;

        if (boss.action != null) {
            updateAction(boss);
            return;
        }
        if (target == null) return;

        var loc = boss.carrier.getLocation();
        var tgt = target.getLocation();
        var dx = tgt.getX() - loc.getX();
        var dz = tgt.getZ() - loc.getZ();
        var dist = Math.sqrt(dx * dx + dz * dz);

        // 优先级：冲锋 > 恐惧战吼 > 大剑
        if (globalTick >= boss.nextChargeTick
            && dist >= CHARGE_MIN_DISTANCE && dist <= CHARGE_MAX_DISTANCE) {
            startCharge(boss, target);
            return;
        }
        if (globalTick >= boss.nextRoarTick && dist <= ROAR_RADIUS) {
            startRoar(boss);
            return;
        }
        if (dist <= MELEE_TRIGGER_RANGE && globalTick >= boss.nextMeleeTick) {
            startMelee(boss, target);
            return;
        }
        updateMovement(boss, target);
    }

    function updateBossBar(boss) {
        if (boss.bar == null) return;
        boss.barTick++;
        if (boss.barTick % 5 === 0) {
            try {
                var health = boss.carrier.getHealth();
                boss.bar.setTitle(BOSS_NAME + "  " + ChatColor.YELLOW + Math.max(0, Math.round(health))
                    + ChatColor.GRAY + "/" + ChatColor.YELLOW + Math.round(MAX_HEALTH));
                boss.bar.setProgress(clamp(health / MAX_HEALTH, 0.0, 1.0));
            } catch (ignored) { }
        }
        if (boss.barTick % 20 !== 0) return;
        try {
            var loc = boss.carrier.getLocation();
            var players = boss.world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var p = players.get(i);
                if (p.getLocation().distanceSquared(loc) <= BAR_VIEW_RANGE * BAR_VIEW_RANGE) {
                    boss.bar.addPlayer(p);
                } else {
                    boss.bar.removePlayer(p);
                }
            }
        } catch (ignored) { }
    }

    // -----------------------------------------------------------------------
    // 死亡序列
    // -----------------------------------------------------------------------
    function startDeathSequence(boss) {
        if (boss.dead) return;
        boss.dead = true;
        boss.action = null;
        boss.deathStartTick = globalTick;
        boss.deathEndTick = globalTick + DEATH_SEQUENCE_TICKS;
        try {
            boss.deathLocation = boss.carrier.getLocation().clone();
        } catch (e) {
            boss.deathLocation = null;
        }
        removeBossBar(boss);
        if (boss.deathLocation != null) {
            playSoundSafe(boss.world, boss.deathLocation, Sound.ENTITY_IRON_GOLEM_DEATH, 1.6, 0.7);
            playSoundSafe(boss.world, boss.deathLocation, Sound.ENTITY_ZOMBIE_DEATH, 1.4, 0.8);
            spawnParticleSafe(boss.world, Particle.LARGE_SMOKE, boss.deathLocation, 40, 0.8, 1.0, 0.8, 0.05);
        }
        log.info("TitlelessKnight 进入死亡序列：" + boss.uuid);
    }

    function updateDeathSequence(boss) {
        if (boss.deathLocation != null && globalTick % 4 === 0) {
            spawnParticleSafe(boss.world, Particle.SOUL, boss.deathLocation, 8, 0.6, 0.8, 0.6, 0.02);
        }
        if (globalTick >= boss.deathEndTick) {
            log.info("TitlelessKnight 死亡序列完成。");
            cleanupBoss(boss);
        }
    }

    function updateBoss(boss) {
        if (boss.dead) {
            updateDeathSequence(boss);
            return;
        }
        if (boss.carrier == null || !boss.carrier.isValid()) {
            cleanupBoss(boss);
            return;
        }
        try { boss.carrier.setFireTicks(0); } catch (ignored) { }
        updateBossBar(boss);
        updateCombat(boss);
    }

    function updateAllBosses() {
        var uuids = Object.keys(activeBosses);
        for (var i = 0; i < uuids.length; i++) {
            var boss = activeBosses[uuids[i]];
            if (boss == null) continue;
            try {
                updateBoss(boss);
            } catch (e) {
                logError("TitlelessKnight BOSS[" + uuids[i] + "] tick 异常", e);
            }
        }
    }

    // -----------------------------------------------------------------------
    // 事件注册
    // M-2：OpenJS 并行加载脚本，监听器表是普通 HashMap，顶层 registerEvent 会抛
    // ConcurrentModificationException，统一推迟到主线程第一个 tick 串行注册。
    // -----------------------------------------------------------------------
    function registerAllEvents() {

        // 伤害免疫：只接受玩家来源的伤害，免疫火焰 / 爆炸 / 摔落等环境伤害
        registerEvent("org.bukkit.event.entity.EntityDamageEvent", function (event) {
            try {
                var boss = getBossByEntity(event.getEntity());
                if (boss == null) return;

                if (boss.dead) {
                    event.setCancelled(true);
                    return;
                }
                if (isIgnoredDamageCause(event.getCause())) {
                    event.setCancelled(true);
                    return;
                }

                var source = null;
                try { source = event.getDamageSource(); } catch (ignored) { }
                var attacker = null;
                if (source != null) {
                    attacker = source.getCausingEntity();
                    if (attacker == null) attacker = source.getDirectEntity();
                }
                if (attacker != null && !(attacker instanceof PlayerClass)) {
                    event.setCancelled(true);
                }
            } catch (e) {
                logError("TitlelessKnight 受伤事件异常", e);
            }
        });

        // 近战 / 远程命中：只做金属碰撞反馈（无硬直机制）
        registerEvent("org.bukkit.event.entity.EntityDamageByEntityEvent", function (event) {
            try {
                var boss = getBossByEntity(event.getEntity());
                if (boss == null || boss.dead) return;

                // 子类事件监听器会收到基类伤害事件，普通伤害没有 getDamager()，必须 try/catch
                var damager = null;
                try { damager = event.getDamager(); } catch (e) { return; }
                if (damager == null) return;
                if (damager instanceof PlayerClass) {
                    var loc = boss.carrier.getLocation();
                    playSoundSafe(boss.world, loc, Sound.ENTITY_IRON_GOLEM_HURT, 0.55, 1.4);
                    spawnParticleSafe(boss.world, Particle.CRIT,
                        new Location(boss.world, loc.getX(), loc.getY() + 1.2, loc.getZ()),
                        6, 0.4, 0.4, 0.4, 0.05);
                }
            } catch (e) {
                logError("TitlelessKnight 近战/远程事件异常", e);
            }
        });

        // 死亡：清空掉落并进入死亡序列
        registerEvent("org.bukkit.event.entity.EntityDeathEvent", function (event) {
            try {
                var boss = getBossByEntity(event.getEntity());
                if (boss == null) return;
                try {
                    event.getDrops().clear();
                    event.setDroppedExp(0);
                } catch (ignored) { }
                startDeathSequence(boss);
            } catch (e) {
                logError("TitlelessKnight 死亡事件异常", e);
            }
        });

    }   // ---- end registerAllEvents ----

    // -----------------------------------------------------------------------
    // 主循环
    // -----------------------------------------------------------------------
    task.repeat(ticks(1), ticks(1), function () {
        globalTick++;
        try {
            processSyncDelayedTasks();
        } catch (e) {
            logError("TitlelessKnight 延迟队列异常", e);
        }
        try {
            updateAllBosses();
        } catch (e) {
            logError("TitlelessKnight 主循环异常", e);
        }
        // 每秒清理一次「恐惧战吼虚弱」的格挡进度（虚弱已结束 / 玩家已下线的条目）
        if (globalTick % 20 === 0) {
            try {
                decayRoarWeakness();
            } catch (e) {
                logError("TitlelessKnight 虚弱进度清理异常", e);
            }
        }
    });

    scheduleSync(1, registerAllEvents);
    scheduleSync(2, cleanupOrphans);
    task.repeat(ticks(600), ticks(600), cleanupOrphans);

    // -----------------------------------------------------------------------
    // BossRegistry 注册
    // M-1：跨脚本引擎保存 JS 对象会读串号，只传基本值与函数；
    // 别名 / 简介用 java.util.ArrayList（纯 Java 容器），跨引擎读取最稳。
    // -----------------------------------------------------------------------
    var registeredThisInstance = false;

    function ensureRegistered() {
        try {
            var api = getShared("BossRegistry");
            if (api == null) return;
            if (!registeredThisInstance || api.heartbeat(BOSS_ID) !== true) {
                // 必须覆盖注册：CallBoss / 本脚本重载后旧注册表可能已失效，
                // heartbeat 返回 false 时必须重新注册当前实例的 spawn 句柄。
                var aliases = new ArrayList();
                for (var i = 0; i < BOSS_ALIASES.length; i++) aliases.add(String(BOSS_ALIASES[i]));
                var lore = new ArrayList();
                for (var j = 0; j < BOSS_LORE.length; j++) lore.add(String(BOSS_LORE[j]));
                api.register(BOSS_ID, BOSS_NAME, aliases, lore, spawnTitlelessKnight);
                registeredThisInstance = true;
            }
        } catch (e) {
            logError("TitlelessKnight 注册异常", e);
        }
    }

    ensureRegistered();
    task.repeat(ticks(20), ticks(20), ensureRegistered);

    // -----------------------------------------------------------------------
    // 启动日志（契约第 10 节：必须能看到脚本自己的加载日志）
    // -----------------------------------------------------------------------
    log.info("TitlelessKnight 已加载：使用 /call boss " + BOSS_NAME + " 获取召唤绿宝石。");
})();
