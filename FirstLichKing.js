/*
 * FirstLichKing.js —— 自定义 BOSS「初代巫妖王」（OpenJS 1.5.0 / Paper 1.21.8）
 *
 * 获取方式：/call boss 初代巫妖王
 * 召唤方式：手持「召唤初代巫妖王」烈焰棒右键点击地面 → 6 秒倒计时后降临
 *
 * 机制摘要（初版）：
 *   - 外观：手持木棍的凋零骷髅；头顶黑色粒子光环，身周蓝色火焰粒子光环
 *   - 生命：900（计分板承载有效生命，本体原生生命固定 20）
 *   - 普通攻击：每 35 tick 从身后上方随机位置发射 3 道黑色粒子激光，优先选择远处玩家，单道 10 伤害
 *   - 强化攻击：每 3 次普通攻击后，发动一次 10 tick 红色粒子预警的强化激光，
 *     命中造成 35 伤害并恢复 20 生命
 *   - 亡灵召唤：登场 30 秒后召唤 6 个铁甲铁剑僵尸；僵尸全程发光（光灵箭标记），
 *     优先攻击对巫妖累计伤害最高的目标，移动速度按玩家奔跑设置；
 *     僵尸存活期间巫妖受到的伤害 -75%、免疫远程攻击，并有三圈白色粒子环绕；
 *     僵尸全灭后 30 秒召唤下一波
 *   - 死亡之触：累计命中 3 次近战攻击后，经过 5 tick 黄色粒子前摇发动近战反击，
 *     造成 25 伤害 + 10 秒凋零，若命中则巫妖恢复 15 生命
 *   - 半血升空：HP ≤ 450 时升空并获得短暂无敌，随后召唤 3 颗巨大凋零骷髅头颅，
 *     落点提前用红色粒子标记；头颅落地造成威力 25 的爆炸并给予 30 秒凋零
 *   - 强化召唤：半血后召唤的僵尸额外获得力量 III、速度 III、全套铁甲保护 II
 *   - 强化普攻：半血后普通攻击变为在所有玩家脚下生成黑色法阵，5 tick 黄色预警后造成 15 伤害
 *   - 律令死亡：半血后每当玩家击退 2 次召唤僵尸，巫妖锁定对其伤害最高的玩家；
 *     目标 3 秒内未脱离巫妖视线则被即死，本人可见倒计时
 *
 * 依赖框架：CallBoss.js 提供的 BossRegistry（本脚本自动注册，无需改动 CallBoss.js）
 */

// 作用域隔离：所有变量、常量和函数都封装在本 IIFE 内，
// 避免与其他 OpenJS 脚本的全局名称互相覆盖。
(function () {
    "use strict";

    // ---------------------------------------------------------------------------
    // Java / API 类型
    // ---------------------------------------------------------------------------
    var Material = Java.type("org.bukkit.Material");
    var ItemStack = Java.type("org.bukkit.inventory.ItemStack");
    var ChatColor = Java.type("org.bukkit.ChatColor");
    var PersistentDataType = Java.type("org.bukkit.persistence.PersistentDataType");
    var NamespacedKey = Java.type("org.bukkit.NamespacedKey");
    var Class = Java.type("java.lang.Class");
    var UUID = Java.type("java.util.UUID");
    var Bukkit = Java.type("org.bukkit.Bukkit");
    var Location = Java.type("org.bukkit.Location");
    var Vector = Java.type("org.bukkit.util.Vector");
    var Particle = Java.type("org.bukkit.Particle");
    var Sound = Java.type("org.bukkit.Sound");
    var Attribute = Java.type("org.bukkit.attribute.Attribute");
    var BarColor = Java.type("org.bukkit.boss.BarColor");
    var BarStyle = Java.type("org.bukkit.boss.BarStyle");
    var Color = Java.type("org.bukkit.Color");
    var DustOptions = Java.type("org.bukkit.Particle$DustOptions");
    var Transformation = Java.type("org.bukkit.util.Transformation");
    var Vector3f = Java.type("org.joml.Vector3f");
    var Quaternionf = Java.type("org.joml.Quaternionf");
    var Enchantment = Java.type("org.bukkit.enchantments.Enchantment");
    var PotionEffect = Java.type("org.bukkit.potion.PotionEffect");
    var PotionEffectType = Java.type("org.bukkit.potion.PotionEffectType");
    var PlayerClass = Java.type("org.bukkit.entity.Player");
    var ProjectileClass = Java.type("org.bukkit.entity.Projectile");
    var ItemDisplayClass = Class.forName("org.bukkit.entity.ItemDisplay");
    var ItemDisplay$ItemDisplayTransform = Java.type("org.bukkit.entity.ItemDisplay$ItemDisplayTransform");
    var Billboard = Java.type("org.bukkit.entity.Display$Billboard");
    var Brightness = Java.type("org.bukkit.entity.Display$Brightness");
    var WitherSkeletonClass = Class.forName("org.bukkit.entity.WitherSkeleton");
    var ZombieClass = Class.forName("org.bukkit.entity.Zombie");
    var WitherSkullClass = Class.forName("org.bukkit.entity.WitherSkull");

    // ---------------------------------------------------------------------------
    // 数值配置
    // ---------------------------------------------------------------------------
    var BOSS_ID = "first_lich_king";
    var BOSS_NAME = "初代巫妖王";

    // 生命与计分板
    var MAX_HEALTH = 900.0;
    var PHASE_THRESHOLD = 450.0;          // 半血阶段触发线
    var NATIVE_CARRIER_HEALTH = 20.0;     // 本体原生生命固定 20

    // 体形与移动
    var CARRIER_SCALE = 1.15;
    var HEAD_HEIGHT = 2.4 * CARRIER_SCALE; // 凋零骷髅头顶大致高度
    var GROUND_MOVE_SPEED = 0.18;          // 地面追击速度（格 / tick）
    var AIR_MOVE_SPEED = 0.14;             // 升空后追击速度
    var AIR_HOVER_HEIGHT = 3.6;            // 半血后悬浮离地高度
    var KEEP_DISTANCE = 3.0;               // 地面与目标保持的最近距离
    var TARGET_RANGE = 64.0;

    // 普通 / 强化激光
    var ATTACK_INTERVAL_TICKS = 35;
    var LASER_COUNT = 3;
    var LASER_DAMAGE = 10.0;
    var LASER_HIT_RADIUS = 1.9;
    var LASER_TRAVEL_TICKS = 4;
    var ENHANCED_WARNING_TICKS = 10;
    var ENHANCED_LASER_DAMAGE = 35.0;
    var ENHANCED_LASER_HEAL = 20.0;
    var ENHANCED_LASER_HIT_RADIUS = 2.2;
    var NORMAL_ATTACKS_PER_ENHANCED = 3;

    // 死亡之触
    var MELEE_HITS_TO_TOUCH = 3;
    var DEATH_TOUCH_WARNING_TICKS = 5;
    var DEATH_TOUCH_DAMAGE = 25.0;
    var DEATH_TOUCH_WITHER_TICKS = 200;   // 10 秒
    var DEATH_TOUCH_HEAL = 15.0;
    var DEATH_TOUCH_RANGE = 5.0;

    // 亡灵召唤
    var FIRST_SUMMON_DELAY_TICKS = 600;    // 登场 30 秒
    var ZOMBIE_RESUMMON_DELAY_TICKS = 600; // 全灭后 30 秒
    var ZOMBIE_COUNT = 6;
    var ZOMBIE_HEALTH = 20.0;
    var ZOMBIE_RUN_ATTRIBUTE = 0.13;       // 约等于玩家奔跑时的速度属性
    var ZOMBIE_DAMAGE_TAKEN_MULTIPLIER = 0.25; // 受到伤害 -75%
    var ZOMBIE_SPAWN_RADIUS = 3.2;
    var ZOMBIE_TARGET_REFRESH_TICKS = 10;

    // 半血升空与头颅
    var PHASE2_ASCEND_TICKS = 40;
    var SKULL_WARNING_TICKS = 20;
    var SKULL_COUNT = 3;
    var SKULL_SPAWN_HEIGHT = 22.0;
    var SKULL_FALL_SPEED = 1.65;
    var SKULL_LIFE_TICKS = 140;
    var SKULL_EXPLOSION_POWER = 25.0;
    var SKULL_EXPLOSION_BREAK_BLOCKS = true;
    var SKULL_EFFECT_RADIUS = 8.0;
    var SKULL_WITHER_TICKS = 600;          // 30 秒
    var SKULL_RANDOM_RADIUS_MIN = 2.0;
    var SKULL_RANDOM_RADIUS_MAX = 6.5;
    var SKULL_DISPLAY_SCALE = 3.0;

    // 半血强化普攻：脚下法阵
    var CIRCLE_WARNING_TICKS = 5;
    var CIRCLE_DAMAGE = 15.0;
    var CIRCLE_RADIUS = 1.9;

    // 律令死亡
    var DECREE_KNOCKBACKS_REQUIRED = 2;
    var DECREE_DURATION_TICKS = 60;        // 3 秒
    var DECREE_MAX_LOS_DISTANCE = 64.0;

    // 死亡序列
    var DEATH_SEQUENCE_TICKS = 80;

    // 标签 / PDC（全部带 BOSS id 前缀）
    var BOSS_TAG = "first_lich_king_boss";
    var SUMMON_TAG = "first_lich_king_summon";
    var SKULL_TAG = "first_lich_king_skull";
    var SKULL_DISPLAY_TAG = "first_lich_king_skull_display";
    var SKULL_KEY = new NamespacedKey(plugin, "first_lich_king_skull_owner");
    var BOSS_KEY = new NamespacedKey(plugin, "first_lich_king_boss_type");
    var OWNER_KEY = new NamespacedKey(plugin, "first_lich_king_owner");

    var SCOREBOARD_OBJECTIVE = "flk_hp";
    var SCOREBOARD_TEAM_PREFIX = "flk_";

    // 常用粒子颜色
    var BLACK_DUST = new DustOptions(Color.fromRGB(10, 10, 10), 1.25);
    var DARK_PURPLE_DUST = new DustOptions(Color.fromRGB(90, 20, 140), 1.15);
    var WHITE_DUST = new DustOptions(Color.fromRGB(255, 255, 255), 1.0);
    var RED_WARNING_DUST = new DustOptions(Color.fromRGB(255, 40, 40), 1.6);
    var YELLOW_WARNING_DUST = new DustOptions(Color.fromRGB(255, 220, 0), 1.7);

    var STICK_ITEM = new ItemStack(Material.STICK, 1);
    var SKULL_ITEM = new ItemStack(Material.WITHER_SKELETON_SKULL, 1);

    // ---------------------------------------------------------------------------
    // 运行时状态
    // ---------------------------------------------------------------------------
    var activeBosses = {};        // boss uuid -> boss state
    var activeZombies = {};       // zombie uuid -> zombie state
    var trackedLasers = [];       // 普通 / 强化激光状态数组
    var activeCircles = [];       // 半血强化普攻法阵
    var trackedSkulls = {};       // skull uuid -> { proj, display, ownerUuid, life, detonated }
    var activeDecrees = {};       // target uuid -> 律令死亡状态
    var syncDelayedTasks = [];    // 主线程延迟任务
    var globalTick = 0;
    var lastRegistryApi = null;

    // ---------------------------------------------------------------------------
    // 通用工具
    // ---------------------------------------------------------------------------
    function clamp(value, min, max) {
        if (value < min) return min;
        if (value > max) return max;
        return value;
    }

    function randomDouble(min, max) {
        return min + Math.random() * (max - min);
    }

    function toUuidString(entity) {
        try {
            return String(entity.getUniqueId().toString());
        } catch (e) {
            return null;
        }
    }

    function isPlayer(entity) {
        return entity instanceof PlayerClass;
    }

    function isSpectatorPlayer(player) {
        try {
            if (!player || !player.isOnline()) return true;
            var gameMode = player.getGameMode();
            return gameMode != null && String(gameMode.name()) === "SPECTATOR";
        } catch (e) {
            return true;
        }
    }

    function scheduleSync(delayTicks, callback) {
        var delay = Math.max(0, Math.floor(Number(delayTicks) || 0));
        syncDelayedTasks.push({ at: globalTick + delay, fn: callback });
    }

    function processSyncDelayedTasks() {
        if (syncDelayedTasks.length === 0) return;
        var current = syncDelayedTasks;
        var pending = [];
        syncDelayedTasks = pending;
        for (var i = 0; i < current.length; i++) {
            var entry = current[i];
            if (globalTick >= entry.at) {
                try {
                    entry.fn();
                } catch (e) {
                    log.error("FirstLichKing 延迟任务异常：" + e
                            + (e && e.stack ? "\n" + e.stack : ""));
                }
            } else {
                pending.push(entry);
            }
        }
    }

    function getOrRegisterAttribute(entity, attribute) {
        var instance = null;
        try { instance = entity.getAttribute(attribute); } catch (e) { }
        if (instance == null) {
            try { entity.registerAttribute(attribute); } catch (e) { }
            try { instance = entity.getAttribute(attribute); } catch (e) { }
        }
        return instance;
    }

    function groundSurfaceYNear(world, x, z, referenceY) {
        try {
            var blockX = Math.floor(x);
            var blockZ = Math.floor(z);
            var maxHeight = world.getMaxHeight();
            var minHeight = world.getMinHeight();
            var startY = Math.min(maxHeight - 1, Math.floor(referenceY) + 5);
            var endY = Math.max(minHeight, Math.floor(referenceY) - 16);
            for (var y = startY; y >= endY; y--) {
                var block = world.getBlockAt(blockX, y, blockZ);
                if (block.getType().isSolid() && !block.isLiquid()) {
                    return y + 1.0;
                }
            }
        } catch (e) { }
        return referenceY;
    }

    function playSoundAt(location, sound, volume, pitch) {
        try {
            if (!location || !location.getWorld()) return;
            location.getWorld().playSound(location, sound, volume, pitch);
        } catch (e) { }
    }

    function sendActionBar(entity, message) {
        if (!(entity instanceof PlayerClass)) return;
        try { entity.sendActionBar(message); } catch (e) { }
    }

    function sendMessage(entity, message) {
        if (!(entity instanceof PlayerClass)) return;
        try { entity.sendMessage(message); } catch (e) { }
    }

    function sendTitle(entity, title, subtitle, fadeIn, stay, fadeOut) {
        if (!(entity instanceof PlayerClass)) return;
        try { entity.sendTitle(title, subtitle, fadeIn, stay, fadeOut); } catch (e) { }
    }

    function setDisplayTransform(display, scale, spinDegrees) {
        try {
            var radians = (spinDegrees || 0) * Math.PI / 180.0;
            var spin = new Quaternionf().rotationY(radians);
            display.setTransformation(new Transformation(
                    new Vector3f(0, 0, 0),
                    spin,
                    new Vector3f(scale, scale, scale),
                    new Quaternionf()
            ));
        } catch (e) { }
    }

    function isFireOrExplosionDamage(cause) {
        if (cause == null) return false;
        var name = String(cause.name());
        return name === "FIRE"
                || name === "FIRE_TICK"
                || name === "LAVA"
                || name === "HOT_FLOOR"
                || name === "MELTING"
                || name === "ENTITY_EXPLOSION"
                || name === "BLOCK_EXPLOSION"
                || name === "EXPLOSION"
                || name === "LIGHTNING";
    }

    function getBossByEntity(entity) {
        if (!entity) return null;
        try {
            var uuid = toUuidString(entity);
            if (uuid && activeBosses[uuid]) return activeBosses[uuid];
        } catch (e) { }
        try {
            var pdc = entity.getPersistentDataContainer();
            if (pdc != null && pdc.has(OWNER_KEY, PersistentDataType.STRING)) {
                var owner = String(pdc.get(OWNER_KEY, PersistentDataType.STRING));
                if (activeBosses[owner]) return activeBosses[owner];
            }
        } catch (e) { }
        return null;
    }

    function isDouQuQuActive(boss) {
        try {
            if (!boss) return false;
            var api = getShared("DouQuQu");
            return !!(api && api.isActive(BOSS_ID));
        } catch (e) {
            return false;
        }
    }

    function isDisorderDamageSource(entity) {
        try {
            if (!entity) return false;
            var api = getShared("DouQuQu");
            if (!api) return false;
            if (api.isActiveEntity(entity)) return true;
            if (entity instanceof ProjectileClass) {
                var shooter = entity.getShooter();
                if (shooter != null && api.isActiveEntity(shooter)) return true;
            }
        } catch (e) { }
        return false;
    }

    function registerDouQuQuEntity(boss) {
        try {
            var api = getShared("DouQuQu");
            if (!api || !api.isActive(BOSS_ID)) return;
            if (boss && boss.carrier && boss.carrier.isValid()) {
                api.markEntity(BOSS_ID, boss.carrier);
            }
        } catch (e) { }
    }

    function unregisterDouQuQuEntity(boss) {
        try {
            var api = getShared("DouQuQu");
            if (!api || !boss || !boss.carrier) return;
            api.unmarkEntity(boss.carrier);
        } catch (e) { }
    }

    function isBossOwnedEntity(boss, entity) {
        if (!boss || !entity) return true;
        try {
            if (entity === boss.carrier) return true;
            var uuid = toUuidString(entity);
            if (!uuid) return false;
            var zombie = activeZombies[uuid];
            return !!(zombie && String(zombie.bossUuid) === String(boss.uuid));
        } catch (e) {
            return false;
        }
    }

    function isValidTargetForBoss(boss, entity) {
        try {
            if (!boss || !entity) return false;
            if (entity.isDead() || !entity.isValid()) return false;
            if (boss.world && entity.getWorld() !== boss.world) return false;
            if (isBossOwnedEntity(boss, entity)) return false;
            if (String(entity.getType().name()) === "ARMOR_STAND") return false;
            if (entity instanceof PlayerClass) {
                if (isSpectatorPlayer(entity)) return false;
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    function listValidTargets(boss, range) {
        var result = [];
        if (!boss || !boss.world || !boss.carrier) return result;
        var center = boss.carrier.getLocation();
        var maxDistanceSq = range * range;
        try {
            if (isDouQuQuActive(boss)) {
                var iterator = boss.world.getLivingEntities().iterator();
                while (iterator.hasNext()) {
                    var entity = iterator.next();
                    if (!isValidTargetForBoss(boss, entity)) continue;
                    if (entity.getLocation().distanceSquared(center) <= maxDistanceSq) {
                        result.push(entity);
                    }
                }
            } else {
                var players = boss.world.getPlayers();
                for (var i = 0; i < players.size(); i++) {
                    var player = players.get(i);
                    if (!isValidTargetForBoss(boss, player)) continue;
                    if (player.getLocation().distanceSquared(center) <= maxDistanceSq) {
                        result.push(player);
                    }
                }
            }
        } catch (e) { }
        return result;
    }

    function findNearestTarget(boss) {
        var targets = listValidTargets(boss, TARGET_RANGE);
        var best = null;
        var bestDistance = Number.MAX_VALUE;
        for (var i = 0; i < targets.length; i++) {
            try {
                var distance = targets[i].getLocation().distanceSquared(boss.carrier.getLocation());
                if (distance < bestDistance) {
                    bestDistance = distance;
                    best = targets[i];
                }
            } catch (e) { }
        }
        return best;
    }

    function listFarthestTargets(boss, count) {
        var targets = listValidTargets(boss, TARGET_RANGE);
        var decorated = [];
        for (var i = 0; i < targets.length; i++) {
            try {
                decorated.push({
                    entity: targets[i],
                    distance: targets[i].getLocation().distanceSquared(boss.carrier.getLocation())
                });
            } catch (e) { }
        }
        decorated.sort(function (a, b) { return b.distance - a.distance; });
        var result = [];
        for (var j = 0; j < decorated.length && result.length < count; j++) {
            result.push(decorated[j].entity);
        }
        return result;
    }

    function findOnlinePlayerByUuid(uuid) {
        try {
            var players = Bukkit.getOnlinePlayers();
            var iterator = players.iterator();
            while (iterator.hasNext()) {
                var player = iterator.next();
                if (String(player.getUniqueId().toString()) === String(uuid)) return player;
            }
        } catch (e) { }
        return null;
    }

    function findEntityByUuid(world, uuid) {
        try {
            var entity = Bukkit.getEntity(UUID.fromString(String(uuid)));
            if (entity != null && entity.isValid()) return entity;
        } catch (e) { }
        try {
            var entities = world.getEntities();
            for (var i = 0; i < entities.size(); i++) {
                var candidate = entities.get(i);
                if (String(candidate.getUniqueId().toString()) === String(uuid)) return candidate;
            }
        } catch (e) { }
        return null;
    }

    function getTopDamagePlayer(boss) {
        var best = null;
        var bestDamage = 0.0;
        if (!boss) return null;
        for (var uuid in boss.damageByPlayer) {
            if (!boss.damageByPlayer.hasOwnProperty(uuid)) continue;
            var amount = Number(boss.damageByPlayer[uuid]) || 0.0;
            if (amount <= bestDamage) continue;
            var player = findOnlinePlayerByUuid(uuid);
            if (player && isValidTargetForBoss(boss, player)) {
                best = player;
                bestDamage = amount;
            }
        }
        return best;
    }

    function recordPlayerDamage(boss, player, amount) {
        if (!boss || !player || !(amount > 0.0)) return;
        try {
            var uuid = toUuidString(player);
            if (!uuid) return;
            boss.damageByPlayer[uuid] = (Number(boss.damageByPlayer[uuid]) || 0.0) + amount;
        } catch (e) { }
    }

    function drawDustCircle(world, center, radius, yOffset, dust, points) {
        try {
            for (var i = 0; i < points; i++) {
                var angle = (i / points) * Math.PI * 2.0;
                world.spawnParticle(Particle.DUST,
                        center.getX() + Math.cos(angle) * radius,
                        center.getY() + yOffset,
                        center.getZ() + Math.sin(angle) * radius,
                        1, 0.0, 0.0, 0.0, 0.0, dust);
            }
        } catch (e) { }
    }

    function drawParticleLine(world, from, to, dust, includeSmoke) {
        try {
            var diff = to.toVector().subtract(from.toVector());
            var length = diff.length();
            if (length < 0.05) return;
            var direction = diff.clone().normalize();
            var steps = Math.max(1, Math.ceil(length / 0.7));
            for (var i = 0; i <= steps; i++) {
                var distance = Math.min(length, i * 0.7);
                var point = from.clone().add(direction.clone().multiply(distance));
                if (includeSmoke) {
                    world.spawnParticle(Particle.LARGE_SMOKE, point, 1, 0.0, 0.0, 0.0, 0.0);
                }
                world.spawnParticle(Particle.SQUID_INK, point, 1, 0.0, 0.0, 0.0, 0.0);
                if (dust != null) {
                    world.spawnParticle(Particle.DUST, point, 1, 0.0, 0.0, 0.0, 0.0, dust);
                }
            }
        } catch (e) { }
    }

    function getRandomCastOrigin(boss) {
        var base = boss.carrier.getLocation();
        var yaw = base.getYaw() * Math.PI / 180.0;
        var forwardX = -Math.sin(yaw);
        var forwardZ = Math.cos(yaw);
        var rightX = Math.cos(yaw);
        var rightZ = Math.sin(yaw);
        var behind = randomDouble(1.0, 3.0);
        var side = randomDouble(-1.2, 1.2);
        return new Location(boss.world,
                base.getX() - forwardX * behind + rightX * side,
                base.getY() + HEAD_HEIGHT + randomDouble(0.3, 1.8),
                base.getZ() - forwardZ * behind + rightZ * side);
    }

    function getBossHp(boss) {
        if (!boss) return 0.0;
        return Number(boss.hp) || 0.0;
    }

    function bossBarTitle(health) {
        var shown = Math.max(0, Math.round(health));
        return ChatColor.DARK_PURPLE + "" + ChatColor.BOLD + BOSS_NAME + ChatColor.RESET
                + ChatColor.GRAY + "  |  " + ChatColor.WHITE + shown
                + ChatColor.GRAY + " / " + ChatColor.WHITE + Math.round(MAX_HEALTH);
    }

    function syncBossScoreboard(boss) {
        try {
            if (!boss || !boss.objective || !boss.scoreKey || !boss.carrier) return;
            var health = boss.dead ? 0.0 : getBossHp(boss);
            boss.objective.getScore(boss.scoreKey).setScore(Math.round(health));
        } catch (e) { }
    }

    function setBossHp(boss, value) {
        if (!boss) return;
        boss.hp = clamp(Number(value) || 0.0, 0.0, MAX_HEALTH);
        syncBossScoreboard(boss);
        try {
            if (boss.bar && !boss.dead) {
                boss.bar.setProgress(clamp(boss.hp / MAX_HEALTH, 0.0, 1.0));
                boss.bar.setTitle(bossBarTitle(boss.hp));
            }
        } catch (e) { }
    }

    function healBoss(boss, amount) {
        if (!boss || boss.dead || boss.transitioning || !(amount > 0.0)) return;
        var before = getBossHp(boss);
        if (before >= MAX_HEALTH) return;
        setBossHp(boss, Math.min(MAX_HEALTH, before + amount));
        var location = boss.carrier.getLocation();
        try {
            boss.world.spawnParticle(Particle.SOUL, location, 35, 1.0, 1.2, 1.0, 0.04);
            boss.world.spawnParticle(Particle.SOUL_FIRE_FLAME, location, 20, 0.9, 1.0, 0.9, 0.02);
            boss.world.playSound(location, Sound.ITEM_TOTEM_USE, 0.8, 1.5);
        } catch (e) { }
    }

    function createBossBar(uuid) {
        try {
            var compact = String(uuid).split("-").join("");
            var barKey = new NamespacedKey(plugin, (BOSS_ID + "_" + compact).toLowerCase());
            var oldBar = Bukkit.getBossBar(barKey);
            if (oldBar != null) {
                oldBar.removeAll();
                Bukkit.removeBossBar(barKey);
            }
            var bar = Bukkit.createBossBar(barKey, bossBarTitle(MAX_HEALTH),
                    BarColor.PURPLE, BarStyle.SOLID);
            return { bar: bar, barKey: barKey };
        } catch (e) {
            log.warn("FirstLichKing 血条创建失败：" + e);
            return { bar: null, barKey: null };
        }
    }

    function createBossScoreboard(uuid) {
        try {
            var scoreboard = Bukkit.getScoreboardManager().getMainScoreboard();
            var objective = scoreboard.getObjective(SCOREBOARD_OBJECTIVE);
            if (objective == null) {
                try {
                    objective = scoreboard.registerNewObjective(SCOREBOARD_OBJECTIVE, "dummy",
                            ChatColor.DARK_PURPLE + BOSS_NAME);
                } catch (e) {
                    objective = scoreboard.getObjective(SCOREBOARD_OBJECTIVE);
                }
            }
            var compact = String(uuid).split("-").join("");
            var shortId = compact.substring(0, Math.min(12, compact.length));
            var scoreKey = "flk_" + shortId;
            var teamName = "flk_" + shortId;
            var team = scoreboard.getTeam(teamName);
            if (team == null) {
                try { team = scoreboard.registerNewTeam(teamName); }
                catch (e) { team = scoreboard.getTeam(teamName); }
            }
            if (team != null) {
                team.setDisplayName(BOSS_NAME);
                team.setPrefix("");
                try { team.addEntry(String(uuid)); } catch (e) { }
            }
            if (objective != null) {
                objective.getScore(scoreKey).setScore(Math.round(MAX_HEALTH));
            }
            return { objective: objective, scoreKey: scoreKey, team: team };
        } catch (e) {
            log.warn("FirstLichKing 计分板初始化失败：" + e);
            return null;
        }
    }

    function removeBossBar(boss) {
        try {
            if (!boss || !boss.bar) return;
            boss.bar.removeAll();
            if (boss.barKey) Bukkit.removeBossBar(boss.barKey);
        } catch (e) { }
    }

    function removeBossScoreboard(boss) {
        try {
            if (!boss) return;
            if (boss.team) {
                try { boss.team.removeEntry(String(boss.uuid)); } catch (e) { }
                try { boss.team.unregister(); } catch (e) { }
            }
            if (boss.objective && boss.scoreKey) {
                try {
                    var scoreboard = Bukkit.getScoreboardManager().getMainScoreboard();
                    scoreboard.resetScores(boss.scoreKey);
                } catch (e) { }
            }
        } catch (e) { }
    }

    function updateBossBar(boss) {
        if (!boss || boss.dead || !boss.bar) return;
        if (globalTick % 5 !== 0 && !boss.barNeedsUpdate) return;
        boss.barNeedsUpdate = false;
        try {
            boss.bar.setProgress(clamp(getBossHp(boss) / MAX_HEALTH, 0.0, 1.0));
            boss.bar.setTitle(bossBarTitle(getBossHp(boss)));
            var bossLocation = boss.carrier.getLocation();
            var players = boss.world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var player = players.get(i);
                if (!player || player.isDead() || !player.isOnline()) continue;
                var near = player.getLocation().distanceSquared(bossLocation) <= 64.0 * 64.0;
                var has = false;
                try { has = boss.bar.getPlayers().contains(player); } catch (e) { }
                if (near && !has) {
                    try { boss.bar.addPlayer(player); } catch (e) { }
                } else if (!near && has) {
                    try { boss.bar.removePlayer(player); } catch (e) { }
                }
            }
        } catch (e) { }
    }

    function countZombiesForBoss(bossUuid) {
        var count = 0;
        for (var uuid in activeZombies) {
            if (!activeZombies.hasOwnProperty(uuid)) continue;
            var zombie = activeZombies[uuid];
            if (zombie && String(zombie.bossUuid) === String(bossUuid)) count++;
        }
        return count;
    }

    function hasActiveZombieWave(boss) {
        return !!(boss && boss.zombieWaveActive && countZombiesForBoss(boss.uuid) > 0);
    }

    // ---------------------------------------------------------------------------
    // 外观 / 粒子
    // ---------------------------------------------------------------------------
    function spawnAuraParticles(boss) {
        try {
            var base = boss.carrier.getLocation();
            var world = boss.world;
            var phase2 = boss.phase2Triggered === true;
            var haloRadius = phase2 ? 1.0 : 0.85;
            var haloY = base.getY() + HEAD_HEIGHT + 0.15;

            // 头顶旋转的黑色粒子光环
            var haloBase = globalTick * 0.14;
            for (var i = 0; i < 16; i++) {
                var angle = haloBase + (i / 16.0) * Math.PI * 2.0;
                var x = base.getX() + Math.cos(angle) * haloRadius;
                var z = base.getZ() + Math.sin(angle) * haloRadius;
                var y = haloY + Math.sin(angle * 2.0 + globalTick * 0.08) * 0.08;
                world.spawnParticle(Particle.SQUID_INK, x, y, z, 1, 0.0, 0.0, 0.0, 0.0);
                if (i % 2 === 0) {
                    world.spawnParticle(Particle.DUST, x, y, z, 1, 0.0, 0.0, 0.0, 0.0, BLACK_DUST);
                }
            }

            // 身周蓝色火焰粒子光环
            var flameBase = -globalTick * 0.18;
            var points = phase2 ? 18 : 14;
            var radius = phase2 ? 1.45 : 1.25;
            for (var j = 0; j < points; j++) {
                var flameAngle = flameBase + (j / points) * Math.PI * 2.0;
                var flameY = base.getY() + 0.45 + Math.sin(flameAngle * 2.0 + globalTick * 0.1) * 0.65;
                world.spawnParticle(Particle.SOUL_FIRE_FLAME,
                        base.getX() + Math.cos(flameAngle) * radius,
                        flameY,
                        base.getZ() + Math.sin(flameAngle) * radius,
                        1, 0.0, 0.0, 0.0, 0.0);
                if (j % 4 === 0) {
                    world.spawnParticle(Particle.SOUL,
                            base.getX() + Math.cos(flameAngle) * radius,
                            flameY + 0.15,
                            base.getZ() + Math.sin(flameAngle) * radius,
                            1, 0.0, 0.0, 0.0, 0.0);
                }
            }

            // 亡灵护盾：三圈白色粒子环绕
            if (hasActiveZombieWave(boss)) {
                for (var ring = 0; ring < 3; ring++) {
                    drawDustCircle(world, base, 1.35 + ring * 0.12,
                            -0.35 + ring * 0.85, WHITE_DUST, 14);
                }
            }

            // 半血后额外暗紫色灵魂粒子
            if (phase2 && globalTick % 2 === 0) {
                world.spawnParticle(Particle.PORTAL, base.getX(), base.getY() + 1.2,
                        base.getZ(), 8, 1.0, 1.1, 1.0, 0.05);
            }
        } catch (e) { }
    }

    function spawnTransitionParticles(boss) {
        try {
            var center = boss.carrier.getLocation();
            var world = boss.world;
            world.spawnParticle(Particle.SOUL_FIRE_FLAME, center, 35, 1.5, 1.2, 1.5, 0.03);
            world.spawnParticle(Particle.SQUID_INK, center, 45, 1.5, 1.2, 1.5, 0.04);
            if (globalTick % 2 === 0) {
                world.spawnParticle(Particle.END_ROD, center, 18, 1.4, 1.0, 1.4, 0.02);
            }
        } catch (e) { }
    }

    // ---------------------------------------------------------------------------
    // 移动
    // ---------------------------------------------------------------------------
    function faceLocation(boss, location) {
        try {
            var current = boss.carrier.getLocation();
            var dx = location.getX() - current.getX();
            var dz = location.getZ() - current.getZ();
            var yaw = Math.atan2(-dx, dz) * 180.0 / Math.PI;
            boss.carrier.teleport(new Location(boss.world,
                    current.getX(), current.getY(), current.getZ(), yaw, 0));
        } catch (e) { }
    }

    function moveToward(boss, targetX, targetZ, speed) {
        try {
            var location = boss.carrier.getLocation();
            var dx = targetX - location.getX();
            var dz = targetZ - location.getZ();
            var horizontal = Math.sqrt(dx * dx + dz * dz);
            if (horizontal < 0.001) return;
            var newX = location.getX() + (dx / horizontal) * speed;
            var newZ = location.getZ() + (dz / horizontal) * speed;
            var groundY = groundSurfaceYNear(boss.world, newX, newZ, location.getY());
            var targetY = boss.airborne
                    ? groundY + AIR_HOVER_HEIGHT + Math.sin(globalTick / 22.0) * 0.18
                    : groundY;
            var newY = location.getY() + clamp(targetY - location.getY(), -0.4, 0.4);
            boss.carrier.teleport(new Location(boss.world, newX, newY, newZ,
                    location.getYaw(), location.getPitch()));
        } catch (e) { }
    }

    function idleHover(boss) {
        try {
            var location = boss.carrier.getLocation();
            var groundY = groundSurfaceYNear(boss.world, location.getX(), location.getZ(),
                    location.getY());
            var targetY = boss.airborne
                    ? groundY + AIR_HOVER_HEIGHT + Math.sin(globalTick / 22.0) * 0.18
                    : groundY;
            var newY = location.getY() + clamp(targetY - location.getY(), -0.3, 0.3);
            boss.carrier.teleport(new Location(boss.world, location.getX(), newY,
                    location.getZ(), location.getYaw(), location.getPitch()));
        } catch (e) { }
    }

    function updateMovement(boss, target) {
        if (!target) {
            idleHover(boss);
            return;
        }
        try {
            var location = boss.carrier.getLocation();
            var targetLocation = target.getLocation();
            var dx = targetLocation.getX() - location.getX();
            var dz = targetLocation.getZ() - location.getZ();
            var horizontal = Math.sqrt(dx * dx + dz * dz);
            faceLocation(boss, targetLocation);
            if (horizontal < 0.001) return;
            var keepDistance = boss.airborne ? 2.6 : KEEP_DISTANCE;
            var moveSpeed = boss.airborne ? AIR_MOVE_SPEED : GROUND_MOVE_SPEED;
            if (horizontal > keepDistance) {
                moveToward(boss, targetLocation.getX(), targetLocation.getZ(), moveSpeed);
            } else if (horizontal < keepDistance - 1.0) {
                moveToward(boss,
                        location.getX() - dx / horizontal * moveSpeed,
                        location.getZ() - dz / horizontal * moveSpeed,
                        moveSpeed * 0.7);
            } else {
                idleHover(boss);
            }
        } catch (e) { }
    }

    // ---------------------------------------------------------------------------
    // 生命周期
    // ---------------------------------------------------------------------------
    function spawnFirstLichKing(location, player) {
        try {
            if (!location || !location.getWorld()) return false;
            var world = location.getWorld();
            var spawnY = location.getY() + 0.05;
            var spawnLoc = new Location(world, location.getX(), spawnY, location.getZ(), 0, 0);

            var carrier = world.spawn(spawnLoc, WitherSkeletonClass);
            if (!carrier) return false;
            carrier.setAI(false);
            carrier.setSilent(true);
            carrier.setGravity(false);
            carrier.setPersistent(true);
            carrier.setRemoveWhenFarAway(false);
            carrier.setCanPickupItems(false);
            carrier.setCollidable(true);
            try { carrier.setShouldBurnInDay(false); } catch (e) { }
            carrier.setCustomName(ChatColor.DARK_PURPLE + BOSS_NAME);
            carrier.setCustomNameVisible(false);
            carrier.setMaximumNoDamageTicks(0);
            carrier.setNoDamageTicks(0);
            carrier.addScoreboardTag(BOSS_TAG);

            var maxHealthAttribute = getOrRegisterAttribute(carrier, Attribute.MAX_HEALTH);
            if (maxHealthAttribute) maxHealthAttribute.setBaseValue(NATIVE_CARRIER_HEALTH);
            var scaleAttribute = getOrRegisterAttribute(carrier, Attribute.SCALE);
            if (scaleAttribute) scaleAttribute.setBaseValue(CARRIER_SCALE);
            try { carrier.setHealth(NATIVE_CARRIER_HEALTH); } catch (e) { }

            try {
                var equipment = carrier.getEquipment();
                if (equipment != null) {
                    equipment.setItemInMainHand(STICK_ITEM);
                    equipment.setItemInMainHandDropChance(0.0);
                }
            } catch (e) { }

            var uuid = String(carrier.getUniqueId().toString());
            carrier.getPersistentDataContainer().set(OWNER_KEY, PersistentDataType.STRING, uuid);
            carrier.getPersistentDataContainer().set(BOSS_KEY, PersistentDataType.STRING, BOSS_ID);

            var barInfo = createBossBar(uuid);
            var scoreboardInfo = createBossScoreboard(uuid);
            if (barInfo.bar && player) {
                try { barInfo.bar.addPlayer(player); } catch (e) { }
            }

            var boss = {
                id: BOSS_ID,
                uuid: uuid,
                carrier: carrier,
                world: world,
                bar: barInfo.bar,
                barKey: barInfo.barKey,
                barNeedsUpdate: true,
                objective: scoreboardInfo ? scoreboardInfo.objective : null,
                scoreKey: scoreboardInfo ? scoreboardInfo.scoreKey : null,
                team: scoreboardInfo ? scoreboardInfo.team : null,
                hp: MAX_HEALTH,
                maxHealth: MAX_HEALTH,
                spawnTick: globalTick,
                target: null,

                nextAttackTick: globalTick + 40,
                normalAttacksSinceEnhanced: 0,
                nextAttackEnhanced: false,
                enhancedLaser: null,
                meleeHitCount: 0,
                lastMeleePlayerUuid: null,
                deathTouch: null,
                damageByPlayer: {},

                zombieWaveActive: false,
                zombieWaveNumber: 0,
                nextZombieWaveTick: globalTick + FIRST_SUMMON_DELAY_TICKS,

                phase2Triggered: false,
                transitioning: false,
                transitionStartTick: 0,
                transitionEndTick: 0,
                riseStartY: spawnY,
                riseTargetY: spawnY,
                skullWarningsPrepared: false,
                skullWarnings: [],

                airborne: false,
                knockbackCounts: {},
                dead: false,
                deathStartTick: 0,
                deathEndTick: 0,
                deathLocation: null
            };

            activeBosses[uuid] = boss;
            setBossHp(boss, MAX_HEALTH);
            updateBossBar(boss);

            world.playSound(spawnLoc, Sound.ENTITY_WITHER_SPAWN, 1.8, 0.8);
            world.spawnParticle(Particle.SOUL, spawnLoc, 100, 1.2, 1.4, 1.2, 0.04);
            world.spawnParticle(Particle.SOUL_FIRE_FLAME, spawnLoc, 80, 1.0, 1.0, 1.0, 0.03);
            world.spawnParticle(Particle.SQUID_INK, spawnLoc, 80, 1.0, 1.0, 1.0, 0.04);
            world.playSound(spawnLoc, Sound.ENTITY_WITHER_AMBIENT, 1.4, 0.7);

            if (player) {
                player.sendMessage(ChatColor.DARK_PURPLE + "§l" + BOSS_NAME + ChatColor.LIGHT_PURPLE
                        + " 已降临！");
            }
            log.info("FirstLichKing 已生成：" + uuid + " @" + spawnLoc);
            return true;
        } catch (e) {
            log.error("FirstLichKing 生成失败：" + e + (e && e.stack ? "\n" + e.stack : ""));
            try {
                if (typeof uuid !== "undefined" && uuid && activeBosses[uuid]) {
                    cleanupBoss(activeBosses[uuid], uuid);
                } else if (typeof carrier !== "undefined" && carrier && carrier.isValid()) {
                    carrier.remove();
                }
            } catch (cleanupError) { }
            return false;
        }
    }

    function removeZombie(uuid, killed, silent) {
        var zombie = activeZombies[uuid];
        if (!zombie) return;
        var boss = activeBosses[String(zombie.bossUuid)] || null;
        delete activeZombies[uuid];
        try {
            if (zombie.entity) {
                if (killed && !silent) {
                    var location = zombie.entity.getLocation();
                    zombie.entity.getWorld().spawnParticle(Particle.SOUL, location, 35,
                            0.8, 1.0, 0.8, 0.04);
                    zombie.entity.getWorld().spawnParticle(Particle.SQUID_INK, location, 25,
                            0.8, 1.0, 0.8, 0.03);
                    zombie.entity.getWorld().playSound(location, Sound.ENTITY_ZOMBIE_DEATH, 1.0, 1.3);
                }
                if (zombie.entity.isValid() && !zombie.entity.isDead()) {
                    zombie.entity.remove();
                }
            }
        } catch (e) { }
        if (boss && !boss.dead && boss.zombieWaveActive
                && countZombiesForBoss(boss.uuid) === 0) {
            boss.zombieWaveActive = false;
            boss.nextZombieWaveTick = globalTick + ZOMBIE_RESUMMON_DELAY_TICKS;
            if (!silent) {
                announceNearby(boss, 64.0, ChatColor.DARK_PURPLE + "[" + BOSS_NAME + "] "
                        + ChatColor.GRAY + "亡灵仆从全灭，巫妖王的护盾消失了……30 秒后它将再次召唤亡灵。");
            }
        }
    }

    function removeZombiesForBoss(boss, silent) {
        if (!boss) return;
        var toRemove = [];
        for (var uuid in activeZombies) {
            if (!activeZombies.hasOwnProperty(uuid)) continue;
            if (String(activeZombies[uuid].bossUuid) === String(boss.uuid)) toRemove.push(uuid);
        }
        for (var i = 0; i < toRemove.length; i++) {
            removeZombie(toRemove[i], false, silent !== false);
        }
        boss.zombieWaveActive = false;
    }

    function removeCirclesForBoss(boss) {
        if (!boss) return;
        var remaining = [];
        for (var i = 0; i < activeCircles.length; i++) {
            if (String(activeCircles[i].ownerUuid) !== String(boss.uuid)) {
                remaining.push(activeCircles[i]);
            }
        }
        activeCircles = remaining;
    }

    function removeLasersForBoss(boss) {
        if (!boss) return;
        var remaining = [];
        for (var i = 0; i < trackedLasers.length; i++) {
            if (String(trackedLasers[i].ownerUuid) !== String(boss.uuid)) {
                remaining.push(trackedLasers[i]);
            }
        }
        trackedLasers = remaining;
    }

    function removeSkullsForBoss(boss) {
        if (!boss) return;
        var toRemove = [];
        for (var uuid in trackedSkulls) {
            if (!trackedSkulls.hasOwnProperty(uuid)) continue;
            if (String(trackedSkulls[uuid].ownerUuid) === String(boss.uuid)) toRemove.push(uuid);
        }
        for (var i = 0; i < toRemove.length; i++) {
            var entry = trackedSkulls[toRemove[i]];
            delete trackedSkulls[toRemove[i]];
            try { if (entry.display) entry.display.remove(); } catch (e) { }
            try { if (entry.proj) entry.proj.remove(); } catch (e) { }
        }
    }

    function removeDecreesForBoss(boss) {
        if (!boss) return;
        for (var uuid in activeDecrees) {
            if (!activeDecrees.hasOwnProperty(uuid)) continue;
            if (String(activeDecrees[uuid].bossUuid) === String(boss.uuid)) {
                delete activeDecrees[uuid];
            }
        }
    }

    function cleanupBoss(boss, uuid) {
        try {
            unregisterDouQuQuEntity(boss);
            removeBossBar(boss);
            removeBossScoreboard(boss);
            removeZombiesForBoss(boss, true);
            removeCirclesForBoss(boss);
            removeLasersForBoss(boss);
            removeSkullsForBoss(boss);
            removeDecreesForBoss(boss);
            if (boss.carrier) {
                try { boss.carrier.remove(); } catch (e) { }
            }
        } catch (e) {
            log.error("FirstLichKing 清理异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
        delete activeBosses[uuid];
    }

    function announceNearby(boss, range, message) {
        try {
            var location = boss.carrier.getLocation();
            var players = boss.world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var player = players.get(i);
                if (!player || player.isDead() || !player.isOnline()) continue;
                if (player.getLocation().distanceSquared(location) <= range * range) {
                    player.sendMessage(message);
                }
            }
        } catch (e) { }
    }

    function removeTaggedEntities(world, tag) {
        try {
            var entities = world.getEntities();
            var toRemove = [];
            for (var i = 0; i < entities.size(); i++) {
                var entity = entities.get(i);
                try {
                    if (entity.getScoreboardTags().contains(tag)) toRemove.push(entity);
                } catch (e) { }
            }
            for (var j = 0; j < toRemove.length; j++) {
                try { toRemove[j].remove(); } catch (e) { }
            }
        } catch (e) { }
    }

    function cleanupOrphanBossBars() {
        try {
            var toRemove = [];
            var iterator = Bukkit.getBossBars();
            while (iterator.hasNext()) {
                var bar = iterator.next();
                try {
                    var key = bar.getKey();
                    if (key != null && String(key.getKey()).indexOf(BOSS_ID) === 0) {
                        toRemove.push(bar);
                    }
                } catch (e) { }
            }
            for (var i = 0; i < toRemove.length; i++) {
                try {
                    toRemove[i].removeAll();
                    Bukkit.removeBossBar(toRemove[i].getKey());
                } catch (e) { }
            }
        } catch (e) { }
    }

    function cleanupOrphanScoreboard() {
        try {
            var scoreboard = Bukkit.getScoreboardManager().getMainScoreboard();
            var iterator = scoreboard.getTeams().iterator();
            var toRemove = [];
            while (iterator.hasNext()) {
                var team = iterator.next();
                if (String(team.getName()).indexOf(SCOREBOARD_TEAM_PREFIX) === 0) {
                    toRemove.push(team);
                }
            }
            for (var i = 0; i < toRemove.length; i++) {
                try { toRemove[i].unregister(); } catch (e) { }
            }
            var hasActive = false;
            for (var uuid in activeBosses) {
                if (activeBosses.hasOwnProperty(uuid)) { hasActive = true; break; }
            }
            if (!hasActive) {
                var objective = scoreboard.getObjective(SCOREBOARD_OBJECTIVE);
                if (objective != null) {
                    try { objective.unregister(); } catch (e) { }
                }
            }
        } catch (e) { }
    }

    function cleanupOrphans() {
        try {
            var worlds = Bukkit.getWorlds();
            for (var i = 0; i < worlds.size(); i++) {
                var world = worlds.get(i);
                removeTaggedEntities(world, BOSS_TAG);
                removeTaggedEntities(world, SUMMON_TAG);
                removeTaggedEntities(world, SKULL_TAG);
                removeTaggedEntities(world, SKULL_DISPLAY_TAG);
            }
            cleanupOrphanBossBars();
            cleanupOrphanScoreboard();
        } catch (e) {
            log.error("FirstLichKing 清理残留异常：" + e);
        }
    }

    // ---------------------------------------------------------------------------
    // 伤害与死亡之触
    // ---------------------------------------------------------------------------
    function parseAttackSource(event) {
        var info = {
            direct: null,
            causing: null,
            player: null,
            isMelee: false,
            isRanged: false
        };
        try {
            var source = event.getDamageSource();
            if (source != null) {
                info.direct = source.getDirectEntity();
                info.causing = source.getCausingEntity();
            }
        } catch (e) { }
        if (info.direct == null) {
            try { info.direct = event.getDamager(); } catch (e) { }
        }
        if (info.direct instanceof PlayerClass) {
            info.player = info.direct;
            info.isMelee = true;
        } else if (info.causing instanceof PlayerClass) {
            info.player = info.causing;
            info.isRanged = info.direct instanceof ProjectileClass;
            info.isMelee = !info.isRanged;
        } else if (info.direct instanceof ProjectileClass) {
            try {
                var shooter = info.direct.getShooter();
                if (shooter instanceof PlayerClass) {
                    info.player = shooter;
                    info.isRanged = true;
                }
            } catch (e) { }
        } else if (info.causing instanceof ProjectileClass) {
            try {
                var shooter2 = info.causing.getShooter();
                if (shooter2 instanceof PlayerClass) {
                    info.player = shooter2;
                    info.isRanged = true;
                }
            } catch (e) { }
        }
        return info;
    }

    function registerMeleeHit(boss, player) {
        if (!boss || boss.dead || boss.transitioning || !player) return;
        if (boss.deathTouch) return;
        boss.meleeHitCount++;
        boss.lastMeleePlayerUuid = toUuidString(player);
        if (boss.meleeHitCount >= MELEE_HITS_TO_TOUCH) {
            boss.meleeHitCount = 0;
            startDeathTouch(boss, player);
        }
    }

    function applyBossDamage(boss, rawAmount, attackerPlayer, isMelee, isRanged) {
        if (!boss || boss.dead || boss.transitioning) return false;
        if (!(rawAmount > 0.0)) return false;
        if (isRanged && hasActiveZombieWave(boss)) return false;

        var amount = rawAmount;
        if (hasActiveZombieWave(boss)) {
            amount *= ZOMBIE_DAMAGE_TAKEN_MULTIPLIER;
        }
        if (!(amount > 0.0)) return false;

        if (isMelee && attackerPlayer) registerMeleeHit(boss, attackerPlayer);

        var oldHp = getBossHp(boss);
        var newHp = oldHp - amount;
        var applied = amount;
        if (!boss.phase2Triggered && newHp <= PHASE_THRESHOLD) {
            newHp = PHASE_THRESHOLD;
            applied = Math.max(0.0, oldHp - newHp);
        }

        if (attackerPlayer && applied > 0.0) {
            recordPlayerDamage(boss, attackerPlayer, applied);
        }

        if (newHp <= 0.0 && boss.phase2Triggered) {
            setBossHp(boss, 0.0);
            try { boss.barNeedsUpdate = true; } catch (e) { }
            try { boss.carrier.setHealth(0.0); } catch (e) { }
            return true;
        }

        setBossHp(boss, newHp);
        boss.barNeedsUpdate = true;
        try {
            boss.world.playSound(boss.carrier.getLocation(), Sound.ENTITY_WITHER_HURT, 0.8, 1.1);
        } catch (e) { }
        if (!boss.phase2Triggered && getBossHp(boss) <= PHASE_THRESHOLD) {
            startPhaseTransition(boss);
        }
        return false;
    }

    function startDeathTouch(boss, preferredTarget) {
        if (!boss || boss.dead || boss.transitioning || boss.deathTouch) return;
        var target = preferredTarget;
        if (!target || !isValidTargetForBoss(boss, target)) {
            target = findNearestTarget(boss);
        }
        if (!target) return;
        boss.deathTouch = {
            startTick: globalTick,
            endTick: globalTick + DEATH_TOUCH_WARNING_TICKS,
            targetUuid: toUuidString(target)
        };
        var location = boss.carrier.getLocation();
        playSoundAt(location, Sound.ENTITY_WITHER_SKELETON_AMBIENT, 1.2, 0.8);
        sendActionBar(target, ChatColor.YELLOW + "巫妖王正在发动死亡之触！");
    }

    function updateDeathTouch(boss) {
        if (!boss.deathTouch) return;
        var touch = boss.deathTouch;
        try {
            var location = boss.carrier.getLocation();
            var target = null;
            if (touch.targetUuid) target = findEntityByUuid(boss.world, touch.targetUuid);
            if (!target || !isValidTargetForBoss(boss, target)) target = findNearestTarget(boss);

            // 5 tick 黄色粒子前摇
            drawDustCircle(boss.world, location, 1.6, 0.1, YELLOW_WARNING_DUST, 14);
            drawDustCircle(boss.world, location, 1.0, 1.0, YELLOW_WARNING_DUST, 10);
            if (target && globalTick % 2 === 0) {
                drawParticleLine(boss.world, location.clone().add(0, 1.2, 0),
                        target.getLocation().clone().add(0, 1.0, 0), YELLOW_WARNING_DUST, false);
            }
        } catch (e) { }

        if (globalTick < touch.endTick) return;

        boss.deathTouch = null;
        try {
            var target2 = touch.targetUuid
                    ? findEntityByUuid(boss.world, touch.targetUuid) : null;
            if (!target2 || !isValidTargetForBoss(boss, target2)) target2 = findNearestTarget(boss);
            var hit = false;
            if (target2) {
                var distance = boss.carrier.getLocation().distance(target2.getLocation());
                if (distance <= DEATH_TOUCH_RANGE) {
                    hit = true;
                    try { target2.damage(DEATH_TOUCH_DAMAGE, boss.carrier); } catch (e) { }
                    try {
                        target2.addPotionEffect(new PotionEffect(PotionEffectType.WITHER,
                                DEATH_TOUCH_WITHER_TICKS, 0, false, true, true));
                    } catch (e) { }
                    boss.world.playSound(boss.carrier.getLocation(),
                            Sound.ENTITY_WITHER_SHOOT, 1.2, 0.8);
                    boss.world.spawnParticle(Particle.SQUID_INK,
                            target2.getLocation().clone().add(0, 1.0, 0), 35,
                            0.7, 0.9, 0.7, 0.05);
                }
            }
            if (hit) {
                healBoss(boss, DEATH_TOUCH_HEAL);
            } else {
                boss.world.playSound(boss.carrier.getLocation(),
                        Sound.ENTITY_PLAYER_ATTACK_SWEEP, 1.0, 0.7);
            }
        } catch (e) {
            log.error("FirstLichKing 死亡之触异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    // ---------------------------------------------------------------------------
    // 普通激光 / 强化激光 / 法阵
    // ---------------------------------------------------------------------------
    function fireBasicLasers(boss) {
        var targets = listFarthestTargets(boss, LASER_COUNT);
        if (targets.length === 0) return;
        for (var i = 0; i < LASER_COUNT; i++) {
            var target = targets[i % targets.length];
            if (!target || !isValidTargetForBoss(boss, target)) continue;
            var origin = getRandomCastOrigin(boss);
            var targetPoint = target.getLocation().clone().add(0, 1.0, 0);
            trackedLasers.push({
                ownerUuid: boss.uuid,
                kind: "basic",
                origin: origin,
                targetUuid: toUuidString(target),
                targetPoint: targetPoint,
                startTick: globalTick,
                maxTicks: LASER_TRAVEL_TICKS,
                damage: LASER_DAMAGE,
                heal: 0.0,
                hitRadius: LASER_HIT_RADIUS
            });
        }
        playSoundAt(boss.carrier.getLocation(), Sound.ENTITY_WITHER_SHOOT, 1.3, 1.2);
    }

    function startEnhancedLaser(boss) {
        var targets = listFarthestTargets(boss, 1);
        if (targets.length === 0) return;
        var target = targets[0];
        var targetPoint = target.getLocation().clone().add(0, 1.0, 0);
        boss.enhancedLaser = {
            startTick: globalTick,
            fireTick: globalTick + ENHANCED_WARNING_TICKS + 1,
            origin: getRandomCastOrigin(boss),
            targetUuid: toUuidString(target),
            targetPoint: targetPoint
        };
        sendActionBar(target, ChatColor.RED + "红色预警：强化激光即将命中此处！");
        playSoundAt(boss.carrier.getLocation(), Sound.BLOCK_BEACON_ACTIVATE, 1.2, 0.8);
    }

    function updateEnhancedLaser(boss) {
        if (!boss.enhancedLaser) return;
        var warning = boss.enhancedLaser;
        try {
            if (globalTick >= warning.fireTick) {
                boss.enhancedLaser = null;
                trackedLasers.push({
                    ownerUuid: boss.uuid,
                    kind: "enhanced",
                    origin: warning.origin,
                    targetUuid: warning.targetUuid,
                    targetPoint: warning.targetPoint,
                    startTick: globalTick,
                    maxTicks: 3,
                    damage: ENHANCED_LASER_DAMAGE,
                    heal: ENHANCED_LASER_HEAL,
                    hitRadius: ENHANCED_LASER_HIT_RADIUS
                });
                playSoundAt(warning.origin, Sound.ENTITY_WITHER_SHOOT, 1.6, 0.9);
                try {
                    boss.world.spawnParticle(Particle.FLASH, warning.targetPoint, 1,
                            0.0, 0.0, 0.0, 0.0);
                } catch (e) { }
                return;
            }

            // 10 tick 红色粒子预警：从施法点连到落点，并在落点画圈
            drawParticleLine(boss.world, warning.origin, warning.targetPoint,
                    RED_WARNING_DUST, true);
            drawDustCircle(boss.world, warning.targetPoint, 1.8, 0.15,
                    RED_WARNING_DUST, 18);
            drawDustCircle(boss.world, warning.targetPoint, 1.1, 0.9,
                    RED_WARNING_DUST, 12);
            if (globalTick % 4 === 0) {
                playSoundAt(warning.targetPoint, Sound.BLOCK_BEACON_AMBIENT, 0.7, 1.4);
            }
        } catch (e) { }
    }

    function updateTrackedLasers() {
        for (var i = trackedLasers.length - 1; i >= 0; i--) {
            var laser = trackedLasers[i];
            try {
                var elapsed = globalTick - laser.startTick;
                var progress = laser.maxTicks <= 0 ? 1.0
                        : clamp(elapsed / laser.maxTicks, 0.0, 1.0);
                var head = laser.origin.clone().add(
                        laser.targetPoint.toVector().subtract(laser.origin.toVector())
                                .multiply(progress));
                drawParticleLine(laser.origin.getWorld(), laser.origin, head,
                        laser.kind === "enhanced" ? DARK_PURPLE_DUST : BLACK_DUST, true);
                try {
                    laser.origin.getWorld().spawnParticle(Particle.SQUID_INK, head, 6,
                            0.2, 0.2, 0.2, 0.02);
                } catch (e) { }

                if (progress < 1.0) continue;
                trackedLasers.splice(i, 1);
                var target = laser.targetUuid
                        ? findEntityByUuid(laser.origin.getWorld(), laser.targetUuid) : null;
                var hit = false;
                if (target && isValidTargetForBoss(activeBosses[laser.ownerUuid],
                        target)) {
                    if (target.getLocation().distanceSquared(laser.targetPoint)
                            <= laser.hitRadius * laser.hitRadius) {
                        hit = true;
                        try { target.damage(laser.damage, activeBosses[laser.ownerUuid].carrier); }
                        catch (e) { }
                    }
                }
                try {
                    laser.origin.getWorld().spawnParticle(Particle.SQUID_INK,
                            laser.targetPoint, 45, 1.0, 1.0, 1.0, 0.05);
                    laser.origin.getWorld().spawnParticle(Particle.LARGE_SMOKE,
                            laser.targetPoint, 25, 0.8, 0.8, 0.8, 0.03);
                } catch (e) { }
                if (hit && laser.heal > 0.0) {
                    healBoss(activeBosses[laser.ownerUuid], laser.heal);
                }
            } catch (e) {
                trackedLasers.splice(i, 1);
            }
        }
    }

    function castGroundCircles(boss) {
        var targets = listValidTargets(boss, TARGET_RANGE);
        if (targets.length === 0) return;
        for (var i = 0; i < targets.length; i++) {
            var target = targets[i];
            var location = target.getLocation().clone();
            activeCircles.push({
                ownerUuid: boss.uuid,
                targetUuid: toUuidString(target),
                location: location,
                startTick: globalTick,
                detonateTick: globalTick + CIRCLE_WARNING_TICKS,
                damage: CIRCLE_DAMAGE,
                radius: CIRCLE_RADIUS
            });
            sendActionBar(target, ChatColor.YELLOW + "脚下出现黑色法阵，5 tick 后爆发！");
        }
        playSoundAt(boss.carrier.getLocation(), Sound.ENTITY_EVOKER_PREPARE_ATTACK, 1.4, 0.8);
    }

    function updateGroundCircles() {
        for (var i = activeCircles.length - 1; i >= 0; i--) {
            var circle = activeCircles[i];
            try {
                var world = circle.location.getWorld();
                drawDustCircle(world, circle.location, circle.radius, 0.12, BLACK_DUST, 18);
                drawDustCircle(world, circle.location, circle.radius * 0.65, 0.12,
                        DARK_PURPLE_DUST, 12);
                drawDustCircle(world, circle.location, circle.radius + 0.25, 0.25,
                        YELLOW_WARNING_DUST, 18);
                if (globalTick < circle.detonateTick) continue;
                activeCircles.splice(i, 1);
                var boss = activeBosses[String(circle.ownerUuid)] || null;
                world.spawnParticle(Particle.SQUID_INK,
                        circle.location.clone().add(0, 0.3, 0), 60, 1.2, 0.5, 1.2, 0.06);
                world.spawnParticle(Particle.LARGE_SMOKE,
                        circle.location.clone().add(0, 0.3, 0), 30, 1.0, 0.4, 1.0, 0.03);
                world.playSound(circle.location, Sound.ENTITY_WITHER_SHOOT, 1.2, 1.4);
                var targets = listValidTargets(boss, TARGET_RANGE);
                for (var j = 0; j < targets.length; j++) {
                    var target = targets[j];
                    if (target.getLocation().distanceSquared(circle.location)
                            <= circle.radius * circle.radius) {
                        try {
                            if (boss && boss.carrier) {
                                target.damage(circle.damage, boss.carrier);
                            } else {
                                target.damage(circle.damage);
                            }
                        } catch (e) {
                            try { target.damage(circle.damage); } catch (e2) { }
                        }
                    }
                }
            } catch (e) {
                activeCircles.splice(i, 1);
            }
        }
    }

    // ---------------------------------------------------------------------------
    // 亡灵召唤
    // ---------------------------------------------------------------------------
    function createArmorPiece(material, protectionLevel) {
        var item = new ItemStack(material, 1);
        if (protectionLevel > 0) {
            try {
                var meta = item.getItemMeta();
                if (meta != null) {
                    meta.addEnchant(Enchantment.PROTECTION, protectionLevel, true);
                    item.setItemMeta(meta);
                }
            } catch (e) { }
        }
        return item;
    }

    function setupZombieEquipment(zombie, phase2) {
        try {
            var equipment = zombie.getEquipment();
            if (!equipment) return;
            var protection = phase2 ? 2 : 0;
            equipment.setHelmet(createArmorPiece(Material.IRON_HELMET, protection));
            equipment.setChestplate(createArmorPiece(Material.IRON_CHESTPLATE, protection));
            equipment.setLeggings(createArmorPiece(Material.IRON_LEGGINGS, protection));
            equipment.setBoots(createArmorPiece(Material.IRON_BOOTS, protection));
            equipment.setItemInMainHand(new ItemStack(Material.IRON_SWORD, 1));
            equipment.setHelmetDropChance(0.0);
            equipment.setChestplateDropChance(0.0);
            equipment.setLeggingsDropChance(0.0);
            equipment.setBootsDropChance(0.0);
            equipment.setItemInMainHandDropChance(0.0);
        } catch (e) { }
    }

    function summonZombieWave(boss) {
        if (!boss || boss.dead) return;
        var world = boss.world;
        var phase2 = boss.phase2Triggered === true;
        boss.zombieWaveActive = true;
        boss.zombieWaveNumber++;
        var target = getTopDamagePlayer(boss);
        if (!target) target = findNearestTarget(boss);
        var spawned = 0;
        var base = boss.carrier.getLocation();

        for (var i = 0; i < ZOMBIE_COUNT; i++) {
            try {
                var angle = (Math.PI * 2.0 * i / ZOMBIE_COUNT) + randomDouble(-0.25, 0.25);
                var radius = ZOMBIE_SPAWN_RADIUS + randomDouble(-0.5, 0.8);
                var x = base.getX() + Math.cos(angle) * radius;
                var z = base.getZ() + Math.sin(angle) * radius;
                var y = groundSurfaceYNear(world, x, z, base.getY()) + 0.05;
                var zombie = world.spawn(new Location(world, x, y, z, 0, 0), ZombieClass);
                if (!zombie) continue;

                zombie.setAI(true);
                zombie.setSilent(false);
                zombie.setPersistent(true);
                zombie.setRemoveWhenFarAway(false);
                zombie.setCanPickupItems(false);
                zombie.setCollidable(true);
                try { zombie.setShouldBurnInDay(false); } catch (e) { }
                zombie.setCustomName(ChatColor.DARK_GRAY + "巫妖王的亡灵");
                zombie.setCustomNameVisible(false);
                zombie.setMaximumNoDamageTicks(0);
                zombie.setNoDamageTicks(0);
                zombie.addScoreboardTag(SUMMON_TAG);

                var maxHealthAttribute = getOrRegisterAttribute(zombie, Attribute.MAX_HEALTH);
                if (maxHealthAttribute) maxHealthAttribute.setBaseValue(ZOMBIE_HEALTH);
                var moveSpeedAttribute = getOrRegisterAttribute(zombie, Attribute.MOVEMENT_SPEED);
                if (moveSpeedAttribute) moveSpeedAttribute.setBaseValue(ZOMBIE_RUN_ATTRIBUTE);
                var followRangeAttribute = getOrRegisterAttribute(zombie, Attribute.FOLLOW_RANGE);
                if (followRangeAttribute) followRangeAttribute.setBaseValue(TARGET_RANGE);
                try { zombie.setHealth(ZOMBIE_HEALTH); } catch (e) { }

                setupZombieEquipment(zombie, phase2);
                try { zombie.setGlowing(true); } catch (e) { }

                if (phase2) {
                    try {
                        zombie.addPotionEffect(new PotionEffect(PotionEffectType.STRENGTH,
                                3600 * 20, 2, false, false, true));
                        zombie.addPotionEffect(new PotionEffect(PotionEffectType.SPEED,
                                3600 * 20, 2, false, false, true));
                    } catch (e) { }
                }

                var zombieUuid = String(zombie.getUniqueId().toString());
                activeZombies[zombieUuid] = {
                    entity: zombie,
                    bossUuid: boss.uuid,
                    waveNumber: boss.zombieWaveNumber,
                    spawnTick: globalTick,
                    lastTargetRefreshTick: -100
                };
                if (target && isValidTargetForBoss(boss, target)) {
                    try { zombie.setTarget(target); } catch (e) { }
                }
                spawned++;
            } catch (e) {
                log.error("FirstLichKing 召唤亡灵异常：" + e);
            }
        }

        if (spawned === 0) {
            boss.zombieWaveActive = false;
            boss.nextZombieWaveTick = globalTick + 200;
            return;
        }

        boss.zombieWaveActive = true;
        world.playSound(base, Sound.ENTITY_WITHER_SPAWN, 1.4, 1.3);
        world.spawnParticle(Particle.SOUL, base, 60, 2.0, 1.4, 2.0, 0.05);
        world.spawnParticle(Particle.SQUID_INK, base, 45, 2.0, 1.2, 2.0, 0.04);
        announceNearby(boss, 64.0, ChatColor.DARK_PURPLE + "[" + BOSS_NAME + "] "
                + ChatColor.DARK_GRAY + "亡灵大军响应召唤！击杀全部僵尸才能解除巫妖王的护盾。");
    }

    function updateZombies() {
        for (var uuid in activeZombies) {
            if (!activeZombies.hasOwnProperty(uuid)) continue;
            var zombie = activeZombies[uuid];
            try {
                var entity = zombie.entity;
                if (!entity || !entity.isValid() || entity.isDead()) {
                    removeZombie(uuid, false, false);
                    continue;
                }
                var boss = activeBosses[String(zombie.bossUuid)] || null;
                if (!boss || boss.dead) {
                    removeZombie(uuid, false, true);
                    continue;
                }
                if (globalTick - zombie.lastTargetRefreshTick
                        < ZOMBIE_TARGET_REFRESH_TICKS) continue;
                zombie.lastTargetRefreshTick = globalTick;
                var target = getTopDamagePlayer(boss);
                if (!target) target = findNearestTarget(boss);
                if (target && isValidTargetForBoss(boss, target)) {
                    try { entity.setTarget(target); } catch (e) { }
                }
            } catch (e) {
                removeZombie(uuid, false, true);
            }
        }
    }

    function updateZombieWave(boss) {
        if (!boss || boss.dead) return;
        if (!boss.zombieWaveActive) {
            if (globalTick >= boss.nextZombieWaveTick) summonZombieWave(boss);
            return;
        }
        if (countZombiesForBoss(boss.uuid) === 0) {
            boss.zombieWaveActive = false;
            boss.nextZombieWaveTick = globalTick + ZOMBIE_RESUMMON_DELAY_TICKS;
            announceNearby(boss, 64.0, ChatColor.DARK_PURPLE + "[" + BOSS_NAME + "] "
                    + ChatColor.GRAY + "亡灵仆从全灭，护盾消失；30 秒后它将再次召唤亡灵。");
        }
    }

    // ---------------------------------------------------------------------------
    // 半血升空 / 巨大凋零骷髅头颅
    // ---------------------------------------------------------------------------
    function startPhaseTransition(boss) {
        if (!boss || boss.dead || boss.phase2Triggered) return;
        boss.phase2Triggered = true;
        boss.transitioning = true;
        boss.transitionStartTick = globalTick;
        boss.transitionEndTick = globalTick + PHASE2_ASCEND_TICKS + SKULL_WARNING_TICKS + 1;
        boss.airborne = true;
        boss.riseStartY = boss.carrier.getLocation().getY();
        boss.riseTargetY = groundSurfaceYNear(boss.world,
                boss.carrier.getLocation().getX(), boss.carrier.getLocation().getZ(),
                boss.carrier.getLocation().getY()) + AIR_HOVER_HEIGHT;
        boss.nextAttackTick = boss.transitionEndTick + 30;
        boss.enhancedLaser = null;
        boss.deathTouch = null;
        boss.skullWarnings = [];
        boss.skullWarningsPrepared = false;
        try { boss.carrier.setInvulnerable(true); } catch (e) { }
        try {
            if (boss.bar) {
                boss.bar.setTitle(ChatColor.DARK_PURPLE + "" + ChatColor.BOLD + BOSS_NAME
                        + ChatColor.GRAY + "  |  " + ChatColor.RED + "升空觉醒中...");
                boss.bar.setColor(BarColor.BLUE);
            }
        } catch (e) { }

        var location = boss.carrier.getLocation();
        playSoundAt(location, Sound.ENTITY_WITHER_SPAWN, 2.0, 0.6);
        playSoundAt(location, Sound.ENTITY_LIGHTNING_BOLT_THUNDER, 1.2, 1.2);
        announceNearby(boss, 64.0, ChatColor.DARK_PURPLE + "[" + BOSS_NAME + "] "
                + ChatColor.RED + "损失一半生命值，巫妖王升入空中获得短暂无敌！");
        var players = boss.world.getPlayers();
        for (var i = 0; i < players.size(); i++) {
            var player = players.get(i);
            if (player.getLocation().distanceSquared(location) <= 64.0 * 64.0) {
                sendTitle(player, ChatColor.DARK_PURPLE + "初 代 巫 妖 王",
                        ChatColor.RED + "升空觉醒 · 短暂无敌", 5, 45, 10);
            }
        }
        log.info("FirstLichKing 进入半血升空阶段。");
    }

    function makeLandingLocation(world, x, z, referenceY) {
        return new Location(world, x, groundSurfaceYNear(world, x, z, referenceY) + 0.05, z);
    }

    function prepareSkullWarnings(boss) {
        var world = boss.world;
        var target = getTopDamagePlayer(boss);
        if (!target) target = findNearestTarget(boss);
        var landings = [];
        if (target) {
            var base = target.getLocation();
            landings.push(makeLandingLocation(world, base.getX(), base.getZ(), base.getY()));
            var offsetBaseAngle = Math.random() * Math.PI * 2.0;
            for (var i = 0; i < SKULL_COUNT - 1; i++) {
                var angle = offsetBaseAngle + (Math.PI * 2.0 * i / (SKULL_COUNT - 1))
                        + randomDouble(-0.4, 0.4);
                var radius = randomDouble(SKULL_RANDOM_RADIUS_MIN, SKULL_RANDOM_RADIUS_MAX);
                landings.push(makeLandingLocation(world,
                        base.getX() + Math.cos(angle) * radius,
                        base.getZ() + Math.sin(angle) * radius, base.getY()));
            }
            sendTitle(target, ChatColor.DARK_RED + "天 降 颅 骨",
                    ChatColor.RED + "注意脚下红色落点预警！", 5, 35, 10);
        } else {
            var center = boss.carrier.getLocation();
            for (var j = 0; j < SKULL_COUNT; j++) {
                var randomAngle = Math.random() * Math.PI * 2.0;
                var randomRadius = randomDouble(2.0, 6.0);
                landings.push(makeLandingLocation(world,
                        center.getX() + Math.cos(randomAngle) * randomRadius,
                        center.getZ() + Math.sin(randomAngle) * randomRadius, center.getY()));
            }
        }
        boss.skullWarnings = landings;
        boss.skullWarningsPrepared = true;
    }

    function drawSkullWarning(boss) {
        for (var i = 0; i < boss.skullWarnings.length; i++) {
            var landing = boss.skullWarnings[i];
            drawDustCircle(boss.world, landing, 1.8, 0.1, RED_WARNING_DUST, 22);
            drawDustCircle(boss.world, landing, 1.0, 0.1, RED_WARNING_DUST, 12);
            try {
                boss.world.spawnParticle(Particle.SMOKE, landing.clone().add(0, 0.4, 0),
                        2, 0.2, 0.2, 0.2, 0.01);
            } catch (e) { }
        }
    }

    function createSkullDisplay(world, location) {
        try {
            var display = world.spawn(location, ItemDisplayClass);
            if (!display) return null;
            try { display.setItemStack(SKULL_ITEM); } catch (e) { }
            try {
                display.setItemDisplayTransform(ItemDisplay$ItemDisplayTransform.NONE);
            } catch (e) { }
            setDisplayTransform(display, SKULL_DISPLAY_SCALE, 0);
            display.setRotation(0, 0);
            display.setInterpolationDuration(2);
            display.setInterpolationDelay(0);
            display.setTeleportDuration(2);
            display.setBillboard(Billboard.FIXED);
            try { display.setBrightness(new Brightness(15, 15)); } catch (e) { }
            display.setViewRange(3.0);
            display.setShadowRadius(1.2);
            display.setShadowStrength(0.7);
            display.setPersistent(true);
            display.setInvulnerable(true);
            display.setSilent(true);
            display.addScoreboardTag(SKULL_DISPLAY_TAG);
            return display;
        } catch (e) {
            return null;
        }
    }

    function spawnSkullsFromWarnings(boss) {
        for (var i = 0; i < boss.skullWarnings.length; i++) {
            var landing = boss.skullWarnings[i];
            try {
                var spawnY = Math.min(boss.world.getMaxHeight() - 2.0,
                        landing.getY() + SKULL_SPAWN_HEIGHT);
                var spawnLoc = new Location(boss.world, landing.getX(), spawnY, landing.getZ());
                var skull = boss.world.spawn(spawnLoc, WitherSkullClass);
                if (!skull) continue;
                try { skull.setShooter(boss.carrier); } catch (e) { }
                try { skull.setDirection(new Vector(0, -1, 0)); } catch (e) { }
                try { skull.setVelocity(new Vector(0, -SKULL_FALL_SPEED, 0)); } catch (e) { }
                try { skull.setYield(0.0); } catch (e) { }
                try { skull.setIsIncendiary(false); } catch (e) { }
                skull.addScoreboardTag(SKULL_TAG);
                skull.getPersistentDataContainer().set(SKULL_KEY,
                        PersistentDataType.STRING, boss.uuid);
                var uuid = String(skull.getUniqueId().toString());
                var display = createSkullDisplay(boss.world, spawnLoc);
                trackedSkulls[uuid] = {
                    proj: skull,
                    display: display,
                    ownerUuid: boss.uuid,
                    landing: landing.clone(),
                    lastLocation: spawnLoc.clone(),
                    life: SKULL_LIFE_TICKS,
                    detonated: false
                };
            } catch (e) {
                log.error("FirstLichKing 生成骷髅头颅异常：" + e);
            }
        }
        boss.skullWarnings = [];
        playSoundAt(boss.carrier.getLocation(), Sound.ENTITY_WITHER_SHOOT, 2.0, 0.6);
    }

    function detonateSkull(entry, location) {
        if (!entry || entry.detonated) return;
        entry.detonated = true;
        try {
            var world = location.getWorld();
            world.spawnParticle(Particle.EXPLOSION_EMITTER, location, 3, 2.0, 2.0, 2.0, 0.0);
            world.spawnParticle(Particle.SQUID_INK, location, 160, 4.0, 3.0, 4.0, 0.08);
            world.spawnParticle(Particle.SOUL_FIRE_FLAME, location, 80, 3.5, 2.5, 3.5, 0.06);
            world.playSound(location, Sound.ENTITY_GENERIC_EXPLODE, 2.2, 0.8);
            world.playSound(location, Sound.ENTITY_WITHER_DEATH, 1.5, 1.1);

            // 契约要求：5 参数形式补 null Entity，避免 Nashorn 重载歧义。
            world.createExplosion(location, SKULL_EXPLOSION_POWER, false,
                    SKULL_EXPLOSION_BREAK_BLOCKS, null);

            var players = world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var player = players.get(i);
                if (!player || player.isDead() || !player.isOnline()) continue;
                if (player.getLocation().distanceSquared(location)
                        <= SKULL_EFFECT_RADIUS * SKULL_EFFECT_RADIUS) {
                    try {
                        player.addPotionEffect(new PotionEffect(PotionEffectType.WITHER,
                                SKULL_WITHER_TICKS, 0, false, true, true));
                    } catch (e) { }
                }
            }
        } catch (e) {
            log.error("FirstLichKing 头颅爆炸异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
        try { if (entry.display) entry.display.remove(); } catch (e) { }
    }

    function updateTrackedSkulls() {
        for (var uuid in trackedSkulls) {
            if (!trackedSkulls.hasOwnProperty(uuid)) continue;
            var entry = trackedSkulls[uuid];
            try {
                var proj = entry.proj;
                if (!proj || !proj.isValid() || proj.isDead()) {
                    delete trackedSkulls[uuid];
                    detonateSkull(entry, entry.lastLocation.clone());
                    continue;
                }
                var location = proj.getLocation().clone();
                entry.lastLocation = location.clone();
                if (entry.display && entry.display.isValid()) {
                    entry.display.teleport(location.clone().add(0, 0.2, 0));
                    entry.display.setRotation((globalTick * 18.0) % 360.0, 0);
                }
                var world = location.getWorld();
                world.spawnParticle(Particle.SQUID_INK, location, 10, 0.5, 0.5, 0.5, 0.02);
                world.spawnParticle(Particle.SOUL_FIRE_FLAME, location, 6, 0.4, 0.4, 0.4, 0.01);
                entry.life--;
                if (entry.life <= 0) {
                    delete trackedSkulls[uuid];
                    detonateSkull(entry, location);
                }
            } catch (e) {
                delete trackedSkulls[uuid];
            }
        }
    }

    function updatePhaseTransition(boss) {
        var elapsed = globalTick - boss.transitionStartTick;
        try {
            var location = boss.carrier.getLocation();
            if (elapsed <= PHASE2_ASCEND_TICKS) {
                var progress = clamp(elapsed / PHASE2_ASCEND_TICKS, 0.0, 1.0);
                var newY = boss.riseStartY + (boss.riseTargetY - boss.riseStartY) * progress;
                boss.carrier.teleport(new Location(boss.world, location.getX(), newY,
                        location.getZ(), location.getYaw(), location.getPitch()));
                spawnTransitionParticles(boss);
                return;
            }

            if (!boss.skullWarningsPrepared) {
                prepareSkullWarnings(boss);
                playSoundAt(location, Sound.ENTITY_WITHER_AMBIENT, 1.8, 0.6);
            }
            drawSkullWarning(boss);
            idleHover(boss);
            if (globalTick >= boss.transitionEndTick) {
                spawnSkullsFromWarnings(boss);
                boss.transitioning = false;
                try { boss.carrier.setInvulnerable(false); } catch (e) { }
                boss.nextAttackTick = globalTick + 40;
                try {
                    if (boss.bar) boss.bar.setColor(BarColor.PURPLE);
                } catch (e) { }
                announceNearby(boss, 64.0, ChatColor.DARK_PURPLE + "[" + BOSS_NAME + "] "
                        + ChatColor.RED + "巨大头颅坠落！");
                log.info("FirstLichKing 半血升空结束，已召唤骷髅头颅。");
            }
        } catch (e) {
            log.error("FirstLichKing 升空阶段异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    // ---------------------------------------------------------------------------
    // 律令死亡
    // ---------------------------------------------------------------------------
    function triggerDeathDecree(boss, triggerPlayer) {
        if (!boss || boss.dead || !boss.phase2Triggered) return;
        var target = getTopDamagePlayer(boss);
        if (!target) target = triggerPlayer;
        if (!target || !isValidTargetForBoss(boss, target)) return;
        var uuid = toUuidString(target);
        activeDecrees[uuid] = {
            bossUuid: boss.uuid,
            target: target,
            startTick: globalTick,
            endTick: globalTick + DECREE_DURATION_TICKS,
            lastTitleTick: -100
        };
        target.sendTitle(ChatColor.DARK_RED + "" + ChatColor.BOLD + "死 亡 律 令",
                ChatColor.YELLOW + "3 秒内脱离巫妖王的视线！", 5, 45, 10);
        sendMessage(target, ChatColor.DARK_RED + "[" + BOSS_NAME + "] "
                + ChatColor.RED + "你被死亡律令锁定，立即脱离它的视线！");
        playSoundAt(target.getLocation(), Sound.ENTITY_WITHER_SPAWN, 1.4, 0.8);
    }

    function updateDecrees() {
        for (var uuid in activeDecrees) {
            if (!activeDecrees.hasOwnProperty(uuid)) continue;
            var entry = activeDecrees[uuid];
            var boss = activeBosses[String(entry.bossUuid)] || null;
            var target = entry.target;
            if (!boss || boss.dead || !target || !target.isOnline() || target.isDead()) {
                delete activeDecrees[uuid];
                continue;
            }
            try {
                var seconds = Math.max(0, Math.ceil((entry.endTick - globalTick) / 20.0));
                target.sendActionBar(ChatColor.DARK_RED + "死亡律令 " + ChatColor.YELLOW
                        + seconds + "s " + ChatColor.GRAY + "脱离视线可生还");
                if (globalTick - entry.lastTitleTick >= 10) {
                    entry.lastTitleTick = globalTick;
                    target.sendTitle(ChatColor.DARK_RED + "" + ChatColor.BOLD + "死 亡 律 令",
                            ChatColor.YELLOW + String(seconds) + " 秒内脱离视线", 0, 12, 0);
                }

                var canSee = false;
                try {
                    if (target.getWorld() === boss.world) {
                        var distance = target.getLocation().distanceSquared(boss.carrier.getLocation());
                        if (distance <= DECREE_MAX_LOS_DISTANCE * DECREE_MAX_LOS_DISTANCE) {
                            canSee = boss.carrier.hasLineOfSight(target);
                        }
                    }
                } catch (e) {
                    canSee = false;
                }

                if (!canSee) {
                    delete activeDecrees[uuid];
                    target.sendTitle(ChatColor.GREEN + "脱 离 视 线",
                            ChatColor.GRAY + "死亡律令失效", 0, 20, 5);
                    sendMessage(target, ChatColor.GREEN + "[" + BOSS_NAME + "] "
                            + ChatColor.GRAY + "你成功断开了巫妖王的视线。");
                    playSoundAt(target.getLocation(), Sound.BLOCK_BEACON_DEACTIVATE, 1.0, 1.2);
                    continue;
                }

                if (globalTick >= entry.endTick) {
                    delete activeDecrees[uuid];
                    target.sendTitle(ChatColor.DARK_RED + "即 死", "", 0, 20, 5);
                    sendMessage(target, ChatColor.DARK_RED + "[" + BOSS_NAME + "] "
                            + ChatColor.RED + "未能在 3 秒内脱离视线，死亡律令生效！");
                    playSoundAt(target.getLocation(), Sound.ENTITY_WITHER_DEATH, 1.5, 1.0);
                    try { target.setHealth(0.0); } catch (e) { }
                }
            } catch (e) {
                delete activeDecrees[uuid];
            }
        }
    }

    // ---------------------------------------------------------------------------
    // 死亡序列
    // ---------------------------------------------------------------------------
    function startDeathSequence(boss) {
        if (!boss || boss.dead) return;
        boss.dead = true;
        boss.transitioning = false;
        boss.enhancedLaser = null;
        boss.deathTouch = null;
        setBossHp(boss, 0.0);
        removeBossBar(boss);
        removeZombiesForBoss(boss, true);
        removeCirclesForBoss(boss);
        removeLasersForBoss(boss);
        removeSkullsForBoss(boss);
        removeDecreesForBoss(boss);

        boss.deathStartTick = globalTick;
        boss.deathEndTick = globalTick + DEATH_SEQUENCE_TICKS;
        boss.deathLocation = boss.carrier.getLocation().clone();
        try { boss.carrier.setInvulnerable(true); } catch (e) { }
        playSoundAt(boss.deathLocation, Sound.ENTITY_WITHER_DEATH, 2.0, 0.7);
        playSoundAt(boss.deathLocation, Sound.ENTITY_ENDERMAN_TELEPORT, 1.4, 0.5);
        announceNearby(boss, 64.0, ChatColor.DARK_PURPLE + "[" + BOSS_NAME + "] "
                + ChatColor.DARK_GRAY + "初代巫妖王陨落了……");
        log.info("FirstLichKing 进入死亡序列。");
    }

    function updateDeathSequence(boss, uuid) {
        var elapsed = globalTick - boss.deathStartTick;
        try {
            var location = boss.deathLocation;
            var world = boss.world;
            world.spawnParticle(Particle.SQUID_INK, location, 60, 1.8, 2.0, 1.8, 0.06);
            world.spawnParticle(Particle.SOUL_FIRE_FLAME, location, 30, 1.5, 1.6, 1.5, 0.04);
            if (elapsed % 2 === 0) {
                world.spawnParticle(Particle.SOUL, location, 24, 1.5, 1.8, 1.5, 0.05);
            }
            try { boss.carrier.setInvisible(true); } catch (e) { }
            if (elapsed % 10 === 0) {
                playSoundAt(location, Sound.ENTITY_WITHER_AMBIENT, 1.2, 0.6);
            }
        } catch (e) { }
        if (globalTick >= boss.deathEndTick) {
            try {
                boss.world.spawnParticle(Particle.SQUID_INK, boss.deathLocation,
                        180, 2.8, 2.8, 2.8, 0.09);
                boss.world.spawnParticle(Particle.SOUL_FIRE_FLAME, boss.deathLocation,
                        90, 2.4, 2.4, 2.4, 0.07);
            } catch (e) { }
            cleanupBoss(boss, uuid);
            log.info("FirstLichKing 死亡序列完成。");
        }
    }

    // ---------------------------------------------------------------------------
    // 主逻辑
    // ---------------------------------------------------------------------------
    function updateAttack(boss, target) {
        if (!boss || boss.dead || boss.transitioning || !target) return;
        if (globalTick < boss.nextAttackTick) return;
        boss.nextAttackTick = globalTick + ATTACK_INTERVAL_TICKS;

        if (boss.nextAttackEnhanced) {
            boss.nextAttackEnhanced = false;
            startEnhancedLaser(boss);
            return;
        }

        if (boss.phase2Triggered) {
            castGroundCircles(boss);
        } else {
            fireBasicLasers(boss);
        }
        boss.normalAttacksSinceEnhanced++;
        if (boss.normalAttacksSinceEnhanced >= NORMAL_ATTACKS_PER_ENHANCED) {
            boss.normalAttacksSinceEnhanced = 0;
            boss.nextAttackEnhanced = true;
        }
    }

    function updateBoss(boss, uuid) {
        if (boss.dead) {
            updateDeathSequence(boss, uuid);
            return;
        }
        if (!boss.carrier || !boss.carrier.isValid() || boss.carrier.isDead()) {
            cleanupBoss(boss, uuid);
            return;
        }
        try {
            boss.carrier.setFireTicks(0);
            boss.carrier.setVisualFire(false);
            boss.carrier.setVelocity(new Vector(0.0, 0.0, 0.0));
        } catch (e) { }
        registerDouQuQuEntity(boss);
        spawnAuraParticles(boss);
        updateBossBar(boss);

        if (!boss.phase2Triggered && getBossHp(boss) <= PHASE_THRESHOLD) {
            startPhaseTransition(boss);
        }
        if (boss.transitioning) {
            updatePhaseTransition(boss);
            syncBossScoreboard(boss);
            return;
        }

        var target = findNearestTarget(boss);
        boss.target = target;
        updateMovement(boss, target);
        updateDeathTouch(boss);
        updateEnhancedLaser(boss);
        updateZombieWave(boss);
        updateAttack(boss, target);
        syncBossScoreboard(boss);
    }

    function updateAllBosses() {
        for (var uuid in activeBosses) {
            if (!activeBosses.hasOwnProperty(uuid)) continue;
            var boss = activeBosses[uuid];
            if (!boss) continue;
            try {
                updateBoss(boss, uuid);
                if (activeBosses.hasOwnProperty(uuid) && activeBosses[uuid] === boss) {
                    syncBossScoreboard(boss);
                }
            } catch (e) {
                log.error("FirstLichKing BOSS[" + uuid + "] tick 异常：" + e
                        + (e && e.stack ? "\n" + e.stack : ""));
            }
        }
    }

    // ---------------------------------------------------------------------------
    // 事件注册
    // ---------------------------------------------------------------------------
    registerEvent("org.bukkit.event.entity.EntityDamageEvent", function (event) {
        try {
            var boss = getBossByEntity(event.getEntity());
            if (!boss) return;
            event.setCancelled(true);
            if (boss.dead || boss.transitioning) return;
            if (isFireOrExplosionDamage(event.getCause())) return;

            var info = parseAttackSource(event);
            var attacker = info.player;
            var allowedDisorder = isDouQuQuActive(boss)
                    || isDisorderDamageSource(info.direct)
                    || isDisorderDamageSource(info.causing);
            if (!attacker && !allowedDisorder) return;

            if (info.isRanged && hasActiveZombieWave(boss)) {
                if (attacker) {
                    sendActionBar(attacker, ChatColor.GRAY + "亡灵护盾：巫妖王免疫远程攻击！");
                }
                return;
            }

            var amount = event.getFinalDamage();
            applyBossDamage(boss, amount, attacker, info.isMelee, info.isRanged);
        } catch (e) {
            log.error("FirstLichKing 受伤事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    registerEvent("org.bukkit.event.entity.EntityDeathEvent", function (event) {
        try {
            var entity = event.getEntity();
            var boss = getBossByEntity(entity);
            if (boss) {
                try { event.getDrops().clear(); } catch (e) { }
                try { event.setDroppedExp(0); } catch (e) { }
                if (!boss.dead) startDeathSequence(boss);
                return;
            }

            var zombieUuid = toUuidString(entity);
            if (zombieUuid && activeZombies[zombieUuid]) {
                try { event.getDrops().clear(); } catch (e) { }
                try { event.setDroppedExp(0); } catch (e) { }
                removeZombie(zombieUuid, true, false);
            }
        } catch (e) {
            log.error("FirstLichKing 死亡事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    registerEvent("org.bukkit.event.entity.ProjectileHitEvent", function (event) {
        try {
            var projectile = event.getEntity();
            if (!projectile) return;
            var uuid = toUuidString(projectile);
            var entry = uuid ? trackedSkulls[uuid] : null;
            if (!entry) return;
            event.setCancelled(true);
            delete trackedSkulls[uuid];
            var location = projectile.getLocation().clone();
            try {
                if (event.getHitBlock() != null) {
                    location = event.getHitBlock().getLocation().add(0.5, 0.5, 0.5);
                }
            } catch (e) { }
            detonateSkull(entry, location);
            try { projectile.remove(); } catch (e) { }
        } catch (e) {
            log.error("FirstLichKing 投射物命中异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });
    registerEvent("org.bukkit.event.entity.ExplosionPrimeEvent", function (event) {
        try {
            var explosive = event.getEntity();
            if (!explosive) return;
            var uuid = toUuidString(explosive);
            var entry = uuid ? trackedSkulls[uuid] : null;
            if (!entry) return;
            event.setCancelled(true);
            delete trackedSkulls[uuid];
            if (!entry.detonated) {
                detonateSkull(entry, explosive.getLocation().clone());
            }
            try { explosive.remove(); } catch (e) { }
        } catch (e) {
            log.error("FirstLichKing 爆炸预警事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    registerEvent("org.bukkit.event.entity.EntityDamageByEntityEvent", function (event) {
        try {
            var entity = event.getEntity();
            var zombieUuid = toUuidString(entity);
            if (!zombieUuid) return;
            var zombie = activeZombies[zombieUuid];
            if (!zombie) return;
            var boss = activeBosses[String(zombie.bossUuid)] || null;
            if (!boss || boss.dead || !boss.phase2Triggered) return;

            var damager = null;
            try { damager = event.getDamager(); } catch (e) { return; }
            if (!(damager instanceof PlayerClass)) return; // 只有玩家近战命中才算“击退”

            var uuid = toUuidString(damager);
            if (!uuid) return;
            boss.knockbackCounts[uuid] = (Number(boss.knockbackCounts[uuid]) || 0) + 1;
            sendActionBar(damager, ChatColor.DARK_RED + "击退亡灵 "
                    + boss.knockbackCounts[uuid] + " / " + DECREE_KNOCKBACKS_REQUIRED);
            if (boss.knockbackCounts[uuid] >= DECREE_KNOCKBACKS_REQUIRED) {
                boss.knockbackCounts[uuid] = 0;
                triggerDeathDecree(boss, damager);
            }
        } catch (e) {
            log.error("FirstLichKing 击退事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // ---------------------------------------------------------------------------
    // 主循环
    // ---------------------------------------------------------------------------
    task.repeat(ticks(1), ticks(1), function () {
        globalTick++;
        try {
            processSyncDelayedTasks();
        } catch (e) {
            log.error("FirstLichKing 延迟任务队列异常：" + e);
        }
        try {
            updateAllBosses();
        } catch (e) {
            log.error("FirstLichKing 主循环异常：" + e);
        }
        try {
            updateTrackedLasers();
        } catch (e) {
            log.error("FirstLichKing 激光更新异常：" + e);
        }
        try {
            updateGroundCircles();
        } catch (e) {
            log.error("FirstLichKing 法阵更新异常：" + e);
        }
        try {
            updateTrackedSkulls();
        } catch (e) {
            log.error("FirstLichKing 头颅更新异常：" + e);
        }
        try {
            updateZombies();
        } catch (e) {
            log.error("FirstLichKing 亡灵更新异常：" + e);
        }
        try {
            updateDecrees();
        } catch (e) {
            log.error("FirstLichKing 律令更新异常：" + e);
        }
    });

    // 延迟 1 tick 清理上一次脚本实例遗留的实体、血条与计分板队伍。
    scheduleSync(1, function () {
        cleanupOrphans();
    });

    // ---------------------------------------------------------------------------
    // BossRegistry 注册
    // ---------------------------------------------------------------------------
    var bossDefinition = {
        id: BOSS_ID,
        name: BOSS_NAME,
        aliases: ["初代巫妖王", "first_lich_king", "firstlichking", "lich", "巫妖王"],
        heartbeat: Date.now(),
        lore: [
            ChatColor.LIGHT_PURPLE + "生命值：" + ChatColor.WHITE + "900",
            ChatColor.GOLD + "外观：手持木棍的凋零骷髅，黑色头顶光环 + 蓝色火焰光环",
            ChatColor.DARK_GRAY + "————————————————",
            ChatColor.YELLOW + "普通阶段：",
            ChatColor.GRAY + "· 黑色激光：每 35 tick 发射 3 道，优先远处玩家，单道 10 伤害",
            ChatColor.GRAY + "· 强化激光：每 3 次普通攻击后，10 tick 红色预警，35 伤害并回复 20 生命",
            ChatColor.GRAY + "· 亡灵召唤：30 秒后召唤 6 个铁甲铁剑僵尸；僵尸发光并优先攻击伤害最高者",
            ChatColor.GRAY + "  僵尸存活时巫妖减伤 75%、免疫远程，僵尸全灭后 30 秒再召唤",
            ChatColor.GRAY + "· 死亡之触：累计 3 次近战命中后，5 tick 黄色预警反击，25 伤害 + 10 秒凋零，命中回复 15",
            ChatColor.DARK_RED + "损失一半生命值后升空觉醒：",
            ChatColor.GRAY + "· 无敌升空后召唤 3 颗巨大凋零骷髅头颅，红色落点预警，落地爆炸威力 25 + 30 秒凋零",
            ChatColor.GRAY + "· 强化召唤：僵尸获得力量 III、速度 III、铁甲保护 II",
            ChatColor.GRAY + "· 强化普攻：玩家脚下黑色法阵，5 tick 黄色预警后造成 15 伤害",
            ChatColor.GRAY + "· 律令死亡：击退僵尸两次会锁定最高伤害玩家，3 秒未脱离视线即死",
            ChatColor.DARK_PURPLE + "· 计分板有效生命 900，本体原生生命固定 20"
        ],
        spawn: spawnFirstLichKing
    };

    function ensureRegistered() {
        try {
            var api = getShared("BossRegistry");
            if (!api) return;
            if (api !== lastRegistryApi || !api.get(BOSS_ID)) {
                api.register(bossDefinition);
                lastRegistryApi = api;
            } else {
                api.heartbeat(BOSS_ID);
            }
        } catch (e) {
            try {
                if (typeof log !== "undefined") {
                    log.warn("FirstLichKing 注册到 /call 框架失败：" + e);
                }
            } catch (ignored) { }
        }
    }

    ensureRegistered();
    task.repeat(ticks(20), ticks(20), function () {
        ensureRegistered();
    });

    // ---------------------------------------------------------------------------
    // 启动日志
    // ---------------------------------------------------------------------------
    log.info("FirstLichKing 已加载：使用 /call boss " + BOSS_NAME + " 获取召唤物品。");
})();
