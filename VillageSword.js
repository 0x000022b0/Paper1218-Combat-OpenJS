/*
 * VillageSword.js —— 自定义武器「村好剑」（OpenJS 1.5.0）
 *
 * 获取方式：/equip arms 村好剑
 *
 * 机制摘要：
 *   - 木剑魔改：攻击伤害 6，攻击速度 2，本体无限耐久，无附魔光效、无法被附魔。
 *   - Q（丢弃物品事件）：拦截丢剑，向前发射白色 DUST 剑气，射程 16 格，造成 4 点弹射物伤害，攻速 2。
 *   - E（打开背包事件）：拦截打开玩家背包，发动重击：15 点伤害、类似斧头的破盾；
 *                        随后 30 tick 内村好剑处于不可用状态。
 *   - F（切换副手事件）：拦截换手，向前突刺 5 格，对沿途生物造成 8 点伤害，冷却 20 tick。
 *
 * 关于 E 键的实测说明：
 *   Paper 1.21.8 的纯原版客户端按 E 打开“玩家自身背包”是客户端本地 GUI 行为，
 *   不会向服务端发送打开容器数据包，因此 Bukkit 的 InventoryOpenEvent 通常不会触发。
 *   本脚本仍按需求注册 InventoryOpenEvent；当服务端/插件/API 触发该事件且目标是玩家背包时，
 *   会取消打开并执行重击。
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
    var PlayerInventory = Java.type("org.bukkit.inventory.PlayerInventory");
    var Attribute = Java.type("org.bukkit.attribute.Attribute");
    var AttributeModifier = Java.type("org.bukkit.attribute.AttributeModifier");
    var AttributeOperation = Java.type("org.bukkit.attribute.AttributeModifier$Operation");
    var EquipmentSlotGroup = Java.type("org.bukkit.inventory.EquipmentSlotGroup");
    var Particle = Java.type("org.bukkit.Particle");
    var DustOptions = Java.type("org.bukkit.Particle$DustOptions");
    var Color = Java.type("org.bukkit.Color");
    var Vector = Java.type("org.bukkit.util.Vector");
    var Location = Java.type("org.bukkit.Location");
    var Sound = Java.type("org.bukkit.Sound");
    var Class = Java.type("java.lang.Class");
    var SnowballClass = Class.forName("org.bukkit.entity.Snowball");

    // -----------------------------------------------------------------------
    // 数值配置
    // -----------------------------------------------------------------------
    var SWORD_ID = "village_sword";
    var SWORD_NAME = "村好剑";
    var EQUIP_SLOT = "arms";

    var QI_TAG = "village_sword_qi";

    var SWORD_KEY = new NamespacedKey(plugin, "village_sword_item");
    var SWORD_DAMAGE_MODIFIER_KEY = new NamespacedKey(plugin, "village_sword_attack_damage");
    var SWORD_SPEED_MODIFIER_KEY = new NamespacedKey(plugin, "village_sword_attack_speed");

    var SWORD_ATTACK_DAMAGE = 6.0;
    var SWORD_ATTACK_SPEED = 2.0;
    var PLAYER_BASE_ATTACK_DAMAGE = 1.0;
    var PLAYER_BASE_ATTACK_SPEED = 4.0;
    var ADDED_ATTACK_DAMAGE = SWORD_ATTACK_DAMAGE - PLAYER_BASE_ATTACK_DAMAGE; // +5.0
    var ADDED_ATTACK_SPEED = SWORD_ATTACK_SPEED - PLAYER_BASE_ATTACK_SPEED;   // -2.0

    var QI_DAMAGE = 4.0;
    var QI_RANGE = 16.0;
    var QI_SPEED = 1.0;                // 每 tick 前进 1 格，约 16 tick 飞完全程
    var QI_HIT_RADIUS = 1.0;
    var SLASH_COOLDOWN_TICKS = Math.round(20.0 / SWORD_ATTACK_SPEED); // 攻速 2 -> 10 tick

    var HEAVY_DAMAGE = 15.0;
    var HEAVY_RANGE = 3.5;
    var HEAVY_CONE_DOT = Math.cos(Math.PI / 3.0); // 正前方约 120 度锥形范围
    var SWORD_DISABLE_TICKS = 30;
    var SHIELD_DISABLE_TICKS = 100;    // 与原版斧头一致：5 秒破盾

    var DASH_DAMAGE = 8.0;
    var DASH_DISTANCE = 5.0;
    var DASH_HIT_RADIUS = 1.0;
    var DASH_COOLDOWN_TICKS = 20;

    var WHITE_DUST = new DustOptions(Color.fromRGB(255, 255, 255), 1.0);

    // -----------------------------------------------------------------------
    // 运行时状态
    // -----------------------------------------------------------------------
    var globalTick = 0;
    var activeSlashes = [];       // 当前飞行中的白色剑气
    var swordDisabledUntil = {};  // player uuid -> 不可用结束 tick
    var slashReadyTick = {};      // player uuid -> 下一次可发剑气 tick
    var dashReadyTick = {};       // player uuid -> 下一次可突刺 tick
    var lastEquipRegistry = null;

    // -----------------------------------------------------------------------
    // 工具函数
    // -----------------------------------------------------------------------
    function getPlayerId(player) {
        try {
            return String(player.getUniqueId().toString());
        } catch (e) {
            return "";
        }
    }

    function isVillageSword(item) {
        try {
            if (item == null || item.getType() != Material.WOODEN_SWORD) return false;
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

    function getMainHandSword(player) {
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

    function sendMessage(player, text) {
        try {
            player.sendMessage(text);
        } catch (e) { }
    }

    function playSound(world, location, sound, volume, pitch) {
        try {
            world.playSound(location, sound, volume, pitch);
        } catch (e) { }
    }

    function isSwordDisabled(player) {
        var uuid = getPlayerId(player);
        if (!uuid) return false;
        return globalTick < (swordDisabledUntil[uuid] || 0);
    }

    function putSwordOnCooldown(player, ticks) {
        try {
            var item = getMainHandSword(player);
            if (isVillageSword(item)) player.setCooldown(item, ticks);
        } catch (e) { }
    }

    function setSwordDisabled(player, ticks) {
        var uuid = getPlayerId(player);
        if (!uuid) return;
        swordDisabledUntil[uuid] = globalTick + Math.max(0, ticks);
        putSwordOnCooldown(player, ticks);
        sendActionBar(player, ChatColor.RED + SWORD_NAME + " 过热：接下来 "
                + ChatColor.YELLOW + ticks + ChatColor.RED + " tick 内不可用");
    }

    function isDamageableTarget(entity, owner) {
        if (!entity || entity === owner) return false;
        try {
            if (!(entity instanceof LivingEntity)) return false;
            if (entity.isDead() || !entity.isValid()) return false;
            if (String(entity.getType().name()) === "ARMOR_STAND") return false;
            if (entity instanceof Player) {
                if (!entity.isOnline()) return false;
                var gameMode = entity.getGameMode();
                if (gameMode != null && String(gameMode.name()) === "SPECTATOR") return false;
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    function dealDamage(target, amount, source) {
        if (!target) return false;

        var oldNoDamageTicks = 0;
        try {
            oldNoDamageTicks = target.getNoDamageTicks();
            target.setNoDamageTicks(0);
        } catch (e) { }

        try {
            if (source != null) {
                target.damage(amount, source);
            } else {
                target.damage(amount);
            }
        } catch (e) {
            try { target.setNoDamageTicks(oldNoDamageTicks); } catch (ignored) { }
            log.error("VillageSword 造成伤害异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
            return false;
        }

        // Bukkit 的 Damageable#damage 返回 void：若 noDamageTicks 仍为 0，
        // 说明伤害没有落地（例如被其他插件取消），恢复调用前状态。
        try {
            if (target.getNoDamageTicks() <= 0) {
                target.setNoDamageTicks(oldNoDamageTicks);
            }
        } catch (e) { }
        return true;
    }

    function safeNormalize(vector) {
        if (!vector) return new Vector(0, 0, 1);
        if (vector.lengthSquared() < 0.0001) return new Vector(0, 0, 1);
        return vector.clone().normalize();
    }

    // -----------------------------------------------------------------------
    // 物品构建 / 注册
    // -----------------------------------------------------------------------
    function createVillageSwordItem() {
        var item = new ItemStack(Material.WOODEN_SWORD, 1);
        var meta = item.getItemMeta();
        if (meta == null) return item;

        meta.setDisplayName(ChatColor.GOLD + SWORD_NAME);
        meta.setLore(toJavaList([
            ChatColor.GRAY + "村中铁匠随手打出的好剑，朴实耐用。",
            "",
            ChatColor.YELLOW + "攻击伤害：" + ChatColor.RED + "6",
            ChatColor.YELLOW + "攻击速度：" + ChatColor.RED + "2",
            ChatColor.YELLOW + "耐久：" + ChatColor.GREEN + "无限",
            ChatColor.DARK_GRAY + "无附魔光效，且无法被附魔。",
            "",
            ChatColor.AQUA + "Q " + ChatColor.GRAY + "发射白色剑气（射程 16，伤害 4）",
            ChatColor.AQUA + "E " + ChatColor.GRAY + "重击（伤害 15，破盾，之后 30 tick 不可用）",
            ChatColor.AQUA + "F " + ChatColor.GRAY + "突刺 5 格（沿途伤害 8，冷却 20 tick）"
        ]));

        meta.setUnbreakable(true);
        try {
            meta.setEnchantmentGlintOverride(false);
        } catch (e) { }
        try {
            meta.addItemFlags(ItemFlag.HIDE_ATTRIBUTES, ItemFlag.HIDE_UNBREAKABLE, ItemFlag.HIDE_ENCHANTS);
        } catch (e) { }

        try {
            meta.addAttributeModifier(Attribute.ATTACK_DAMAGE,
                    new AttributeModifier(SWORD_DAMAGE_MODIFIER_KEY, ADDED_ATTACK_DAMAGE,
                            AttributeOperation.ADD_NUMBER, EquipmentSlotGroup.MAINHAND));
            meta.addAttributeModifier(Attribute.ATTACK_SPEED,
                    new AttributeModifier(SWORD_SPEED_MODIFIER_KEY, ADDED_ATTACK_SPEED,
                            AttributeOperation.ADD_NUMBER, EquipmentSlotGroup.MAINHAND));
        } catch (e) {
            log.error("VillageSword 写入属性失败：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }

        meta.getPersistentDataContainer().set(SWORD_KEY, PersistentDataType.STRING, SWORD_ID);
        item.setItemMeta(meta);
        return item;
    }

    function sanitizeSwordItem(item) {
        try {
            if (!isVillageSword(item)) return false;

            var meta = item.getItemMeta();
            if (meta == null) return false;

            var changed = false;
            if (meta.hasEnchants()) {
                meta.removeEnchantments();
                changed = true;
            }
            try {
                if (String(meta.getEnchantmentGlintOverride()) !== "false") {
                    meta.setEnchantmentGlintOverride(false);
                    changed = true;
                }
            } catch (e) { }
            // 物品的 Enchantable 组件由原版物品原型提供；Bukkit API 不允许写入 0，
            // 因此这里不做无效尝试，附魔拦截统一交给附魔台 / 铁砧 / 指令事件。

            if (changed) item.setItemMeta(meta);
            return changed;
        } catch (e) {
            return false;
        }
    }

    var villageSwordDefinition = {
        id: SWORD_ID,
        slot: EQUIP_SLOT,
        name: SWORD_NAME,
        aliases: ["村好", "cunhaojian", "village_sword"],
        create: createVillageSwordItem
    };

    function ensureRegistered() {
        try {
            var registry = getShared("EquipRegistry");
            if (!registry) return;

            if (registry !== lastEquipRegistry || !registry.get(EQUIP_SLOT, SWORD_ID)) {
                registry.register(villageSwordDefinition);
                lastEquipRegistry = registry;
            } else {
                registry.heartbeat(EQUIP_SLOT, SWORD_ID);
            }
        } catch (e) {
            log.error("VillageSword 注册装备失败：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    ensureRegistered();
    task.repeat(ticks(20), ticks(20), ensureRegistered);
    // -----------------------------------------------------------------------
    // 白色剑气粒子 / Q 技能
    // -----------------------------------------------------------------------
    function spawnSwordQiParticles(world, location, direction) {
        try {
            var dir = safeNormalize(direction);
            var side = dir.clone().crossProduct(new Vector(0, 1, 0));
            if (side.lengthSquared() < 0.0001) side = new Vector(1, 0, 0);
            side.normalize();

            var upPerp = new Vector(0, 1, 0)
                    .subtract(dir.clone().multiply(new Vector(0, 1, 0).dot(dir)));
            if (upPerp.lengthSquared() < 0.0001) upPerp = new Vector(0, 1, 0);
            upPerp.normalize();

            var base = location.toVector();
            for (var i = -4; i <= 4; i++) {
                var angle = (i / 4.0) * Math.PI * 0.6;
                var offset = side.clone().multiply(Math.sin(angle) * 0.95)
                        .add(upPerp.clone().multiply(Math.cos(angle) * 1.0));
                var point = base.clone().add(offset);
                world.spawnParticle(Particle.DUST, point.getX(), point.getY(), point.getZ(),
                        1, 0.0, 0.0, 0.0, 0.0, WHITE_DUST);
            }

            world.spawnParticle(Particle.DUST, location.getX(), location.getY(), location.getZ(),
                    3, 0.15, 0.15, 0.15, 0.0, WHITE_DUST);
        } catch (e) { }
    }

    function isSlashBlocked(world, location) {
        try {
            return !location.getBlock().isPassable();
        } catch (e) {
            return false;
        }
    }

    function removeSlashAt(index) {
        var slash = activeSlashes[index];
        if (slash && slash.projectile) {
            try {
                if (slash.projectile.isValid()) slash.projectile.remove();
            } catch (e) { }
        }
        activeSlashes.splice(index, 1);
    }

    function damageEntitiesAtSlash(slash, location) {
        try {
            var nearby = slash.world.getNearbyEntities(location, QI_HIT_RADIUS, QI_HIT_RADIUS, QI_HIT_RADIUS);
            var iterator = nearby.iterator();

            while (iterator.hasNext()) {
                var target = iterator.next();
                if (!isDamageableTarget(target, slash.owner)) continue;

                var targetId = String(target.getUniqueId().toString());
                if (slash.hit[targetId]) continue;
                slash.hit[targetId] = true;

                dealDamage(target, QI_DAMAGE, slash.projectile);
                try {
                    slash.world.spawnParticle(Particle.SWEEP_ATTACK,
                            target.getLocation().getX(), target.getLocation().getY() + 1.0,
                            target.getLocation().getZ(), 1, 0.0, 0.0, 0.0, 0.0);
                } catch (e) { }
            }
        } catch (e) {
            log.error("VillageSword 剑气命中判定异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    function updateSlashes() {
        for (var i = activeSlashes.length - 1; i >= 0; i--) {
            var slash = activeSlashes[i];
            if (!slash) {
                activeSlashes.splice(i, 1);
                continue;
            }

            try {
                if (!slash.owner || !slash.owner.isOnline() || !slash.owner.isValid()
                        || !slash.projectile || !slash.projectile.isValid()) {
                    removeSlashAt(i);
                    continue;
                }

                var nextLocation = slash.location.clone()
                        .add(slash.direction.clone().multiply(QI_SPEED));
                slash.travelled += QI_SPEED;

                if (slash.travelled > QI_RANGE || isSlashBlocked(slash.world, nextLocation)) {
                    spawnSwordQiParticles(slash.world, nextLocation, slash.direction);
                    removeSlashAt(i);
                    continue;
                }

                slash.location = nextLocation;
                try {
                    slash.projectile.teleport(nextLocation);
                } catch (e) { }

                spawnSwordQiParticles(slash.world, nextLocation, slash.direction);
                damageEntitiesAtSlash(slash, nextLocation);
            } catch (e) {
                log.error("VillageSword 剑气更新异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
                removeSlashAt(i);
            }
        }
    }
    function canUseSlash(player) {
        var uuid = getPlayerId(player);
        if (!uuid) return false;
        if (globalTick < (slashReadyTick[uuid] || 0)) return false;
        try {
            if (player.getAttackCooldown() < 1.0) return false;
        } catch (e) { }
        return true;
    }

    function fireSwordQi(player) {
        try {
            var eye = player.getEyeLocation();
            var direction = safeNormalize(eye.getDirection());
            var spawnLocation = eye.clone().add(direction.clone().multiply(0.6));
            var world = spawnLocation.getWorld();

            var projectile = world.spawn(spawnLocation, SnowballClass);
            if (!projectile) {
                sendActionBar(player, ChatColor.RED + "剑气生成失败，请稍后再试。");
                return;
            }

            projectile.setShooter(player);
            projectile.setVelocity(new Vector(0, 0, 0));
            projectile.setGravity(false);
            projectile.setSilent(true);
            projectile.setInvisible(true);
            projectile.setInvulnerable(true);
            projectile.setPersistent(false);
            projectile.addScoreboardTag(QI_TAG);

            activeSlashes.push({
                owner: player,
                projectile: projectile,
                world: world,
                location: spawnLocation.clone(),
                direction: direction.clone(),
                travelled: 0.0,
                maxDistance: QI_RANGE,
                hit: {}
            });

            var uuid = getPlayerId(player);
            if (uuid) slashReadyTick[uuid] = globalTick + SLASH_COOLDOWN_TICKS;
            try {
                player.resetCooldown();
            } catch (e) { }

            playSound(world, player.getLocation(), Sound.ENTITY_PLAYER_ATTACK_SWEEP, 1.0, 1.35);
            playSound(world, player.getLocation(), Sound.ITEM_TRIDENT_RIPTIDE_3, 0.6, 1.8);
        } catch (e) {
            log.error("VillageSword 发射剑气异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    function warnSwordUnavailable(player) {
        sendActionBar(player, ChatColor.RED + SWORD_NAME + " 过热中，暂时无法使用。");
    }

    function warnSlashCooling(player) {
        sendActionBar(player, ChatColor.GRAY + SWORD_NAME + " 剑气尚未准备好。");
    }
    // -----------------------------------------------------------------------
    // E 技能：重击 / 破盾
    // -----------------------------------------------------------------------
    function findHeavyTarget(player) {
        var best = null;
        var bestDistanceSquared = HEAVY_RANGE * HEAVY_RANGE;

        try {
            var eye = player.getEyeLocation();
            var eyeVector = eye.toVector();
            var direction = safeNormalize(eye.getDirection());
            var nearby = player.getWorld().getNearbyEntities(
                    eye, HEAVY_RANGE, HEAVY_RANGE, HEAVY_RANGE);
            var iterator = nearby.iterator();

            while (iterator.hasNext()) {
                var target = iterator.next();
                if (!isDamageableTarget(target, player)) continue;

                var targetCenter = target.getLocation().clone()
                        .add(0, target.getHeight() / 2.0, 0);
                var delta = targetCenter.toVector().subtract(eyeVector);
                var distance = delta.length();
                var extraRadius = target.getWidth() / 2.0;
                if (distance > HEAVY_RANGE + extraRadius) continue;
                if (distance < 0.001) {
                    if (best == null) best = target;
                    continue;
                }

                var dot = delta.multiply(1.0 / distance).dot(direction);
                if (dot < HEAVY_CONE_DOT) continue;
                if (distance * distance < bestDistanceSquared) {
                    bestDistanceSquared = distance * distance;
                    best = target;
                }
            }
        } catch (e) {
            log.error("VillageSword 重击目标判定异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }

        return best;
    }

    function performHeavyStrike(player) {
        try {
            var world = player.getWorld();
            var eye = player.getEyeLocation();
            var direction = safeNormalize(eye.getDirection());
            var target = findHeavyTarget(player);

            playSound(world, player.getLocation(), Sound.ENTITY_PLAYER_ATTACK_STRONG, 1.2, 0.85);
            playSound(world, player.getLocation(), Sound.BLOCK_ANVIL_LAND, 0.5, 1.4);
            try {
                world.spawnParticle(Particle.SWEEP_ATTACK,
                        eye.getX() + direction.getX() * 1.5,
                        eye.getY() + direction.getY() * 1.5,
                        eye.getZ() + direction.getZ() * 1.5,
                        3, 0.25, 0.25, 0.25, 0.0);
            } catch (e) { }

            if (target != null) {
                var wasBlocking = false;
                if (target instanceof Player) {
                    try {
                        wasBlocking = target.isBlocking();
                        if (wasBlocking) target.clearActiveItem();
                    } catch (e) { }
                }

                dealDamage(target, HEAVY_DAMAGE, player);

                if (wasBlocking) {
                    try {
                        target.setCooldown(Material.SHIELD, SHIELD_DISABLE_TICKS);
                    } catch (e) { }
                    sendMessage(target, ChatColor.DARK_RED + "你的盾牌被 " + ChatColor.GOLD
                            + SWORD_NAME + ChatColor.DARK_RED + " 的重击破开了！");
                }
            }

            setSwordDisabled(player, SWORD_DISABLE_TICKS);
            sendMessage(player, ChatColor.GOLD + "[" + SWORD_NAME + "] " + ChatColor.YELLOW
                    + "你发动了重击，村好剑进入 " + SWORD_DISABLE_TICKS + " tick 过热。");
        } catch (e) {
            log.error("VillageSword 重击异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }
    // -----------------------------------------------------------------------
    // F 技能：突刺 / 沿途伤害
    // -----------------------------------------------------------------------
    function isDashColumnClear(location) {
        try {
            var feet = location.getBlock();
            var head = feet.getRelative(0, 1, 0);
            return feet.isPassable() && head.isPassable();
        } catch (e) {
            return false;
        }
    }

    function findDashDestination(start, direction) {
        var destination = start.clone();
        for (var step = 1.0; step <= DASH_DISTANCE; step += 1.0) {
            var test = start.clone().add(direction.clone().multiply(step));
            if (!isDashColumnClear(test)) break;
            destination = test;
        }
        return destination;
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

    function damageEntitiesAlongDash(player, start, end) {
        try {
            var world = start.getWorld();
            var distance = start.distance(end);
            var mid = new Location(world,
                    (start.getX() + end.getX()) / 2.0,
                    (start.getY() + end.getY()) / 2.0,
                    (start.getZ() + end.getZ()) / 2.0);
            var searchRadius = DASH_HIT_RADIUS + distance / 2.0 + 1.0;
            var nearby = world.getNearbyEntities(mid, searchRadius, searchRadius, searchRadius);
            var iterator = nearby.iterator();
            var startVector = start.toVector();
            var endVector = end.toVector();

            while (iterator.hasNext()) {
                var target = iterator.next();
                if (!isDamageableTarget(target, player)) continue;

                var targetCenter = target.getLocation().clone()
                        .add(0, target.getHeight() / 2.0, 0).toVector();
                var threshold = DASH_HIT_RADIUS + target.getWidth() / 2.0;
                if (distanceSquaredToSegment(targetCenter, startVector, endVector)
                        > threshold * threshold) {
                    continue;
                }

                dealDamage(target, DASH_DAMAGE, player);
            }
        } catch (e) {
            log.error("VillageSword 突刺沿途伤害异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    function spawnDashParticles(world, start, end) {
        try {
            var distance = start.distance(end);
            if (distance < 0.1) return;

            var direction = safeNormalize(end.toVector().subtract(start.toVector()));
            var steps = Math.max(1, Math.ceil(distance * 2.0));
            for (var i = 0; i <= steps; i++) {
                var point = start.toVector()
                        .add(direction.clone().multiply(distance * i / steps));
                world.spawnParticle(Particle.CLOUD,
                        point.getX(), point.getY() + 0.9, point.getZ(),
                        2, 0.12, 0.28, 0.12, 0.0);
            }
            world.spawnParticle(Particle.SWEEP_ATTACK,
                    end.getX(), end.getY() + 0.9, end.getZ(),
                    3, 0.2, 0.2, 0.2, 0.0);
        } catch (e) { }
    }

    function tryDash(player) {
        try {
            var uuid = getPlayerId(player);
            if (!uuid) return;

            if (globalTick < (dashReadyTick[uuid] || 0)) {
                var remain = (dashReadyTick[uuid] || 0) - globalTick;
                sendActionBar(player, ChatColor.GRAY + "突刺冷却中：" + ChatColor.YELLOW
                        + remain + ChatColor.GRAY + " tick");
                return;
            }

            var start = player.getLocation().clone();
            var direction = start.getDirection();
            direction.setY(0);
            direction = safeNormalize(direction);

            var destination = findDashDestination(start, direction);
            if (start.distance(destination) < 0.5) {
                sendActionBar(player, ChatColor.RED + "前方受阻，无法突刺。");
                return;
            }

            damageEntitiesAlongDash(player, start, destination);

            player.teleport(destination);
            try { player.setFallDistance(0.0); } catch (e) { }
            spawnDashParticles(start.getWorld(), start, destination);

            dashReadyTick[uuid] = globalTick + DASH_COOLDOWN_TICKS;
            playSound(start.getWorld(), start, Sound.ENTITY_PLAYER_ATTACK_SWEEP, 1.0, 1.6);
            sendActionBar(player, ChatColor.AQUA + "突刺！");
        } catch (e) {
            log.error("VillageSword 突刺异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }
    // -----------------------------------------------------------------------
    // 事件注册
    // -----------------------------------------------------------------------
    // Q：玩家按 Q 时客户端先创建掉落物实体，服务端触发 PlayerDropItemEvent。
    // 只要掉落的是村好剑，就取消丢出并改为发射剑气。
    registerEvent("org.bukkit.event.player.PlayerDropItemEvent", function (event) {
        try {
            var player = event.getPlayer();
            if (!(player instanceof Player)) return;

            var droppedItem = null;
            try {
                droppedItem = event.getItemDrop().getItemStack();
            } catch (e) { }

            if (!isVillageSword(droppedItem)) return;

            // 不管是否处于冷却/过热，都不能真的把村好剑丢出去。
            event.setCancelled(true);

            if (isSwordDisabled(player)) {
                warnSwordUnavailable(player);
                return;
            }
            if (!canUseSlash(player)) {
                warnSlashCooling(player);
                return;
            }

            fireSwordQi(player);
        } catch (e) {
            log.error("VillageSword Q 事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // F：玩家按 F 时服务端触发 PlayerSwapHandItemsEvent。
    // 手持村好剑时取消换手并改为向前突刺。
    registerEvent("org.bukkit.event.player.PlayerSwapHandItemsEvent", function (event) {
        try {
            var player = event.getPlayer();
            if (!(player instanceof Player)) return;

            var mainHandItem = null;
            try {
                mainHandItem = event.getMainHandItem();
            } catch (e) { }

            if (!isVillageSword(mainHandItem)) return;

            // 手持村好剑时，F 不应该把剑换到副手。
            event.setCancelled(true);

            if (isSwordDisabled(player)) {
                warnSwordUnavailable(player);
                return;
            }

            tryDash(player);
        } catch (e) {
            log.error("VillageSword F 事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // E：按要求拦截“打开玩家背包”事件并改为重击。
    // 注意：纯原版客户端按 E 打开自身背包通常不会触发该事件（详见文件头说明）。
    registerEvent("org.bukkit.event.inventory.InventoryOpenEvent", function (event) {
        try {
            var holder = event.getPlayer();
            if (!(holder instanceof Player)) return;

            var player = holder;
            var inventory = event.getInventory();
            if (!(inventory instanceof PlayerInventory)) return;

            if (!isVillageSword(getMainHandSword(player))) return;
            if (isSwordDisabled(player)) {
                warnSwordUnavailable(player);
                return;
            }

            event.setCancelled(true);
            performHeavyStrike(player);
        } catch (e) {
            log.error("VillageSword E 事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // 过热期间禁止村好剑造成普通近战伤害，确保“剑不可用”状态是真正的不可用。
    registerEvent("org.bukkit.event.entity.EntityDamageByEntityEvent", function (event) {
        try {
            var damager = null;
            try {
                damager = event.getDamager();
            } catch (e) {
                return;
            }

            if (!(damager instanceof Player)) return;
            if (!isVillageSword(getMainHandSword(damager))) return;
            if (!isSwordDisabled(damager)) return;

            event.setCancelled(true);
            warnSwordUnavailable(damager);
        } catch (e) {
            log.error("VillageSword 近战禁用事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });
    // -----------------------------------------------------------------------
    // 禁止附魔：附魔台 / 铁砧 / 指令
    // -----------------------------------------------------------------------
    registerEvent("org.bukkit.event.enchantment.PrepareItemEnchantEvent", function (event) {
        try {
            if (isVillageSword(event.getItem())) event.setCancelled(true);
        } catch (e) {
            log.error("VillageSword 附魔台准备事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    registerEvent("org.bukkit.event.enchantment.EnchantItemEvent", function (event) {
        try {
            if (!isVillageSword(event.getItem())) return;
            event.setCancelled(true);

            var enchanter = event.getEnchanter();
            if (enchanter != null) {
                enchanter.sendMessage(ChatColor.RED + SWORD_NAME + " 无法被附魔。");
            }
        } catch (e) {
            log.error("VillageSword 附魔事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    registerEvent("org.bukkit.event.inventory.PrepareAnvilEvent", function (event) {
        try {
            var inventory = event.getInventory();
            var first = null;
            var second = null;
            var result = null;

            try { first = inventory.getItem(0); } catch (e) { }
            try { second = inventory.getItem(1); } catch (e) { }
            try { result = event.getResult(); } catch (e) { }

            if (!isVillageSword(first) && !isVillageSword(second)) return;
            if (result == null) return;

            var resultMeta = result.getItemMeta();
            if (resultMeta != null && resultMeta.hasEnchants()) {
                event.setResult(null);
            }
        } catch (e) {
            log.error("VillageSword 铁砧事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // 玩家切换到村好剑时立刻净化一次，防止通过插件或异常途径获得带附魔的版本。
    registerEvent("org.bukkit.event.player.PlayerItemHeldEvent", function (event) {
        try {
            var player = event.getPlayer();
            if (!(player instanceof Player)) return;

            var item = null;
            try {
                item = player.getInventory().getItem(event.getNewSlot());
            } catch (e) { }

            if (item != null && sanitizeSwordItem(item)) {
                try {
                    player.getInventory().setItem(event.getNewSlot(), item);
                } catch (e) { }
            }
        } catch (e) {
            log.error("VillageSword 切换物品事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // 阻止 /enchant 直接给村好剑添加附魔。
    registerEvent("org.bukkit.event.player.PlayerCommandPreprocessEvent", function (event) {
        try {
            var player = event.getPlayer();
            if (!(player instanceof Player)) return;
            if (!isVillageSword(getMainHandSword(player))) return;

            var message = String(event.getMessage() == null ? "" : event.getMessage()).trim().toLowerCase();
            if (message.indexOf("/enchant") === 0) {
                event.setCancelled(true);
                player.sendMessage(ChatColor.RED + SWORD_NAME + " 无法被附魔。");
            }
        } catch (e) {
            log.error("VillageSword 指令附魔拦截异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });
    // -----------------------------------------------------------------------
    // 玩家退出清理 / 主循环
    // -----------------------------------------------------------------------
    registerEvent("org.bukkit.event.player.PlayerQuitEvent", function (event) {
        try {
            var uuid = String(event.getPlayer().getUniqueId().toString());
            delete swordDisabledUntil[uuid];
            delete slashReadyTick[uuid];
            delete dashReadyTick[uuid];
        } catch (e) { }
    });

    // 每秒 20 tick 的同步主循环：推进剑气飞行、命中判定和生命周期清理。
    task.repeat(ticks(1), ticks(1), function () {
        globalTick++;
        try {
            updateSlashes();
        } catch (e) {
            log.error("VillageSword 主循环异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // 脚本卸载 / 热重载时清理飞行中的剑气实体并在装备注册表中注销。
    try {
        task.bindToUnload(function () {
            for (var i = activeSlashes.length - 1; i >= 0; i--) {
                removeSlashAt(i);
            }
            try {
                var registry = getShared("EquipRegistry");
                if (registry) registry.unregister(EQUIP_SLOT, SWORD_ID);
            } catch (e) { }
        });
    } catch (e) { }

    log.info("VillageSword 已加载：/equip arms " + SWORD_NAME
            + "（Q 剑气 / E 重击 / F 突刺）");
})();
