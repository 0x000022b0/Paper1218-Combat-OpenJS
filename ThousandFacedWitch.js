/*
 * ThousandFacedWitch.js —— 自定义 BOSS「千面魔女」（OpenJS 1.5.0 / Paper 1.21.8）
 *
 * 获取方式：/call boss 千面魔女
 * 召唤方式：手持「召唤千面魔女」右键点击地面 → 6 秒倒计时 → spawn
 *
 * 机制摘要：
 *   - 外观：隐形 Husk 载具 + 悬浮；黑色颗粒（SQUID_INK / LARGE_SMOKE）与灵魂粒子（SOUL）缠绕
 *   - 数据：HP 650、免疫火焰/岩浆/爆炸、低空悬浮跨越地形、速度介于步行与疾跑之间
 *   - 近战：贴近玩家后挥舞大剑（下界合金剑 ItemDisplay，3 倍），每 3 秒一次，单次三段伤害判定
 *   - 瞬影：冷却 60 秒；召唤 2~5 个幻影（外观/伤害同本体，HP 10）；须幻影全灭后才能再次使用
 *   - 魔弹：先悬停 2 秒（龙息粒子），随后高速射向玩家当时位置；不追踪
 *   - 阶段：HP < 325 进入无敌旋转，落雷解除无敌进入二阶段（黑雾更浓）
 *   - 二阶段：黑暗效果（10 秒 / 冷却 40 秒）；蓄力 3 秒后挥出剑气（高伤害 + 破盾）
 *   - 死亡：黑雾笼罩消散，同时清除场上全部幻影
 *
 * 依赖框架：CallBoss.js 提供的 BossRegistry（本脚本自动注册，无需改动 CallBoss.js 逻辑）
 */

// 作用域隔离：所有变量、常量和函数都封装在本 IIFE 内，
// 避免与其他 OpenJS 脚本的全局名称互相覆盖。
// 规范详见《OpenJS脚本数据契约.md》。
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
    var Bukkit = Java.type("org.bukkit.Bukkit");
    var Location = Java.type("org.bukkit.Location");
    var Vector = Java.type("org.bukkit.util.Vector");
    var Particle = Java.type("org.bukkit.Particle");
    var Sound = Java.type("org.bukkit.Sound");
    var Attribute = Java.type("org.bukkit.attribute.Attribute");
    var BarColor = Java.type("org.bukkit.boss.BarColor");
    var BarStyle = Java.type("org.bukkit.boss.BarStyle");
    var Transformation = Java.type("org.bukkit.util.Transformation");
    var Vector3f = Java.type("org.joml.Vector3f");
    var Quaternionf = Java.type("org.joml.Quaternionf");
    var Color = Java.type("org.bukkit.Color");
    var ItemDisplayClass = Class.forName("org.bukkit.entity.ItemDisplay");
    var ItemDisplay$ItemDisplayTransform = Java.type("org.bukkit.entity.ItemDisplay$ItemDisplayTransform");
    var Billboard = Java.type("org.bukkit.entity.Display$Billboard");
    var Brightness = Java.type("org.bukkit.entity.Display$Brightness");
    var PlayerClass = Java.type("org.bukkit.entity.Player");
    var ProjectileClass = Java.type("org.bukkit.entity.Projectile");
    var PotionEffect = Java.type("org.bukkit.potion.PotionEffect");
    var PotionEffectType = Java.type("org.bukkit.potion.PotionEffectType");

    var HuskClass = Class.forName("org.bukkit.entity.Husk");
    var DragonFireballClass = Class.forName("org.bukkit.entity.DragonFireball");

    // ---------------------------------------------------------------------------
    // 数值配置
    // ---------------------------------------------------------------------------
    var BOSS_ID = "thousand_faced_witch";
    var BOSS_NAME = "千面魔女";

    // 生命与阶段
    var MAX_HEALTH = 650.0;
    var PHASE_THRESHOLD = 325.0;          // HP 低于此值进入二阶段

    // 体形与悬浮
    var CARRIER_SCALE = 2.0;              // 放大到接近末影人体型
    var DISPLAY_SCALE = 3.0;              // 大剑显示放大倍数
    var CARRIER_BASE_HEIGHT = 1.95;       // Husk 原始身高
    var DISPLAY_CENTER_Y = (CARRIER_BASE_HEIGHT * CARRIER_SCALE) / 2.0;
    var HOVER_FEET = 0.60;                // 载具脚底离地高度（跨越复杂地形）
    var HOVER_BOB_AMPLITUDE = 0.10;

    // 速度：玩家步行约 0.215 格/tick，疾跑约 0.28 格/tick。
    // 取 0.250 使其“略快于走路、略慢于奔跑”。
    var MOVE_SPEED = 0.250;
    var PURSUE_DISTANCE = 3.2;            // 超过此距离才前进
    var KEEP_DISTANCE = 2.4;              // 近于此距离后退
    var TARGET_RANGE = 64.0;

    // 近战：每 3 秒挥砍一次，单次三段判定
    var MELEE_INTERVAL_TICKS = 60;
    var MELEE_RANGE = 4.2;
    var MELEE_DAMAGE_PER_HIT = 6.0;
    var MELEE_HIT_COUNT = 3;
    var MELEE_HIT_GAP_TICKS = 4;          // 三段之间间隔 4 tick，避免被无敌帧吞掉
    var MELEE_SWING_TICKS = 18;           // 挥砍动作总时长
    var MELEE_KNOCKBACK = 0.45;

    // 瞬影：召唤 2~5 个幻影，冷却 60 秒，须幻影全灭才可再次使用
    var CLONE_SPELL_COOLDOWN_TICKS = 1200;
    var CLONE_MIN_COUNT = 2;
    var CLONE_MAX_COUNT = 5;
    var CLONE_HEALTH = 10.0;
    var CLONE_DAMAGE = MELEE_DAMAGE_PER_HIT;   // 与本体一致
    var CLONE_SCALE = 2.0;
    var CLONE_SPAWN_RADIUS_MIN = 3.5;
    var CLONE_SPAWN_RADIUS_MAX = 7.0;
    var CLONE_MELEE_INTERVAL_TICKS = 70;

    // 魔法飞弹：悬停 2 秒后高速射向玩家
    var MAGIC_MISSILE_COOLDOWN_TICKS = 180;
    var MAGIC_MISSILE_HOVER_TICKS = 40;   // 2 秒延迟
    var MAGIC_MISSILE_SPEED = 1.35;       // 发射后速度（格/tick）
    var MAGIC_MISSILE_LIFE_TICKS = 70;
    var MAGIC_MISSILE_DAMAGE = 10.0;
    var MAGIC_MISSILE_RADIUS = 3.0;
    var MAGIC_MISSILE_COUNT = 3;          // 一次齐射 3 枚（不追踪）

    // 阶段转换
    var PHASE_TRANSITION_TICKS = 100;     // 5 秒无敌旋转
    var PHASE_SPIN_DEGREES_PER_TICK = 24.0;

    // 二阶段：黑暗
    var DARKNESS_COOLDOWN_TICKS = 800;    // 40 秒
    var DARKNESS_DURATION_TICKS = 200;    // 10 秒
    var DARKNESS_RANGE = 24.0;

    // 二阶段：剑气
    var QI_SLASH_COOLDOWN_TICKS = 240;
    var QI_CHARGE_TICKS = 60;             // 蓄力 3 秒
    var QI_RANGE = 24.0;                  // 剑气飞行距离
    var QI_STEP = 1.8;                    // 每 tick 前进距离
    var QI_HIT_RADIUS = 3.0;
    var QI_DAMAGE = 26.0;
    var QI_SHIELD_DISABLE_TICKS = 100;    // 破盾：5 秒内无法举盾

    // 死亡
    var DEATH_SEQUENCE_TICKS = 70;        // 黑雾消散时长

    // 标签与 PDC（全部带 BOSS id 前缀，避免跨 BOSS 冲突）
    var BOSS_TAG = "thousand_faced_witch_boss";
    var DISPLAY_TAG = "thousand_faced_witch_display";
    var SWORD_TAG = "thousand_faced_witch_sword";
    var CLONE_TAG = "thousand_faced_witch_clone";
    var CLONE_DISPLAY_TAG = "thousand_faced_witch_clone_display";
    var MISSILE_TAG = "thousand_faced_witch_missile";
    var QI_TAG = "thousand_faced_witch_qi";
    var BOSS_KEY = new NamespacedKey(plugin, "thousand_faced_witch_boss_type");
    var OWNER_KEY = new NamespacedKey(plugin, "thousand_faced_witch_owner");

    var SCOREBOARD_OBJECTIVE = "tfw_hp";
    var SCOREBOARD_TEAM_PREFIX = "tfw_";

    var SWORD_ITEM = new ItemStack(Material.NETHERITE_SWORD, 1);

    // ---------------------------------------------------------------------------
    // 运行时状态
    // ---------------------------------------------------------------------------

    var activeBosses = {};        // uuid -> boss state
    var activeClones = {};        // uuid -> clone state
    var trackedMissiles = {};     // uuid -> missile state
    var activeQiSlashes = {};     // uuid -> qi slash state
    var syncDelayedTasks = [];    // 由主循环在主线程统一执行的延迟任务
    var globalTick = 0;
    var lastRegistryApi = null;

    // ---------------------------------------------------------------------------
    // 工具函数
    // ---------------------------------------------------------------------------

    function clamp(value, min, max) {
        if (value < min) return min;
        if (value > max) return max;
        return value;
    }

    // OpenJS 的 task.delay 内部使用线程池（异步）。涉及 Bukkit 世界/实体的延迟逻辑
    // 统一放进这个队列，由主循环（Bukkit runTaskTimer）在主线程执行。
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
                    log.error("ThousandFacedWitch 延迟任务异常：" + e
                            + (e && e.stack ? "\n" + e.stack : ""));
                }
            } else {
                pending.push(entry);
            }
        }
    }

    // 从参考高度向下寻找可站立表面，避免 BOSS 在洞穴/室内直接飞到屋顶以上。
    function groundSurfaceYNear(world, x, z, referenceY) {
        var blockX = Math.floor(x);
        var blockZ = Math.floor(z);
        var maxHeight = world.getMaxHeight();
        var minHeight = world.getMinHeight();
        var startY = Math.min(maxHeight - 1, Math.floor(referenceY) + 4);
        var endY = Math.max(minHeight, Math.floor(referenceY) - 12);
        for (var y = startY; y >= endY; y--) {
            var block = world.getBlockAt(blockX, y, blockZ);
            if (block.getType().isSolid() && !block.isLiquid()) {
                return y + 1.0;
            }
        }
        return referenceY - HOVER_FEET;
    }

    function getOrRegisterAttribute(entity, attribute) {
        var instance = entity.getAttribute(attribute);
        if (instance == null) {
            try { entity.registerAttribute(attribute); } catch (e) { }
            instance = entity.getAttribute(attribute);
        }
        return instance;
    }

    // ItemDisplay 的物品模型以实体位置为中心（与 BlockDisplay 的“方块角”不同），
    // 因此这里不做方块角补偿，只做缩放 + 绕 Y 轴自转。
    // 若实测发现大剑偏离身体中心，把 DISPLAY_ITEM_CENTERED 改为 false 即可启用补偿。
    var DISPLAY_ITEM_CENTERED = true;

    function setDisplayTransform(display, scale, spinDegrees) {
        try {
            var radians = (spinDegrees || 0) * Math.PI / 180.0;
            var spin = new Quaternionf().rotationY(radians);
            var translation = new Vector3f(0, 0, 0);
            if (!DISPLAY_ITEM_CENTERED) {
                var half = scale * 0.5;
                var rotatedCenter = spin.transform(new Vector3f(half, half, half));
                translation = new Vector3f(-rotatedCenter.x(), -rotatedCenter.y(),
                        -rotatedCenter.z());
            }
            display.setTransformation(new Transformation(
                    translation,
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
            var pdc = entity.getPersistentDataContainer();
            if (pdc != null && pdc.has(OWNER_KEY, PersistentDataType.STRING)) {
                var owner = pdc.get(OWNER_KEY, PersistentDataType.STRING);
                if (owner != null) {
                    var uuid = String(owner);
                    if (activeBosses[uuid]) return activeBosses[uuid];
                    if (activeClones[uuid]) return activeClones[uuid];
                }
            }
        } catch (e) { }
        try {
            return activeBosses[String(entity.getUniqueId().toString())] || null;
        } catch (e) {
            return null;
        }
    }

    // 返回所有受伤单位（本体 + 幻影），便于伤害事件统一处理
    function getCombatUnitByEntity(entity) {
        if (!entity) return null;
        try {
            var uuid = String(entity.getUniqueId().toString());
            if (activeBosses[uuid]) return activeBosses[uuid];
            if (activeClones[uuid]) return activeClones[uuid];
        } catch (e) { }
        return getBossByEntity(entity);
    }

    function findNearestPlayer(location, world, range) {
        try {
            var best = null;
            var bestDistance = range * range;
            var players = world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var player = players.get(i);
                if (!player || player.isDead() || !player.isOnline()) continue;
                if (player.getGameMode() != null && String(player.getGameMode().name()) === "SPECTATOR") {
                    continue;
                }
                var distance = player.getLocation().distanceSquared(location);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    best = player;
                }
            }
            return best;
        } catch (e) {
            return null;
        }
    }

    function isDouQuQuActive(unit) {
        try {
            if (!unit) return false;
            var api = getShared("DouQuQu");
            return !!(api && api.isActive(unit.id));
        } catch (e) { return false; }
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

    function isTargetValidForUnit(unit, entity) {
        try {
            if (!unit || !entity || entity === unit.carrier) return false;
            if (entity.isDead() || !entity.isValid()) return false;
            if (entity instanceof PlayerClass) {
                if (!entity.isOnline()
                        || (entity.getGameMode() != null
                            && String(entity.getGameMode().name()) === "SPECTATOR")) {
                    return false;
                }
            }
            if (String(entity.getType().name()) === "ARMOR_STAND") return false;
            var uuid = String(entity.getUniqueId().toString());
            if (unit.isClone) {
                var main = activeBosses[unit.ownerUuid] || null;
                if (main && entity === main.carrier) return false;
                var otherClone = activeClones[uuid];
                if (otherClone && String(otherClone.ownerUuid) === String(unit.ownerUuid)) return false;
            } else {
                var ownClone = activeClones[uuid];
                if (ownClone && String(ownClone.ownerUuid) === String(unit.uuid)) return false;
            }
            return true;
        } catch (e) { return false; }
    }

    function findNearestTarget(location, world, range, unit) {
        if (!unit || !isDouQuQuActive(unit)) return findNearestPlayer(location, world, range);
        try {
            var best = null;
            var bestDistance = range * range;
            var it = world.getLivingEntities().iterator();
            while (it.hasNext()) {
                var entity = it.next();
                if (!isTargetValidForUnit(unit, entity)) continue;
                var distance = entity.getLocation().distanceSquared(location);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    best = entity;
                }
            }
            return best;
        } catch (e) {
            return findNearestPlayer(location, world, range);
        }
    }

    function findEntityByUuid(world, uuid) {
        if (!world || !uuid) return null;
        try {
            var it = world.getLivingEntities().iterator();
            while (it.hasNext()) {
                var entity = it.next();
                if (String(entity.getUniqueId().toString()) === String(uuid)) return entity;
            }
        } catch (e) { }
        return null;
    }

    function getAttackTargets(unit) {
        var list = [];
        try {
            if (unit && isDouQuQuActive(unit)) {
                var it = unit.world.getLivingEntities().iterator();
                while (it.hasNext()) {
                    var entity = it.next();
                    if (isTargetValidForUnit(unit, entity)) list.push(entity);
                }
            } else if (unit) {
                var players = unit.world.getPlayers();
                for (var i = 0; i < players.size(); i++) {
                    var p = players.get(i);
                    if (!p || p.isDead() || !p.isOnline()) continue;
                    if (p.getGameMode() != null
                            && String(p.getGameMode().name()) === "SPECTATOR") continue;
                    list.push(p);
                }
            }
        } catch (e) { }
        return list;
    }

    function registerDouQuQuEntities(unit) {
        try {
            var api = getShared("DouQuQu");
            if (!api || !api.isActive(unit.id)) return;
            if (unit.carrier && unit.carrier.isValid()) api.markEntity(unit.id, unit.carrier);
        } catch (e) { }
    }

    function unregisterDouQuQuEntities(unit) {
        try {
            var api = getShared("DouQuQu");
            if (!api) return;
            if (unit && unit.carrier) api.unmarkEntity(unit.carrier);
        } catch (e) { }
    }

    function damageTargetIgnoringShield(target, damage, source) {
        try {
            if (!target || target.isDead()) return;
            if (target instanceof PlayerClass) {
                var wasBlocking = false;
                try { wasBlocking = target.isBlocking(); } catch (e) { }
                try {
                    if (source != null) target.damage(damage, source);
                    else target.damage(damage);
                } catch (e) { }
                if (wasBlocking) {
                    try { target.clearActiveItem(); } catch (e) { }
                    try { target.setCooldown(Material.SHIELD, QI_SHIELD_DISABLE_TICKS); } catch (e) { }
                    try {
                        target.sendMessage(ChatColor.DARK_PURPLE + "[" + BOSS_NAME + "] "
                                + ChatColor.RED + "你的盾牌被剑气击碎了！");
                    } catch (e) { }
                }
                return;
            }
            if (source != null) target.damage(damage, source);
            else target.damage(damage);
        } catch (e) { }
    }

    function getBossCenter(boss) {
        if (boss.display && boss.display.isValid()) return boss.display.getLocation();
        return boss.carrier.getLocation();
    }

    function bossBarTitle(health) {
        var shown = Math.max(0, Math.round(health));
        return ChatColor.DARK_PURPLE + "" + ChatColor.BOLD + BOSS_NAME + ChatColor.RESET
                + ChatColor.GRAY + "  |  " + ChatColor.WHITE + shown
                + ChatColor.GRAY + " / " + ChatColor.WHITE + Math.round(MAX_HEALTH);
    }

    function playSoundAt(location, sound, volume, pitch) {
        try {
            location.getWorld().playSound(location, sound, volume, pitch);
        } catch (e) { }
    }

    // ---------------------------------------------------------------------------
    // 粒子：黑色颗粒 + 灵魂缠绕（末影人主题）
    // ---------------------------------------------------------------------------

    function spawnAuraParticles(boss, center, world) {
        var dense = boss.phase2Triggered === true;
        var inkCount = dense ? 42 : 22;
        var soulCount = dense ? 26 : 14;
        var radius = dense ? 1.85 : 1.45;

        // 黑色颗粒：脚下与身周弥漫
        world.spawnParticle(Particle.SQUID_INK, center.getX(), center.getY() - 0.6,
                center.getZ(), inkCount, radius, 0.9, radius, 0.012);
        if (globalTick % 2 === 0) {
            world.spawnParticle(Particle.LARGE_SMOKE, center.getX(), center.getY() - 0.3,
                    center.getZ(), dense ? 18 : 10, radius * 0.8, 0.8, radius * 0.8, 0.008);
        }

        // 灵魂粒子：双螺旋缠绕上升
        var baseAngle = globalTick * 0.20;
        for (var s = 0; s < 2; s++) {
            var phase = s * Math.PI;
            var direction = (s === 0) ? 1.0 : -1.0;
            for (var i = 0; i < 6; i++) {
                var t = i / 6.0;
                var angle = baseAngle * direction + phase + t * Math.PI * 1.6;
                var r = 1.0 + t * 0.5;
                world.spawnParticle(Particle.SOUL,
                        center.getX() + Math.cos(angle) * r,
                        center.getY() - 0.9 + t * 2.0,
                        center.getZ() + Math.sin(angle) * r,
                        1, 0.02, 0.02, 0.02, 0.005);
            }
        }

        // 末影人标志性的紫色眼睛光点（漂浮在头部位置）
        if (globalTick % 3 === 0) {
            world.spawnParticle(Particle.PORTAL, center.getX(), center.getY() + 1.1,
                    center.getZ(), dense ? 14 : 8, 0.35, 0.18, 0.35, 0.05);
        }

        // 二阶段额外：更浓的黑雾漩涡
        if (dense && globalTick % 2 === 0) {
            for (var k = 0; k < 10; k++) {
                var ringAngle = k / 10.0 * Math.PI * 2.0 + globalTick * 0.12;
                var ringRadius = 1.4 + Math.random() * 0.5;
                world.spawnParticle(Particle.SQUID_INK,
                        center.getX() + Math.cos(ringAngle) * ringRadius,
                        center.getY() - 0.4 + Math.random() * 1.6,
                        center.getZ() + Math.sin(ringAngle) * ringRadius,
                        1, 0.0, 0.0, 0.0, 0.01);
            }
        }
    }

    // ---------------------------------------------------------------------------
    // 外观同步
    // ---------------------------------------------------------------------------

    function syncDisplay(boss) {
        try {
            var base = boss.carrier.getLocation();
            var bob = boss.transitioning
                    ? 0.0
                    : Math.sin(globalTick / 16.0) * HOVER_BOB_AMPLITUDE;

            // 大剑跟随本体，并在挥砍时做前挥动作
            if (boss.sword && boss.sword.isValid()) {
                var swingProgress = 0.0;
                if (boss.meleeSwingEndTick > globalTick) {
                    var total = Math.max(1, boss.meleeSwingEndTick - boss.meleeSwingStartTick);
                    swingProgress = 1.0 - ((boss.meleeSwingEndTick - globalTick) / total);
                }
                var yaw = base.getYaw() * Math.PI / 180.0;
                var reach = 1.35 + swingProgress * 0.55;
                var offsetX = -Math.sin(yaw) * reach;
                var offsetZ = Math.cos(yaw) * reach;
                var swingDrop = Math.sin(swingProgress * Math.PI) * 0.85;

                var swordLoc = new Location(boss.world,
                        base.getX() + offsetX,
                        base.getY() + DISPLAY_CENTER_Y * 0.62 + bob - swingDrop,
                        base.getZ() + offsetZ);
                boss.sword.teleport(swordLoc);
                boss.sword.setRotation(-base.getYaw(), 20.0 - swingProgress * 70.0);
            }
        } catch (e) { }
    }

    // ---------------------------------------------------------------------------
    // 生命周期
    // ---------------------------------------------------------------------------

    function createSwordDisplay(world, spawnLoc) {
        var sword = world.spawn(spawnLoc.clone().add(0, DISPLAY_CENTER_Y * 0.62, 0),
                ItemDisplayClass);
        if (!sword) return null;
        try { sword.setItemStack(SWORD_ITEM); } catch (e) { }
        try { sword.setItemDisplayTransform(ItemDisplay$ItemDisplayTransform.NONE); } catch (e) { }
        setDisplayTransform(sword, DISPLAY_SCALE, 0);
        sword.setRotation(0, 20);
        sword.setInterpolationDuration(2);
        sword.setInterpolationDelay(0);
        sword.setTeleportDuration(2);
        sword.setBillboard(Billboard.FIXED);
        sword.setBrightness(new Brightness(15, 15));
        sword.setViewRange(2.0);
        sword.setShadowRadius(0.8);
        sword.setShadowStrength(0.6);
        sword.setPersistent(true);
        sword.setInvulnerable(true);
        sword.setSilent(true);
        sword.addScoreboardTag(SWORD_TAG);
        return sword;
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
            log.warn("ThousandFacedWitch 血条创建失败：" + e);
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
            var scoreKey = "tw_" + shortId;
            if (objective != null) {
                objective.getScore(scoreKey).setScore(Math.round(MAX_HEALTH));
            }
            return { objective: objective, scoreKey: scoreKey };
        } catch (e) {
            log.warn("ThousandFacedWitch 计分板初始化失败：" + e);
            return null;
        }
    }

    function syncBossScoreboard(boss) {
        try {
            if (!boss || !boss.objective || !boss.scoreKey || !boss.carrier) return;
            var health = boss.dead ? 0.0 : boss.carrier.getHealth();
            boss.objective.getScore(boss.scoreKey).setScore(Math.round(health));
        } catch (e) { }
    }

    function removeBossScoreboard(boss) {
        try {
            if (!boss) return;
            if (boss.objective && boss.scoreKey) {
                try {
                    var scoreboard = Bukkit.getScoreboardManager().getMainScoreboard();
                    scoreboard.resetScores(boss.scoreKey);
                } catch (e) { }
            }
        } catch (e) { }
    }

    function spawnThousandFacedWitch(location, player) {
        try {
            if (!location || !location.getWorld()) return false;
            var world = location.getWorld();

            // CallBoss 已挑选 3 格高安全位置，这里保持低空悬浮。
            var spawnY = location.getY() + HOVER_FEET;
            var spawnLoc = new Location(world, location.getX(), spawnY, location.getZ(), 0, 0);

            var carrier = world.spawn(spawnLoc, HuskClass);
            if (!carrier) return false;

            carrier.setAI(false);
            carrier.setInvisible(true);
            carrier.setSilent(true);
            carrier.setGravity(false);
            carrier.setPersistent(true);
            carrier.setRemoveWhenFarAway(false);
            carrier.setCanPickupItems(false);
            carrier.setCollidable(false);
            try { carrier.setShouldBurnInDay(false); } catch (e) { }
            carrier.setCustomName(ChatColor.DARK_PURPLE + BOSS_NAME);
            carrier.setCustomNameVisible(false);
            carrier.setMaximumNoDamageTicks(0);
            carrier.setNoDamageTicks(0);
            carrier.addScoreboardTag(BOSS_TAG);

            var maxHealthAttribute = getOrRegisterAttribute(carrier, Attribute.MAX_HEALTH);
            if (maxHealthAttribute) maxHealthAttribute.setBaseValue(MAX_HEALTH);
            var scaleAttribute = getOrRegisterAttribute(carrier, Attribute.SCALE);
            if (scaleAttribute) scaleAttribute.setBaseValue(CARRIER_SCALE);
            try { carrier.setHealth(MAX_HEALTH); } catch (e) { }

            var uuid = String(carrier.getUniqueId().toString());
            carrier.getPersistentDataContainer().set(OWNER_KEY, PersistentDataType.STRING, uuid);
            carrier.getPersistentDataContainer().set(BOSS_KEY, PersistentDataType.STRING, BOSS_ID);

            // 大剑外观
            var sword = createSwordDisplay(world, spawnLoc);
            if (!sword) {
                carrier.remove();
                return false;
            }
            sword.getPersistentDataContainer().set(OWNER_KEY, PersistentDataType.STRING, uuid);

            var barInfo = createBossBar(uuid);
            if (barInfo.bar && player) {
                try { barInfo.bar.addPlayer(player); } catch (e) { }
            }
            var scoreboardInfo = createBossScoreboard(uuid);

            var boss = {
                id: BOSS_ID,
                uuid: uuid,
                isClone: false,
                carrier: carrier,
                sword: sword,
                display: sword,
                world: world,
                bar: barInfo.bar,
                barKey: barInfo.barKey,
                objective: scoreboardInfo ? scoreboardInfo.objective : null,
                scoreKey: scoreboardInfo ? scoreboardInfo.scoreKey : null,
                spawnTick: globalTick,
                target: null,

                nextMeleeTick: globalTick + 40,
                meleeSwingStartTick: 0,
                meleeSwingEndTick: 0,
                meleeHitIndex: 0,
                nextMeleeHitTick: 0,

                nextMagicMissileTick: globalTick + 100,
                nextCloneSpellTick: globalTick + 200,
                cloneCount: 0,

                phase2Triggered: false,
                pendingPhase: false,
                transitioning: false,
                transitionStartTick: 0,
                transitionEndTick: 0,
                spin: 0.0,

                nextDarknessTick: 0,
                nextQiSlashTick: 0,
                qiCharge: null,

                dead: false,
                deathStartTick: 0,
                deathEndTick: 0,
                deathLocation: null,
                clearing: false
            };

            activeBosses[uuid] = boss;

            world.playSound(spawnLoc, Sound.ENTITY_ENDERMAN_SCREAM, 1.6, 0.75);
            world.spawnParticle(Particle.SQUID_INK, spawnLoc, 120, 1.4, 1.4, 1.4, 0.05);
            world.spawnParticle(Particle.SOUL, spawnLoc, 60, 1.2, 1.2, 1.2, 0.03);
            world.spawnParticle(Particle.PORTAL, spawnLoc, 90, 1.0, 1.0, 1.0, 0.35);
            world.spawnParticle(Particle.EXPLOSION_EMITTER, spawnLoc, 2, 0.8, 0.8, 0.8, 0);

            if (player) {
                player.sendMessage(ChatColor.DARK_PURPLE + "§l" + BOSS_NAME + ChatColor.LIGHT_PURPLE
                        + " 已降临！");
            }
            log.info("ThousandFacedWitch 已生成：" + uuid + " @" + spawnLoc);
            return true;
        } catch (e) {
            log.error("ThousandFacedWitch 生成失败：" + e + (e && e.stack ? "\n" + e.stack : ""));
            return false;
        }
    }

    function removeBossBar(boss) {
        try {
            if (!boss || !boss.bar) return;
            boss.bar.removeAll();
            if (boss.barKey) Bukkit.removeBossBar(boss.barKey);
        } catch (e) { }
    }

    function cleanupBoss(boss, uuid) {
        try {
            unregisterDouQuQuEntities(boss);
            removeBossBar(boss);
            removeBossScoreboard(boss);
            if (boss.sword) { try { boss.sword.remove(); } catch (e) { } }
            if (boss.carrier) { try { boss.carrier.remove(); } catch (e) { } }
        } catch (e) { }
        delete activeBosses[uuid];
    }

    // 清除场上全部幻影（死亡时会调用）
    function removeAllClones(reason) {
        var removed = 0;
        for (var uuid in activeClones) {
            if (!activeClones.hasOwnProperty(uuid)) continue;
            var clone = activeClones[uuid];
            try {
                unregisterDouQuQuEntities(clone);
                if (clone.display) { try { clone.display.remove(); } catch (e) { } }
                if (clone.carrier) { try { clone.carrier.remove(); } catch (e) { } }
            } catch (e) { }
            delete activeClones[uuid];
            removed++;
        }
        if (removed > 0) {
            log.info("ThousandFacedWitch 已清除幻影 " + removed + " 个（" + reason + "）");
        }
        return removed;
    }

    function countAliveClones(bossUuid) {
        var count = 0;
        for (var uuid in activeClones) {
            if (!activeClones.hasOwnProperty(uuid)) continue;
            if (activeClones[uuid] && String(activeClones[uuid].ownerUuid) === String(bossUuid)) {
                count++;
            }
        }
        return count;
    }

    // 脚本重载 / 启动时清理上一次实例遗留的实体
    function cleanupOrphans() {
        try {
            var worlds = Bukkit.getWorlds();
            for (var w = 0; w < worlds.size(); w++) {
                var world = worlds.get(w);
                removeTaggedEntities(world, BOSS_TAG);
                removeTaggedEntities(world, SWORD_TAG);
                removeTaggedEntities(world, CLONE_TAG);
                removeTaggedEntities(world, CLONE_DISPLAY_TAG);
                removeTaggedEntities(world, MISSILE_TAG);
                removeTaggedEntities(world, QI_TAG);
            }
            cleanupOrphanBossBars();
            cleanupOrphanScoreboard();
        } catch (e) {
            log.error("ThousandFacedWitch 清理残留异常：" + e);
        }
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
            var bars = Bukkit.getBossBars();
            var toRemove = [];
            var iterator = bars.iterator();
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
        } catch (e) { }
    }

    // ---------------------------------------------------------------------------
    // 移动
    // ---------------------------------------------------------------------------

    function hoverToward(boss, targetX, targetZ, speed) {
        try {
            var location = boss.carrier.getLocation();
            var dx = targetX - location.getX();
            var dz = targetZ - location.getZ();
            var horizontal = Math.sqrt(dx * dx + dz * dz);
            if (horizontal < 0.001) return;

            var moveX = dx / horizontal * speed;
            var moveZ = dz / horizontal * speed;
            var newX = location.getX() + moveX;
            var newZ = location.getZ() + moveZ;
            var desiredY = groundSurfaceYNear(boss.world, newX, newZ, location.getY())
                    + HOVER_FEET + Math.sin(globalTick / 25.0) * HOVER_BOB_AMPLITUDE;
            var newY = location.getY() + clamp(desiredY - location.getY(), -0.35, 0.35);

            boss.carrier.teleport(new Location(boss.world, newX, newY, newZ,
                    location.getYaw(), location.getPitch()));
        } catch (e) { }
    }

    function idleHover(boss) {
        try {
            var location = boss.carrier.getLocation();
            var desiredY = groundSurfaceYNear(boss.world, location.getX(), location.getZ(),
                    location.getY()) + HOVER_FEET
                    + Math.sin(globalTick / 25.0) * HOVER_BOB_AMPLITUDE;
            var newY = location.getY() + clamp(desiredY - location.getY(), -0.25, 0.25);
            boss.carrier.teleport(new Location(boss.world, location.getX(), newY,
                    location.getZ(), location.getYaw(), location.getPitch()));
        } catch (e) { }
    }

    function faceLocation(boss, location) {
        try {
            var current = boss.carrier.getLocation();
            var dx = location.getX() - current.getX();
            var dz = location.getZ() - current.getZ();
            var yaw = (Math.atan2(-dx, dz) * 180.0 / Math.PI);
            boss.carrier.teleport(new Location(boss.world, current.getX(), current.getY(),
                    current.getZ(), yaw, 0));
        } catch (e) { }
    }

    function updateMovement(boss, target) {
        try {
            var location = boss.carrier.getLocation();
            var targetLocation = target.getLocation();
            var dx = targetLocation.getX() - location.getX();
            var dz = targetLocation.getZ() - location.getZ();
            var horizontal = Math.sqrt(dx * dx + dz * dz);
            if (horizontal < 0.001) return;

            faceLocation(boss, targetLocation);

            if (horizontal > PURSUE_DISTANCE) {
                hoverToward(boss, targetLocation.getX(), targetLocation.getZ(), MOVE_SPEED);
            } else if (horizontal < KEEP_DISTANCE) {
                // 太近则保持距离，避免贴脸推挤玩家
                var backX = location.getX() - dx / horizontal * MOVE_SPEED * 0.6;
                var backZ = location.getZ() - dz / horizontal * MOVE_SPEED * 0.6;
                hoverToward(boss, backX, backZ, MOVE_SPEED * 0.6);
            } else {
                // 攻击距离内做小幅度环绕，制造压迫感
                var direction = (Math.floor(globalTick / 90) % 2 === 0) ? 1.0 : -1.0;
                var orbitX = location.getX() - dz / horizontal * MOVE_SPEED * 0.35 * direction;
                var orbitZ = location.getZ() + dx / horizontal * MOVE_SPEED * 0.35 * direction;
                hoverToward(boss, orbitX, orbitZ, MOVE_SPEED * 0.35);
            }
        } catch (e) { }
    }

    // ---------------------------------------------------------------------------
    // 近战：每 3 秒挥砍一次，单次三段伤害判定
    // ---------------------------------------------------------------------------

    function startMeleeSwing(boss, target) {
        boss.meleeSwingStartTick = globalTick;
        boss.meleeSwingEndTick = globalTick + MELEE_SWING_TICKS;
        boss.meleeHitIndex = 0;
        boss.nextMeleeHitTick = globalTick + 2;
        var interval = boss.isClone ? CLONE_MELEE_INTERVAL_TICKS : MELEE_INTERVAL_TICKS;
        boss.nextMeleeTick = globalTick + interval;

        try {
            var location = boss.carrier.getLocation();
            boss.world.playSound(location, Sound.ENTITY_PLAYER_ATTACK_SWEEP, 1.4, 0.7);
            boss.world.playSound(location, Sound.ENTITY_ENDERMAN_SCREAM, 0.8, 1.4);
        } catch (e) { }
    }

    function performMeleeHit(boss) {
        try {
            var location = boss.carrier.getLocation();
            var world = boss.world;
            var damage = boss.isClone ? CLONE_DAMAGE : MELEE_DAMAGE_PER_HIT;

            var targets = getAttackTargets(boss);
            var hitAny = false;
            for (var i = 0; i < targets.length; i++) {
                var meleeTarget = targets[i];
                if (!meleeTarget || meleeTarget.isDead()) continue;
                if (meleeTarget.getLocation().distanceSquared(location)
                        > MELEE_RANGE * MELEE_RANGE) {
                    continue;
                }
                hitAny = true;
                meleeTarget.damage(damage, boss.carrier);
                try {
                    var push = meleeTarget.getLocation().toVector()
                            .subtract(location.toVector()).normalize().multiply(MELEE_KNOCKBACK);
                    push.setY(0.28);
                    meleeTarget.setVelocity(push);
                } catch (e) { }
            }

            // 刀光粒子
            var yaw = location.getYaw() * Math.PI / 180.0;
            for (var k = 0; k < 12; k++) {
                var angle = yaw + (k / 12.0 - 0.5) * Math.PI * 1.1;
                var radius = 2.2;
                world.spawnParticle(Particle.SWEEP_ATTACK,
                        location.getX() - Math.sin(angle) * radius,
                        location.getY() + 1.1,
                        location.getZ() + Math.cos(angle) * radius,
                        1, 0.0, 0.0, 0.0, 0.0);
            }
            if (hitAny) {
                world.playSound(location, Sound.ENTITY_PLAYER_ATTACK_STRONG, 1.2, 0.9);
            }
        } catch (e) {
            log.error("ThousandFacedWitch 近战判定异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    function updateMelee(boss, target) {
        // 三段判定的推进（与挥砍触发解耦，保证三段一定打完）
        if (boss.meleeHitIndex < MELEE_HIT_COUNT && globalTick >= boss.nextMeleeHitTick) {
            performMeleeHit(boss);
            boss.meleeHitIndex++;
            boss.nextMeleeHitTick = globalTick + MELEE_HIT_GAP_TICKS;
        }

        // 挥砍触发：冷却结束且目标进入近战范围
        if (!target) return;
        if (globalTick < boss.nextMeleeTick) return;

        var distance = target.getLocation().distanceSquared(boss.carrier.getLocation());
        if (distance <= MELEE_RANGE * MELEE_RANGE) {
            startMeleeSwing(boss, target);
        }
    }

    // ---------------------------------------------------------------------------
    // 魔法飞弹：悬停 2 秒（龙息粒子）后高速射向玩家，不追踪
    // ---------------------------------------------------------------------------

    function fireMagicMissile(boss, target) {
        try {
            var center = getBossCenter(boss);
            var targetLocation = target.getLocation().clone().add(0, 1.0, 0);
            var direction = targetLocation.toVector().subtract(center.toVector());
            if (direction.lengthSquared() < 0.001) return;
            direction.normalize();

            var spawnLoc = center.clone().add(direction.clone().multiply(1.6));

            var missile = boss.world.spawn(spawnLoc, DragonFireballClass);
            if (!missile) return;

            try { missile.setShooter(boss.carrier); } catch (e) { }
            try { missile.setDirection(direction); } catch (e) { }
            // 悬停阶段速度接近 0，仅留极小位移让粒子有拖尾
            try { missile.setVelocity(direction.clone().multiply(0.02)); } catch (e) { }
            try { missile.setYield(0.0); } catch (e) { }
            missile.addScoreboardTag(MISSILE_TAG);

            var uuid = String(missile.getUniqueId().toString());
            trackedMissiles[uuid] = {
                proj: missile,
                ownerUuid: boss.uuid,
                lockedDirection: direction.clone(),
                hoverTicksLeft: MAGIC_MISSILE_HOVER_TICKS,
                life: MAGIC_MISSILE_LIFE_TICKS,
                launched: false,
                damage: MAGIC_MISSILE_DAMAGE
            };

            // 悬停期龙息粒子
            try {
                boss.world.spawnParticle(Particle.DRAGON_BREATH, spawnLoc, 18, 0.3, 0.3, 0.3, 0.02);
            } catch (e) { }
        } catch (e) {
            log.error("ThousandFacedWitch 魔法飞弹生成异常：" + e
                    + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    function updateMissiles() {
        for (var uuid in trackedMissiles) {
            if (!trackedMissiles.hasOwnProperty(uuid)) continue;
            var entry = trackedMissiles[uuid];
            try {
                var proj = entry.proj;
                if (!proj || !proj.isValid() || proj.isDead()) {
                    delete trackedMissiles[uuid];
                    continue;
                }

                var location = proj.getLocation();
                var world = location.getWorld();

                if (!entry.launched) {
                    // 悬停阶段：定住位置 + 龙息粒子
                    entry.hoverTicksLeft--;
                    try { proj.setVelocity(new Vector(0, 0, 0)); } catch (e) { }
                    world.spawnParticle(Particle.DRAGON_BREATH, location, 12, 0.25, 0.25, 0.25, 0.02);
                    world.spawnParticle(Particle.SQUID_INK, location, 4, 0.2, 0.2, 0.2, 0.01);

                    if (entry.hoverTicksLeft <= 0) {
                        // 2 秒延迟结束：锁定“此刻”玩家位置，快速射出
                        entry.launched = true;
                        var boss = activeBosses[entry.ownerUuid] || null;
                        var targetPlayer = boss ? findNearestTarget(location, world, 48.0, boss) : null;
                        var aimPoint = targetPlayer
                                ? targetPlayer.getLocation().clone().add(0, 1.0, 0)
                                : location.clone().add(entry.lockedDirection.clone().multiply(20));
                        var launchDirection = aimPoint.toVector().subtract(location.toVector());
                        if (launchDirection.lengthSquared() < 0.001) {
                            launchDirection = entry.lockedDirection.clone();
                        }
                        launchDirection.normalize();
                        try { proj.setDirection(launchDirection); } catch (e) { }
                        try {
                            proj.setVelocity(launchDirection.multiply(MAGIC_MISSILE_SPEED));
                        } catch (e) { }
                        world.playSound(location, Sound.ENTITY_ENDER_DRAGON_SHOOT, 1.4, 1.1);
                        world.spawnParticle(Particle.DRAGON_BREATH, location, 30, 0.4, 0.4, 0.4, 0.08);
                    }
                    continue;
                }

                // 飞行阶段：尾迹 + 命中判定（命中由 ProjectileHitEvent 处理）
                world.spawnParticle(Particle.DRAGON_BREATH, location, 6, 0.12, 0.12, 0.12, 0.01);
                entry.life--;
                if (entry.life <= 0) {
                    delete trackedMissiles[uuid];
                    try { proj.remove(); } catch (e) { }
                }
            } catch (e) {
                delete trackedMissiles[uuid];
            }
        }
    }

    function handleMissileHit(entry, hitLocation) {
        try {
            var world = hitLocation.getWorld();
            world.spawnParticle(Particle.DRAGON_BREATH, hitLocation, 45, 1.0, 1.0, 1.0, 0.06);
            world.spawnParticle(Particle.SQUID_INK, hitLocation, 25, 0.9, 0.9, 0.9, 0.03);
            world.playSound(hitLocation, Sound.ENTITY_DRAGON_FIREBALL_EXPLODE, 1.5, 1.2);

            var ownerBoss = activeBosses[entry.ownerUuid] || null;
            var targets = ownerBoss ? getAttackTargets(ownerBoss) : [];
            if (!ownerBoss) {
                var players = world.getPlayers();
                for (var p = 0; p < players.size(); p++) {
                    var fallbackTarget = players.get(p);
                    if (fallbackTarget && !fallbackTarget.isDead()) targets.push(fallbackTarget);
                }
            }
            for (var i = 0; i < targets.length; i++) {
                var missileTarget = targets[i];
                if (!missileTarget || missileTarget.isDead()) continue;
                if (missileTarget.getLocation().distanceSquared(hitLocation)
                        <= MAGIC_MISSILE_RADIUS * MAGIC_MISSILE_RADIUS) {
                    if (entry.proj != null && entry.proj.isValid()) {
                        missileTarget.damage(entry.damage, entry.proj);
                    } else {
                        missileTarget.damage(entry.damage);
                    }
                }
            }
        } catch (e) {
            log.error("ThousandFacedWitch 魔法飞弹命中处理异常：" + e);
        }
    }

    // ---------------------------------------------------------------------------
    // 瞬影：召唤 2~5 个幻影（HP 10，外观与伤害同本体）
    // ---------------------------------------------------------------------------

    function spawnClone(boss, spawnLoc) {
        try {
            var world = boss.world;
            var carrier = world.spawn(spawnLoc, HuskClass);
            if (!carrier) return null;

            carrier.setAI(false);
            carrier.setInvisible(true);
            carrier.setSilent(true);
            carrier.setGravity(false);
            carrier.setPersistent(true);
            carrier.setRemoveWhenFarAway(false);
            carrier.setCanPickupItems(false);
            carrier.setCollidable(false);
            try { carrier.setShouldBurnInDay(false); } catch (e) { }
            carrier.setCustomName(ChatColor.DARK_PURPLE + BOSS_NAME);
            carrier.setCustomNameVisible(false);
            carrier.setMaximumNoDamageTicks(0);
            carrier.setNoDamageTicks(0);
            carrier.addScoreboardTag(CLONE_TAG);

            var maxHealthAttribute = getOrRegisterAttribute(carrier, Attribute.MAX_HEALTH);
            if (maxHealthAttribute) maxHealthAttribute.setBaseValue(CLONE_HEALTH);
            var scaleAttribute = getOrRegisterAttribute(carrier, Attribute.SCALE);
            if (scaleAttribute) scaleAttribute.setBaseValue(CLONE_SCALE);
            try { carrier.setHealth(CLONE_HEALTH); } catch (e) { }

            var uuid = String(carrier.getUniqueId().toString());
            carrier.getPersistentDataContainer().set(OWNER_KEY, PersistentDataType.STRING, uuid);

            var sword = createSwordDisplay(world, spawnLoc);
            if (sword) {
                sword.getPersistentDataContainer().set(OWNER_KEY, PersistentDataType.STRING, uuid);
                try { sword.getScoreboardTags().add(CLONE_DISPLAY_TAG); } catch (e) { }
            }

            var clone = {
                id: BOSS_ID,
                uuid: uuid,
                isClone: true,
                ownerUuid: boss.uuid,
                carrier: carrier,
                sword: sword,
                display: sword,
                world: world,
                bar: null,
                barKey: null,
                objective: null,
                scoreKey: null,
                spawnTick: globalTick,
                target: null,

                nextMeleeTick: globalTick + 20,
                meleeSwingStartTick: 0,
                meleeSwingEndTick: 0,
                meleeHitIndex: 0,
                nextMeleeHitTick: 0,

                nextMagicMissileTick: globalTick + 60,
                nextCloneSpellTick: 0,
                cloneCount: 0,

                phase2Triggered: true,
                pendingPhase: false,
                transitioning: false,
                transitionStartTick: 0,
                transitionEndTick: 0,
                spin: 0.0,

                nextDarknessTick: 0,
                nextQiSlashTick: 0,
                qiCharge: null,

                dead: false,
                deathStartTick: 0,
                deathEndTick: 0,
                deathLocation: null,
                clearing: false
            };

            activeClones[uuid] = clone;

            world.spawnParticle(Particle.SQUID_INK, spawnLoc, 60, 1.0, 1.0, 1.0, 0.04);
            world.spawnParticle(Particle.SOUL, spawnLoc, 30, 0.9, 0.9, 0.9, 0.02);
            world.playSound(spawnLoc, Sound.ENTITY_ENDERMAN_TELEPORT, 1.2, 1.3);
            return clone;
        } catch (e) {
            log.error("ThousandFacedWitch 幻影生成异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
            return null;
        }
    }

    function castCloneSpell(boss) {
        try {
            var world = boss.world;
            var center = getBossCenter(boss);
            var count = CLONE_MIN_COUNT
                    + Math.floor(Math.random() * (CLONE_MAX_COUNT - CLONE_MIN_COUNT + 1));

            var spawned = 0;
            for (var i = 0; i < count; i++) {
                var angle = (Math.PI * 2.0 * i / count) + Math.random() * 0.6;
                var radius = CLONE_SPAWN_RADIUS_MIN
                        + Math.random() * (CLONE_SPAWN_RADIUS_MAX - CLONE_SPAWN_RADIUS_MIN);
                var x = center.getX() + Math.cos(angle) * radius;
                var z = center.getZ() + Math.sin(angle) * radius;
                var y = groundSurfaceYNear(world, x, z, center.getY()) + HOVER_FEET;
                var spawnLoc = new Location(world, x, y, z, 0, 0);

                world.spawnParticle(Particle.SQUID_INK, spawnLoc, 40, 0.8, 0.8, 0.8, 0.04);
                if (spawnClone(boss, spawnLoc)) spawned++;
            }

            boss.cloneCount = spawned;
            boss.nextCloneSpellTick = globalTick + CLONE_SPELL_COOLDOWN_TICKS;

            world.playSound(center, Sound.ENTITY_ENDERMAN_SCREAM, 1.4, 1.1);
            world.spawnParticle(Particle.PORTAL, center, 80, 1.5, 1.0, 1.5, 0.4);

            var players = world.getPlayers();
            for (var p = 0; p < players.size(); p++) {
                var player = players.get(p);
                if (!player || player.isDead()) continue;
                if (player.getLocation().distanceSquared(center) <= 48.0 * 48.0) {
                    player.sendMessage(ChatColor.DARK_PURPLE + "[" + BOSS_NAME + "] "
                            + ChatColor.LIGHT_PURPLE + "千面之影浮现……");
                }
            }
            log.info("ThousandFacedWitch 施放瞬影，生成幻影 " + spawned + " 个。");
        } catch (e) {
            log.error("ThousandFacedWitch 瞬影异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    function updateCloneSpell(boss) {
        // 冷却与“幻影全灭”双条件：只要还有幻影存活就不能再次施放
        if (globalTick < boss.nextCloneSpellTick) return;
        if (countAliveClones(boss.uuid) > 0) return;
        castCloneSpell(boss);
    }

    // ---------------------------------------------------------------------------
    // 阶段转换：HP < 325 → 无敌旋转 → 落雷解除无敌 → 二阶段
    // ---------------------------------------------------------------------------

    function startPhaseTransition(boss) {
        if (!boss || boss.dead || boss.phase2Triggered) return;
        if (!boss.carrier || !boss.carrier.isValid()) return;

        boss.pendingPhase = false;
        boss.phase2Triggered = true;
        boss.transitioning = true;
        boss.transitionStartTick = globalTick;
        boss.transitionEndTick = globalTick + PHASE_TRANSITION_TICKS;
        boss.meleeHitIndex = MELEE_HIT_COUNT;
        boss.qiCharge = null;

        try { boss.carrier.setInvulnerable(true); } catch (e) { }
        try {
            if (boss.bar) {
                boss.bar.setTitle(ChatColor.DARK_PURPLE + BOSS_NAME + ChatColor.GRAY
                        + "  |  " + ChatColor.LIGHT_PURPLE + "" + ChatColor.BOLD + "觉醒中...");
                boss.bar.setColor(BarColor.PINK);
            }
        } catch (e) { }

        var location = getBossCenter(boss);
        playSoundAt(location, Sound.ENTITY_ENDERMAN_SCREAM, 2.0, 0.6);
        playSoundAt(location, Sound.ENTITY_WITHER_SPAWN, 1.4, 1.2);

        var players = boss.world.getPlayers();
        for (var i = 0; i < players.size(); i++) {
            var player = players.get(i);
            if (!player || player.isDead()) continue;
            if (player.getLocation().distanceSquared(location) <= 60.0 * 60.0) {
                player.sendTitle(ChatColor.DARK_PURPLE + "千 面 觉 醒",
                        ChatColor.LIGHT_PURPLE + BOSS_NAME + " 正在揭开新的面孔……", 5, 60, 10);
                player.sendMessage(ChatColor.DARK_PURPLE + "[" + BOSS_NAME + "] " + ChatColor.RED
                        + "生命值低于 " + Math.round(PHASE_THRESHOLD) + "，即将进入第二阶段！");
            }
        }
        log.info("ThousandFacedWitch 进入阶段转换（HP < " + PHASE_THRESHOLD + "）。");
    }

    function updatePhaseTransition(boss) {
        var elapsed = globalTick - boss.transitionStartTick;
        var on = (Math.floor(elapsed / 2) % 2 === 0);

        try {
            // 原地高速旋转
            boss.spin = (boss.spin + PHASE_SPIN_DEGREES_PER_TICK) % 360.0;
            if (boss.sword && boss.sword.isValid()) {
                var base = boss.carrier.getLocation();
                boss.sword.teleport(new Location(boss.world, base.getX(),
                        base.getY() + DISPLAY_CENTER_Y * 0.62, base.getZ()));
                boss.sword.setRotation((globalTick * 30.0) % 360.0, 0);
                setDisplayTransform(boss.sword, on ? DISPLAY_SCALE * 1.15 : DISPLAY_SCALE, boss.spin);
            }

            var location = getBossCenter(boss);
            var world = boss.world;
            if (elapsed % 2 === 0) {
                world.spawnParticle(Particle.SQUID_INK, location, 70, 2.0, 1.6, 2.0, 0.06);
                world.spawnParticle(Particle.SOUL, location, 30, 1.8, 1.4, 1.8, 0.05);
                world.spawnParticle(Particle.PORTAL, location, 40, 1.6, 1.2, 1.6, 0.5);
            }
            if (elapsed % 10 === 0) {
                playSoundAt(location, Sound.ENTITY_ENDERMAN_AMBIENT, 1.6, 0.7);
            }
        } catch (e) { }

        if (globalTick >= boss.transitionEndTick) {
            boss.transitioning = false;
            finishPhaseTransition(boss);
        }
    }

    function finishPhaseTransition(boss) {
        try {
            var location = getBossCenter(boss).clone();
            var world = boss.world;

            // 落雷解除无敌（仅视觉效果，不造成伤害）
            world.strikeLightningEffect(location);
            world.strikeLightningEffect(location.clone().add(2.5, 0, 2.5));
            world.strikeLightningEffect(location.clone().add(-2.5, 0, -2.5));
            playSoundAt(location, Sound.ENTITY_LIGHTNING_BOLT_THUNDER, 2.0, 1.0);

            // 二阶段登场冲击
            world.spawnParticle(Particle.SQUID_INK, location, 200, 3.0, 2.0, 3.0, 0.08);
            world.spawnParticle(Particle.SOUL, location, 90, 2.6, 1.8, 2.6, 0.06);
            world.createExplosion(location, 0.0, false, false, null);

            try {
                if (boss.sword && boss.sword.isValid()) {
                    setDisplayTransform(boss.sword, DISPLAY_SCALE, boss.spin);
                }
            } catch (e) { }

            scheduleSync(2, function() {
                try {
                    if (boss.carrier && boss.carrier.isValid()) {
                        boss.carrier.setInvulnerable(false);
                    }
                } catch (e) { }
            });

            try {
                if (boss.bar) {
                    boss.bar.setTitle(bossBarTitle(boss.carrier.getHealth()));
                    boss.bar.setColor(BarColor.PURPLE);
                }
            } catch (e) { }

            boss.nextMeleeTick = globalTick + 40;
            boss.nextMagicMissileTick = globalTick + 60;
            boss.nextCloneSpellTick = globalTick + 120;
            boss.nextDarknessTick = globalTick + 100;
            boss.nextQiSlashTick = globalTick + 160;

            var players = world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var player = players.get(i);
                if (!player || player.isDead()) continue;
                if (player.getLocation().distanceSquared(location) <= 60.0 * 60.0) {
                    player.sendTitle(ChatColor.DARK_PURPLE + "" + ChatColor.BOLD + "第 二 阶 段",
                            ChatColor.LIGHT_PURPLE + "黑雾更浓了……", 5, 50, 12);
                }
            }
            log.info("ThousandFacedWitch 已进入第二阶段。");
        } catch (e) {
            log.error("ThousandFacedWitch 阶段转换收尾异常：" + e);
        }
    }

    // ---------------------------------------------------------------------------
    // 二阶段技能：黑暗 / 剑气
    // ---------------------------------------------------------------------------

    function castDarkness(boss) {
        try {
            var center = getBossCenter(boss);
            var world = boss.world;
            var affected = 0;
            var players = world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var player = players.get(i);
                if (!player || player.isDead() || !player.isOnline()) continue;
                if (player.getLocation().distanceSquared(center) > DARKNESS_RANGE * DARKNESS_RANGE) {
                    continue;
                }
                try {
                    player.addPotionEffect(new PotionEffect(PotionEffectType.DARKNESS,
                            DARKNESS_DURATION_TICKS, 0, false, true, true));
                } catch (e) { }
                player.sendMessage(ChatColor.DARK_PURPLE + "[" + BOSS_NAME + "] "
                        + ChatColor.DARK_GRAY + "视野被黑雾吞没……");
                affected++;
            }

            boss.nextDarknessTick = globalTick + DARKNESS_COOLDOWN_TICKS;
            world.playSound(center, Sound.ENTITY_WARDEN_SONIC_BOOM, 1.2, 0.7);
            world.spawnParticle(Particle.SQUID_INK, center, 140, DARKNESS_RANGE * 0.5, 1.5,
                    DARKNESS_RANGE * 0.5, 0.05);
            world.spawnParticle(Particle.SCULK_SOUL, center, 50, DARKNESS_RANGE * 0.4, 1.2,
                    DARKNESS_RANGE * 0.4, 0.03);
            log.info("ThousandFacedWitch 施放黑暗，影响玩家 " + affected + " 名。");
        } catch (e) {
            log.error("ThousandFacedWitch 黑暗施放异常：" + e);
        }
    }

    function startQiCharge(boss, target) {
        try {
            boss.qiCharge = {
                startTick: globalTick,
                endTick: globalTick + QI_CHARGE_TICKS,
                targetUuid: String(target.getUniqueId().toString())
            };
            boss.nextQiSlashTick = globalTick + QI_CHARGE_TICKS + QI_SLASH_COOLDOWN_TICKS;

            var center = getBossCenter(boss);
            playSoundAt(center, Sound.ENTITY_ENDERMAN_SCREAM, 1.6, 0.9);
            var players = boss.world.getPlayers();
            for (var i = 0; i < players.size(); i++) {
                var player = players.get(i);
                if (!player || player.isDead()) continue;
                if (player.getLocation().distanceSquared(center) <= 30.0 * 30.0) {
                    player.sendTitle(ChatColor.DARK_PURPLE + "蓄 力",
                            ChatColor.LIGHT_PURPLE + "千面魔女正在凝聚剑气！", 0, 40, 5);
                }
            }
        } catch (e) { }
    }

    function updateQiCharge(boss) {
        if (!boss.qiCharge) return;
        try {
            var center = getBossCenter(boss);
            var world = boss.world;
            var elapsed = globalTick - boss.qiCharge.startTick;
            var progress = clamp(elapsed / Math.max(1, QI_CHARGE_TICKS), 0.0, 1.0);

            // 蓄力期间的黑雾向内收拢 + 刀光聚能
            world.spawnParticle(Particle.SQUID_INK, center, 26, 0.6, 1.2, 0.6, 0.02);
            world.spawnParticle(Particle.SOUL, center, 14, 0.5, 1.0, 0.5, 0.02);

            var radius = 2.6 * (1.0 - progress) + 0.4;
            for (var k = 0; k < 16; k++) {
                var angle = k / 16.0 * Math.PI * 2.0 + globalTick * 0.25;
                world.spawnParticle(Particle.SWEEP_ATTACK,
                        center.getX() + Math.cos(angle) * radius,
                        center.getY() + 0.8 + Math.sin(globalTick * 0.3) * 0.3,
                        center.getZ() + Math.sin(angle) * radius,
                        1, 0.0, 0.0, 0.0, 0.0);
            }
            if (elapsed % 8 === 0) {
                playSoundAt(center, Sound.BLOCK_BEACON_ACTIVATE, 1.0, 0.8 + progress * 0.6);
            }

            if (globalTick >= boss.qiCharge.endTick) {
                var charge = boss.qiCharge;
                boss.qiCharge = null;
                launchQiSlash(boss, charge);
            }
        } catch (e) {
            boss.qiCharge = null;
        }
    }

    function launchQiSlash(boss, charge) {
        try {
            var world = boss.world;
            var center = getBossCenter(boss);

            // 朝最近的玩家（优先蓄力时锁定的目标）
            var target = null;
            if (charge && charge.targetUuid) {
                target = findEntityByUuid(world, charge.targetUuid);
            }
            if (!target) target = findNearestTarget(center, world, 48.0, boss);

            var direction;
            if (target) {
                var aim = target.getLocation().clone().add(0, 1.0, 0).toVector()
                        .subtract(center.toVector());
                if (aim.lengthSquared() < 0.001) aim = new Vector(0, 0, 1);
                direction = aim.normalize();
            } else {
                direction = new Vector(0, 0, 1);
            }
            direction.setY(0);
            if (direction.lengthSquared() < 0.001) direction = new Vector(0, 0, 1);
            direction.normalize();

            activeQiSlashes[boss.uuid] = {
                ownerUuid: boss.uuid,
                location: center.clone(),
                direction: direction,
                travelled: 0.0,
                hitPlayers: {},
                passedShieldCheck: false
            };

            world.playSound(center, Sound.ENTITY_PLAYER_ATTACK_SWEEP, 2.0, 0.6);
            world.playSound(center, Sound.ENTITY_ENDER_DRAGON_FLAP, 1.5, 0.8);
        } catch (e) {
            log.error("ThousandFacedWitch 剑气发射异常：" + e);
        }
    }

    function damagePlayerIgnoringShield(player, damage, source) {
        // 破盾：先记录是否举盾，再造成伤害；随后移除举盾状态并施加短暂禁用。
        var wasBlocking = false;
        try { wasBlocking = player.isBlocking(); } catch (e) { }

        try {
            if (source != null) {
                player.damage(damage, source);
            } else {
                player.damage(damage);
            }
        } catch (e) { }

        if (wasBlocking) {
            try {
                // 清理举盾状态，使盾牌无法继续抵挡后续伤害
                player.clearActiveItem();
            } catch (e) { }
            try {
                player.setCooldown(Material.SHIELD, QI_SHIELD_DISABLE_TICKS);
            } catch (e) { }
            try {
                player.sendMessage(ChatColor.DARK_PURPLE + "[" + BOSS_NAME + "] "
                        + ChatColor.RED + "你的盾牌被剑气击碎了！");
            } catch (e) { }
        }
    }

    function updateQiSlashes() {
        for (var ownerUuid in activeQiSlashes) {
            if (!activeQiSlashes.hasOwnProperty(ownerUuid)) continue;
            var slash = activeQiSlashes[ownerUuid];
            try {
                var world = slash.location.getWorld();
                if (slash.travelled >= QI_RANGE) {
                    delete activeQiSlashes[ownerUuid];
                    continue;
                }

                // 前进
                var step = slash.direction.clone().multiply(QI_STEP);
                slash.location = slash.location.clone().add(step);
                slash.travelled += QI_STEP;

                var location = slash.location;

                // 剑气视觉：横向刀光 + 黑雾
                for (var k = 0; k < 14; k++) {
                    var offset = (k / 13.0 - 0.5) * 4.0;
                    var side = new Vector(-slash.direction.getZ(), 0, slash.direction.getX())
                            .multiply(offset);
                    world.spawnParticle(Particle.SWEEP_ATTACK,
                            location.getX() + side.getX(),
                            location.getY() + 0.9,
                            location.getZ() + side.getZ(),
                            1, 0.0, 0.0, 0.0, 0.0);
                }
                world.spawnParticle(Particle.SQUID_INK, location, 16, 0.5, 0.7, 0.5, 0.02);
                world.spawnParticle(Particle.SOUL, location, 6, 0.4, 0.6, 0.4, 0.01);
                if (globalTick % 3 === 0) {
                    playSoundAt(location, Sound.ENTITY_PLAYER_ATTACK_SWEEP, 1.0, 1.4);
                }

                // 命中判定
                var ownerBoss = activeBosses[ownerUuid] || null;
                var targets = ownerBoss ? getAttackTargets(ownerBoss) : [];
                if (!ownerBoss) {
                    var players = world.getPlayers();
                    for (var q = 0; q < players.size(); q++) {
                        var fallbackQi = players.get(q);
                        if (fallbackQi && !fallbackQi.isDead()) targets.push(fallbackQi);
                    }
                }
                for (var i = 0; i < targets.length; i++) {
                    var qiTarget = targets[i];
                    if (!qiTarget || qiTarget.isDead()) continue;
                    var targetUuid = String(qiTarget.getUniqueId().toString());
                    if (slash.hitPlayers[targetUuid]) continue;
                    if (qiTarget.getLocation().distanceSquared(location)
                            > QI_HIT_RADIUS * QI_HIT_RADIUS) {
                        continue;
                    }
                    slash.hitPlayers[targetUuid] = true;
                    damageTargetIgnoringShield(qiTarget, QI_DAMAGE,
                            ownerBoss ? ownerBoss.carrier : null);
                }
            } catch (e) {
                delete activeQiSlashes[ownerUuid];
            }
        }
    }

    // ---------------------------------------------------------------------------
    // 死亡序列：黑雾笼罩消散 + 清除全部幻影
    // ---------------------------------------------------------------------------

    function startDeathSequence(boss) {
        if (!boss || boss.dead) return;
        boss.dead = true;
        boss.transitioning = false;
        boss.pendingPhase = false;
        boss.phase2Triggered = true;
        boss.meleeHitIndex = MELEE_HIT_COUNT;
        boss.qiCharge = null;

        boss.deathStartTick = globalTick;
        boss.deathEndTick = globalTick + DEATH_SEQUENCE_TICKS;
        boss.deathLocation = getBossCenter(boss).clone();

        try { boss.carrier.setInvulnerable(true); } catch (e) { }
        removeBossBar(boss);

        // 死亡时清除场上所有幻影
        removeAllClones("本体死亡");

        var location = boss.deathLocation.clone();
        playSoundAt(location, Sound.ENTITY_ENDERMAN_DEATH, 2.0, 0.7);
        playSoundAt(location, Sound.ENTITY_WITHER_DEATH, 1.2, 1.4);

        var players = boss.world.getPlayers();
        for (var i = 0; i < players.size(); i++) {
            var player = players.get(i);
            if (!player || player.isDead()) continue;
            if (player.getLocation().distanceSquared(location) <= 60.0 * 60.0) {
                player.sendTitle(ChatColor.DARK_PURPLE + BOSS_NAME + " 陨落",
                        ChatColor.DARK_GRAY + "她化作黑雾消散了……", 5, 45, 10);
            }
        }
        log.info("ThousandFacedWitch 进入死亡消散序列。");
    }

    function updateDeathSequence(boss, uuid) {
        var elapsed = globalTick - boss.deathStartTick;
        try {
            var location = boss.deathLocation;
            var world = boss.world;
            var progress = clamp(elapsed / Math.max(1, DEATH_SEQUENCE_TICKS), 0.0, 1.0);

            // 大剑随黑雾缓慢消散
            if (boss.sword && boss.sword.isValid()) {
                boss.sword.teleport(location.clone().add(0, 0.5 + progress * 0.8, 0));
                setDisplayTransform(boss.sword, DISPLAY_SCALE * (1.0 - progress * 0.6),
                        (globalTick * 18.0) % 360.0);
            }
            // 本体载具隐藏
            try { boss.carrier.setInvisible(true); } catch (e) { }

            world.spawnParticle(Particle.SQUID_INK, location, 60, 1.6, 1.8, 1.6, 0.05);
            world.spawnParticle(Particle.LARGE_SMOKE, location, 40, 1.4, 1.6, 1.4, 0.03);
            world.spawnParticle(Particle.SOUL, location, 24, 1.2, 1.4, 1.2, 0.04);
            world.spawnParticle(Particle.SCULK_SOUL, location, 12, 1.0, 1.2, 1.0, 0.03);
            if (elapsed % 8 === 0) {
                playSoundAt(location, Sound.ENTITY_ENDERMAN_AMBIENT, 1.2, 0.6);
            }
        } catch (e) { }

        if (globalTick >= boss.deathEndTick) {
            try {
                var finalLocation = boss.deathLocation.clone();
                boss.world.spawnParticle(Particle.SQUID_INK, finalLocation, 220, 2.6, 2.6, 2.6, 0.09);
                boss.world.spawnParticle(Particle.LARGE_SMOKE, finalLocation, 120, 2.4, 2.4, 2.4, 0.05);
                boss.world.spawnParticle(Particle.SOUL, finalLocation, 70, 2.0, 2.0, 2.0, 0.06);
                playSoundAt(finalLocation, Sound.ENTITY_ENDERMAN_TELEPORT, 2.0, 0.5);
            } catch (e) { }
            removeAllClones("死亡收尾");
            cleanupBoss(boss, uuid);
            log.info("ThousandFacedWitch 死亡序列完成。");
        }
    }

    // ---------------------------------------------------------------------------
    // 血条
    // ---------------------------------------------------------------------------

    function updateBossBar(boss) {
        if (globalTick % 5 !== 0) return;
        try {
            if (!boss.bar) return;
            if (boss.transitioning) return;

            var health = boss.dead ? 0.0 : boss.carrier.getHealth();
            boss.bar.setProgress(clamp(health / MAX_HEALTH, 0.0, 1.0));
            boss.bar.setTitle(bossBarTitle(health));

            // 让附近玩家自动看到血条
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

    // ---------------------------------------------------------------------------
    // 主逻辑
    // ---------------------------------------------------------------------------

    function updateCombatUnit(unit, uuid, isClone) {
        if (unit.dead) {
            if (isClone) {
                // 幻影只有死亡表现，立即清理
                try {
                    if (unit.display) { try { unit.display.remove(); } catch (e) { } }
                    if (unit.carrier) { try { unit.carrier.remove(); } catch (e) { } }
                } catch (e) { }
                delete activeClones[uuid];
            } else {
                updateDeathSequence(unit, uuid);
            }
            return;
        }

        if (!unit.carrier || !unit.carrier.isValid() || unit.carrier.isDead()) {
            if (isClone) {
                if (unit.display) { try { unit.display.remove(); } catch (e) { } }
                delete activeClones[uuid];
            } else {
                cleanupBoss(unit, uuid);
            }
            return;
        }

        // 阶段转换（仅本体）
        if (!isClone && !unit.phase2Triggered && !unit.pendingPhase
                && unit.carrier.getHealth() > 0.0
                && unit.carrier.getHealth() < PHASE_THRESHOLD) {
            unit.pendingPhase = true;
            scheduleSync(1, function() {
                startPhaseTransition(unit);
            });
        }

        if (unit.transitioning) {
            updatePhaseTransition(unit);
            return;
        }

        // 视觉与目标
        try {
            unit.carrier.setFireTicks(0);
            unit.carrier.setVisualFire(false);
        } catch (e) { }
        syncDisplay(unit);
        registerDouQuQuEntities(unit);
        spawnAuraParticles(unit, getBossCenter(unit), unit.world);
        if (!isClone) updateBossBar(unit);

        var target = findNearestTarget(unit.carrier.getLocation(), unit.world, TARGET_RANGE, unit);
        unit.target = target;

        // 蓄力中：不移动、不近战，只推进蓄力
        if (unit.qiCharge) {
            updateQiCharge(unit);
            return;
        }

        if (!target) {
            idleHover(unit);
            return;
        }

        updateMovement(unit, target);
        updateMelee(unit, target);

        if (isClone) {
            // 幻影只做近战与少量魔法飞弹
            if (globalTick >= unit.nextMagicMissileTick) {
                fireMagicMissile(unit, target);
                unit.nextMagicMissileTick = globalTick + MAGIC_MISSILE_COOLDOWN_TICKS * 2;
            }
            return;
        }

        // 本体：魔法飞弹
        if (globalTick >= unit.nextMagicMissileTick) {
            for (var shot = 0; shot < MAGIC_MISSILE_COUNT; shot++) {
                fireMagicMissile(unit, target);
            }
            unit.nextMagicMissileTick = globalTick + MAGIC_MISSILE_COOLDOWN_TICKS;
        }

        // 瞬影
        updateCloneSpell(unit);

        // 二阶段技能
        if (unit.phase2Triggered) {
            if (globalTick >= unit.nextDarknessTick) {
                castDarkness(unit);
            }
            if (globalTick >= unit.nextQiSlashTick && !unit.qiCharge) {
                startQiCharge(unit, target);
            }
        }
    }

    function updateAllBosses() {
        for (var uuid in activeBosses) {
            if (!activeBosses.hasOwnProperty(uuid)) continue;
            var boss = activeBosses[uuid];
            if (!boss) continue;
            try {
                updateCombatUnit(boss, uuid, false);
                if (activeBosses.hasOwnProperty(uuid) && activeBosses[uuid] === boss) {
                    syncBossScoreboard(boss);
                }
            } catch (e) {
                log.error("ThousandFacedWitch BOSS[" + uuid + "] tick 异常：" + e
                        + (e && e.stack ? "\n" + e.stack : ""));
            }
        }

        for (var cuuid in activeClones) {
            if (!activeClones.hasOwnProperty(cuuid)) continue;
            var clone = activeClones[cuuid];
            if (!clone) continue;
            try {
                updateCombatUnit(clone, cuuid, true);
            } catch (e) {
                log.error("ThousandFacedWitch 幻影[" + cuuid + "] tick 异常：" + e
                        + (e && e.stack ? "\n" + e.stack : ""));
                try {
                    if (clone.display) clone.display.remove();
                    if (clone.carrier) clone.carrier.remove();
                } catch (e2) { }
                delete activeClones[cuuid];
            }
        }
    }

    // ---------------------------------------------------------------------------
    // 事件注册
    // ---------------------------------------------------------------------------

    // 伤害入口：本体与幻影的统一处理（免疫火焰/爆炸、阶段无敌、只允许玩家来源）
    registerEvent("org.bukkit.event.entity.EntityDamageEvent", function(event) {
        try {
            var unit = getCombatUnitByEntity(event.getEntity());
            if (!unit) return;

            if (unit.dead || unit.transitioning) {
                event.setCancelled(true);
                return;
            }

            if (isFireOrExplosionDamage(event.getCause())) {
                event.setCancelled(true);
                return;
            }

            // 非玩家来源不造成伤害
            var source = null;
            try { source = event.getDamageSource(); } catch (e) { }
            var attacker = source != null ? source.getCausingEntity() : null;
            if (attacker == null && source != null) attacker = source.getDirectEntity();
            if (attacker != null && !(attacker instanceof PlayerClass)
                    && !isDisorderDamageSource(attacker)
                    && !isDouQuQuActive(unit)) {
                event.setCancelled(true);
                return;
            }

            // 幻影只有 10 点生命：命中即走正常伤害流程，由原版扣血
            if (unit.isClone) return;
        } catch (e) {
            log.error("ThousandFacedWitch 受伤事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // 近战 / 远程判定（子类事件会收到基类事件，必须 try/catch 取 getDamager）
    registerEvent("org.bukkit.event.entity.EntityDamageByEntityEvent", function(event) {
        try {
            var unit = getCombatUnitByEntity(event.getEntity());
            if (!unit || unit.dead || unit.transitioning) return;

            var damager = null;
            try { damager = event.getDamager(); } catch (e) { return; }
            if (damager == null) return;

            if (damager instanceof PlayerClass) {
                // 近战命中本体：触发一次可选的受击反馈（音效）
                var location = unit.carrier.getLocation();
                try {
                    unit.world.playSound(location, Sound.ENTITY_ENDERMAN_HURT, 0.9, 1.1);
                } catch (e) { }
                return;
            }

            if (damager instanceof ProjectileClass) {
                var shooter = null;
                try { shooter = damager.getShooter(); } catch (e) { }
                if (shooter instanceof PlayerClass) {
                    try {
                        unit.world.playSound(unit.carrier.getLocation(),
                                Sound.ENTITY_ENDERMAN_HURT, 0.8, 1.3);
                    } catch (e) { }
                }
            }
        } catch (e) {
            log.error("ThousandFacedWitch 近战/远程事件异常：" + e
                    + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // 死亡：本体进入死亡序列；幻影直接清除
    registerEvent("org.bukkit.event.entity.EntityDeathEvent", function(event) {
        try {
            var unit = getCombatUnitByEntity(event.getEntity());
            if (!unit) return;
            try { event.getDrops().clear(); } catch (e) { }
            try { event.setDroppedExp(0); } catch (e) { }

            if (unit.isClone) {
                var location = unit.carrier.getLocation();
                try {
                    unit.world.spawnParticle(Particle.SQUID_INK, location, 80, 1.0, 1.2, 1.0, 0.05);
                    unit.world.spawnParticle(Particle.SOUL, location, 30, 0.8, 1.0, 0.8, 0.03);
                    unit.world.playSound(location, Sound.ENTITY_ENDERMAN_DEATH, 1.2, 1.4);
                } catch (e) { }
                unit.dead = true;
                return;
            }

            startDeathSequence(unit);
        } catch (e) {
            log.error("ThousandFacedWitch 死亡事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // 投射物命中：魔法飞弹自定义命中（不产生原版爆炸）
    registerEvent("org.bukkit.event.entity.ProjectileHitEvent", function(event) {
        try {
            var projectile = event.getEntity();
            if (!projectile) return;
            var uuid = String(projectile.getUniqueId().toString());
            var entry = trackedMissiles[uuid];
            if (!entry) return;

            event.setCancelled(true);
            delete trackedMissiles[uuid];

            var hitLocation = projectile.getLocation().clone();
            try {
                if (event.getHitBlock() != null) {
                    hitLocation = event.getHitBlock().getLocation().add(0.5, 0.5, 0.5);
                }
            } catch (e) { }

            handleMissileHit(entry, hitLocation);
            try { projectile.remove(); } catch (e) { }
        } catch (e) {
            log.error("ThousandFacedWitch 投射物命中异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // 末影龙龙息弹命中会生成 AreaEffectCloud，必须拦截
    registerEvent("com.destroystokyo.paper.event.entity.EnderDragonFireballHitEvent", function(event) {
        try {
            var projectile = event.getEntity();
            if (!projectile) return;
            var uuid = String(projectile.getUniqueId().toString());
            var entry = trackedMissiles[uuid];
            if (!entry) return;

            event.setCancelled(true);
            delete trackedMissiles[uuid];
            handleMissileHit(entry, projectile.getLocation().clone());
            try { projectile.remove(); } catch (e) { }
        } catch (e) { }
    });

    // 玩家传送（末影珍珠等）：被剑气/飞弹锁定时无特殊处理，此处仅清理无效投射物
    registerEvent("org.bukkit.event.player.PlayerTeleportEvent", function(event) {
        try {
            // 目前无需处理；保留事件以确保后续扩展（如锁定类技能）有统一入口
        } catch (e) { }
    });

    // ---------------------------------------------------------------------------
    // 主循环
    // ---------------------------------------------------------------------------

    task.repeat(ticks(1), ticks(1), function() {
        globalTick++;
        try {
            processSyncDelayedTasks();
        } catch (e) {
            log.error("ThousandFacedWitch 延迟任务队列异常：" + e);
        }
        try {
            updateAllBosses();
        } catch (e) {
            log.error("ThousandFacedWitch 主循环异常：" + e);
        }
        try {
            updateMissiles();
        } catch (e) { }
        try {
            updateQiSlashes();
        } catch (e) { }
    });

    // 延迟 1 tick 清理上一次脚本实例遗留的实体与血条，避免在异步加载线程访问世界。
    scheduleSync(1, function() {
        cleanupOrphans();
    });

    // ---------------------------------------------------------------------------
    // BossRegistry 注册
    // ---------------------------------------------------------------------------

    var bossDefinition = {
        id: BOSS_ID,
        name: BOSS_NAME,
        aliases: ["千面魔女", "thousand_faced_witch", "thousandfacedwitch", "witch"],
        heartbeat: Date.now(),
        lore: [
            ChatColor.LIGHT_PURPLE + "生命值：" + ChatColor.WHITE + "650",
            ChatColor.GOLD + "免疫：火焰、岩浆、爆炸、闪电伤害",
            ChatColor.GRAY + "低空悬浮，可跨越复杂地形；近战玩家可以攻击到。",
            ChatColor.GRAY + "速度略快于步行、略慢于奔跑。",
            ChatColor.DARK_GRAY + "————————————————",
            ChatColor.YELLOW + "普通阶段：",
            ChatColor.GRAY + "· 大剑挥砍：每 3 秒一次，单次三段伤害判定",
            ChatColor.GRAY + "· 魔法飞弹：悬停 2 秒后高速射出，不追踪",
            ChatColor.GRAY + "· 瞬影：召唤 2~5 个幻影（HP 10，伤害同本体），冷却 60 秒",
            ChatColor.DARK_GRAY + "  须幻影全部死亡后才能再次施放",
            ChatColor.DARK_RED + "生命值低于 325 后觉醒",
            ChatColor.YELLOW + "第二阶段：",
            ChatColor.GRAY + "· 黑雾更浓，黑暗效果 10 秒（冷却 40 秒）",
            ChatColor.GRAY + "· 蓄力 3 秒后挥出剑气：高伤害且可破盾",
            ChatColor.DARK_PURPLE + "· 死亡时化作黑雾消散，并清除场上全部幻影"
        ],
        spawn: spawnThousandFacedWitch
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
                    log.warn("ThousandFacedWitch 注册到 /call 框架失败：" + e);
                }
            } catch (ignored) { }
        }
    }

    ensureRegistered();
    task.repeat(ticks(20), ticks(20), function() {
        ensureRegistered();
    });

    // ---------------------------------------------------------------------------
    // 启动日志
    // ---------------------------------------------------------------------------
    log.info("ThousandFacedWitch 已加载：使用 /call boss " + BOSS_NAME + " 获取召唤物品。");
})();
