/*
 * SoulReapingSword.js —— 自定义武器「索命剑」（OpenJS 1.5.0）
 *
 * 获取方式：/equip arms 索命剑
 *
 * 特殊效果：
 *   - 下界合金剑魔改：基础伤害 20，无限耐久，无附魔光效。
 *   - Q：发射红色剑气，伤害 15；剑气未命中任何目标时，对玩家自身造成 15 伤害。
 *   - 左键挥空：对玩家自身造成伤害。
 *   - 左键命中敌人：25% 几率反噬一半伤害；跳劈时提升至 50%。
 *   - Lore 额外一行：“每次挥剑必定见血的诅咒之剑”。
 */

// 作用域隔离：所有变量、常量和函数都封装在本 IIFE 内，
// 避免与其他 OpenJS 脚本的全局名称互相覆盖。
// 规范详见仓库根目录《OpenJS脚本数据契约.md》。
(function () {
    "use strict";

    // -----------------------------------------------------------------------
    // Java / API 类型
    // -----------------------------------------------------------------------
    var Material = Java.type("org.bukkit.Material");
    var ItemStack = Java.type("org.bukkit.inventory.ItemStack");
    var ChatColor = Java.type("org.bukkit.ChatColor");
    var ItemFlag = Java.type("org.bukkit.inventory.ItemFlag");
    var PersistentDataType = Java.type("org.bukkit.persistence.PersistentDataType");
    var NamespacedKey = Java.type("org.bukkit.NamespacedKey");
    var Player = Java.type("org.bukkit.entity.Player");
    var LivingEntity = Java.type("org.bukkit.entity.LivingEntity");
    var Attribute = Java.type("org.bukkit.attribute.Attribute");
    var AttributeModifier = Java.type("org.bukkit.attribute.AttributeModifier");
    var AttributeOperation = Java.type("org.bukkit.attribute.AttributeModifier$Operation");
    var EquipmentSlotGroup = Java.type("org.bukkit.inventory.EquipmentSlotGroup");
    var EquipmentSlot = Java.type("org.bukkit.inventory.EquipmentSlot");
    var Action = Java.type("org.bukkit.event.block.Action");
    var Particle = Java.type("org.bukkit.Particle");
    var DustOptions = Java.type("org.bukkit.Particle$DustOptions");
    var Color = Java.type("org.bukkit.Color");
    var Vector = Java.type("org.bukkit.util.Vector");
    var Sound = Java.type("org.bukkit.Sound");
    var Class = Java.type("java.lang.Class");
    var ItemFlagClass = Class.forName("org.bukkit.inventory.ItemFlag");
    var Array = Java.type("java.lang.reflect.Array");
    var SnowballClass = Class.forName("org.bukkit.entity.Snowball");

    // -----------------------------------------------------------------------
    // 数值配置
    // -----------------------------------------------------------------------
    var SWORD_ID = "soul_reaping_sword";
    var SWORD_NAME = "索命剑";
    var EQUIP_SLOT = "arms";

    var SWORD_KEY = new NamespacedKey(plugin, "soul_reaping_sword_item");
    var DAMAGE_MODIFIER_KEY = new NamespacedKey(plugin, "soul_reaping_sword_damage");
    var SPEED_MODIFIER_KEY = new NamespacedKey(plugin, "soul_reaping_sword_speed");

    var PLAYER_BASE_ATTACK_DAMAGE = 1.0;
    var PLAYER_BASE_ATTACK_SPEED = 4.0;
    var NETHERITE_SWORD_ATTACK_SPEED = 1.6;

    var SWORD_ATTACK_DAMAGE = 20.0;
    var ADDED_ATTACK_DAMAGE = SWORD_ATTACK_DAMAGE - PLAYER_BASE_ATTACK_DAMAGE; // +19.0
    var ADDED_ATTACK_SPEED = NETHERITE_SWORD_ATTACK_SPEED - PLAYER_BASE_ATTACK_SPEED; // -2.4

    var QI_DAMAGE = 15.0;
    var QI_MISS_SELF_DAMAGE = 15.0;
    var QI_RANGE = 16.0;
    var QI_SPEED = 1.0;
    var QI_HIT_RADIUS = 1.0;

    var SWING_MISS_SELF_DAMAGE = 2.0;
    var HIT_REFLECT_CHANCE = 0.25;
    var JUMP_SLASH_REFLECT_CHANCE = 0.50;

    var QI_TAG = "soul_reaping_sword_qi";
    var QI_SOURCE_TAG = "soul_reaping_sword_qi_source";

    var RED_DUST = new DustOptions(Color.fromRGB(255, 40, 40), 1.2);
    var RED_SMALL_DUST = new DustOptions(Color.fromRGB(255, 120, 120), 0.8);

    // -----------------------------------------------------------------------
    // 运行时状态
    // -----------------------------------------------------------------------
    var activeQis = [];       // 飞行中的红色剑气
    var lastEquipRegistry = null;

    // -----------------------------------------------------------------------
    // 工具函数
    // -----------------------------------------------------------------------
    function isSoulReapingSword(item) {
        try {
            if (item == null || item.getType() != Material.NETHERITE_SWORD) return false;
            if (!item.hasItemMeta()) return false;

            var meta = item.getItemMeta();
            if (meta == null) return false;

            var container = meta.getPersistentDataContainer();
            if (!container.has(SWORD_KEY, PersistentDataType.STRING)) return false;
            return String(container.get(SWORD_KEY, PersistentDataType.STRING)) === SWORD_ID;
        } catch (e) {
            return false;
        }
    }

    function getMainHandItem(player) {
        try {
            return player.getInventory().getItemInMainHand();
        } catch (e) {
            return null;
        }
    }

    function sendActionBar(player, text) {
        try {
            player.sendActionBar(text);
        } catch (e) { }
    }

    function playSound(world, location, sound, volume, pitch) {
        try {
            world.playSound(location, sound, volume, pitch);
        } catch (e) { }
    }

    function safeNormalize(vector) {
        if (!vector) return new Vector(0, 0, 1);
        if (vector.lengthSquared() < 0.0001) return new Vector(0, 0, 1);
        return vector.clone().normalize();
    }

    function damageSelf(player, amount, reason) {
        try {
            if (!player || !player.isOnline() || player.isDead()) return;
            player.setNoDamageTicks(0);
            player.damage(amount);
            if (reason) {
                sendActionBar(player, ChatColor.DARK_RED + "索命剑反噬："
                        + ChatColor.RED + reason);
            }
        } catch (e) {
            log.error("SoulReapingSword 自身伤害异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    function isBlockedLocation(world, location) {
        try {
            return !location.getBlock().isPassable();
        } catch (e) {
            return false;
        }
    }

    // -----------------------------------------------------------------------
    // 物品构建 / 注册
    // -----------------------------------------------------------------------
    function createSoulReapingSwordItem() {
        var item = new ItemStack(Material.NETHERITE_SWORD, 1);
        var meta = item.getItemMeta();
        if (meta == null) return item;

        meta.setDisplayName(ChatColor.DARK_RED + SWORD_NAME);
        meta.setLore(toJavaList([
            ChatColor.YELLOW + "基础伤害：" + ChatColor.RED + "20",
            ChatColor.AQUA + "Q " + ChatColor.GRAY + "红色剑气（伤害 15）",
            ChatColor.DARK_GRAY + "挥空或剑气未命中会反噬自身。",
            ChatColor.DARK_GRAY + "命中敌人有几率反噬一半伤害（跳劈提升）。",
            ChatColor.DARK_RED + "每次挥剑必定见血的诅咒之剑"
        ]));

        meta.setUnbreakable(true);

        // 无附魔光效。
        try {
            meta.setEnchantmentGlintOverride(false);
        } catch (e) { }

        try {
            var flags = Array.newInstance(ItemFlagClass, 2);
            Array.set(flags, 0, ItemFlag.HIDE_ATTRIBUTES);
            Array.set(flags, 1, ItemFlag.HIDE_UNBREAKABLE);
            meta.addItemFlags(flags);
        } catch (e) { }

        try {
            meta.addAttributeModifier(Attribute.ATTACK_DAMAGE,
                    new AttributeModifier(DAMAGE_MODIFIER_KEY, ADDED_ATTACK_DAMAGE,
                            AttributeOperation.ADD_NUMBER, EquipmentSlotGroup.MAINHAND));
            meta.addAttributeModifier(Attribute.ATTACK_SPEED,
                    new AttributeModifier(SPEED_MODIFIER_KEY, ADDED_ATTACK_SPEED,
                            AttributeOperation.ADD_NUMBER, EquipmentSlotGroup.MAINHAND));
        } catch (e) {
            log.error("SoulReapingSword 写入属性失败：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }

        meta.getPersistentDataContainer().set(SWORD_KEY, PersistentDataType.STRING, SWORD_ID);
        item.setItemMeta(meta);
        return item;
    }

    var soulSwordDefinition = {
        id: SWORD_ID,
        slot: EQUIP_SLOT,
        name: SWORD_NAME,
        aliases: ["索命", "soul_reaping_sword", "soulreapingsword"],
        create: createSoulReapingSwordItem
    };

    function ensureRegistered() {
        try {
            var registry = getShared("EquipRegistry");
            if (!registry) return;

            if (registry !== lastEquipRegistry || !registry.get(EQUIP_SLOT, SWORD_ID)) {
                registry.register(soulSwordDefinition);
                lastEquipRegistry = registry;
            } else {
                registry.heartbeat(EQUIP_SLOT, SWORD_ID);
            }
        } catch (e) {
            log.error("SoulReapingSword 注册装备失败：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    ensureRegistered();
    task.repeat(ticks(20), ticks(20), ensureRegistered);

    // -----------------------------------------------------------------------
    // Q 红色剑气
    // -----------------------------------------------------------------------
    function spawnRedQiParticles(world, location, direction) {
        try {
            var dir = safeNormalize(direction);
            var side = dir.clone().crossProduct(new Vector(0, 1, 0));
            if (side.lengthSquared() < 0.0001) side = new Vector(1, 0, 0);
            side.normalize();

            var up = new Vector(0, 1, 0);
            var upPerp = up.clone().subtract(dir.clone().multiply(up.dot(dir)));
            if (upPerp.lengthSquared() < 0.0001) upPerp = new Vector(0, 1, 0);
            upPerp.normalize();

            var base = location.toVector();
            for (var i = -4; i <= 4; i++) {
                var angle = (i / 4.0) * Math.PI * 0.6;
                var offset = side.clone().multiply(Math.sin(angle) * 0.95)
                        .add(upPerp.clone().multiply(Math.cos(angle) * 1.0));
                var point = base.clone().add(offset);
                world.spawnParticle(Particle.DUST, point.getX(), point.getY(), point.getZ(),
                        1, 0.0, 0.0, 0.0, 0.0, RED_DUST);
            }
            world.spawnParticle(Particle.DUST, location.getX(), location.getY(),
                    location.getZ(), 5, 0.2, 0.2, 0.2, 0.0, RED_SMALL_DUST);
        } catch (e) { }
    }

    function removeRedQiAt(index) {
        var qi = activeQis[index];
        if (qi && qi.source) {
            try {
                if (qi.source.isValid()) qi.source.remove();
            } catch (e) { }
        }
        activeQis.splice(index, 1);
    }

    function fireRedQi(player) {
        try {
            var eye = player.getEyeLocation();
            var direction = safeNormalize(eye.getDirection());
            var spawnLocation = eye.clone().add(direction.clone().multiply(0.6));
            var world = player.getWorld();

            var source = world.spawn(spawnLocation, SnowballClass);
            if (!source) {
                sendActionBar(player, ChatColor.RED + "红色剑气生成失败，请稍后再试。");
                return;
            }

            source.setShooter(player);
            source.setVelocity(new Vector(0, 0, 0));
            source.setGravity(false);
            source.setSilent(true);
            source.setInvisible(true);
            source.setInvulnerable(true);
            source.setPersistent(false);
            source.addScoreboardTag(QI_SOURCE_TAG);

            activeQis.push({
                owner: player,
                source: source,
                world: world,
                location: spawnLocation.clone(),
                direction: direction.clone(),
                travelled: 0.0,
                hit: {},
                hitAny: false
            });

            playSound(world, player.getLocation(), Sound.ENTITY_PLAYER_ATTACK_SWEEP, 1.0, 0.8);
        } catch (e) {
            log.error("SoulReapingSword 发射红色剑气异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    function damageRedQiTargets(qi, location) {
        try {
            var nearby = qi.world.getNearbyEntities(location,
                    QI_HIT_RADIUS, QI_HIT_RADIUS, QI_HIT_RADIUS);
            var iterator = nearby.iterator();

            while (iterator.hasNext()) {
                var target = iterator.next();
                if (target === qi.owner) continue;
                if (!(target instanceof LivingEntity)) continue;
                if (target.isDead() || !target.isValid()) continue;

                var targetId = String(target.getUniqueId().toString());
                if (qi.hit[targetId]) continue;
                qi.hit[targetId] = true;
                qi.hitAny = true;

                target.setNoDamageTicks(0);
                target.damage(QI_DAMAGE, qi.source);
                try {
                    qi.world.spawnParticle(Particle.SWEEP_ATTACK,
                            target.getLocation().getX(), target.getLocation().getY() + 1.0,
                            target.getLocation().getZ(), 1, 0.0, 0.0, 0.0, 0.0);
                } catch (e) { }
            }
        } catch (e) {
            log.error("SoulReapingSword 红色剑气命中异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    function updateRedQis() {
        for (var i = activeQis.length - 1; i >= 0; i--) {
            var qi = activeQis[i];
            if (!qi) {
                activeQis.splice(i, 1);
                continue;
            }

            try {
                var owner = qi.owner;
                if (!owner || !owner.isOnline() || !owner.isValid()) {
                    removeRedQiAt(i);
                    continue;
                }

                if (!qi.source || !qi.source.isValid()) {
                    if (!qi.hitAny) damageSelf(owner, QI_MISS_SELF_DAMAGE, "剑气未命中");
                    removeRedQiAt(i);
                    continue;
                }

                var next = qi.location.clone().add(qi.direction.clone().multiply(QI_SPEED));
                qi.travelled += QI_SPEED;

                if (qi.travelled > QI_RANGE || isBlockedLocation(qi.world, next)) {
                    spawnRedQiParticles(qi.world, next, qi.direction);
                    if (!qi.hitAny) damageSelf(owner, QI_MISS_SELF_DAMAGE, "剑气未命中");
                    removeRedQiAt(i);
                    continue;
                }

                qi.location = next;
                try { qi.source.teleport(next); } catch (e) { }
                spawnRedQiParticles(qi.world, next, qi.direction);
                damageRedQiTargets(qi, next);
            } catch (e) {
                log.error("SoulReapingSword 红色剑气更新异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
                try {
                    if (qi.owner && qi.owner.isOnline() && !qi.hitAny) {
                        damageSelf(qi.owner, QI_MISS_SELF_DAMAGE, "剑气未命中");
                    }
                } catch (ignored) { }
                removeRedQiAt(i);
            }
        }
    }

    registerEvent("org.bukkit.event.player.PlayerDropItemEvent", function (event) {
        try {
            var player = event.getPlayer();
            if (!(player instanceof Player)) return;

            var droppedItem = null;
            try { droppedItem = event.getItemDrop().getItemStack(); } catch (e) { }
            if (!isSoulReapingSword(droppedItem)) return;

            event.setCancelled(true);
            fireRedQi(player);
        } catch (e) {
            log.error("SoulReapingSword Q 事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // -----------------------------------------------------------------------
    // 左键挥空：反噬自身
    // -----------------------------------------------------------------------
    registerEvent("org.bukkit.event.player.PlayerInteractEvent", function (event) {
        try {
            var player = event.getPlayer();
            if (!(player instanceof Player)) return;

            var actionName = event.getAction() == null ? "" : String(event.getAction().name());
            if (actionName !== "LEFT_CLICK_AIR") return;

            var handName = event.getHand() == null ? "" : String(event.getHand().name());
            if (handName !== "HAND") return;
            if (!isSoulReapingSword(getMainHandItem(player))) return;

            damageSelf(player, SWING_MISS_SELF_DAMAGE, "挥空");
        } catch (e) {
            log.error("SoulReapingSword 挥空事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // -----------------------------------------------------------------------
    // 左键命中：25% 反噬一半伤害；跳劈 50%
    // -----------------------------------------------------------------------
    function isJumpSlash(player, event) {
        try {
            if (event.isCritical()) return true;
        } catch (e) { }

        try {
            return !player.isOnGround() && player.getFallDistance() > 0.0;
        } catch (e) {
            return false;
        }
    }

    registerEvent("org.bukkit.event.entity.EntityDamageByEntityEvent", function (event) {
        try {
            var damager = null;
            try { damager = event.getDamager(); } catch (e) { return; }
            if (!(damager instanceof Player)) return;
            if (!isSoulReapingSword(getMainHandItem(damager))) return;

            var causeName = String(event.getCause().name());
            if (causeName !== "ENTITY_ATTACK" && causeName !== "ENTITY_SWEEP_ATTACK") return;

            var target = event.getEntity();
            if (target === damager) return;
            if (!(target instanceof LivingEntity)) return;

            var chance = isJumpSlash(damager, event)
                    ? JUMP_SLASH_REFLECT_CHANCE
                    : HIT_REFLECT_CHANCE;
            if (Math.random() >= chance) return;

            var reflectDamage = Math.max(0.0, event.getFinalDamage() / 2.0);
            damageSelf(damager, reflectDamage, "命中反噬");
        } catch (e) {
            log.error("SoulReapingSword 命中反噬异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // -----------------------------------------------------------------------
    // 1 tick 主循环：推进红色剑气
    // -----------------------------------------------------------------------
    task.repeat(ticks(1), ticks(1), function () {
        try {
            updateRedQis();
        } catch (e) {
            log.error("SoulReapingSword 主循环异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // 脚本卸载 / 热重载：清理飞行中的红色剑气并在装备注册表中注销。
    try {
        task.bindToUnload(function () {
            for (var i = activeQis.length - 1; i >= 0; i--) {
                removeRedQiAt(i);
            }
            activeQis = [];

            try {
                var registry = getShared("EquipRegistry");
                if (registry) registry.unregister(EQUIP_SLOT, SWORD_ID);
            } catch (e) { }
        });
    } catch (e) { }

    log.info("SoulReapingSword 已加载：/equip arms " + SWORD_NAME
            + "（伤害 20 / Q 红色剑气 / 挥空反噬 / 命中几率反噬）");
})();
