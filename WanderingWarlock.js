/*
 * WanderingWarlock.js —— 自定义 BOSS「流浪术士」（OpenJS 1.5.0 / Paper 1.21.8）
 *
 * 获取方式：/call boss 流浪术士
 * 召唤方式：手持名为「流浪术士」的绿宝石右键地面 → 6 秒倒计时 → spawn
 *
 * 机制摘要：
 *   外观：真实骷髅（Skeleton）本体，头 / 胸 / 腿 / 脚 全套金甲，主手 书
 *   数据：HP 100；移动速度 0.24 格/tick（玩家步行约 0.215，略快约 11%）；
 *         击退抗性 1.0（完全免疫击退）；免疫火焰 / 爆炸 / 摔落等环境伤害，
 *         只接受玩家造成的伤害；白天不会着火（逐 tick 清火焰 + 取消火焰伤害）
 *   走位：中距离施法者 —— 玩家近于 4 格后退、远于 12 格靠近、中距离横向绕行
 *   施展戏法（三选一，一次连发两招，冷却 3 秒）：
 *     · 火焰箭  ：发射火焰弹，微量伤害并点燃命中目标，可被盾牌防御
 *     · 电爪    ：距离目标 1 格内施展，微量伤害，**无视护甲与盾牌**
 *     · 次级幻影：召唤 1~2 个替身，替身原地站立、被攻击即消失，持续 5 秒
 *   施展 1 级法术（二选一，冷却 30 秒；后两个需要场上有其他自定义 BOSS）：
 *     · 护盾术  ：给另一个自定义 BOSS 套 3 层护盾（每层抵消一次任意来源伤害），持续 60 秒
 *     · 法师护甲：给另一个自定义 BOSS 提升护甲值 +8，持续 120 秒（金光特效）
 *     · 雷鸣波  ：距离目标 2 格内施展，扇形声波击飞 + 微量伤害，可破盾（斧头原理）
 *   施展 2 级法术（二选一，冷却 45 秒）：
 *     · 粉碎音波：在目标附近产生直径 6 格的球形音波，一定伤害，无视护甲、可被盾牌防御
 *     · 灼热射线：向目标发射 3 道热射线，一定伤害并点燃目标（可被盾牌防御）
 *
 * 契约依据：《OpenJS脚本数据契约.md》v1.0.0；实测约束见 M-1 ~ M-20
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
    var AttributeInstanceClass = Java.type("org.bukkit.attribute.AttributeInstance");
    var AttributeModifierClass = Java.type("org.bukkit.attribute.AttributeModifier");
    var AttributeModifierOperation = Java.type("org.bukkit.attribute.AttributeModifier$Operation");
    var Particle = Java.type("org.bukkit.Particle");
    var Sound = Java.type("org.bukkit.Sound");
    var PotionEffect = Java.type("org.bukkit.potion.PotionEffect");
    var PotionEffectType = Java.type("org.bukkit.potion.PotionEffectType");
    var BarColor = Java.type("org.bukkit.boss.BarColor");
    var BarStyle = Java.type("org.bukkit.boss.BarStyle");
    var GameMode = Java.type("org.bukkit.GameMode");
    var PlayerClass = Java.type("org.bukkit.entity.Player");
    var LivingEntityClass = Java.type("org.bukkit.entity.LivingEntity");
    // 「无视护甲」用的伤害来源（契约实测补充 M-11：只设伤害类型，不要传 null 坐标）
    var DamageSourceClass = Java.type("org.bukkit.damage.DamageSource");
    var Registry = Java.type("org.bukkit.Registry");
    var NamespacedKeyClass = Java.type("org.bukkit.NamespacedKey");
    var ArrayList = Java.type("java.util.ArrayList");
    var UUIDClass = Java.type("java.util.UUID");

    // M-5：Java.type(...) 返回 Nashorn StaticClass，不能当 java.lang.Class 传给 world.spawn。
    var EntityClass = Class.forName("org.bukkit.entity.Entity");
    var SkeletonClass = Class.forName("org.bukkit.entity.Skeleton");
    var SmallFireballClass = Class.forName("org.bukkit.entity.SmallFireball");
    var LargeFireballClass = Class.forName("org.bukkit.entity.LargeFireball");

    // -----------------------------------------------------------------------
    // 数值配置
    // -----------------------------------------------------------------------
    var BOSS_ID = "wandering_warlock";
    var BOSS_NAME = "流浪术士";
    var BOSS_ALIASES = ["流浪", "warlock", "wanderingwarlock", "sorcerer"];
    var BOSS_LORE = [
        "生命值：150",
        "全套金甲，手持一本书（骷髅本体）",
        "免疫击退；免疫火焰、爆炸、摔落等环境伤害",
        "只接受玩家造成的伤害",
        "————————————————",
        "施展戏法（三选一，一次连发两招，冷却 3 秒）：",
        "· 火焰箭：火焰弹，微量伤害 + 点燃，可被盾牌防御",
        "· 电爪：1 格内施展，微量伤害，无视护甲与盾牌",
        "· 次级幻影：召唤 1~2 个替身，替身被攻击即消失，持续 5 秒",
        "————————————————",
        "1 级法术（冷却 30 秒）：",
        "· 护盾术：给场上的其他自定义 BOSS 3 层护盾（每层抵消一次伤害），60 秒",
        "· 法师护甲：给场上的其他自定义 BOSS 提升护甲（+8），120 秒",
        "· 雷鸣波：2 格内施展，扇形声波击飞 + 微量伤害，可破盾",
        "————————————————",
        "2 级法术（冷却 45 秒）：",
        "· 粉碎音波：目标附近直径 6 格球形音波，一定伤害，无视护甲、可被盾牌防御",
        "· 灼热射线：3 道热射线，一定伤害并点燃目标，可被盾牌防御",
        "————————————————",
        "3 级法术（冷却 60 秒）：",
        "· 闪电束：1 秒前摇并发出警告，长 16 格宽 3 格的蓝白闪电柱，无视护甲与盾牌，大量伤害",
        "————————————————",
        "4 级法术（冷却 90 秒）：",
        "· 火球术：1.5 秒前摇并发出警告，无法拦截的火球，半径 8 格球状爆发，无视盾牌，大量伤害"
    ];

    // 生命 / 移动
    var MAX_HEALTH = 150.0;
    var KNOCKBACK_RESISTANCE = 1.0;
    // 速度：玩家步行速度属性 0.1 ≈ 0.215 格/tick；本 BOSS 逐 tick 位移，单位是 格/tick。
    var PLAYER_WALK_ATTRIBUTE = 0.1;
    var SPEED_MULTIPLIER = 1.11;
    var WALK_SPEED = 0.24;
    var MAX_STEP_UP = 1;
    var MAX_STEP_DOWN = 3;
    // 中距离施法者的放风筝走位
    var KEEP_DISTANCE = 4.0;              // 近于此后退
    var PREFERRED_RANGE = 12.0;           // 远于此靠近
    var STRAFE_SPEED = 0.09;
    var STRAFE_FLIP_TICKS = 40;
    var TARGET_RANGE = 48.0;
    var BAR_VIEW_RANGE = TARGET_RANGE;
    var SPAWN_GROUND_SEARCH = 5;

    // 朝向
    var TARGET_EYE_HEIGHT = 1.6;
    var MAX_FACE_PITCH = 35.0;

    // 血量：需求由 100 提升到 150（法术更偏辅助后需要更耐打）
    // 戏法（cantrip）：一次连发两招，冷却 3 秒
    var CANTRIP_CHAIN = 2;
    var CANTRIP_COOLDOWN_TICKS = 60;
    var FIRE_BOLT_WINDUP_TICKS = 10;
    var FIRE_BOLT_DAMAGE = 3.0;           // 需求：微量伤害
    var FIRE_BOLT_BURN_TICKS = 100;       // 点燃 5 秒
    var FIRE_BOLT_SPEED = 1.15;
    // 实测：小火球（SmallFireball）在 1.21 是**无重力**直线飞行的，
    // 原先按箭矢重力（0.05）做落点补偿会把瞄准点抬到目标头顶上方约 1.9 格。
    // 这里把重力做成可配参数：火焰弹填 0（直瞄胸口），若将来换成有重力的弹体再改。
    var FIRE_BOLT_GRAVITY = 0.0;
    var GRASP_CAST_RANGE = 1.6;           // 需求：距离目标 1 格范围内施展
    var GRASP_PICK_RANGE = 6.0;           // 目标在 6 格内才会选这一招
    var GRASP_DAMAGE = 3.0;               // 微量伤害（无视护甲与盾牌）
    var GRASP_WINDUP_TICKS = 22;          // 前摇期间会朝目标走近
    var ILLUSION_WINDUP_TICKS = 14;
    var ILLUSION_MIN = 1;
    var ILLUSION_MAX = 2;
    var ILLUSION_LIFE_TICKS = 100;        // 需求：持续 5 秒
    var ILLUSION_SPAWN_MIN = 2.0;         // 替身出现位置（距本体）
    var ILLUSION_SPAWN_MAX = 4.0;

    // 1 级法术
    var SPELL1_COOLDOWN_TICKS = 600;      // 需求：冷却 30 秒
    // 需求：法术更侧重辅助 —— 护盾术 / 法师护甲权重远高于攻击性的雷鸣波。
    // 注意：这里对 1 级法术不再套用「排除上一招」（pickWeighted 会因此反向抬高
    // 低权重项在稳态下的占比：4:4:2 + 排除时雷鸣波约 25%，5:5:2 不排除才稳定在 1/6）。
    var ARCANE_SHIELD_WEIGHT = 5;
    var MAGE_ARMOR_WEIGHT = 5;
    var THUNDERWAVE_WEIGHT = 2;
    var SHIELD_CHARGES = 3;               // 需求：3 个护盾环绕
    var SHIELD_DURATION_TICKS = 1200;     // 需求：持续 60 秒
    var SHIELD_CAST_WINDUP_TICKS = 20;
    var SHIELD_TARGET_RANGE = 32.0;       // 只给附近的另一个自定义 BOSS 套盾
    var MAGE_ARMOR_BONUS = 8.0;           // 需求：提升一定的护甲值
    var MAGE_ARMOR_DURATION_TICKS = 2400; // 需求：持续 120 秒
    var MAGE_ARMOR_WINDUP_TICKS = 20;
    var THUNDERWAVE_CAST_RANGE = 2.8;     // 需求：距离目标 2 格范围内施展
    var THUNDERWAVE_PICK_RANGE = 8.0;
    var THUNDERWAVE_WINDUP_TICKS = 22;    // 前摇期间会朝目标走近
    var THUNDERWAVE_RADIUS = 5.0;
    var THUNDERWAVE_ARC_DOT_MIN = 0.30;   // 正面约 ±72° 扇形
    var THUNDERWAVE_VERTICAL_TOLERANCE = 3.0;
    var THUNDERWAVE_DAMAGE = 3.0;         // 微量伤害
    var THUNDERWAVE_KNOCKBACK = 0.55;
    var THUNDERWAVE_LAUNCH_UP = 0.95;     // 需求：击飞
    var SHIELD_DISABLE_TICKS = 100;       // 破盾（斧头原理）5 秒

    // 2 级法术
    var SPELL2_COOLDOWN_TICKS = 900;      // 需求：冷却 45 秒
    var SHATTER_RADIUS = 3.0;             // 需求：直径 6 格的球形
    var SHATTER_DAMAGE = 8.0;             // 一定伤害（无视护甲、可被盾牌防御）
    var SHATTER_CAST_RANGE = 20.0;
    var SHATTER_WINDUP_TICKS = 25;
    var RAY_COUNT = 3;                    // 需求：3 道热射线
    var RAY_DAMAGE = 4.0;
    var RAY_BURN_TICKS = 100;
    var RAY_GAP_TICKS = 4;
    var RAY_WINDUP_TICKS = 12;
    var RAY_MAX_RANGE = 24.0;

    // 3 级法术：闪电束（长 16 格 / 宽 3 格的闪电射线，无视护甲与盾牌）
    var SPELL3_COOLDOWN_TICKS = 1200;      // 需求：冷却 60 秒
    var LIGHTNING_BEAM_WINDUP_TICKS = 20;  // 需求：前摇 1 秒
    var LIGHTNING_BEAM_LENGTH = 16.0;      // 需求：长 16 格
    var LIGHTNING_BEAM_RADIUS = 1.5;       // 需求：宽 3 格（半径 1.5）
    var LIGHTNING_BEAM_DAMAGE = 14.0;      // 需求：大量伤害（无视护甲与盾牌）
    var LIGHTNING_BEAM_WARN_RADIUS = 32.0; // 警告广播半径
    var LIGHTNING_BEAM_STEPS = 40;         // 柱形粒子采样点

    // 4 级法术：火球术（无法拦截 / 半径 8 格球状 / 无视盾牌 / 大量伤害）
    var SPELL4_COOLDOWN_TICKS = 1800;      // 需求：冷却 90 秒
    var ULT_FIREBALL_WINDUP_TICKS = 30;    // 需求：前摇 1.5 秒
    var ULT_FIREBALL_RADIUS = 8.0;         // 需求：半径 8 格球状
    var ULT_FIREBALL_DAMAGE = 16.0;        // 需求：大量伤害（吃护甲、无视盾牌）
    var ULT_FIREBALL_SPEED = 1.25;
    var ULT_FIREBALL_LIFE_TICKS = 200;
    var ULT_FIREBALL_COVER_MULTIPLIER = 0.35;   // 被方块遮挡时只吃 35%（掩体有效）
    var ULT_FIREBALL_KNOCKBACK = 0.45;
    var ULT_FIREBALL_LAUNCH_UP = 0.55;
    var ULT_FIREBALL_HIT_RADIUS = 2.6;     // 兜底命中半径（大火球体积大）

    // 收招时间
    var RECOVER_TICKS = 10;

    // 初始冷却（刚召唤出来给玩家一点准备时间）
    var INITIAL_CANTRIP_DELAY_TICKS = 30;
    var INITIAL_SPELL1_DELAY_TICKS = 200;
    var INITIAL_SPELL2_DELAY_TICKS = 400;
    var INITIAL_SPELL3_DELAY_TICKS = 500;
    var INITIAL_SPELL4_DELAY_TICKS = 700;

    // 死亡
    var DEATH_SEQUENCE_TICKS = 30;

    // Tag / PDC key 必须带 BOSS id 前缀，避免跨 BOSS 冲突
    var BOSS_TAG = "wandering_warlock_boss";
    var CLONE_TAG = "wandering_warlock_clone";
    var PROJECTILE_TAG = "wandering_warlock_projectile";
    var bossKey = new NamespacedKey(plugin, "wandering_warlock_boss_type");
    var cloneOwnerKey = new NamespacedKey(plugin, "wandering_warlock_clone_owner");
    var barKey = new NamespacedKey(plugin, "wandering_warlock_bar");
    var mageArmorKey = new NamespacedKey(plugin, "wandering_warlock_mage_armor");

    // 法术标识
    var KIND_FIRE_BOLT = "fire_bolt";
    var KIND_SHOCKING_GRASP = "shocking_grasp";
    var KIND_MINOR_ILLUSION = "minor_illusion";
    var KIND_ARCANE_SHIELD = "arcane_shield";
    var KIND_MAGE_ARMOR = "mage_armor";
    var KIND_THUNDERWAVE = "thunderwave";
    var KIND_SHATTER = "shatter";
    var KIND_SCORCHING_RAY = "scorching_ray";
    var KIND_LIGHTNING_BEAM = "lightning_beam";
    var KIND_ULT_FIREBALL = "ultimate_fireball";

    // 法术位
    var SLOT_CANTRIP = "cantrip";
    var SLOT_SPELL1 = "spell1";
    var SLOT_SPELL2 = "spell2";
    var SLOT_SPELL3 = "spell3";
    var SLOT_SPELL4 = "spell4";

    // 需要免疫的伤害原因（玩家造成的伤害不受此表影响）
    var IGNORED_CAUSE_LIST = "|LAVA|HOT_FLOOR|MELTING|FALL|DROWNING|SUFFOCATION|STARVATION"
        + "|CRAMMING|CONTACT|POISON|WITHER|MAGIC|DRAGON_BREATH|CAMPFIRE|FREEZE|LIGHTNING"
        + "|SONIC_BOOM|VOID|";

    // -----------------------------------------------------------------------
    // 枚举 / 常量预检（M-9a）
    // -----------------------------------------------------------------------
    var PREFLIGHT_CONSTANTS = [
        String(Material.GOLDEN_HELMET), String(Material.GOLDEN_CHESTPLATE),
        String(Material.GOLDEN_LEGGINGS), String(Material.GOLDEN_BOOTS),
        String(Material.BOOK), String(Material.EMERALD), String(Material.SHIELD),
        String(Particle.FLAME), String(Particle.SMALL_FLAME), String(Particle.SMOKE),
        String(Particle.LARGE_SMOKE), String(Particle.CLOUD), String(Particle.CRIT),
        String(Particle.ENCHANT), String(Particle.END_ROD), String(Particle.WITCH),
        String(Particle.SQUID_INK), String(Particle.ELECTRIC_SPARK), String(Particle.LAVA),
        String(Particle.SONIC_BOOM), String(Particle.EXPLOSION), String(Particle.WAX_ON),
        String(Particle.SOUL_FIRE_FLAME),
        String(Sound.ENTITY_BLAZE_SHOOT), String(Sound.ITEM_FIRECHARGE_USE),
        String(Sound.ENTITY_LIGHTNING_BOLT_IMPACT), String(Sound.BLOCK_AMETHYST_BLOCK_CHIME),
        String(Sound.ENTITY_ILLUSIONER_MIRROR_MOVE), String(Sound.ENTITY_ILLUSIONER_CAST_SPELL),
        String(Sound.ENTITY_EVOKER_CAST_SPELL), String(Sound.ENTITY_SKELETON_AMBIENT),
        String(Sound.ENTITY_SKELETON_HURT), String(Sound.ENTITY_SKELETON_DEATH),
        String(Sound.ENTITY_WARDEN_SONIC_BOOM), String(Sound.ENTITY_WARDEN_SONIC_CHARGE),
        String(Sound.ENTITY_LIGHTNING_BOLT_THUNDER), String(Sound.ENTITY_GHAST_WARN),
        String(Sound.ENTITY_GHAST_SHOOT), String(Sound.ENTITY_DRAGON_FIREBALL_EXPLODE),
        String(Sound.ENTITY_GENERIC_EXPLODE), String(Sound.ITEM_SHIELD_BLOCK),
        String(Sound.ITEM_SHIELD_BREAK), String(Sound.BLOCK_BEACON_ACTIVATE),
        String(Sound.BLOCK_BEACON_POWER_SELECT), String(Sound.BLOCK_ENCHANTMENT_TABLE_USE),
        String(PotionEffectType.SLOWNESS), String(PotionEffectType.WEAKNESS),
        String(Attribute.MAX_HEALTH), String(Attribute.KNOCKBACK_RESISTANCE),
        String(Attribute.MOVEMENT_SPEED), String(Attribute.ATTACK_DAMAGE),
        String(Attribute.ARMOR), String(AttributeModifierOperation.ADD_NUMBER),
        String(BarColor.PURPLE), String(BarStyle.SOLID), String(GameMode.SPECTATOR),
        String(PersistentDataType.STRING)
    ];

    // -----------------------------------------------------------------------
    // 运行时状态
    // -----------------------------------------------------------------------
    var activeBosses = {};        // uuid -> boss 状态对象
    var activeClones = {};        // uuid -> 替身状态对象
    var trackedProjectiles = {};  // uuid -> 在飞火焰弹（契约 6.2 的同类结构）
    var protectedBosses = {};     // uuid -> 被「护盾术」保护的其他 BOSS
    var mageArmorTargets = {};    // uuid -> 被「法师护甲」强化的其他 BOSS
    var syncDelayedTasks = [];
    var globalTick = 0;

    var headRotationViaNms = null;
    var sonicBoomResolved = false;
    var sonicBoomDamageSource = null;

    // -----------------------------------------------------------------------
    // 工具函数
    // -----------------------------------------------------------------------
    function logError(tag, e) {
        log.error(tag + "：" + e + (e && e.stack ? "\n" + e.stack : ""));
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
                    logError("WanderingWarlock 延迟任务异常", e);
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
            logError("WanderingWarlock 查找最近玩家异常", e);
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

    function getCloneByEntity(entity) {
        if (entity == null) return null;
        try {
            if (!entity.getScoreboardTags().contains(CLONE_TAG)) return null;
            var uuid = String(entity.getUniqueId().toString());
            return activeClones[uuid] == null ? null : activeClones[uuid];
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

    function resolveGroundY(world, x, y, z) {
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

    function findStandY(world, x, z, currentY, upRange, downRange) {
        try {
            var bx = Math.floor(x);
            var bz = Math.floor(z);
            var base = Math.floor(currentY);
            for (var dy = upRange; dy >= -downRange; dy--) {
                var y = base + dy;
                if (world.getBlockAt(bx, y - 1, bz).getType().isSolid()
                        && !world.getBlockAt(bx, y, bz).getType().isSolid()
                        && !world.getBlockAt(bx, y + 1, bz).getType().isSolid()) {
                    return y;
                }
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    function resolveWalkY(world, x, currentY, z) {
        return findStandY(world, x, z, currentY, MAX_STEP_UP, MAX_STEP_DOWN);
    }

    function horizontalDistance(a, b) {
        var dx = a.getX() - b.getX();
        var dz = a.getZ() - b.getZ();
        return Math.sqrt(dx * dx + dz * dz);
    }

    // 朝瞄准点求发射方向；gravity 是该弹体的每 tick 重力（无重力填 0）
    // drop = 0.5 * g * t^2 是「飞行期间下坠的距离」，把它加回 Y 分量即为落点补偿。
    function aimDirectionTo(boss, aimLocation, speed, gravity) {
        var eye = boss.carrier.getEyeLocation();
        var dx = aimLocation.getX() - eye.getX();
        var dy = aimLocation.getY() - eye.getY();
        var dz = aimLocation.getZ() - eye.getZ();
        var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        var flightTicks = dist / Math.max(0.1, speed);
        var g = (gravity == null) ? 0.0 : gravity;
        var drop = 0.5 * g * flightTicks * flightTicks;
        var dir = new Vector(dx, dy + drop, dz);
        if (dir.lengthSquared() < 1.0e-6) return new Vector(0, 0, 1);
        return dir.normalize();
    }

    // -----------------------------------------------------------------------
    // 无视护甲的伤害来源（声波 boom）
    // 实测结论（M-11）：DamageSource.Builder.withDamageLocation(null) 会抛异常，
    // 只设置伤害类型即可；解析失败时回退到普通伤害来源。
    // -----------------------------------------------------------------------
    function lookupSonicBoomDamageType() {
        var keyText = "sonic_boom";
        try {
            var RegistryKeyClass = Java.type("io.papermc.paper.registry.RegistryKey");
            var registryField = RegistryKeyClass.class.getField("DAMAGE_TYPE");
            var registryKey = registryField.get(null);
            var nsKey = new NamespacedKeyClass(NamespacedKeyClass.MINECRAFT, keyText);
            var created = RegistryKeyClass.class
                .getMethod("create", NamespacedKeyClass.class)
                .invoke(null, nsKey);
            try {
                return Registry.DAMAGE_TYPE.get(created);
            } catch (e1) { }
            try {
                return Registry.DAMAGE_TYPE.getOrThrow(created);
            } catch (e2) { }
        } catch (e) { }

        try {
            var nsKey2 = new NamespacedKeyClass(NamespacedKeyClass.MINECRAFT, keyText);
            try {
                return Registry.DAMAGE_TYPE.get(nsKey2);
            } catch (e3) { }
            try {
                return Registry.DAMAGE_TYPE.getOrThrow(nsKey2);
            } catch (e4) { }
        } catch (e5) { }
        return null;
    }

    function resolveSonicBoomDamageSource() {
        if (!sonicBoomResolved) {
            sonicBoomResolved = true;
            try {
                var damageType = lookupSonicBoomDamageType();
                if (damageType != null) {
                    sonicBoomDamageSource = DamageSourceClass.builder(damageType).build();
                    log.info("WanderingWarlock 已解析 sonic_boom 伤害类型：电爪 / 粉碎音波将无视护甲。");
                } else {
                    log.warn("WanderingWarlock 未找到 sonic_boom 伤害类型，将回退到普通伤害来源。");
                }
            } catch (e) {
                log.warn("WanderingWarlock 解析 sonic_boom 失败，将回退到普通伤害来源：" + e);
                sonicBoomDamageSource = null;
            }
        }
        return sonicBoomDamageSource;
    }

    // -----------------------------------------------------------------------
    // 生命周期：生成 / 清理
    // -----------------------------------------------------------------------
    function equipWarlock(entity) {
        try {
            var equipment = entity.getEquipment();
            if (equipment == null) return;
            equipment.setHelmet(new ItemStack(Material.GOLDEN_HELMET));
            equipment.setChestplate(new ItemStack(Material.GOLDEN_CHESTPLATE));
            equipment.setLeggings(new ItemStack(Material.GOLDEN_LEGGINGS));
            equipment.setBoots(new ItemStack(Material.GOLDEN_BOOTS));
            equipment.setItemInMainHand(new ItemStack(Material.BOOK));
            equipment.setHelmetDropChance(0.0);
            equipment.setChestplateDropChance(0.0);
            equipment.setLeggingsDropChance(0.0);
            equipment.setBootsDropChance(0.0);
            equipment.setItemInMainHandDropChance(0.0);
        } catch (e) {
            logError("WanderingWarlock 穿戴金甲 / 书失败", e);
        }
    }

    function createBossBar() {
        var bar = null;
        try {
            Bukkit.removeBossBar(barKey);
            bar = Bukkit.createBossBar(barKey, BOSS_NAME, BarColor.PURPLE, BarStyle.SOLID);
            bar.setProgress(1.0);
            bar.setVisible(true);
        } catch (e) {
            logError("WanderingWarlock 创建 BossBar 失败", e);
            bar = null;
        }
        return bar;
    }

    function spawnWanderingWarlock(location, player) {
        try {
            if (location == null) return false;
            var world = location.getWorld();
            if (world == null) return false;

            var groundY = resolveGroundY(world, location.getX(), location.getY(), location.getZ());
            var spawnLoc = new Location(world, location.getX(), groundY, location.getZ(), 0, 0);

            // M-5：必须传 Class.forName(...) 得到的 java.lang.Class。
            var carrier = world.spawn(spawnLoc, SkeletonClass);
            if (carrier == null) {
                logError("WanderingWarlock 生成失败", "world.spawn 返回 null");
                return false;
            }

            carrier.setAI(false);
            carrier.setInvisible(false);
            carrier.setGravity(false);
            carrier.setPersistent(true);
            carrier.setRemoveWhenFarAway(false);
            carrier.setCanPickupItems(false);
            carrier.setCollidable(true);
            carrier.setMaximumNoDamageTicks(0);
            carrier.setNoDamageTicks(0);
            carrier.setCustomName(ChatColor.LIGHT_PURPLE + BOSS_NAME);
            carrier.setCustomNameVisible(false);
            try { carrier.setVisualFire(false); } catch (ignored) { }
            carrier.addScoreboardTag(BOSS_TAG);
            carrier.getPersistentDataContainer().set(bossKey, PersistentDataType.STRING, BOSS_ID);

            var maxHealth = getAttributeSafe(carrier, Attribute.MAX_HEALTH);
            if (maxHealth != null) maxHealth.setBaseValue(MAX_HEALTH);
            var knockback = getAttributeSafe(carrier, Attribute.KNOCKBACK_RESISTANCE);
            if (knockback != null) knockback.setBaseValue(KNOCKBACK_RESISTANCE);
            var moveSpeed = getAttributeSafe(carrier, Attribute.MOVEMENT_SPEED);
            if (moveSpeed != null) moveSpeed.setBaseValue(PLAYER_WALK_ATTRIBUTE * SPEED_MULTIPLIER);
            var attackDamage = getAttributeSafe(carrier, Attribute.ATTACK_DAMAGE);
            if (attackDamage != null) attackDamage.setBaseValue(0.0);
            try {
                carrier.setHealth(MAX_HEALTH);
            } catch (e) {
                logError("WanderingWarlock 设置生命值失败", e);
            }
            equipWarlock(carrier);

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
                nextCantripTick: globalTick + INITIAL_CANTRIP_DELAY_TICKS,
                nextSpell1Tick: globalTick + INITIAL_SPELL1_DELAY_TICKS,
                nextSpell2Tick: globalTick + INITIAL_SPELL2_DELAY_TICKS,
                nextSpell3Tick: globalTick + INITIAL_SPELL3_DELAY_TICKS,
                nextSpell4Tick: globalTick + INITIAL_SPELL4_DELAY_TICKS,
                lastCantrip: null,
                lastSpell1: null,
                lastSpell2: null,
                lastSpell3: null,
                lastSpell4: null,
                strafeDir: 1.0,
                nextStrafeFlipTick: globalTick + STRAFE_FLIP_TICKS,
                faceYaw: 0.0,
                facePitch: 0.0,
                castCount: 0,
                dead: false,
                deathStartTick: 0,
                deathEndTick: 0,
                deathLocation: null
            };

            playSoundSafe(world, spawnLoc, Sound.ENTITY_EVOKER_CAST_SPELL, 1.4, 0.9);
            playSoundSafe(world, spawnLoc, Sound.ENTITY_SKELETON_AMBIENT, 1.2, 0.8);
            spawnParticleSafe(world, Particle.ENCHANT, spawnLoc, 30, 0.9, 1.2, 0.9, 0.4);
            spawnParticleSafe(world, Particle.WITCH, spawnLoc, 20, 0.8, 1.0, 0.8, 0.02);
            log.info("WanderingWarlock 生成成功：" + uuid + " @ " + world.getName()
                + " (" + Math.round(spawnLoc.getX()) + "," + Math.round(spawnLoc.getY())
                + "," + Math.round(spawnLoc.getZ()) + ")");
            return true;
        } catch (e) {
            logError("WanderingWarlock 生成失败", e);
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

    function removeProjectilesOf(bossUuid) {
        var uuids = Object.keys(trackedProjectiles);
        for (var i = 0; i < uuids.length; i++) {
            var entry = trackedProjectiles[uuids[i]];
            if (entry == null) continue;
            if (bossUuid != null && String(entry.bossUuid) !== String(bossUuid)) continue;
            try {
                if (entry.proj != null) entry.proj.remove();
            } catch (ignored) { }
            delete trackedProjectiles[uuids[i]];
        }
    }

    function removeClonesOf(bossUuid, reason) {
        var uuids = Object.keys(activeClones);
        var removed = 0;
        for (var i = 0; i < uuids.length; i++) {
            var clone = activeClones[uuids[i]];
            if (clone == null) continue;
            if (bossUuid != null && String(clone.bossUuid) !== String(bossUuid)) continue;
            try {
                if (clone.entity != null && clone.entity.isValid()) {
                    spawnParticleSafe(clone.entity.getWorld(), Particle.CLOUD,
                        clone.entity.getLocation().clone().add(0, 1.0, 0), 20, 0.5, 0.8, 0.5, 0.03);
                    spawnParticleSafe(clone.entity.getWorld(), Particle.SQUID_INK,
                        clone.entity.getLocation().clone().add(0, 1.0, 0), 12, 0.5, 0.8, 0.5, 0.02);
                    clone.entity.remove();
                }
            } catch (ignored) { }
            delete activeClones[uuids[i]];
            removed++;
        }
        if (removed > 0 && reason != null) {
            log.info("WanderingWarlock 已清除替身 " + removed + " 个（" + reason + "）");
        }
        return removed;
    }

    function clearProtectionOf(targetUuid) {
        try {
            delete protectedBosses[String(targetUuid)];
        } catch (ignored) { }
    }

    function removeMageArmor(targetUuid) {
        var key = String(targetUuid);
        var entry = mageArmorTargets[key];
        if (entry == null) return false;
        try {
            var inst = getAttributeSafe(entry.entity, Attribute.ARMOR);
            if (inst != null) {
                try {
                    inst.removeModifier(mageArmorKey);
                } catch (e1) {
                    try { inst.removeModifier(entry.modifier); } catch (e2) { }
                }
            }
        } catch (e) {
            logError("WanderingWarlock 移除法师护甲异常", e);
        }
        delete mageArmorTargets[key];
        return true;
    }

    function cleanupBoss(boss) {
        if (boss == null) return;
        removeBossBar(boss);
        removeProjectilesOf(boss.uuid);
        removeClonesOf(boss.uuid, "BOSS 清理");
        // 清理这个 BOSS 施加给其他 BOSS 的增益
        var protectedUuids = Object.keys(protectedBosses);
        for (var i = 0; i < protectedUuids.length; i++) {
            var prot = protectedBosses[protectedUuids[i]];
            if (prot != null && String(prot.bossUuid) === String(boss.uuid)) {
                delete protectedBosses[protectedUuids[i]];
            }
        }
        var armorUuids = Object.keys(mageArmorTargets);
        for (var j = 0; j < armorUuids.length; j++) {
            var armor = mageArmorTargets[armorUuids[j]];
            if (armor != null && String(armor.bossUuid) === String(boss.uuid)) {
                removeMageArmor(armorUuids[j]);
            }
        }
        try {
            if (boss.carrier != null && boss.carrier.isValid() && !boss.carrier.isDead()) {
                boss.carrier.remove();
            }
        } catch (ignored) { }
        delete activeBosses[boss.uuid];
        log.info("WanderingWarlock 已清理 BOSS：" + boss.uuid);
    }

    // M-15：周期性孤儿清理必须跳过本实例还活着的实体
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
                if (tag === BOSS_TAG && isOwnedEntity(String(ent.getUniqueId().toString()))) continue;
                if (tag === CLONE_TAG && activeClones[String(ent.getUniqueId().toString())] != null) continue;
                ent.remove();
                removed++;
            }
        } catch (e) {
            logError("WanderingWarlock 清理带 Tag 实体异常", e);
        }
        return removed;
    }

    function removeOrphanProjectiles(world) {
        var removed = 0;
        var classes = [SmallFireballClass, LargeFireballClass];
        for (var c = 0; c < classes.length; c++) {
            try {
                var it = world.getEntitiesByClass(classes[c]).iterator();
                var toRemove = [];
                while (it.hasNext()) {
                    var proj = it.next();
                    if (!proj.getScoreboardTags().contains(PROJECTILE_TAG)) continue;
                    var uuid = String(proj.getUniqueId().toString());
                    var entry = trackedProjectiles[uuid];
                    if (entry != null && activeBosses[entry.bossUuid] != null) continue;
                    toRemove.push(proj);
                    delete trackedProjectiles[uuid];
                }
                for (var i = 0; i < toRemove.length; i++) {
                    try { toRemove[i].remove(); } catch (ignored) { }
                    removed++;
                }
            } catch (e) {
                logError("WanderingWarlock 清理孤儿火焰弹异常", e);
            }
        }
        return removed;
    }

    function cleanupOrphanBossBars() {
        if (Object.keys(activeBosses).length > 0) return;
        try {
            Bukkit.removeBossBar(barKey);
        } catch (e) {
            logError("WanderingWarlock 清理孤儿 BossBar 异常", e);
        }
    }

    function cleanupOrphans() {
        try {
            var removed = 0;
            var worlds = Bukkit.getWorlds();
            for (var i = 0; i < worlds.size(); i++) {
                var world = worlds.get(i);
                removed += removeTaggedEntities(world, BOSS_TAG);
                removed += removeTaggedEntities(world, CLONE_TAG);
                removed += removeOrphanProjectiles(world);
            }
            cleanupOrphanBossBars();
            if (removed > 0) log.info("WanderingWarlock 清理孤儿实体 / 火焰弹：" + removed + " 个。");
        } catch (e) {
            logError("WanderingWarlock 清理孤儿实体异常", e);
        }
    }

    // -----------------------------------------------------------------------
    // 朝向 / 移动
    // -----------------------------------------------------------------------
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
                        log.info("WanderingWarlock 头部朝向：已启用 NMS 直接写入（setYHeadRot/setYBodyRot）。");
                    }
                } catch (e) {
                    if (headRotationViaNms === null) {
                        headRotationViaNms = false;
                        log.warn("WanderingWarlock 头部朝向：NMS 通道不可用，退化为 setRotation + lookAt（"
                            + e + "）。");
                    }
                }
            }
        } catch (e) {
            logError("WanderingWarlock 朝向计算异常", e);
        }
        boss.faceYaw = yaw;
        boss.facePitch = pitch;
        return yaw;
    }

    function faceTarget(boss, targetLocation) {
        return lookAtPoint(boss, targetLocation.getX(),
            targetLocation.getY() + TARGET_EYE_HEIGHT, targetLocation.getZ());
    }

    function stepToward(boss, dirX, dirZ, speed) {
        try {
            var loc = boss.carrier.getLocation();
            var nextX = loc.getX() + dirX * speed;
            var nextZ = loc.getZ() + dirZ * speed;
            var nextY = resolveWalkY(boss.world, nextX, loc.getY(), nextZ);
            if (nextY == null) return false;
            boss.carrier.teleport(new Location(boss.world, nextX, nextY, nextZ,
                boss.faceYaw, boss.facePitch));
            return true;
        } catch (e) {
            return false;
        }
    }

    function updateMovement(boss, target) {
        if (boss.action != null) return;
        if (target == null) return;
        try {
            var loc = boss.carrier.getLocation();
            var tgt = target.getLocation();
            var dist = horizontalDistance(loc, tgt);
            lookAtPoint(boss, tgt.getX(), tgt.getY() + TARGET_EYE_HEIGHT, tgt.getZ());
            if (dist < 0.0001) return;

            var dx = tgt.getX() - loc.getX();
            var dz = tgt.getZ() - loc.getZ();
            var ux = dx / dist;
            var uz = dz / dist;

            if (dist > PREFERRED_RANGE) {
                stepToward(boss, ux, uz, WALK_SPEED);
                return;
            }
            if (dist < KEEP_DISTANCE) {
                stepToward(boss, -ux, -uz, WALK_SPEED);
                return;
            }
            if (globalTick >= boss.nextStrafeFlipTick) {
                boss.strafeDir = -boss.strafeDir;
                boss.nextStrafeFlipTick = globalTick + STRAFE_FLIP_TICKS;
            }
            var sideX = -uz * boss.strafeDir;
            var sideZ = ux * boss.strafeDir;
            if (!stepToward(boss, sideX, sideZ, STRAFE_SPEED)) {
                boss.strafeDir = -boss.strafeDir;
                stepToward(boss, -sideX, -sideZ, STRAFE_SPEED);
            }
        } catch (e) {
            logError("WanderingWarlock 移动异常", e);
        }
    }

    function approachTarget(boss, target) {
        try {
            var loc = boss.carrier.getLocation();
            var tgt = target.getLocation();
            lookAtPoint(boss, tgt.getX(), tgt.getY() + TARGET_EYE_HEIGHT, tgt.getZ());
            var dist = horizontalDistance(loc, tgt);
            if (dist < 0.0001) return;
            stepToward(boss, (tgt.getX() - loc.getX()) / dist, (tgt.getZ() - loc.getZ()) / dist, WALK_SPEED);
        } catch (ignored) { }
    }

    // -----------------------------------------------------------------------
    // 盾牌 / 伤害底层
    // -----------------------------------------------------------------------
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
    }

    // 斧头式破盾（雷鸣波的「可破盾」）
    function breakPlayerShield(player) {
        try { player.clearActiveItem(); } catch (ignored) { }
        try { player.setCooldown(Material.SHIELD, SHIELD_DISABLE_TICKS); } catch (ignored) { }
        try {
            playSoundSafe(player.getWorld(), player.getLocation(), Sound.ITEM_SHIELD_BREAK, 1.5, 0.9);
        } catch (ignored) { }
        try {
            player.sendMessage(ChatColor.DARK_PURPLE + "[" + BOSS_NAME + "] " + ChatColor.RED
                + "雷鸣波震碎了你的盾牌！" + ChatColor.GRAY + "（"
                + (SHIELD_DISABLE_TICKS / 20) + " 秒内无法格挡）");
        } catch (ignored) { }
    }

    // 普通伤害（吃护甲；我们的盾牌规则由调用方判断）
    function dealPlayerDamage(player, amount, boss) {
        var before = -1.0;
        try {
            before = player.getHealth();
        } catch (e) {
            return false;
        }
        try { player.setNoDamageTicks(0); } catch (ignored) { }
        try {
            if (boss != null && boss.carrier != null && boss.carrier.isValid()) {
                player.damage(amount, boss.carrier);
            } else {
                player.damage(amount);
            }
        } catch (e) {
            logError("WanderingWarlock 造成伤害失败", e);
            return false;
        }
        try {
            return player.getHealth() < before - 0.001;
        } catch (e) {
            return false;
        }
    }

    // 无视护甲的伤害（声波 boom；原版层面也无视盾牌 —— 因此「可被盾牌防御」的技能
    // 必须由调用方先用 isPlayerGuarding() 拦住）
    function dealArcaneDamage(player, amount, boss) {
        var before = -1.0;
        try {
            before = player.getHealth();
        } catch (e) {
            return false;
        }
        try { player.setNoDamageTicks(0); } catch (ignored) { }
        try {
            var source = resolveSonicBoomDamageSource();
            if (source != null) {
                player.damage(amount, source);
            } else if (boss != null && boss.carrier != null && boss.carrier.isValid()) {
                player.damage(amount, boss.carrier);
            } else {
                player.damage(amount);
            }
        } catch (e) {
            logError("WanderingWarlock 造成无视护甲伤害失败", e);
            return false;
        }
        try {
            return player.getHealth() < before - 0.001;
        } catch (e) {
            return false;
        }
    }

    function ignitePlayer(player, ticks) {
        try { player.setFireTicks(ticks); } catch (ignored) { }
    }

    function knockbackPlayerFrom(boss, player, strength, upward) {
        try {
            var push = player.getLocation().toVector()
                .subtract(boss.carrier.getLocation().toVector());
            push.setY(0.0);
            if (push.lengthSquared() > 0.0001) {
                push.normalize().multiply(strength);
            } else {
                push = new Vector(0.0, 0.0, 0.0);
            }
            push.setY(upward);
            player.setVelocity(push);
        } catch (ignored) { }
    }

    // 正面扇形内的玩家（雷鸣波用）
    function collectPlayersInSector(boss, radius, dotMin, verticalTolerance) {
        var result = [];
        try {
            var loc = boss.carrier.getLocation();
            var yawRad = loc.getYaw() * Math.PI / 180.0;
            var forwardX = -Math.sin(yawRad);
            var forwardZ = Math.cos(yawRad);
            var players = boss.world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var p = players.get(i);
                if (!isEngageablePlayer(p)) continue;
                var pl = p.getLocation();
                var dx = pl.getX() - loc.getX();
                var dz = pl.getZ() - loc.getZ();
                var dy = (pl.getY() + 0.9) - (loc.getY() + 1.0);
                if (Math.abs(dy) > verticalTolerance) continue;
                var h2 = dx * dx + dz * dz;
                if (h2 > radius * radius) continue;
                if (h2 < 0.09) {
                    result.push(p);
                    continue;
                }
                var dot = (dx * forwardX + dz * forwardZ) / Math.sqrt(h2);
                if (dot >= dotMin) result.push(p);
            }
        } catch (e) {
            logError("WanderingWarlock 扇形目标收集异常", e);
        }
        return result;
    }

    // -----------------------------------------------------------------------
    // 其他自定义 BOSS 的识别与增益（护盾术 / 法师护甲）
    // 房内约定：所有自定义 BOSS 的载具都带一个以 "_boss" 结尾的 Tag
    // -----------------------------------------------------------------------
    function isOtherCustomBoss(boss, entity) {
        if (entity == null) return false;
        try {
            if (!(entity instanceof LivingEntityClass)) return false;
            if (entity.getUniqueId().equals(boss.carrier.getUniqueId())) return false;
            var tags = entity.getScoreboardTags();
            var it = tags.iterator();
            while (it.hasNext()) {
                var tag = String(it.next());
                if (tag === BOSS_TAG || tag === CLONE_TAG || tag === PROJECTILE_TAG) continue;
                if (tag.length > 5 && tag.substring(tag.length - 5) === "_boss") return true;
            }
        } catch (e) {
            return false;
        }
        return false;
    }

    // 目标身上是否已经有对应的增益（用来优先照顾「还没被强化」的 BOSS）
    function hasBuffFor(entity, kind) {
        try {
            var uuid = String(entity.getUniqueId().toString());
            if (kind === KIND_ARCANE_SHIELD) {
                var prot = protectedBosses[uuid];
                return prot != null && prot.charges > 0 && globalTick < prot.endTick;
            }
            if (kind === KIND_MAGE_ARMOR) {
                var armor = mageArmorTargets[uuid];
                return armor != null && globalTick < armor.endTick;
            }
        } catch (e) { }
        return false;
    }

    // 找其他自定义 BOSS：avoidKind 不为空时，优先返回「还没有该增益」的最近一个，
    // 都有增益（或没传）时返回最近的一个
    function findOtherCustomBoss(boss, avoidKind) {
        var nearest = null;
        var nearestDist = SHIELD_TARGET_RANGE * SHIELD_TARGET_RANGE;
        var nearestUnbuffed = null;
        var nearestUnbuffedDist = nearestDist;
        try {
            var it = boss.world.getEntitiesByClass(EntityClass).iterator();
            while (it.hasNext()) {
                var e = it.next();
                if (!isOtherCustomBoss(boss, e)) continue;
                var d = e.getLocation().distanceSquared(boss.carrier.getLocation());
                if (d < nearestDist) {
                    nearestDist = d;
                    nearest = e;
                }
                if (avoidKind != null && hasBuffFor(e, avoidKind)) continue;
                if (d < nearestUnbuffedDist) {
                    nearestUnbuffedDist = d;
                    nearestUnbuffed = e;
                }
            }
        } catch (e2) {
            logError("WanderingWarlock 查找其他自定义 BOSS 异常", e2);
        }
        return (nearestUnbuffed != null) ? nearestUnbuffed : nearest;
    }

    function otherBossName(entity) {
        try {
            if (entity.getCustomName() != null) {
                return ChatColor.stripColor(String(entity.getCustomName()));
            }
            var it = entity.getScoreboardTags().iterator();
            while (it.hasNext()) {
                var tag = String(it.next());
                if (tag.length > 5 && tag.substring(tag.length - 5) === "_boss") {
                    return tag.substring(0, tag.length - 5);
                }
            }
        } catch (ignored) { }
        return "自定义 BOSS";
    }

    // 给目标套 3 层「抵消一次任意来源伤害」的护盾
    function applyArcaneShield(boss, targetEntity) {
        var uuid = String(targetEntity.getUniqueId().toString());
        protectedBosses[uuid] = {
            entity: targetEntity,
            bossUuid: boss.uuid,
            charges: SHIELD_CHARGES,
            endTick: globalTick + SHIELD_DURATION_TICKS,
            name: otherBossName(targetEntity)
        };
        var loc = targetEntity.getLocation().clone().add(0, 1.2, 0);
        playSoundSafe(targetEntity.getWorld(), loc, Sound.BLOCK_BEACON_ACTIVATE, 1.4, 1.2);
        playSoundSafe(targetEntity.getWorld(), loc, Sound.BLOCK_BEACON_POWER_SELECT, 1.2, 1.4);
        spawnParticleSafe(targetEntity.getWorld(), Particle.END_ROD, loc, 40, 0.8, 1.2, 0.8, 0.05);
        spawnParticleSafe(targetEntity.getWorld(), Particle.ENCHANT, loc, 30, 1.0, 1.2, 1.0, 0.5);
        log.info("WanderingWarlock 护盾术：为 " + protectedBosses[uuid].name + " 套上 "
            + SHIELD_CHARGES + " 层护盾（" + (SHIELD_DURATION_TICKS / 20) + " 秒）。");
        return true;
    }

    function applyMageArmor(boss, targetEntity) {
        var uuid = String(targetEntity.getUniqueId().toString());
        removeMageArmor(uuid);   // 重复施放先移除旧的
        var inst = getAttributeSafe(targetEntity, Attribute.ARMOR);
        if (inst == null) return false;
        var modifier = null;
        try {
            modifier = new AttributeModifierClass(mageArmorKey, MAGE_ARMOR_BONUS,
                AttributeModifierOperation.ADD_NUMBER);
            inst.addModifier(modifier);
        } catch (e) {
            logError("WanderingWarlock 法师护甲添加护甲修饰符失败", e);
            return false;
        }
        mageArmorTargets[uuid] = {
            entity: targetEntity,
            bossUuid: boss.uuid,
            modifier: modifier,
            endTick: globalTick + MAGE_ARMOR_DURATION_TICKS,
            name: otherBossName(targetEntity)
        };
        var loc = targetEntity.getLocation().clone().add(0, 1.2, 0);
        playSoundSafe(targetEntity.getWorld(), loc, Sound.BLOCK_ENCHANTMENT_TABLE_USE, 1.3, 1.2);
        spawnParticleSafe(targetEntity.getWorld(), Particle.WAX_ON, loc, 30, 0.8, 1.2, 0.8, 0.0);
        spawnParticleSafe(targetEntity.getWorld(), Particle.END_ROD, loc, 20, 0.8, 1.2, 0.8, 0.03);
        log.info("WanderingWarlock 法师护甲：为 " + mageArmorTargets[uuid].name + " 提升护甲 +"
            + MAGE_ARMOR_BONUS + "（" + (MAGE_ARMOR_DURATION_TICKS / 20) + " 秒）。");
        return true;
    }

    // 每 tick 维护：护盾环绕粒子 / 法师护甲金光 / 到期清理
    function updateBuffs() {
        var uuids = Object.keys(protectedBosses);
        for (var i = 0; i < uuids.length; i++) {
            var prot = protectedBosses[uuids[i]];
            if (prot == null) continue;
            try {
                if (prot.entity == null || !prot.entity.isValid() || prot.charges <= 0
                        || globalTick >= prot.endTick) {
                    delete protectedBosses[uuids[i]];
                    continue;
                }
                // 3 层护盾环绕（用粒子表现）
                var center = prot.entity.getLocation().clone().add(0, 1.3, 0);
                for (var c = 0; c < prot.charges; c++) {
                    var angle = (globalTick * 0.12) + (c / prot.charges) * Math.PI * 2.0;
                    spawnParticleSafe(prot.entity.getWorld(), Particle.END_ROD, new Location(
                        prot.entity.getWorld(),
                        center.getX() + Math.cos(angle) * 1.1,
                        center.getY() + Math.sin(globalTick * 0.15 + c) * 0.25,
                        center.getZ() + Math.sin(angle) * 1.1), 1, 0.0, 0.0, 0.0, 0.0);
                }
                if (globalTick % 10 === 0) {
                    spawnParticleSafe(prot.entity.getWorld(), Particle.ENCHANT, center, 4, 0.6, 0.8, 0.6, 0.3);
                }
            } catch (e) {
                delete protectedBosses[uuids[i]];
            }
        }

        var armorUuids = Object.keys(mageArmorTargets);
        for (var j = 0; j < armorUuids.length; j++) {
            var armor = mageArmorTargets[armorUuids[j]];
            if (armor == null) continue;
            try {
                if (armor.entity == null || !armor.entity.isValid() || globalTick >= armor.endTick) {
                    removeMageArmor(armorUuids[j]);
                    continue;
                }
                if (globalTick % 4 === 0) {
                    spawnParticleSafe(armor.entity.getWorld(), Particle.WAX_ON,
                        armor.entity.getLocation().clone().add(0, 1.1, 0), 4, 0.6, 0.8, 0.6, 0.0);
                    spawnParticleSafe(armor.entity.getWorld(), Particle.END_ROD,
                        armor.entity.getLocation().clone().add(0, 1.1, 0), 2, 0.6, 0.8, 0.6, 0.01);
                }
            } catch (e) {
                removeMageArmor(armorUuids[j]);
            }
        }
    }

    // -----------------------------------------------------------------------
    // 替身（次级幻影）
    // -----------------------------------------------------------------------
    function spawnClone(boss, x, z) {
        try {
            var world = boss.world;
            var y = findStandY(world, x, z, boss.carrier.getLocation().getY(), 2, 4);
            if (y == null) return null;
            var loc = new Location(world, x, y, z, boss.faceYaw, boss.facePitch);
            var clone = world.spawn(loc, SkeletonClass);
            if (clone == null) return null;
            clone.setAI(false);
            clone.setInvisible(false);
            clone.setGravity(false);
            clone.setPersistent(true);
            clone.setRemoveWhenFarAway(false);
            clone.setCanPickupItems(false);
            clone.setCollidable(false);
            clone.setSilent(true);                 // 替身不出声，玩家只能靠「动不动 / 打不打人」分辨
            clone.setMaximumNoDamageTicks(0);
            clone.setNoDamageTicks(0);
            clone.setCustomName(ChatColor.LIGHT_PURPLE + BOSS_NAME);
            clone.setCustomNameVisible(false);
            try { clone.setVisualFire(false); } catch (ignored) { }
            var maxHealth = getAttributeSafe(clone, Attribute.MAX_HEALTH);
            if (maxHealth != null) maxHealth.setBaseValue(1.0);
            var knockback = getAttributeSafe(clone, Attribute.KNOCKBACK_RESISTANCE);
            if (knockback != null) knockback.setBaseValue(1.0);
            var moveSpeed = getAttributeSafe(clone, Attribute.MOVEMENT_SPEED);
            if (moveSpeed != null) moveSpeed.setBaseValue(0.0);
            var attackDamage = getAttributeSafe(clone, Attribute.ATTACK_DAMAGE);
            if (attackDamage != null) attackDamage.setBaseValue(0.0);
            try { clone.setHealth(1.0); } catch (ignored) { }
            equipWarlock(clone);
            clone.addScoreboardTag(CLONE_TAG);
            clone.getPersistentDataContainer().set(cloneOwnerKey, PersistentDataType.STRING, boss.uuid);

            var uuid = String(clone.getUniqueId().toString());
            activeClones[uuid] = {
                uuid: uuid,
                entity: clone,
                bossUuid: boss.uuid,
                spawnTick: globalTick,
                endTick: globalTick + ILLUSION_LIFE_TICKS,
                world: world
            };
            spawnParticleSafe(world, Particle.CLOUD, loc.clone().add(0, 1.0, 0), 25, 0.5, 0.9, 0.5, 0.04);
            spawnParticleSafe(world, Particle.ENCHANT, loc.clone().add(0, 1.0, 0), 20, 0.5, 0.9, 0.5, 0.4);
            return clone;
        } catch (e) {
            logError("WanderingWarlock 召唤替身失败", e);
            return null;
        }
    }

    function castMinorIllusion(boss) {
        var count = ILLUSION_MIN
            + Math.floor(Math.random() * (ILLUSION_MAX - ILLUSION_MIN + 1));
        var spawned = 0;
        var loc = boss.carrier.getLocation();
        for (var i = 0; i < count; i++) {
            var angle = Math.random() * Math.PI * 2.0;
            var radius = ILLUSION_SPAWN_MIN
                + Math.random() * (ILLUSION_SPAWN_MAX - ILLUSION_SPAWN_MIN);
            var clone = spawnClone(boss, loc.getX() + Math.cos(angle) * radius,
                loc.getZ() + Math.sin(angle) * radius);
            if (clone != null) spawned++;
        }
        playSoundSafe(boss.world, loc, Sound.ENTITY_ILLUSIONER_MIRROR_MOVE, 1.5, 1.0);
        playSoundSafe(boss.world, loc, Sound.ENTITY_ILLUSIONER_CAST_SPELL, 1.3, 1.2);
        log.info("WanderingWarlock 次级幻影：召唤替身 " + spawned + " 个（持续 "
            + (ILLUSION_LIFE_TICKS / 20) + " 秒）。");
        return spawned;
    }

    function updateClones() {
        var uuids = Object.keys(activeClones);
        for (var i = 0; i < uuids.length; i++) {
            var clone = activeClones[uuids[i]];
            if (clone == null) continue;
            try {
                if (clone.entity == null || !clone.entity.isValid()) {
                    delete activeClones[uuids[i]];
                    continue;
                }
                // 需求：持续 5 秒
                if (globalTick >= clone.endTick) {
                    var loc = clone.entity.getLocation().clone().add(0, 1.0, 0);
                    spawnParticleSafe(clone.world, Particle.CLOUD, loc, 25, 0.5, 0.9, 0.5, 0.04);
                    spawnParticleSafe(clone.world, Particle.SQUID_INK, loc, 15, 0.5, 0.9, 0.5, 0.02);
                    playSoundSafe(clone.world, loc, Sound.ENTITY_ILLUSIONER_MIRROR_MOVE, 1.0, 0.8);
                    clone.entity.remove();
                    delete activeClones[uuids[i]];
                }
            } catch (e) {
                delete activeClones[uuids[i]];
            }
        }
    }

    function killClone(clone, reason) {
        if (clone == null) return;
        try {
            if (clone.entity != null && clone.entity.isValid()) {
                var loc = clone.entity.getLocation().clone().add(0, 1.0, 0);
                spawnParticleSafe(clone.world, Particle.CLOUD, loc, 25, 0.5, 0.9, 0.5, 0.04);
                spawnParticleSafe(clone.world, Particle.SQUID_INK, loc, 15, 0.5, 0.9, 0.5, 0.02);
                playSoundSafe(clone.world, loc, Sound.ENTITY_ILLUSIONER_MIRROR_MOVE, 1.1, 0.7);
                clone.entity.remove();
            }
        } catch (ignored) { }
        delete activeClones[clone.uuid];
        if (reason != null) log.info("WanderingWarlock 替身被击破（" + reason + "）。");
    }

    // -----------------------------------------------------------------------
    // 火焰弹（火焰箭）
    // -----------------------------------------------------------------------
    function spawnFireBolt(boss, target) {
        try {
            var eye = boss.carrier.getEyeLocation();
            // 瞄准点：目标胸口（脚底 +1.0）；重力系数 0 → 直瞄
            var aim = target.getLocation().clone().add(0, 1.0, 0);
            var dir = aimDirectionTo(boss, aim, FIRE_BOLT_SPEED, FIRE_BOLT_GRAVITY);
            var loc = eye.clone().add(dir.clone().multiply(0.7));
            var ball = boss.world.spawn(loc, SmallFireballClass);
            if (ball == null) return null;
            try { ball.setShooter(boss.carrier); } catch (ignored) { }
            try { ball.setIsIncendiary(false); } catch (ignored) { }   // 不点燃方块
            try { ball.setYield(0.0); } catch (ignored) { }
            ball.setDirection(dir);
            ball.setVelocity(dir.clone().multiply(FIRE_BOLT_SPEED));
            ball.addScoreboardTag(PROJECTILE_TAG);
            var uuid = String(ball.getUniqueId().toString());
            trackedProjectiles[uuid] = {
                proj: ball,
                kind: KIND_FIRE_BOLT,
                bossUuid: boss.uuid,
                life: 120,
                resolved: false
            };
            playSoundSafe(boss.world, loc, Sound.ENTITY_BLAZE_SHOOT, 1.1, 1.2);
            playSoundSafe(boss.world, loc, Sound.ITEM_FIRECHARGE_USE, 1.0, 1.1);
            return ball;
        } catch (e) {
            logError("WanderingWarlock 发射火焰弹失败", e);
            return null;
        }
    }

    // 火焰箭命中结算：可被盾牌防御；命中后微量伤害 + 点燃
    function resolveFireBoltHit(boss, player, hitLocation) {
        if (isPlayerGuarding(player)) {
            playShieldBlockFeedback(player);
            return "blocked";
        }
        var dealt = dealPlayerDamage(player, FIRE_BOLT_DAMAGE, boss);
        if (!dealt) return "noeffect";
        ignitePlayer(player, FIRE_BOLT_BURN_TICKS);
        try {
            player.sendMessage(ChatColor.GOLD + "[" + BOSS_NAME + "] " + ChatColor.GRAY
                + "火焰箭命中：你被点燃了（" + (FIRE_BOLT_BURN_TICKS / 20) + " 秒）。");
        } catch (ignored) { }
        return "hit";
    }

    function updateTrackedProjectiles() {
        var uuids = Object.keys(trackedProjectiles);
        if (uuids.length === 0) return;
        for (var i = 0; i < uuids.length; i++) {
            var uuid = uuids[i];
            var entry = trackedProjectiles[uuid];
            if (entry == null) continue;
            try {
                var proj = entry.proj;
                if (proj == null || !proj.isValid() || proj.isDead()) {
                    delete trackedProjectiles[uuid];
                    continue;
                }
                entry.life--;
                if (entry.life <= 0) {
                    try { proj.remove(); } catch (ignored) { }
                    delete trackedProjectiles[uuid];
                    continue;
                }
                var loc = proj.getLocation();
                if (entry.kind === KIND_ULT_FIREBALL) {
                    // 大火球：更浓的火焰尾迹
                    spawnParticleSafe(proj.getWorld(), Particle.FLAME, loc, 8, 0.25, 0.25, 0.25, 0.03);
                    spawnParticleSafe(proj.getWorld(), Particle.SMALL_FLAME, loc, 4, 0.2, 0.2, 0.2, 0.01);
                    if (globalTick % 2 === 0) {
                        spawnParticleSafe(proj.getWorld(), Particle.LARGE_SMOKE, loc, 3, 0.2, 0.2, 0.2, 0.01);
                        spawnParticleSafe(proj.getWorld(), Particle.LAVA, loc, 1, 0.1, 0.1, 0.1, 0.0);
                    }
                } else {
                    spawnParticleSafe(proj.getWorld(), Particle.FLAME, loc, 3, 0.08, 0.08, 0.08, 0.01);
                    if (globalTick % 2 === 0) {
                        spawnParticleSafe(proj.getWorld(), Particle.SMALL_FLAME, loc, 1, 0.05, 0.05, 0.05, 0.0);
                    }
                }
                // 兜底命中判定（防止高速穿透漏判）
                var boss = activeBosses[entry.bossUuid];
                var isUlt = (entry.kind === KIND_ULT_FIREBALL);
                var hitRadius = isUlt ? ULT_FIREBALL_HIT_RADIUS : 1.5;
                var hitVertical = isUlt ? 3.0 : 1.8;
                if (boss != null && entry.life <= 118) {
                    var players = boss.world.getPlayers();
                    for (var j = 0; j < players.size(); j++) {
                        var p = players.get(j);
                        if (!isEngageablePlayer(p)) continue;
                        var pl = p.getLocation();
                        var dx = pl.getX() - loc.getX();
                        var dz = pl.getZ() - loc.getZ();
                        if (dx * dx + dz * dz > hitRadius * hitRadius) continue;
                        var dy = (pl.getY() + 1.0) - loc.getY();
                        if (Math.abs(dy) > hitVertical) continue;
                        delete trackedProjectiles[uuid];
                        try { proj.remove(); } catch (ignored) { }
                        resolveProjectileImpact(boss, entry.kind, p, loc);
                        break;
                    }
                }
            } catch (e) {
                delete trackedProjectiles[uuid];
            }
        }
    }

    // -----------------------------------------------------------------------
    // 通用工具：点到射线的距离 / 视线遮挡 / 全场警告
    // -----------------------------------------------------------------------
    function distanceToRay(point, origin, dir, maxLength) {
        var px = point.getX() - origin.getX();
        var py = point.getY() - origin.getY();
        var pz = point.getZ() - origin.getZ();
        var proj = px * dir.getX() + py * dir.getY() + pz * dir.getZ();
        if (proj < 0.0) proj = 0.0;
        if (proj > maxLength) proj = maxLength;
        var cx = origin.getX() + dir.getX() * proj;
        var cy = origin.getY() + dir.getY() * proj;
        var cz = origin.getZ() + dir.getZ() * proj;
        var dx = point.getX() - cx;
        var dy = point.getY() - cy;
        var dz = point.getZ() - cz;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    // 两点之间是否没有方块遮挡（掩体判定）
    function hasClearPath(world, from, to) {
        try {
            var dir = new Vector(to.getX() - from.getX(), to.getY() - from.getY(),
                to.getZ() - from.getZ());
            var dist = dir.length();
            if (dist < 0.001) return true;
            dir.normalize();
            return world.rayTraceBlocks(from, dir, dist) == null;
        } catch (e) {
            return true;
        }
    }

    // 需求：3/4 级法术「施展时会发出警告」
    function warnPlayers(boss, title, subtitle, actionText, sound, pitch) {
        var warned = 0;
        try {
            var players = boss.world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var p = players.get(i);
                if (!isEngageablePlayer(p)) continue;
                if (p.getLocation().distanceSquared(boss.carrier.getLocation())
                        > LIGHTNING_BEAM_WARN_RADIUS * LIGHTNING_BEAM_WARN_RADIUS) continue;
                try {
                    p.sendTitle(title, subtitle, 0, 25, 5);
                    p.sendActionBar(actionText);
                } catch (ignored) { }
                try {
                    playSoundSafe(boss.world, p.getLocation(), sound, 1.6, pitch);
                } catch (ignored) { }
                warned++;
            }
        } catch (e) {
            logError("WanderingWarlock 施法警告异常", e);
        }
        // 运行日志：重技能前摇的警告广播人数（便于排障，不属于调试日志）
        log.info("WanderingWarlock 施法警告：" + ChatColor.stripColor(title) + " → " + warned + " 人");
        return warned;
    }

    // -----------------------------------------------------------------------
    // 3 级法术：闪电束
    // -----------------------------------------------------------------------
    // 射线命中结算（单目标，供自检使用）：无视护甲与盾牌
    function resolveLightningBeamHit(boss, player, origin, dir, reach) {
        var center = player.getLocation().clone().add(0, 0.9, 0);
        var offset = distanceToRay(center, origin, dir, reach);
        if (offset > LIGHTNING_BEAM_RADIUS) return "miss";
        // 需求：无视护甲和护盾 —— 不做举盾判断，用无视护甲的伤害来源
        var dealt = dealArcaneDamage(player, LIGHTNING_BEAM_DAMAGE, boss);
        if (!dealt) return "noeffect";
        try {
            player.sendMessage(ChatColor.AQUA + "[" + BOSS_NAME + "] " + ChatColor.GRAY
                + "闪电束贯穿了你（" + LIGHTNING_BEAM_DAMAGE + " 点，无视护甲与盾牌）。");
        } catch (ignored) { }
        return "hit";
    }

    function beamReach(boss, origin, dir) {
        // 光束被方块挡住就停在墙上
        try {
            var trace = boss.world.rayTraceBlocks(origin, dir, LIGHTNING_BEAM_LENGTH);
            if (trace == null) return LIGHTNING_BEAM_LENGTH;
            var hp = trace.getHitPosition();
            var dx = hp.getX() - origin.getX();
            var dy = hp.getY() - origin.getY();
            var dz = hp.getZ() - origin.getZ();
            return Math.min(LIGHTNING_BEAM_LENGTH, Math.sqrt(dx * dx + dy * dy + dz * dz));
        } catch (e) {
            return LIGHTNING_BEAM_LENGTH;
        }
    }

    function castLightningBeam(boss, act, target) {
        var origin = boss.carrier.getEyeLocation();
        var dir = act.beamDir;
        if (dir == null) {
            act.fizzled = true;
            return "fizzle";
        }
        var reach = beamReach(boss, origin, dir);

        // 视觉：暴击 + 蓝白粒子组成的柱形光束
        for (var i = 0; i <= LIGHTNING_BEAM_STEPS; i++) {
            var t = i / LIGHTNING_BEAM_STEPS;
            var px = origin.getX() + dir.getX() * reach * t;
            var py = origin.getY() + dir.getY() * reach * t;
            var pz = origin.getZ() + dir.getZ() * reach * t;
            var at = new Location(boss.world, px, py, pz);
            spawnParticleSafe(boss.world, Particle.CRIT, at, 8, 1.4, 1.4, 1.4, 0.35);
            spawnParticleSafe(boss.world, Particle.ELECTRIC_SPARK, at, 5, 1.2, 1.2, 1.2, 0.25);
            spawnParticleSafe(boss.world, Particle.END_ROD, at, 3, 0.9, 0.9, 0.9, 0.02);
            if (i % 3 === 0) {
                spawnParticleSafe(boss.world, Particle.SOUL_FIRE_FLAME, at, 2, 0.8, 0.8, 0.8, 0.02);
            }
        }
        try {
            for (var s = 1; s <= 3; s++) {
                var tt = s / 4.0;
                boss.world.strikeLightningEffect(new Location(boss.world,
                    origin.getX() + dir.getX() * reach * tt,
                    origin.getY() + dir.getY() * reach * tt,
                    origin.getZ() + dir.getZ() * reach * tt));
            }
        } catch (ignored) { }
        playSoundSafe(boss.world, origin, Sound.ENTITY_LIGHTNING_BOLT_THUNDER, 2.0, 1.3);
        playSoundSafe(boss.world, origin, Sound.ENTITY_LIGHTNING_BOLT_IMPACT, 1.8, 1.0);
        playSoundSafe(boss.world, origin, Sound.ENTITY_WARDEN_SONIC_BOOM, 1.2, 1.4);

        var hit = 0;
        try {
            var players = boss.world.getPlayers();
            for (var j = 0; j < players.size(); j++) {
                var p = players.get(j);
                if (!isEngageablePlayer(p)) continue;
                var status = resolveLightningBeamHit(boss, p, origin, dir, reach);
                if (status === "hit") hit++;
            }
        } catch (e) {
            logError("WanderingWarlock 闪电束结算异常", e);
        }
        act.hitOk = hit;
        return (hit > 0) ? "hit" : "cast";
    }

    // -----------------------------------------------------------------------
    // 4 级法术：火球术（无法拦截 / 半径 8 格球状 / 无视盾牌）
    // -----------------------------------------------------------------------
    function spawnUltimateFireball(boss, act, target) {
        try {
            var eye = boss.carrier.getEyeLocation();
            var aim = target.getLocation().clone().add(0, 1.0, 0);
            // 大火球同样是无重力直线飞行（M-22）
            var dir = aimDirectionTo(boss, aim, ULT_FIREBALL_SPEED, 0.0);
            var loc = eye.clone().add(dir.clone().multiply(0.9));
            var ball = boss.world.spawn(loc, LargeFireballClass);
            if (ball == null) return null;
            try { ball.setShooter(boss.carrier); } catch (ignored) { }
            try { ball.setIsIncendiary(false); } catch (ignored) { }
            try { ball.setYield(0.0); } catch (ignored) { }
            ball.setDirection(dir);
            ball.setVelocity(dir.clone().multiply(ULT_FIREBALL_SPEED));
            ball.addScoreboardTag(PROJECTILE_TAG);
            var uuid = String(ball.getUniqueId().toString());
            trackedProjectiles[uuid] = {
                proj: ball,
                kind: KIND_ULT_FIREBALL,
                bossUuid: boss.uuid,
                life: ULT_FIREBALL_LIFE_TICKS,
                resolved: false
            };
            playSoundSafe(boss.world, loc, Sound.ENTITY_GHAST_SHOOT, 1.6, 1.0);
            playSoundSafe(boss.world, loc, Sound.ITEM_FIRECHARGE_USE, 1.4, 0.9);
            return ball;
        } catch (e) {
            logError("WanderingWarlock 发射火球术失败", e);
            return null;
        }
    }

    // 火球术的单目标结算：吃护甲、**无视盾牌**；被方块遮挡时只吃一部分伤害
    function resolveUltimateFireballHit(boss, player, center) {
        var loc = player.getLocation().clone().add(0, 0.9, 0);
        var clear = hasClearPath(boss.world, center, loc);
        var damage = clear ? ULT_FIREBALL_DAMAGE
            : ULT_FIREBALL_DAMAGE * ULT_FIREBALL_COVER_MULTIPLIER;
        // 需求：可以无视盾牌 —— 不做 isPlayerGuarding 判断
        var dealt = dealPlayerDamage(player, damage, boss);
        if (!dealt) return "noeffect";
        try {
            var push = player.getLocation().toVector().subtract(center.toVector());
            push.setY(0.0);
            if (push.lengthSquared() > 0.0001) {
                push.normalize().multiply(ULT_FIREBALL_KNOCKBACK);
            } else {
                push = new Vector(0.0, 0.0, 0.0);
            }
            push.setY(ULT_FIREBALL_LAUNCH_UP);
            player.setVelocity(push);
        } catch (ignored) { }
        try {
            player.sendMessage(ChatColor.DARK_RED + "[" + BOSS_NAME + "] " + ChatColor.GRAY
                + "火球术命中（" + Math.round(damage) + " 点"
                + (clear ? "" : "，被掩体削弱") + "）。");
        } catch (ignored) { }
        return "hit";
    }

    function detonateUltimateFireball(boss, center) {
        playSoundSafe(boss.world, center, Sound.ENTITY_GENERIC_EXPLODE, 2.2, 0.9);
        playSoundSafe(boss.world, center, Sound.ENTITY_DRAGON_FIREBALL_EXPLODE, 1.6, 1.0);
        spawnParticleSafe(boss.world, Particle.EXPLOSION_EMITTER, center, 3, 0.0, 0.0, 0.0, 0.0);
        spawnParticleSafe(boss.world, Particle.EXPLOSION, center, 12, 3.0, 2.0, 3.0, 0.0);
        spawnParticleSafe(boss.world, Particle.FLAME, center, 120, 5.0, 3.0, 5.0, 0.15);
        spawnParticleSafe(boss.world, Particle.LAVA, center, 40, 4.0, 2.0, 4.0, 0.0);
        spawnParticleSafe(boss.world, Particle.LARGE_SMOKE, center, 60, 4.5, 2.5, 4.5, 0.08);
        // 半径 8 格的冲击环
        for (var k = 0; k < 48; k++) {
            var angle = (k / 48.0) * Math.PI * 2.0;
            spawnParticleSafe(boss.world, Particle.CLOUD, new Location(boss.world,
                center.getX() + Math.cos(angle) * ULT_FIREBALL_RADIUS,
                center.getY() + 0.4,
                center.getZ() + Math.sin(angle) * ULT_FIREBALL_RADIUS), 1, 0.0, 0.0, 0.0, 0.02);
        }

        var hit = 0;
        try {
            var players = boss.world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var p = players.get(i);
                if (!isEngageablePlayer(p)) continue;
                if (p.getLocation().distanceSquared(center) > ULT_FIREBALL_RADIUS * ULT_FIREBALL_RADIUS) {
                    continue;
                }
                var status = resolveUltimateFireballHit(boss, p, center);
                if (status === "hit") hit++;
            }
        } catch (e) {
            logError("WanderingWarlock 火球术爆炸结算异常", e);
        }
        log.info("WanderingWarlock 火球术引爆：半径 " + ULT_FIREBALL_RADIUS + " 格，命中 " + hit + " 人。");
        return hit;
    }

    // 投射物命中统一分发（火焰箭 / 火球术）
    function resolveProjectileImpact(boss, kind, hitPlayer, loc) {
        if (boss == null) return;
        if (kind === KIND_ULT_FIREBALL) {
            detonateUltimateFireball(boss, loc);
            return;
        }
        if (hitPlayer == null) return;
        if (!(hitPlayer instanceof PlayerClass)) return;
        resolveFireBoltHit(boss, hitPlayer, loc);
    }

    // -----------------------------------------------------------------------
    // 法术：施法表现 / 结算
    // -----------------------------------------------------------------------
    function windupTicksFor(spell) {
        if (spell === KIND_SHOCKING_GRASP) return GRASP_WINDUP_TICKS;
        if (spell === KIND_MINOR_ILLUSION) return ILLUSION_WINDUP_TICKS;
        if (spell === KIND_ARCANE_SHIELD) return SHIELD_CAST_WINDUP_TICKS;
        if (spell === KIND_MAGE_ARMOR) return MAGE_ARMOR_WINDUP_TICKS;
        if (spell === KIND_THUNDERWAVE) return THUNDERWAVE_WINDUP_TICKS;
        if (spell === KIND_SHATTER) return SHATTER_WINDUP_TICKS;
        if (spell === KIND_SCORCHING_RAY) return RAY_WINDUP_TICKS;
        if (spell === KIND_LIGHTNING_BEAM) return LIGHTNING_BEAM_WINDUP_TICKS;
        if (spell === KIND_ULT_FIREBALL) return ULT_FIREBALL_WINDUP_TICKS;
        return FIRE_BOLT_WINDUP_TICKS;
    }

    function hitCountFor(spell) {
        return (spell === KIND_SCORCHING_RAY) ? RAY_COUNT : 1;
    }

    function gapFor(spell) {
        return (spell === KIND_SCORCHING_RAY) ? RAY_GAP_TICKS : 0;
    }

    function needsApproach(spell) {
        return (spell === KIND_SHOCKING_GRASP || spell === KIND_THUNDERWAVE);
    }

    function spellDisplayName(spell) {
        if (spell === KIND_FIRE_BOLT) return "火焰箭";
        if (spell === KIND_SHOCKING_GRASP) return "电爪";
        if (spell === KIND_MINOR_ILLUSION) return "次级幻影";
        if (spell === KIND_ARCANE_SHIELD) return "护盾术";
        if (spell === KIND_MAGE_ARMOR) return "法师护甲";
        if (spell === KIND_THUNDERWAVE) return "雷鸣波";
        if (spell === KIND_SHATTER) return "粉碎音波";
        if (spell === KIND_SCORCHING_RAY) return "灼热射线";
        if (spell === KIND_LIGHTNING_BEAM) return "闪电束";
        if (spell === KIND_ULT_FIREBALL) return "火球术";
        return String(spell);
    }

    // 加权随机（尽量排除上一招，避免连续两次放同一个法术）
    function pickWeighted(entries, lastPick) {
        var total = 0.0;
        var i;
        for (i = 0; i < entries.length; i++) {
            if (entries[i][0] === lastPick) continue;
            total += entries[i][1];
        }
        var excluded = lastPick;
        if (total <= 0.0) {
            excluded = null;
            for (i = 0; i < entries.length; i++) total += entries[i][1];
        }
        var roll = Math.random() * total;
        for (i = 0; i < entries.length; i++) {
            if (entries[i][0] === excluded) continue;
            if (roll < entries[i][1]) return entries[i][0];
            roll -= entries[i][1];
        }
        return entries[0][0];
    }

    function pickFrom(list, lastPick) {
        if (list.length === 0) return null;
        if (list.length === 1) return list[0];
        var pool = [];
        for (var i = 0; i < list.length; i++) {
            if (list[i] !== lastPick) pool.push(list[i]);
        }
        if (pool.length === 0) pool = list;
        return pool[Math.floor(Math.random() * pool.length)];
    }

    function pickCantrip(boss, target) {
        var options = [KIND_FIRE_BOLT, KIND_MINOR_ILLUSION];
        try {
            if (target != null
                && horizontalDistance(boss.carrier.getLocation(), target.getLocation()) <= GRASP_PICK_RANGE) {
                options.push(KIND_SHOCKING_GRASP);
            }
        } catch (ignored) { }
        var pick = pickFrom(options, boss.lastCantrip);
        boss.lastCantrip = pick;
        return pick;
    }

    function pickSpell1(boss, target) {
        var entries = [];
        if (findOtherCustomBoss(boss, null) != null) {
            // 需求：法术更侧重辅助 → 护盾术 / 法师护甲 各 4，雷鸣波 2
            entries.push([KIND_ARCANE_SHIELD, ARCANE_SHIELD_WEIGHT]);
            entries.push([KIND_MAGE_ARMOR, MAGE_ARMOR_WEIGHT]);
        }
        try {
            if (target != null
                && horizontalDistance(boss.carrier.getLocation(), target.getLocation()) <= THUNDERWAVE_PICK_RANGE) {
                entries.push([KIND_THUNDERWAVE, THUNDERWAVE_WEIGHT]);
            }
        } catch (ignored) { }
        if (entries.length === 0) return null;
        // 传 null 表示不做「排除上一招」：辅助技占比稳定在 10/12 ≈ 83%
        var pick = pickWeighted(entries, null);
        boss.lastSpell1 = pick;
        return pick;
    }

    function pickSpell2(boss, target) {
        var options = [];
        try {
            if (target != null) {
                var dist = horizontalDistance(boss.carrier.getLocation(), target.getLocation());
                if (dist <= SHATTER_CAST_RANGE) options.push(KIND_SHATTER);
                if (dist <= RAY_MAX_RANGE) options.push(KIND_SCORCHING_RAY);
            }
        } catch (ignored) { }
        if (options.length === 0) return null;
        var pick = pickFrom(options, boss.lastSpell2);
        boss.lastSpell2 = pick;
        return pick;
    }

    // 3 级法术位（目前只有闪电束；以后加招只需往这里追加）
    function pickSpell3(boss, target) {
        if (target == null) return null;
        var entries = [[KIND_LIGHTNING_BEAM, 1]];
        var pick = pickWeighted(entries, boss.lastSpell3);
        boss.lastSpell3 = pick;
        return pick;
    }

    // 4 级法术位（目前只有火球术）
    function pickSpell4(boss, target) {
        if (target == null) return null;
        var entries = [[KIND_ULT_FIREBALL, 1]];
        var pick = pickWeighted(entries, boss.lastSpell4);
        boss.lastSpell4 = pick;
        return pick;
    }

    function beginCast(boss, slot, spell, target, chainLeft, chainStartTick) {
        var windup = windupTicksFor(spell);
        var hits = hitCountFor(spell);
        var gap = gapFor(spell);
        var act = {
            slot: slot,
            spell: spell,
            chainLeft: (chainLeft == null) ? 0 : chainLeft,
            chainStartTick: (chainStartTick == null) ? globalTick : chainStartTick,
            startTick: globalTick,
            windupEndTick: globalTick + windup,
            endTick: globalTick + windup + Math.max(0, hits - 1) * gap + RECOVER_TICKS,
            nextHitTick: globalTick + windup,
            hitIndex: 0,
            hitCount: hits,
            gap: gap,
            targetRef: target,
            targetUuid: (target != null) ? String(target.getUniqueId().toString()) : null,
            blockedCount: 0,
            hitOk: 0,
            fizzled: false
        };
        boss.action = act;
        boss.castCount++;

        if (slot === SLOT_CANTRIP) {
            // 需求：戏法冷却 3 秒（从连发的第一招开始算）
            boss.nextCantripTick = act.chainStartTick + CANTRIP_COOLDOWN_TICKS;
        } else if (slot === SLOT_SPELL1) {
            // 需求：1 级法术冷却 30 秒
            boss.nextSpell1Tick = act.startTick + SPELL1_COOLDOWN_TICKS;
        } else if (slot === SLOT_SPELL3) {
            // 需求：3 级法术冷却 60 秒
            boss.nextSpell3Tick = act.startTick + SPELL3_COOLDOWN_TICKS;
        } else if (slot === SLOT_SPELL4) {
            // 需求：4 级法术冷却 90 秒
            boss.nextSpell4Tick = act.startTick + SPELL4_COOLDOWN_TICKS;
        } else {
            // 需求：2 级法术冷却 45 秒
            boss.nextSpell2Tick = act.startTick + SPELL2_COOLDOWN_TICKS;
        }

        // 闪电束：施法瞬间锁定方向（之后玩家可以靠走位离开光束轨迹）
        if (spell === KIND_LIGHTNING_BEAM && target != null) {
            try {
                var eye = boss.carrier.getEyeLocation();
                var aim = target.getLocation().clone().add(0, 1.0, 0);
                var beamVec = new Vector(aim.getX() - eye.getX(), aim.getY() - eye.getY(),
                    aim.getZ() - eye.getZ());
                if (beamVec.lengthSquared() > 1.0e-6) {
                    act.beamDir = beamVec.normalize();
                }
            } catch (ignored) { }
        }

        var loc = boss.carrier.getLocation();
        if (spell === KIND_FIRE_BOLT || spell === KIND_SCORCHING_RAY) {
            playSoundSafe(boss.world, loc, Sound.ENTITY_EVOKER_CAST_SPELL, 1.1, 1.2);
        } else if (spell === KIND_SHOCKING_GRASP) {
            playSoundSafe(boss.world, loc, Sound.BLOCK_AMETHYST_BLOCK_CHIME, 1.0, 1.4);
        } else if (spell === KIND_MINOR_ILLUSION) {
            playSoundSafe(boss.world, loc, Sound.ENTITY_ILLUSIONER_CAST_SPELL, 1.2, 1.0);
        } else if (spell === KIND_THUNDERWAVE) {
            playSoundSafe(boss.world, loc, Sound.ENTITY_WARDEN_SONIC_CHARGE, 1.3, 1.0);
        } else if (spell === KIND_SHATTER) {
            playSoundSafe(boss.world, loc, Sound.ENTITY_WARDEN_SONIC_CHARGE, 1.6, 1.2);
        } else if (spell === KIND_LIGHTNING_BEAM) {
            // 需求：前摇 1 秒 + 发出警告
            playSoundSafe(boss.world, loc, Sound.BLOCK_BEACON_ACTIVATE, 1.4, 1.6);
            playSoundSafe(boss.world, loc, Sound.ENTITY_LIGHTNING_BOLT_THUNDER, 1.2, 1.6);
            warnPlayers(boss, ChatColor.AQUA + "§l闪电束", ChatColor.GRAY + "立刻离开蓝色光束轨迹！",
                ChatColor.AQUA + "闪电束蓄力中……", Sound.ENTITY_WARDEN_SONIC_CHARGE, 1.2);
        } else if (spell === KIND_ULT_FIREBALL) {
            // 需求：前摇 1.5 秒 + 发出警告
            playSoundSafe(boss.world, loc, Sound.ENTITY_GHAST_WARN, 1.6, 1.0);
            warnPlayers(boss, ChatColor.RED + "§l火球术", ChatColor.GRAY + "半径 8 格内都会被波及！",
                ChatColor.RED + "火球术蓄力中……", Sound.ENTITY_GHAST_WARN, 1.0);
        } else {
            playSoundSafe(boss.world, loc, Sound.BLOCK_ENCHANTMENT_TABLE_USE, 1.2, 1.1);
        }
        return act;
    }

    function startCantripCast(boss, target, chainLeft, chainStartTick) {
        var spell = pickCantrip(boss, target);
        return beginCast(boss, SLOT_CANTRIP, spell, target, chainLeft, chainStartTick);
    }

    function spawnCastWindupEffect(boss, act, target) {
        if (globalTick % 2 !== 0) return;
        var eye = boss.carrier.getEyeLocation();
        var spell = act.spell;
        if (spell === KIND_FIRE_BOLT) {
            spawnParticleSafe(boss.world, Particle.FLAME, eye, 3, 0.25, 0.25, 0.25, 0.01);
        } else if (spell === KIND_SHOCKING_GRASP) {
            spawnParticleSafe(boss.world, Particle.ELECTRIC_SPARK, eye, 5, 0.3, 0.3, 0.3, 0.02);
        } else if (spell === KIND_MINOR_ILLUSION) {
            spawnParticleSafe(boss.world, Particle.ENCHANT,
                boss.carrier.getLocation().clone().add(0, 1.2, 0), 8, 0.7, 0.9, 0.7, 0.4);
        } else if (spell === KIND_ARCANE_SHIELD) {
            spawnParticleSafe(boss.world, Particle.END_ROD,
                boss.carrier.getLocation().clone().add(0, 1.2, 0), 6, 0.6, 0.8, 0.6, 0.02);
        } else if (spell === KIND_MAGE_ARMOR) {
            spawnParticleSafe(boss.world, Particle.WAX_ON,
                boss.carrier.getLocation().clone().add(0, 1.2, 0), 6, 0.6, 0.8, 0.6, 0.0);
        } else if (spell === KIND_THUNDERWAVE) {
            spawnParticleSafe(boss.world, Particle.CLOUD, eye, 4, 0.3, 0.3, 0.3, 0.02);
        } else if (spell === KIND_SHATTER) {
            if (target != null) {
                spawnParticleSafe(boss.world, Particle.SONIC_BOOM,
                    target.getLocation().clone().add(0, 1.0, 0), 1, 0.0, 0.0, 0.0, 0.0);
                spawnParticleSafe(boss.world, Particle.CLOUD,
                    target.getLocation().clone().add(0, 1.0, 0), 6, 0.5, 0.5, 0.5, 0.02);
            }
        } else if (spell === KIND_SCORCHING_RAY) {
            spawnParticleSafe(boss.world, Particle.SMALL_FLAME, eye, 3, 0.2, 0.2, 0.2, 0.0);
        } else if (spell === KIND_LIGHTNING_BEAM) {
            // 前摇期间画出「光束将经过的轨迹」警告线（每 tick 画一次，方向已锁定）
            spawnParticleSafe(boss.world, Particle.ELECTRIC_SPARK, eye, 8, 0.35, 0.35, 0.35, 0.05);
            spawnParticleSafe(boss.world, Particle.END_ROD, eye, 4, 0.3, 0.3, 0.3, 0.02);
            var beamDir = act.beamDir;
            if (beamDir != null) {
                for (var bi = 1; bi <= 14; bi++) {
                    var bt = bi / 14.0;
                    spawnParticleSafe(boss.world, Particle.SOUL_FIRE_FLAME, new Location(boss.world,
                        eye.getX() + beamDir.getX() * LIGHTNING_BEAM_LENGTH * bt,
                        eye.getY() + beamDir.getY() * LIGHTNING_BEAM_LENGTH * bt,
                        eye.getZ() + beamDir.getZ() * LIGHTNING_BEAM_LENGTH * bt), 1, 0.15, 0.15, 0.15, 0.0);
                }
            }
        } else if (spell === KIND_ULT_FIREBALL) {
            // 前摇期间在boss身上汇聚火焰
            spawnParticleSafe(boss.world, Particle.FLAME, eye, 10, 0.6, 0.6, 0.6, 0.05);
            spawnParticleSafe(boss.world, Particle.LAVA, eye, 3, 0.4, 0.4, 0.4, 0.0);
            spawnParticleSafe(boss.world, Particle.LARGE_SMOKE, eye, 6, 0.5, 0.5, 0.5, 0.03);
        }
    }

    // 电爪：1 格内，微量伤害，无视护甲与盾牌
    function castShockingGrasp(boss, act, target) {
        if (target == null || !isEngageablePlayer(target)) {
            act.fizzled = true;
            return "fizzle";
        }
        var dist = horizontalDistance(boss.carrier.getLocation(), target.getLocation());
        var eye = boss.carrier.getEyeLocation();
        if (dist > GRASP_CAST_RANGE) {
            // 目标跑出了 1 格范围：落空
            act.fizzled = true;
            spawnParticleSafe(boss.world, Particle.ELECTRIC_SPARK, eye, 10, 0.4, 0.4, 0.4, 0.05);
            try {
                target.sendActionBar(ChatColor.AQUA + "你躲开了电爪！");
            } catch (ignored) { }
            return "fizzle";
        }
        // 无视护甲值与盾牌防御：不做 isPlayerGuarding 判断，用无视护甲的伤害来源
        var dealt = dealArcaneDamage(target, GRASP_DAMAGE, boss);
        var loc = target.getLocation().clone().add(0, 1.0, 0);
        spawnParticleSafe(boss.world, Particle.ELECTRIC_SPARK, loc, 30, 0.6, 0.8, 0.6, 0.15);
        spawnParticleSafe(boss.world, Particle.CRIT, loc, 12, 0.5, 0.6, 0.5, 0.1);
        playSoundSafe(boss.world, loc, Sound.ENTITY_LIGHTNING_BOLT_IMPACT, 0.9, 1.6);
        playSoundSafe(boss.world, loc, Sound.BLOCK_AMETHYST_BLOCK_CHIME, 1.2, 1.6);
        try {
            target.sendMessage(ChatColor.AQUA + "[" + BOSS_NAME + "] " + ChatColor.GRAY
                + "电爪穿过护甲与盾牌命中了你（" + GRASP_DAMAGE + " 点）。");
        } catch (ignored) { }
        return dealt ? "hit" : "noeffect";
    }

    // 火焰箭
    function castFireBolt(boss, act, target) {
        if (target == null || !isEngageablePlayer(target)) {
            act.fizzled = true;
            return "fizzle";
        }
        faceTarget(boss, target.getLocation());
        spawnFireBolt(boss, target);
        return "cast";
    }

    // 雷鸣波的单目标结算：可破盾（斧头原理：本次挡下，但盾牌进入 5 秒冷却）
    function resolveThunderwaveHit(boss, player) {
        if (isPlayerGuarding(player)) {
            playShieldBlockFeedback(player);
            breakPlayerShield(player);
            return "blocked";
        }
        var dealt = dealPlayerDamage(player, THUNDERWAVE_DAMAGE, boss);
        if (!dealt) return "noeffect";
        knockbackPlayerFrom(boss, player, THUNDERWAVE_KNOCKBACK, THUNDERWAVE_LAUNCH_UP);
        try {
            player.sendMessage(ChatColor.DARK_PURPLE + "[" + BOSS_NAME + "] " + ChatColor.GRAY
                + "雷鸣波把你击飞了！");
        } catch (ignored) { }
        return "hit";
    }

    // 粉碎音波的单目标结算：无视护甲（声波伤害来源），但可被盾牌防御（由本函数拦截）
    function resolveShatterHit(boss, player) {
        if (isPlayerGuarding(player)) {      // 需求：可被盾牌防御
            playShieldBlockFeedback(player);
            return "blocked";
        }
        var dealt = dealArcaneDamage(player, SHATTER_DAMAGE, boss);   // 需求：无视护甲
        return dealt ? "hit" : "noeffect";
    }

    // 雷鸣波：2 格内施展，扇形声波击飞 + 微量伤害，可破盾
    function castThunderwave(boss, act, target) {
        if (target == null || !isEngageablePlayer(target)) {
            act.fizzled = true;
            return "fizzle";
        }
        var dist = horizontalDistance(boss.carrier.getLocation(), target.getLocation());
        var eye = boss.carrier.getEyeLocation();
        if (dist > THUNDERWAVE_CAST_RANGE) {
            act.fizzled = true;
            spawnParticleSafe(boss.world, Particle.CLOUD, eye, 10, 0.4, 0.4, 0.4, 0.03);
            try {
                target.sendActionBar(ChatColor.GRAY + "你及时拉开了距离，雷鸣波落空。");
            } catch (ignored) { }
            return "fizzle";
        }

        faceTarget(boss, target.getLocation());
        spawnParticleSafe(boss.world, Particle.SONIC_BOOM,
            boss.carrier.getLocation().clone().add(0, 1.2, 0), 1, 0.0, 0.0, 0.0, 0.0);
        var yawRad = boss.carrier.getLocation().getYaw() * Math.PI / 180.0;
        var forwardX = -Math.sin(yawRad);
        var forwardZ = Math.cos(yawRad);
        for (var k = 0; k < 18; k++) {
            var t = (k / 17.0 - 0.5) * 2.0;
            var angle = yawRad + t * 1.2;
            spawnParticleSafe(boss.world, Particle.CLOUD, new Location(boss.world,
                boss.carrier.getLocation().getX() - Math.sin(angle) * 3.0,
                boss.carrier.getLocation().getY() + 1.0,
                boss.carrier.getLocation().getZ() + Math.cos(angle) * 3.0),
                1, 0.0, 0.0, 0.0, 0.02);
        }
        spawnParticleSafe(boss.world, Particle.SMOKE,
            boss.carrier.getLocation().clone().add(0, 0.3, 0), 20, 1.2, 0.3, 1.2, 0.05);
        playSoundSafe(boss.world, eye, Sound.ENTITY_WARDEN_SONIC_BOOM, 1.6, 1.3);
        playSoundSafe(boss.world, eye, Sound.ENTITY_GENERIC_EXPLODE, 0.8, 1.6);

        var players = collectPlayersInSector(boss, THUNDERWAVE_RADIUS,
            THUNDERWAVE_ARC_DOT_MIN, THUNDERWAVE_VERTICAL_TOLERANCE);
        var blocked = 0;
        var hit = 0;
        for (var i = 0; i < players.length; i++) {
            var status = resolveThunderwaveHit(boss, players[i]);
            if (status === "blocked") blocked++;
            else if (status === "hit") hit++;
        }
        act.blockedCount = blocked;
        act.hitOk = hit;
        return "cast";
    }

    // 粉碎音波：目标附近直径 6 格球形，一定伤害，无视护甲、可被盾牌防御
    function castShatter(boss, act, target) {
        if (target == null || !isEngageablePlayer(target)) {
            act.fizzled = true;
            return "fizzle";
        }
        var center = target.getLocation().clone();
        spawnParticleSafe(boss.world, Particle.SONIC_BOOM, center.clone().add(0, 0.5, 0),
            1, 0.0, 0.0, 0.0, 0.0);
        spawnParticleSafe(boss.world, Particle.EXPLOSION, center.clone().add(0, 0.5, 0),
            8, 1.6, 1.2, 1.6, 0.0);
        spawnParticleSafe(boss.world, Particle.LARGE_SMOKE, center.clone().add(0, 0.5, 0),
            25, 1.6, 1.2, 1.6, 0.05);
        for (var r = 0; r < 3; r++) {
            var radius = SHATTER_RADIUS * ((r + 1) / 3.0);
            for (var i = 0; i < 16; i++) {
                var angle = (i / 16.0) * Math.PI * 2.0;
                spawnParticleSafe(boss.world, Particle.CLOUD, new Location(boss.world,
                    center.getX() + Math.cos(angle) * radius,
                    center.getY() + 0.4 + Math.sin(angle) * radius * 0.4,
                    center.getZ() + Math.sin(angle) * radius), 1, 0.0, 0.0, 0.0, 0.01);
            }
        }
        playSoundSafe(boss.world, center, Sound.ENTITY_WARDEN_SONIC_BOOM, 2.0, 1.0);
        playSoundSafe(boss.world, center, Sound.ENTITY_GENERIC_EXPLODE, 1.2, 1.2);

        var blocked = 0;
        var hit = 0;
        try {
            var players = boss.world.getPlayers();
            for (var j = 0; j < players.size(); j++) {
                var p = players.get(j);
                if (!isEngageablePlayer(p)) continue;
                if (p.getLocation().distanceSquared(center) > SHATTER_RADIUS * SHATTER_RADIUS) continue;
                var status = resolveShatterHit(boss, p);
                if (status === "blocked") blocked++;
                else if (status === "hit") hit++;
            }
        } catch (e) {
            logError("WanderingWarlock 粉碎音波结算异常", e);
        }
        act.blockedCount = blocked;
        act.hitOk = hit;
        return "cast";
    }

    // 灼热射线：3 道热射线，一定伤害并点燃目标
    function castScorchingRay(boss, act, target) {
        if (target == null || !isEngageablePlayer(target)) {
            act.fizzled = true;
            return "fizzle";
        }
        var eye = boss.carrier.getEyeLocation();
        var aim = target.getLocation().clone().add(0, 1.0, 0);
        var dist = eye.distance(aim);
        if (dist > RAY_MAX_RANGE) {
            act.fizzled = true;
            return "fizzle";
        }
        var dir = new Vector(aim.getX() - eye.getX(), aim.getY() - eye.getY(),
            aim.getZ() - eye.getZ()).normalize();
        // 射线被方块挡住就没有伤害（可以躲在掩体后）
        var blockedByBlock = false;
        var endLoc = aim;
        try {
            var trace = boss.world.rayTraceBlocks(eye, dir, dist);
            if (trace != null) {
                blockedByBlock = true;
                var hitPos = trace.getHitPosition();
                endLoc = new Location(boss.world, hitPos.getX(), hitPos.getY(), hitPos.getZ());
            }
        } catch (ignored) { }

        // 射线表现
        var points = 18;
        for (var i = 1; i <= points; i++) {
            var t = i / points;
            spawnParticleSafe(boss.world, Particle.FLAME, new Location(boss.world,
                eye.getX() + (endLoc.getX() - eye.getX()) * t,
                eye.getY() + (endLoc.getY() - eye.getY()) * t,
                eye.getZ() + (endLoc.getZ() - eye.getZ()) * t), 1, 0.03, 0.03, 0.03, 0.01);
            if (i % 3 === 0) {
                spawnParticleSafe(boss.world, Particle.SMALL_FLAME, new Location(boss.world,
                    eye.getX() + (endLoc.getX() - eye.getX()) * t,
                    eye.getY() + (endLoc.getY() - eye.getY()) * t,
                    eye.getZ() + (endLoc.getZ() - eye.getZ()) * t), 1, 0.02, 0.02, 0.02, 0.0);
            }
        }
        playSoundSafe(boss.world, eye, Sound.ENTITY_BLAZE_SHOOT, 1.0, 1.4);
        playSoundSafe(boss.world, eye, Sound.ITEM_FIRECHARGE_USE, 0.9, 1.2);

        if (blockedByBlock) return "wall";
        if (isPlayerGuarding(target)) {     // 射线可被盾牌防御
            act.blockedCount++;
            playShieldBlockFeedback(target);
            return "blocked";
        }
        var dealt = dealPlayerDamage(target, RAY_DAMAGE, boss);
        if (!dealt) return "noeffect";
        ignitePlayer(target, RAY_BURN_TICKS);
        try {
            target.sendMessage(ChatColor.GOLD + "[" + BOSS_NAME + "] " + ChatColor.GRAY
                + "灼热射线命中：你被点燃了（" + (RAY_BURN_TICKS / 20) + " 秒）。");
        } catch (ignored) { }
        return "hit";
    }

    // 法术结算分发
    function castSpellEffect(boss, act, target) {
        var spell = act.spell;
        if (spell === KIND_FIRE_BOLT) return castFireBolt(boss, act, target);
        if (spell === KIND_SHOCKING_GRASP) return castShockingGrasp(boss, act, target);
        if (spell === KIND_MINOR_ILLUSION) return (castMinorIllusion(boss) > 0) ? "cast" : "fizzle";
        if (spell === KIND_ARCANE_SHIELD) {
            var shieldTarget = findOtherCustomBoss(boss, KIND_ARCANE_SHIELD);
            if (shieldTarget == null) {
                act.fizzled = true;
                return "fizzle";
            }
            return applyArcaneShield(boss, shieldTarget) ? "cast" : "fizzle";
        }
        if (spell === KIND_MAGE_ARMOR) {
            var armorTarget = findOtherCustomBoss(boss, KIND_MAGE_ARMOR);
            if (armorTarget == null) {
                act.fizzled = true;
                return "fizzle";
            }
            return applyMageArmor(boss, armorTarget) ? "cast" : "fizzle";
        }
        if (spell === KIND_THUNDERWAVE) return castThunderwave(boss, act, target);
        if (spell === KIND_SHATTER) return castShatter(boss, act, target);
        if (spell === KIND_SCORCHING_RAY) return castScorchingRay(boss, act, target);
        if (spell === KIND_LIGHTNING_BEAM) return castLightningBeam(boss, act, target);
        if (spell === KIND_ULT_FIREBALL) {
            if (target == null || !isEngageablePlayer(target)) {
                act.fizzled = true;
                return "fizzle";
            }
            return (spawnUltimateFireball(boss, act, target) != null) ? "cast" : "fizzle";
        }
        return "fizzle";
    }

    function finishCast(boss, act) {
        if (boss.action === act) boss.action = null;
        // 戏法连发：第一招结束后立刻接第二招（冷却仍按连发起点算）
        // 目标沿用上一招的目标，目标不可用时才重新索敌
        if (act.slot === SLOT_CANTRIP && act.chainLeft > 0) {
            var target = (act.targetRef != null && isEngageablePlayer(act.targetRef))
                ? act.targetRef : findNearestPlayer(boss);
            if (target != null) {
                startCantripCast(boss, target, act.chainLeft - 1, act.chainStartTick);
                return;
            }
        }
        return null;
    }

    function updateAction(boss) {
        var act = boss.action;
        if (act == null) return;
        var target = act.targetRef;
        var targetAlive = (target != null && isEngageablePlayer(target) && target.isOnline());

        // 前摇 / 接近阶段
        if (globalTick < act.windupEndTick) {
            if (needsApproach(act.spell)) {
                if (targetAlive) approachTarget(boss, target);
            } else if (targetAlive) {
                faceTarget(boss, target.getLocation());
            }
            spawnCastWindupEffect(boss, act, target);
            return;
        }

        // 结算阶段
        if (act.hitIndex < act.hitCount && globalTick >= act.nextHitTick) {
            act.hitIndex++;
            act.nextHitTick = globalTick + act.gap;
            castSpellEffect(boss, act, targetAlive ? target : null);
        }

        if (globalTick >= act.endTick) finishCast(boss, act);
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

        // 优先级：4 级法术 > 3 级法术 > 2 级法术 > 1 级法术 > 戏法
        if (globalTick >= boss.nextSpell4Tick) {
            var spell4 = pickSpell4(boss, target);
            if (spell4 != null) {
                beginCast(boss, SLOT_SPELL4, spell4, target, 0, globalTick);
                return;
            }
        }
        if (globalTick >= boss.nextSpell3Tick) {
            var spell3 = pickSpell3(boss, target);
            if (spell3 != null) {
                beginCast(boss, SLOT_SPELL3, spell3, target, 0, globalTick);
                return;
            }
        }
        if (globalTick >= boss.nextSpell2Tick) {
            var spell2 = pickSpell2(boss, target);
            if (spell2 != null) {
                beginCast(boss, SLOT_SPELL2, spell2, target, 0, globalTick);
                return;
            }
        }
        if (globalTick >= boss.nextSpell1Tick) {
            var spell1 = pickSpell1(boss, target);
            if (spell1 != null) {
                beginCast(boss, SLOT_SPELL1, spell1, target, 0, globalTick);
                return;
            }
        }
        if (globalTick >= boss.nextCantripTick) {
            startCantripCast(boss, target, CANTRIP_CHAIN - 1, globalTick);
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
        removeProjectilesOf(boss.uuid);
        removeClonesOf(boss.uuid, "BOSS 死亡");
        removeBossBar(boss);
        if (boss.deathLocation != null) {
            playSoundSafe(boss.world, boss.deathLocation, Sound.ENTITY_SKELETON_DEATH, 1.6, 0.8);
            playSoundSafe(boss.world, boss.deathLocation, Sound.ENTITY_ILLUSIONER_MIRROR_MOVE, 1.2, 0.7);
            spawnParticleSafe(boss.world, Particle.SQUID_INK, boss.deathLocation, 30, 0.8, 1.0, 0.8, 0.05);
            spawnParticleSafe(boss.world, Particle.ENCHANT, boss.deathLocation, 40, 0.9, 1.2, 0.9, 0.5);
        }
        log.info("WanderingWarlock 进入死亡序列：" + boss.uuid);
    }

    function updateDeathSequence(boss) {
        if (boss.deathLocation != null && globalTick % 4 === 0) {
            spawnParticleSafe(boss.world, Particle.WITCH, boss.deathLocation, 8, 0.6, 0.8, 0.6, 0.02);
        }
        if (globalTick >= boss.deathEndTick) {
            log.info("WanderingWarlock 死亡序列完成。");
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
        // 骷髅是亡灵：白天会被点燃 —— 逐 tick 清火焰 + 关视觉火焰（配合火焰伤害免疫）
        try { boss.carrier.setFireTicks(0); } catch (ignored) { }
        try { boss.carrier.setVisualFire(false); } catch (ignored) { }
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
                logError("WanderingWarlock BOSS[" + uuids[i] + "] tick 异常", e);
            }
        }
    }

    // -----------------------------------------------------------------------
    // 事件注册（M-2：推迟到主线程第一个 tick 串行注册）
    // -----------------------------------------------------------------------
    function registerAllEvents() {

        // BOSS 本体伤害免疫 + 替身「被攻击即消失」+ 其他 BOSS 的护盾抵消
        registerEvent("org.bukkit.event.entity.EntityDamageEvent", function (event) {
            try {
                var entity = event.getEntity();
                if (entity == null) return;

                // 1) 替身：受到任何攻击就消失
                var clone = getCloneByEntity(entity);
                if (clone != null) {
                    event.setCancelled(true);
                    killClone(clone, "被攻击");
                    return;
                }

                // 2) 护盾术：为其他自定义 BOSS 抵消一次任意来源伤害
                var protectedUuid = String(entity.getUniqueId().toString());
                var prot = protectedBosses[protectedUuid];
                if (prot != null) {
                    if (prot.charges <= 0 || globalTick >= prot.endTick
                            || prot.entity == null || !prot.entity.isValid()) {
                        delete protectedBosses[protectedUuid];
                    } else if (!event.isCancelled()) {
                        prot.charges--;
                        event.setCancelled(true);
                        var ploc = entity.getLocation().clone().add(0, 1.3, 0);
                        try {
                            playSoundSafe(entity.getWorld(), ploc, Sound.ITEM_SHIELD_BLOCK, 1.6, 1.4);
                            spawnParticleSafe(entity.getWorld(), Particle.END_ROD, ploc, 25, 0.8, 1.0, 0.8, 0.05);
                            spawnParticleSafe(entity.getWorld(), Particle.CRIT, ploc, 15, 0.7, 0.9, 0.7, 0.1);
                        } catch (ignored) { }
                        log.info("WanderingWarlock 护盾术抵消了一次伤害：" + prot.name
                            + " 剩余护盾 " + prot.charges + " 层。");
                        if (prot.charges <= 0) delete protectedBosses[protectedUuid];
                        return;
                    }
                }

                // 3) BOSS 本体
                var boss = getBossByEntity(entity);
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
                logError("WanderingWarlock 受伤事件异常", e);
            }
        });

        // 近战 / 远程命中反馈
        registerEvent("org.bukkit.event.entity.EntityDamageByEntityEvent", function (event) {
            try {
                var boss = getBossByEntity(event.getEntity());
                if (boss == null || boss.dead) return;
                var damager = null;
                try { damager = event.getDamager(); } catch (e) { return; }
                if (damager == null) return;
                if (damager instanceof PlayerClass) {
                    var loc = boss.carrier.getLocation();
                    playSoundSafe(boss.world, loc, Sound.ENTITY_SKELETON_HURT, 0.7, 1.3);
                    spawnParticleSafe(boss.world, Particle.CRIT,
                        new Location(boss.world, loc.getX(), loc.getY() + 1.2, loc.getZ()),
                        6, 0.4, 0.4, 0.4, 0.05);
                }
            } catch (e) {
                logError("WanderingWarlock 近战/远程事件异常", e);
            }
        });

        // 火焰弹命中：取消原版行为，改由脚本结算
        registerEvent("org.bukkit.event.entity.ProjectileHitEvent", function (event) {
            try {
                var proj = event.getEntity();
                if (proj == null) return;
                var uuid = String(proj.getUniqueId().toString());
                var entry = trackedProjectiles[uuid];
                if (entry == null) return;

                event.setCancelled(true);
                delete trackedProjectiles[uuid];

                var boss = activeBosses[entry.bossUuid];
                var hitPlayer = null;
                try { hitPlayer = event.getHitEntity(); } catch (ignored) { }
                var loc = proj.getLocation().clone();
                try {
                    var hitBlock = event.getHitBlock();
                    if (hitBlock != null) loc = hitBlock.getLocation().add(0.5, 0.5, 0.5);
                } catch (ignored) { }
                try { proj.remove(); } catch (ignored) { }

                if (boss != null && !boss.dead) {
                    resolveProjectileImpact(boss, entry.kind, hitPlayer, loc);
                }
            } catch (e) {
                logError("WanderingWarlock 火焰弹命中事件异常", e);
            }
        });

        // 契约 7.2：拦截原版整数爆炸，防止火焰弹产生非预期爆炸
        registerEvent("org.bukkit.event.entity.ExplosionPrimeEvent", function (event) {
            try {
                var ent = event.getEntity();
                if (ent == null) return;
                if (!ent.getScoreboardTags().contains(PROJECTILE_TAG)) return;
                event.setCancelled(true);
            } catch (e) {
                logError("WanderingWarlock 爆炸预备事件异常", e);
            }
        });

        // 死亡：清空掉落并进入死亡序列
        registerEvent("org.bukkit.event.entity.EntityDeathEvent", function (event) {
            try {
                var entity = event.getEntity();
                if (entity == null) return;
                var clone = getCloneByEntity(entity);
                if (clone != null) {
                    try {
                        event.getDrops().clear();
                        event.setDroppedExp(0);
                    } catch (ignored) { }
                    killClone(clone, "死亡");
                    return;
                }
                var boss = getBossByEntity(entity);
                if (boss == null) return;
                try {
                    event.getDrops().clear();
                    event.setDroppedExp(0);
                } catch (ignored) { }
                startDeathSequence(boss);
            } catch (e) {
                logError("WanderingWarlock 死亡事件异常", e);
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
            logError("WanderingWarlock 延迟队列异常", e);
        }
        try {
            updateAllBosses();
        } catch (e) {
            logError("WanderingWarlock 主循环异常", e);
        }
        try {
            updateClones();
        } catch (e) {
            logError("WanderingWarlock 替身推进异常", e);
        }
        try {
            updateTrackedProjectiles();
        } catch (e) {
            logError("WanderingWarlock 火焰弹推进异常", e);
        }
        try {
            updateBuffs();
        } catch (e) {
            logError("WanderingWarlock 增益维护异常", e);
        }
    });

    scheduleSync(1, registerAllEvents);
    scheduleSync(2, cleanupOrphans);
    task.repeat(ticks(600), ticks(600), cleanupOrphans);

    // -----------------------------------------------------------------------
    // BossRegistry 注册
    // -----------------------------------------------------------------------
    var registeredThisInstance = false;

    function ensureRegistered() {
        try {
            var api = getShared("BossRegistry");
            if (api == null) return;
            if (!registeredThisInstance || api.heartbeat(BOSS_ID) !== true) {
                var aliases = new ArrayList();
                for (var i = 0; i < BOSS_ALIASES.length; i++) aliases.add(String(BOSS_ALIASES[i]));
                var lore = new ArrayList();
                for (var j = 0; j < BOSS_LORE.length; j++) lore.add(String(BOSS_LORE[j]));
                api.register(BOSS_ID, BOSS_NAME, aliases, lore, spawnWanderingWarlock);
                registeredThisInstance = true;
            }
        } catch (e) {
            logError("WanderingWarlock 注册异常", e);
        }
    }

    ensureRegistered();
    task.repeat(ticks(20), ticks(20), ensureRegistered);

    // -----------------------------------------------------------------------
    // 启动日志
    // -----------------------------------------------------------------------
    log.info("WanderingWarlock 已加载：使用 /call boss " + BOSS_NAME + " 获取召唤绿宝石。");
})();
