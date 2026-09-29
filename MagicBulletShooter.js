/*
 * MagicBulletShooter.js —— 自定义武器「魔弹射手」（OpenJS 1.5.0）
 *
 * 获取方式：/equip arms 魔弹射手
 *
 * 特殊效果：
 *   - 弩魔改：基础伤害 20，无限耐久。
 *   - 自带穿透 5、快速装填 4，有附魔光效，但隐藏所有附魔文字。
 *   - 箭矢每 2 tick 修正一次轨迹，优先追踪场上当前 HP 最高的敌人。
 *   - 隐藏特性：每 6 次射击后的第 7 次攻击必定锁定随机玩家，每 tick 修正轨迹，伤害翻倍。
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
    var Projectile = Java.type("org.bukkit.entity.Projectile");
    var AbstractArrow = Java.type("org.bukkit.entity.AbstractArrow");
    var Vector = Java.type("org.bukkit.util.Vector");
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
    var ARROW_TAG = "magic_bullet_arrow";

    var BASE_DAMAGE = 20.0;
    var SPECIAL_DAMAGE = 40.0;          // 第 7 发射击伤害翻倍
    var NORMAL_STEER_INTERVAL = 2;      // 普通箭每 2 tick 修正
    var SPECIAL_STEER_INTERVAL = 1;     // 特殊箭每 tick 修正
    var HOMING_SPEED = 2.0;
    var SHOTS_BEFORE_SPECIAL = 7;       // 第 7 发为特殊弹

    // -----------------------------------------------------------------------
    // 运行时状态
    // -----------------------------------------------------------------------
    var trackedArrows = {};  // arrow uuid -> state
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

    function getMainHandItem(player) {
        try {
            return player.getInventory().getItemInMainHand();
        } catch (e) {
            return null;
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
            ChatColor.AQUA + "箭矢每 2 tick 修正轨迹，优先攻击 HP 最高的敌人"
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
    // 目标选择 / 弹道修正
    // -----------------------------------------------------------------------
    function findHighestHpEnemy(world, owner) {
        var best = null;
        var bestHealth = -1.0;
        try {
            var it = world.getLivingEntities().iterator();
            while (it.hasNext()) {
                var entity = it.next();
                if (!isDamageableTarget(entity, owner)) continue;

                var health = entity.getHealth();
                if (health > bestHealth) {
                    bestHealth = health;
                    best = entity;
                }
            }
        } catch (e) {
            log.error("MagicBulletShooter 目标选择异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
        return best;
    }

    function findRandomPlayer(world, owner) {
        try {
            var players = world.getPlayers();
            var candidates = [];
            for (var i = 0; i < players.size(); i++) {
                var player = players.get(i);
                if (!isDamageableTarget(player, owner)) continue;
                candidates.push(player);
            }
            if (candidates.length === 0) return null;
            return candidates[Math.floor(Math.random() * candidates.length)];
        } catch (e) {
            return null;
        }
    }

    function steerArrow(state, target, speed) {
        try {
            if (target == null || state.projectile == null || !state.projectile.isValid()) return;
            var from = state.projectile.getLocation().toVector();
            var to = target.getLocation().clone()
                    .add(0, target.getHeight() / 2.0, 0).toVector();
            var direction = to.subtract(from);
            if (direction.lengthSquared() < 0.04) return;
            state.projectile.setVelocity(direction.normalize().multiply(speed));
        } catch (e) { }
    }

    function trackArrow(shooter, projectile, special) {
        try {
            if (!(projectile instanceof Projectile)) return;

            var target = null;
            if (special) {
                target = findRandomPlayer(shooter.getWorld(), shooter);
                if (target == null) target = findHighestHpEnemy(shooter.getWorld(), shooter);
            }

            var uuid = String(projectile.getUniqueId().toString());
            trackedArrows[uuid] = {
                owner: shooter,
                projectile: projectile,
                special: special === true,
                target: target,
                ticks: 0
            };

            projectile.addScoreboardTag(ARROW_TAG);
            projectile.setGravity(false);
            try { projectile.setCritical(false); } catch (e) { }

            if (projectile instanceof AbstractArrow) {
                projectile.setDamage(special ? SPECIAL_DAMAGE : BASE_DAMAGE);
                projectile.setPierceLevel(5);
            }
        } catch (e) {
            log.error("MagicBulletShooter 追踪箭矢异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    function updateTrackedArrows() {
        for (var key in trackedArrows) {
            if (!trackedArrows.hasOwnProperty(key)) continue;
            var state = trackedArrows[key];
            if (!state) continue;

            try {
                var projectile = state.projectile;
                if (projectile == null || !projectile.isValid()) {
                    delete trackedArrows[key];
                    continue;
                }

                // 首次命中后不再修正方向，但保留状态以便穿刺后的命中仍按 20 / 40 结算。
                if (state.hitOnce === true) continue;

                state.ticks++;
                var interval = state.special ? SPECIAL_STEER_INTERVAL : NORMAL_STEER_INTERVAL;
                if (state.ticks % interval !== 0) continue;

                var target = state.target;
                if (target == null || target.isDead() || !target.isValid()) {
                    if (state.special) {
                        target = findRandomPlayer(state.owner.getWorld(), state.owner);
                        if (target == null) target = findHighestHpEnemy(state.owner.getWorld(), state.owner);
                        state.target = target;
                    } else {
                        target = findHighestHpEnemy(state.owner.getWorld(), state.owner);
                    }
                }

                if (target != null) steerArrow(state, target, HOMING_SPEED);
            } catch (e) {
                log.error("MagicBulletShooter 弹道修正异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
            }
        }
    }

    // -----------------------------------------------------------------------
    // 射击事件
    // -----------------------------------------------------------------------
    registerEvent("org.bukkit.event.entity.EntityShootBowEvent", function (event) {
        try {
            if (event.isCancelled()) return;

            var shooter = event.getEntity();
            if (!(shooter instanceof Player)) return;

            var bow = event.getBow();
            if (!isMagicWeapon(bow)) return;

            var uuid = getPlayerId(shooter);
            if (!uuid) return;

            var count = (shotCounts[uuid] || 0) + 1;
            var special = count >= SHOTS_BEFORE_SPECIAL;
            shotCounts[uuid] = special ? 0 : count;

            var projectile = event.getProjectile();
            if (!(projectile instanceof Projectile)) return;

            trackArrow(shooter, projectile, special);
        } catch (e) {
            log.error("MagicBulletShooter 射击事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    registerEvent("org.bukkit.event.entity.ProjectileHitEvent", function (event) {
        try {
            var projectile = event.getEntity();
            if (!(projectile instanceof Projectile)) return;
            var uuid = String(projectile.getUniqueId().toString());
            var state = trackedArrows[uuid];
            if (state) {
                // 不删除状态：穿刺附魔会让箭矢继续命中后续目标，
                // 必须保留伤害覆写；命中后只停止弹道修正。
                state.hitOnce = true;
            }
        } catch (e) { }
    });

    registerEvent("org.bukkit.event.entity.EntityDamageByEntityEvent", function (event) {
        try {
            var damager = null;
            try { damager = event.getDamager(); } catch (e) { return; }
            if (!(damager instanceof Projectile)) return;

            var uuid = String(damager.getUniqueId().toString());
            var state = trackedArrows[uuid];
            if (!state) return;

            var target = event.getEntity();
            if (target === state.owner) return;

            event.setDamage(state.special ? SPECIAL_DAMAGE : BASE_DAMAGE);
        } catch (e) {
            log.error("MagicBulletShooter 箭矢伤害异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // 玩家退出时清理计数（箭矢状态会因实体无效自动清理）。
    registerEvent("org.bukkit.event.player.PlayerQuitEvent", function (event) {
        try {
            var uuid = String(event.getPlayer().getUniqueId().toString());
            delete shotCounts[uuid];
        } catch (e) { }
    });

    // -----------------------------------------------------------------------
    // 主循环 / 清理
    // -----------------------------------------------------------------------
    task.repeat(ticks(1), ticks(1), function () {
        try {
            updateTrackedArrows();
        } catch (e) {
            log.error("MagicBulletShooter 主循环异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    try {
        task.bindToUnload(function () {
            trackedArrows = {};
            shotCounts = {};

            try {
                var registry = getShared("EquipRegistry");
                if (registry) registry.unregister(EQUIP_SLOT, WEAPON_ID);
            } catch (e) { }
        });
    } catch (e) { }

    log.info("MagicBulletShooter 已加载：/equip arms " + WEAPON_NAME
            + "（伤害 20 / 穿透 5 / 快速装填 4 / 弹道修正）");
})();
