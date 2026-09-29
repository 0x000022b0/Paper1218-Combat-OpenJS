/*
 * MagicBulletShooter.js —— 自定义武器「魔弹射手」（OpenJS 1.5.0）
 *
 * 获取方式：/equip arms 魔弹射手
 *
 * 特殊效果：
 *   - 弩魔改：基础伤害 20，无限耐久。
 *   - 自带穿透 5、快速装填 4，有附魔光效，但隐藏所有附魔文字。
 *   - 拦截 EntityShootBowEvent，不发射箭矢，改为发射 64 格蓝色激光；
 *     激光对沿途所有敌人各结算一次伤害，不区分队伍 / 队员。
 *   - 隐藏特性：每 6 次射击后的第 7 发激光必定瞄准队员（无队伍时回退为其他在线玩家）；
 *     如果单人模式没有可选目标，则直接对自己造成伤害；第 7 发伤害翻倍。
 */

// 作用域隔离：所有变量、常量和函数都封装在本 IIFE 内，
// 避免与其他 OpenJS 脚本的全局名称互相覆盖。
// 规范详见根目录《OpenJS脚本数据契约.md》。
(function () {
    "use strict";

    // -----------------------------------------------------------------------
    // Java / API 类型
    // -----------------------------------------------------------------------
    var Material = Java.type("org.bukkit.Material");
    var ItemStack = Java.type("org.bukkit.inventory.ItemStack");
    var ChatColor = Java.type("org.bukkit.ChatColor");
    var ItemFlag = Java.type("org.bukkit.inventory.ItemFlag");
    var Enchantment = Java.type("org.bukkit.enchantments.Enchantment");
    var PersistentDataType = Java.type("org.bukkit.persistence.PersistentDataType");
    var NamespacedKey = Java.type("org.bukkit.NamespacedKey");
    var Player = Java.type("org.bukkit.entity.Player");
    var LivingEntity = Java.type("org.bukkit.entity.LivingEntity");
    var Bukkit = Java.type("org.bukkit.Bukkit");
    var Vector = Java.type("org.bukkit.util.Vector");
    var Location = Java.type("org.bukkit.Location");
    var Particle = Java.type("org.bukkit.Particle");
    var DustOptions = Java.type("org.bukkit.Particle$DustOptions");
    var Color = Java.type("org.bukkit.Color");
    var Sound = Java.type("org.bukkit.Sound");
    var Class = Java.type("java.lang.Class");
    var Array = Java.type("java.lang.reflect.Array");
    var ItemFlagClass = Class.forName("org.bukkit.inventory.ItemFlag");

    // -----------------------------------------------------------------------
    // 数值配置
    // -----------------------------------------------------------------------
    var WEAPON_ID = "magic_bullet_shooter";
    var WEAPON_NAME = "魔弹射手";
    var EQUIP_SLOT = "arms";

    var WEAPON_KEY = new NamespacedKey(plugin, "magic_bullet_shooter_item");

    var BASE_DAMAGE = 20.0;
    var SPECIAL_DAMAGE = 40.0;      // 第 7 发伤害翻倍
    var LASER_RANGE = 64.0;
    var LASER_RADIUS = 0.6;
    var SHOTS_BEFORE_SPECIAL = 7;

    var BLUE_DUST = new DustOptions(Color.fromRGB(40, 120, 255), 1.2);
    var BLUE_CORE_DUST = new DustOptions(Color.fromRGB(180, 230, 255), 0.8);

    // -----------------------------------------------------------------------
    // 运行时状态
    // -----------------------------------------------------------------------
    var shotCounts = {};     // player uuid -> 连续射击计数（已发射数）
    var lastEquipRegistry = null;

    // -----------------------------------------------------------------------
    // 工具函数
    // -----------------------------------------------------------------------
    function isMagicWeapon(item) {
        try {
            if (item == null || item.getType() != Material.CROSSBOW) return false;
            if (!item.hasItemMeta()) return false;

            var meta = item.getItemMeta();
            if (meta == null) return false;

            var container = meta.getPersistentDataContainer();
            if (!container.has(WEAPON_KEY, PersistentDataType.STRING)) return false;
            return String(container.get(WEAPON_KEY, PersistentDataType.STRING)) === WEAPON_ID;
        } catch (e) {
            return false;
        }
    }

    function getPlayerId(player) {
        try {
            return String(player.getUniqueId().toString());
        } catch (e) {
            return "";
        }
    }

    function safeNormalize(vector) {
        if (!vector) return new Vector(0, 0, 1);
        if (vector.lengthSquared() < 0.0001) return new Vector(0, 0, 1);
        return vector.clone().normalize();
    }

    function isDamageableTarget(entity, owner) {
        try {
            if (!(entity instanceof LivingEntity)) return false;
            if (entity === owner) return false;
            if (entity.isDead() || !entity.isValid()) return false;
            if (String(entity.getType().name()) === "ARMOR_STAND") return false;
            if (entity instanceof Player) {
                if (!entity.isOnline()) return false;
                var mode = entity.getGameMode();
                if (mode != null && String(mode.name()) === "SPECTATOR") return false;
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    function damageSelf(player, amount) {
        try {
            if (!player || !player.isOnline() || player.isDead()) return;
            player.setNoDamageTicks(0);
            player.damage(amount);
        } catch (e) {
            log.error("MagicBulletShooter 自身伤害异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    function distanceSquaredToSegment(point, start, end) {
        var segment = end.clone().subtract(start);
        var lengthSquared = segment.lengthSquared();
        if (lengthSquared < 0.0001) return point.distanceSquared(start);

        var t = point.clone().subtract(start).dot(segment) / lengthSquared;
        if (t < 0.0) t = 0.0;
        if (t > 1.0) t = 1.0;

        var closest = start.clone().add(segment.multiply(t));
        return point.distanceSquared(closest);
    }

    // -----------------------------------------------------------------------
    // 物品构建 / 注册
    // -----------------------------------------------------------------------
    function createMagicBulletShooterItem() {
        var item = new ItemStack(Material.CROSSBOW, 1);
        var meta = item.getItemMeta();
        if (meta == null) return item;

        meta.setDisplayName(ChatColor.DARK_PURPLE + WEAPON_NAME);
        meta.setLore(toJavaList([
            ChatColor.YELLOW + "基础伤害：" + ChatColor.RED + "20",
            ChatColor.AQUA + "发射 64 格蓝色激光，攻击沿途所有敌人（不区分队员）"
        ]));

        meta.setUnbreakable(true);

        // 有附魔光效：真实附魔 + 隐藏附魔文字。
        try {
            meta.addEnchant(Enchantment.PIERCING, 5, true);
            meta.addEnchant(Enchantment.QUICK_CHARGE, 4, true);
            meta.setEnchantmentGlintOverride(true);
        } catch (e) {
            log.error("MagicBulletShooter 写入附魔失败：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }

        try {
            // 直接构造 ItemFlag[]，避免 OpenJS/Nashorn 的 Java 变参兼容问题。
            var array = Array.newInstance(ItemFlagClass, 2);
            Array.set(array, 0, ItemFlag.HIDE_ENCHANTS);
            Array.set(array, 1, ItemFlag.HIDE_UNBREAKABLE);
            meta.addItemFlags(array);
        } catch (e) { }

        meta.getPersistentDataContainer().set(WEAPON_KEY, PersistentDataType.STRING, WEAPON_ID);
        item.setItemMeta(meta);
        return item;
    }

    var magicWeaponDefinition = {
        id: WEAPON_ID,
        slot: EQUIP_SLOT,
        name: WEAPON_NAME,
        aliases: ["魔弹", "magic_bullet", "magicbullet"],
        create: createMagicBulletShooterItem
    };

    function ensureRegistered() {
        try {
            var registry = getShared("EquipRegistry");
            if (!registry) return;

            if (registry !== lastEquipRegistry || !registry.get(EQUIP_SLOT, WEAPON_ID)) {
                registry.register(magicWeaponDefinition);
                lastEquipRegistry = registry;
            } else {
                registry.heartbeat(EQUIP_SLOT, WEAPON_ID);
            }
        } catch (e) {
            log.error("MagicBulletShooter 注册装备失败：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    ensureRegistered();
    task.repeat(ticks(20), ticks(20), ensureRegistered);

    // -----------------------------------------------------------------------
    // 队员选择 / 激光结算
    // -----------------------------------------------------------------------
    function findTeammateTarget(shooter) {
        try {
            var scoreboard = shooter.getScoreboard();
            var team = scoreboard == null ? null : scoreboard.getEntryTeam(shooter.getName());
            if (team != null) {
                var entries = team.getEntries().iterator();
                var teammates = [];
                while (entries.hasNext()) {
                    var name = entries.next();
                    var player = Bukkit.getPlayerExact(name);
                    if (player != null && player !== shooter && isDamageableTarget(player, shooter)) {
                        teammates.push(player);
                    }
                }
                if (teammates.length > 0) {
                    return teammates[Math.floor(Math.random() * teammates.length)];
                }
            }

            // 没有 scoreboard 队伍时，把同世界其他在线玩家视为“队员”；
            // 真正单人模式下这里返回 null，第 7 发就会直接反噬自己。
            var players = shooter.getWorld().getPlayers();
            var fallback = [];
            for (var i = 0; i < players.size(); i++) {
                var other = players.get(i);
                if (other !== shooter && isDamageableTarget(other, shooter)) fallback.push(other);
            }
            if (fallback.length > 0) {
                return fallback[Math.floor(Math.random() * fallback.length)];
            }
        } catch (e) {
            log.error("MagicBulletShooter 队员选择异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
        return null;
    }

    function findLaserEnd(world, start, direction) {
        // 魔弹射手的激光固定贯穿 64 格，不因地形提前消失；
        // 如需“撞墙停止”，可在这里加入方块采样。
        return start.clone().add(direction.clone().multiply(LASER_RANGE));
    }

    function spawnLaserParticles(world, start, end) {
        try {
            var vector = end.toVector().subtract(start.toVector());
            var distance = vector.length();
            if (distance < 0.1) return;

            var direction = vector.normalize();
            var steps = Math.max(1, Math.ceil(distance / 0.5));
            for (var i = 0; i <= steps; i++) {
                var point = start.toVector().add(direction.clone().multiply(distance * i / steps));
                world.spawnParticle(Particle.DUST, point.getX(), point.getY(), point.getZ(),
                        1, 0.0, 0.0, 0.0, 0.0, BLUE_DUST);
                if (i % 2 === 0) {
                    world.spawnParticle(Particle.DUST, point.getX(), point.getY(), point.getZ(),
                            1, 0.0, 0.0, 0.0, 0.0, BLUE_CORE_DUST);
                }
            }
        } catch (e) { }
    }

    function damageLaserEntities(world, start, end, shooter, special) {
        try {
            var startVector = start.toVector();
            var endVector = end.toVector();
            var distance = start.distance(end);
            var mid = new Location(world,
                    (start.getX() + end.getX()) / 2.0,
                    (start.getY() + end.getY()) / 2.0,
                    (start.getZ() + end.getZ()) / 2.0);
            var searchRadius = distance / 2.0 + 4.0;
            var nearby = world.getNearbyEntities(mid, searchRadius, searchRadius, searchRadius);
            var iterator = nearby.iterator();
            var amount = special ? SPECIAL_DAMAGE : BASE_DAMAGE;

            while (iterator.hasNext()) {
                var target = iterator.next();
                if (!isDamageableTarget(target, shooter)) continue;

                var center = target.getLocation().clone()
                        .add(0, target.getHeight() / 2.0, 0).toVector();
                var threshold = LASER_RADIUS + Math.max(target.getWidth(), target.getHeight()) / 2.0;
                if (distanceSquaredToSegment(center, startVector, endVector)
                        <= threshold * threshold) {
                    try {
                        target.setNoDamageTicks(0);
                        target.damage(amount);
                    } catch (e) { }
                }
            }
        } catch (e) {
            log.error("MagicBulletShooter 激光伤害异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    function spawnSelfLaserBurst(player) {
        try {
            var world = player.getWorld();
            var location = player.getLocation().clone().add(0, 1.0, 0);
            world.spawnParticle(Particle.DUST, location.getX(), location.getY(), location.getZ(),
                    35, 0.8, 1.0, 0.8, 0.0, BLUE_DUST);
            world.spawnParticle(Particle.DUST, location.getX(), location.getY(), location.getZ(),
                    20, 0.5, 0.7, 0.5, 0.0, BLUE_CORE_DUST);
            world.playSound(location, Sound.ENTITY_ENDER_DRAGON_SHOOT, 1.0, 1.2);
        } catch (e) { }
    }

    function fireLaser(shooter, special) {
        try {
            var eye = shooter.getEyeLocation();
            var direction = safeNormalize(eye.getDirection());

            if (special) {
                var teammate = findTeammateTarget(shooter);
                if (teammate == null) {
                    // 单人模式：第 7 发没有队员可锁定，直接反噬自己（伤害 *2）。
                    damageSelf(shooter, SPECIAL_DAMAGE);
                    spawnSelfLaserBurst(shooter);
                    return;
                }
                var targetCenter = teammate.getLocation().clone()
                        .add(0, teammate.getHeight() / 2.0, 0);
                direction = safeNormalize(targetCenter.toVector().subtract(eye.toVector()));
            }

            var world = shooter.getWorld();
            var end = findLaserEnd(world, eye, direction);
            spawnLaserParticles(world, eye, end);
            damageLaserEntities(world, eye, end, shooter, special);
            playSound(world, eye, Sound.ENTITY_ENDER_DRAGON_SHOOT, 1.0, 1.8);
        } catch (e) {
            log.error("MagicBulletShooter 激光发射异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    function playSound(world, location, sound, volume, pitch) {
        try {
            world.playSound(location, sound, volume, pitch);
        } catch (e) { }
    }

    // -----------------------------------------------------------------------
    // 拦截射箭事件
    // -----------------------------------------------------------------------
    registerEvent("org.bukkit.event.entity.EntityShootBowEvent", function (event) {
        try {
            if (event.isCancelled()) return;

            var shooter = event.getEntity();
            if (!(shooter instanceof Player)) return;

            var bow = event.getBow();
            if (!isMagicWeapon(bow)) return;

            // 拦截原本的箭矢，改为发射蓝色激光。
            event.setCancelled(true);
            try { event.setConsumeArrow(false); } catch (e) { }
            try { event.setConsumeItem(false); } catch (e) { }

            var uuid = getPlayerId(shooter);
            if (!uuid) return;

            var count = (shotCounts[uuid] || 0) + 1;
            var special = count >= SHOTS_BEFORE_SPECIAL;
            shotCounts[uuid] = special ? 0 : count;

            fireLaser(shooter, special);
        } catch (e) {
            log.error("MagicBulletShooter 射箭拦截异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    registerEvent("org.bukkit.event.player.PlayerQuitEvent", function (event) {
        try {
            var uuid = String(event.getPlayer().getUniqueId().toString());
            delete shotCounts[uuid];
        } catch (e) { }
    });

    // 脚本卸载 / 热重载：清空射击计数并在装备注册表中注销。
    try {
        task.bindToUnload(function () {
            shotCounts = {};

            try {
                var registry = getShared("EquipRegistry");
                if (registry) registry.unregister(EQUIP_SLOT, WEAPON_ID);
            } catch (e) { }
        });
    } catch (e) { }

    log.info("MagicBulletShooter 已加载：/equip arms " + WEAPON_NAME
            + "（伤害 20 / 64 格蓝色激光 / 第 7 发队员锁定）");
})();
