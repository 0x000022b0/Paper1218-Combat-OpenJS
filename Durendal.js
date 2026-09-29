/*
 * Durendal.js —— 自定义武器「杜兰达尔」（OpenJS 1.5.0）
 *
 * 获取方式：/equip arms 杜兰达尔
 *
 * 特殊效果：
 *   - 金剑魔改，基础伤害 12，无限耐久，有附魔光效但无法附魔。
 *   - 对亡灵生物伤害 +4。
 *   - Q：恢复 15 生命，10 秒冷却。
 *   - 长按 1（快捷栏第 1 格）：蓄力金块；每 tick 射程 +1.5、威力 +1，
 *     每 10 tick 碰撞体积增大；最多蓄力 3 秒；发射后 6 秒冷却。
 *   - 按 4：发射金色粒子剑气，伤害 10，15 tick 冷却。
 *
 * 说明：原版服务器收不到“按键按下/松开”事件，只能收到快捷栏选择变化
 *       （PlayerItemHeldEvent）。因此“长按 1”用以下方式近似：
 *       - 按 1（或按 1 选中杜兰达尔）开始蓄力；
 *       - 再按其他快捷栏键 / 按 4 视为释放，按当前蓄力值发射金块；
 *       - 如果不按其他键，蓄满 3 秒后自动发射；
 *       - 如果杜兰达尔已在第 1 格且已选中，需要先按其他数字键再按 1 才能重新开始蓄力。
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
    var Tag = Java.type("org.bukkit.Tag");
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
    var Transformation = Java.type("org.bukkit.util.Transformation");
    var Vector3f = Java.type("org.joml.Vector3f");
    var Quaternionf = Java.type("org.joml.Quaternionf");
    var Billboard = Java.type("org.bukkit.entity.Display$Billboard");
    var Brightness = Java.type("org.bukkit.entity.Display$Brightness");
    var Class = Java.type("java.lang.Class");
    var ItemFlagClass = Class.forName("org.bukkit.inventory.ItemFlag");
    var Array = Java.type("java.lang.reflect.Array");
    var BlockDisplayClass = Class.forName("org.bukkit.entity.BlockDisplay");
    var SnowballClass = Class.forName("org.bukkit.entity.Snowball");

    // -----------------------------------------------------------------------
    // 数值配置
    // -----------------------------------------------------------------------
    var SWORD_ID = "durendal";
    var SWORD_NAME = "杜兰达尔";
    var EQUIP_SLOT = "arms";

    var SWORD_KEY = new NamespacedKey(plugin, "durendal_item");
    var DAMAGE_MODIFIER_KEY = new NamespacedKey(plugin, "durendal_attack_damage");
    var SPEED_MODIFIER_KEY = new NamespacedKey(plugin, "durendal_attack_speed");

    var GOLD_BLOCK_TAG = "durendal_gold_block";
    var GOLD_QI_TAG = "durendal_gold_qi";
    var GOLD_QI_SOURCE_TAG = "durendal_gold_qi_source";

    var PLAYER_BASE_ATTACK_DAMAGE = 1.0;
    var PLAYER_BASE_ATTACK_SPEED = 4.0;
    var GOLDEN_SWORD_ATTACK_SPEED = 1.6;

    var SWORD_ATTACK_DAMAGE = 12.0;
    var ADDED_ATTACK_DAMAGE = SWORD_ATTACK_DAMAGE - PLAYER_BASE_ATTACK_DAMAGE; // +11.0
    var ADDED_ATTACK_SPEED = GOLDEN_SWORD_ATTACK_SPEED - PLAYER_BASE_ATTACK_SPEED; // -2.4

    var UNDEAD_BONUS_DAMAGE = 4.0;

    var HEAL_AMOUNT = 15.0;
    var HEAL_COOLDOWN_TICKS = 200; // 10 秒

    var MAX_CHARGE_TICKS = 60;          // 3 秒
    var CHARGE_COOLDOWN_TICKS = 120;    // 6 秒
    var CHARGE_BASE_RANGE = 6.0;
    var CHARGE_RANGE_PER_TICK = 1.5;
    var CHARGE_BASE_POWER = 1;
    var CHARGE_POWER_PER_TICK = 1;
    var CHARGE_BASE_RADIUS = 0.8;
    var CHARGE_RADIUS_PER_10_TICKS = 0.2;
    var GOLD_BLOCK_SPEED = 1.5;

    var GOLD_QI_DAMAGE = 10.0;
    var GOLD_QI_COOLDOWN_TICKS = 15;
    var GOLD_QI_RANGE = 16.0;
    var GOLD_QI_SPEED = 1.0;
    var GOLD_QI_HIT_RADIUS = 1.0;

    var GOLD_DUST = new DustOptions(Color.fromRGB(255, 200, 40), 1.2);
    var GOLD_SMALL_DUST = new DustOptions(Color.fromRGB(255, 230, 120), 0.8);

    // -----------------------------------------------------------------------
    // 运行时状态
    // -----------------------------------------------------------------------
    var globalTick = 0;
    var healCooldownUntil = {};       // player uuid -> tick
    var chargeCooldownUntil = {};     // player uuid -> tick
    var qiCooldownUntil = {};         // player uuid -> tick
    var activeCharges = {};           // player uuid -> { player, ticks }
    var activeGoldBlocks = [];        // 飞行中的蓄力金块
    var activeGoldQis = [];           // 飞行中的金色剑气
    var lastEquipRegistry = null;

    // -----------------------------------------------------------------------
    // 工具函数
    // -----------------------------------------------------------------------
    function isDurendal(item) {
        try {
            if (item == null || item.getType() != Material.GOLDEN_SWORD) return false;
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

    function setGoldBlockTransform(display, scale) {
        // BlockDisplay 模型原点在方块角上，把方块中心平移到显示实体位置。
        var spin = new Quaternionf();
        var half = scale * 0.5;
        var rotatedCenter = spin.transform(new Vector3f(half, half, half));
        var translation = new Vector3f(-rotatedCenter.x(), -rotatedCenter.y(), -rotatedCenter.z());
        display.setTransformation(new Transformation(
                translation,
                spin,
                new Vector3f(scale, scale, scale),
                new Quaternionf()
        ));
    }

    function dealAbilityDamage(target, amount, source) {
        if (!target) return false;
        try {
            if (!(target instanceof LivingEntity)) return false;
            if (target.isDead() || !target.isValid()) return false;
            if (source != null && target === source) return false;

            try {
                target.setNoDamageTicks(0);
            } catch (e) { }

            if (source != null) target.damage(amount, source);
            else target.damage(amount);
            return true;
        } catch (e) {
            log.error("Durendal 技能伤害异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
            return false;
        }
    }

    // -----------------------------------------------------------------------
    // 物品构建 / 净化 / 注册
    // -----------------------------------------------------------------------
    function createDurendalItem() {
        var item = new ItemStack(Material.GOLDEN_SWORD, 1);
        var meta = item.getItemMeta();
        if (meta == null) return item;

        meta.setDisplayName(ChatColor.GOLD + SWORD_NAME);
        meta.setLore(toJavaList([
            ChatColor.YELLOW + "基础伤害：" + ChatColor.RED + "12",
            ChatColor.YELLOW + "对亡灵生物伤害：" + ChatColor.RED + "+4",
            ChatColor.AQUA + "Q " + ChatColor.GRAY + "恢复 15 生命（冷却 10 秒）",
            ChatColor.AQUA + "长按 1 " + ChatColor.GRAY + "蓄力金块（最多 3 秒，冷却 6 秒）",
            ChatColor.AQUA + "按 4 " + ChatColor.GRAY + "发射金色剑气（伤害 10，冷却 15 tick）"
        ]));

        meta.setUnbreakable(true);

        try {
            meta.setEnchantmentGlintOverride(true);
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
            log.error("Durendal 写入属性失败：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }

        meta.getPersistentDataContainer().set(SWORD_KEY, PersistentDataType.STRING, SWORD_ID);
        item.setItemMeta(meta);
        return item;
    }

    function sanitizeDurendalItem(item) {
        try {
            if (!isDurendal(item)) return false;

            var meta = item.getItemMeta();
            if (meta == null) return false;

            var changed = false;
            if (meta.hasEnchants()) {
                meta.removeEnchantments();
                changed = true;
            }
            try {
                if (String(meta.getEnchantmentGlintOverride()) !== "true") {
                    meta.setEnchantmentGlintOverride(true);
                    changed = true;
                }
            } catch (e) { }

            if (changed) item.setItemMeta(meta);
            return changed;
        } catch (e) {
            return false;
        }
    }

    var durendalDefinition = {
        id: SWORD_ID,
        slot: EQUIP_SLOT,
        name: SWORD_NAME,
        aliases: ["杜兰", "durendal", "durandal"],
        create: createDurendalItem
    };

    function ensureRegistered() {
        try {
            var registry = getShared("EquipRegistry");
            if (!registry) return;

            if (registry !== lastEquipRegistry || !registry.get(EQUIP_SLOT, SWORD_ID)) {
                registry.register(durendalDefinition);
                lastEquipRegistry = registry;
            } else {
                registry.heartbeat(EQUIP_SLOT, SWORD_ID);
            }
        } catch (e) {
            log.error("Durendal 注册装备失败：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    ensureRegistered();
    task.repeat(ticks(20), ticks(20), ensureRegistered);

    // -----------------------------------------------------------------------
    // Q 技能：恢复 15 生命（10 秒冷却）
    // -----------------------------------------------------------------------
    function isHealOnCooldown(player) {
        var uuid = getPlayerId(player);
        if (!uuid) return true;
        return globalTick < (healCooldownUntil[uuid] || 0);
    }

    function tryHeal(player) {
        try {
            var uuid = getPlayerId(player);
            if (!uuid) return;

            if (isHealOnCooldown(player)) {
                var remain = Math.ceil(((healCooldownUntil[uuid] || 0) - globalTick) / 20.0);
                sendActionBar(player, ChatColor.GRAY + "杜兰达尔治疗冷却中："
                        + ChatColor.YELLOW + remain + ChatColor.GRAY + " 秒");
                return;
            }

            var maxHealth = player.getMaxHealth();
            var health = player.getHealth();
            if (health >= maxHealth) {
                sendActionBar(player, ChatColor.GRAY + "生命值已满，未消耗治疗冷却。");
                return;
            }

            var healed = Math.min(maxHealth, health + HEAL_AMOUNT);
            player.setHealth(healed);
            healCooldownUntil[uuid] = globalTick + HEAL_COOLDOWN_TICKS;

            var world = player.getWorld();
            var location = player.getLocation().clone().add(0, 1.0, 0);
            playSound(world, location, Sound.ITEM_TOTEM_USE, 0.8, 1.2);
            try {
                world.spawnParticle(Particle.HEART, location.getX(), location.getY(),
                        location.getZ(), 6, 0.4, 0.5, 0.4, 0.0);
                world.spawnParticle(Particle.DUST, location.getX(), location.getY(),
                        location.getZ(), 15, 0.5, 0.6, 0.5, 0.0, GOLD_DUST);
            } catch (e) { }

            sendActionBar(player, ChatColor.GOLD + "杜兰达尔恢复了 " + ChatColor.YELLOW
                    + HEAL_AMOUNT + ChatColor.GOLD + " 点生命。");
        } catch (e) {
            log.error("Durendal 治疗异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    registerEvent("org.bukkit.event.player.PlayerDropItemEvent", function (event) {
        try {
            var player = event.getPlayer();
            if (!(player instanceof Player)) return;

            var droppedItem = null;
            try { droppedItem = event.getItemDrop().getItemStack(); } catch (e) { }
            if (!isDurendal(droppedItem)) return;

            event.setCancelled(true);
            tryHeal(player);
        } catch (e) {
            log.error("Durendal Q 事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // -----------------------------------------------------------------------
    // 对亡灵生物伤害 +4
    // -----------------------------------------------------------------------
    registerEvent("org.bukkit.event.entity.EntityDamageByEntityEvent", function (event) {
        try {
            var damager = null;
            try { damager = event.getDamager(); } catch (e) { return; }
            if (!(damager instanceof Player)) return;
            if (!isDurendal(getMainHandItem(damager))) return;

            var causeName = String(event.getCause().name());
            if (causeName !== "ENTITY_ATTACK" && causeName !== "ENTITY_SWEEP_ATTACK") return;

            var target = event.getEntity();
            if (!(target instanceof LivingEntity)) return;

            if (!Tag.ENTITY_TYPES_UNDEAD.isTagged(target.getType())) return;

            event.setDamage(event.getDamage() + UNDEAD_BONUS_DAMAGE);
        } catch (e) {
            log.error("Durendal 亡灵增伤异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // -----------------------------------------------------------------------
    // 1 键蓄力
    // -----------------------------------------------------------------------
    function startCharge(player) {
        var uuid = getPlayerId(player);
        if (!uuid) return false;

        if (globalTick < (chargeCooldownUntil[uuid] || 0)) {
            var remain = Math.ceil(((chargeCooldownUntil[uuid] || 0) - globalTick) / 20.0);
            sendActionBar(player, ChatColor.GRAY + "金块蓄力冷却中："
                    + ChatColor.YELLOW + remain + ChatColor.GRAY + " 秒");
            return false;
        }

        if (activeCharges[uuid]) return true;
        activeCharges[uuid] = { player: player, ticks: 0 };
        sendActionBar(player, ChatColor.GOLD + "开始蓄力金块……");
        return true;
    }

    function releaseCharge(player, autoRelease) {
        var uuid = getPlayerId(player);
        if (!uuid) return;

        var charge = activeCharges[uuid];
        if (!charge) return;
        delete activeCharges[uuid];

        var ticks = charge.ticks;
        launchGoldBlock(player, ticks);
        chargeCooldownUntil[uuid] = globalTick + CHARGE_COOLDOWN_TICKS;

        if (autoRelease === true) {
            sendActionBar(player, ChatColor.GOLD + "金块蓄力已满 3 秒，自动发射！");
        } else {
            sendActionBar(player, ChatColor.GOLD + "金块已发射（蓄力 "
                    + ChatColor.YELLOW + ticks + ChatColor.GOLD + " tick）。");
        }
    }

    function launchGoldBlock(player, chargeTicks) {
        try {
            var eye = player.getEyeLocation();
            var direction = safeNormalize(eye.getDirection());
            var spawnLocation = eye.clone().add(direction.clone().multiply(1.2));
            var world = player.getWorld();

            var range = CHARGE_BASE_RANGE + chargeTicks * CHARGE_RANGE_PER_TICK;
            var power = CHARGE_BASE_POWER + chargeTicks * CHARGE_POWER_PER_TICK;
            var hitRadius = CHARGE_BASE_RADIUS
                    + Math.floor(chargeTicks / 10.0) * CHARGE_RADIUS_PER_10_TICKS;
            var visualScale = 0.8 + Math.min(1.2, (chargeTicks / MAX_CHARGE_TICKS) * 1.2);

            var display = world.spawn(spawnLocation, BlockDisplayClass);
            if (!display) {
                sendMessage(player, ChatColor.RED + "金块生成失败，请稍后再试。");
                return;
            }

            display.setBlock(Material.GOLD_BLOCK.createBlockData());
            display.setBillboard(Billboard.FIXED);
            display.setBrightness(new Brightness(15, 15));
            display.setInvulnerable(true);
            display.setPersistent(false);
            display.addScoreboardTag(GOLD_BLOCK_TAG);
            setGoldBlockTransform(display, visualScale);

            activeGoldBlocks.push({
                owner: player,
                display: display,
                world: world,
                location: spawnLocation.clone(),
                direction: direction.clone(),
                maxRange: range,
                power: power,
                hitRadius: hitRadius,
                travelled: 0.0,
                visualScale: visualScale
            });

            playSound(world, player.getLocation(), Sound.ENTITY_FIREWORK_ROCKET_LAUNCH, 0.8, 1.4);
        } catch (e) {
            log.error("Durendal 发射金块异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    function isGoldQiOnCooldown(player) {
        var uuid = getPlayerId(player);
        if (!uuid) return true;
        return globalTick < (qiCooldownUntil[uuid] || 0);
    }

    function fireGoldQi(player) {
        try {
            if (isGoldQiOnCooldown(player)) {
                var uuid = getPlayerId(player);
                var remain = (qiCooldownUntil[uuid] || 0) - globalTick;
                sendActionBar(player, ChatColor.GRAY + "金色剑气冷却中："
                        + ChatColor.YELLOW + remain + ChatColor.GRAY + " tick");
                return;
            }

            var eye = player.getEyeLocation();
            var direction = safeNormalize(eye.getDirection());
            var spawnLocation = eye.clone().add(direction.clone().multiply(0.6));
            var world = player.getWorld();

            var source = world.spawn(spawnLocation, SnowballClass);
            if (!source) {
                sendMessage(player, ChatColor.RED + "金色剑气生成失败，请稍后再试。");
                return;
            }
            source.setShooter(player);
            source.setVelocity(new Vector(0, 0, 0));
            source.setGravity(false);
            source.setSilent(true);
            source.setInvisible(true);
            source.setInvulnerable(true);
            source.setPersistent(false);
            source.addScoreboardTag(GOLD_QI_SOURCE_TAG);

            activeGoldQis.push({
                owner: player,
                source: source,
                world: world,
                location: spawnLocation.clone(),
                direction: direction.clone(),
                travelled: 0.0,
                hit: {}
            });

            var playerId = getPlayerId(player);
            if (playerId) qiCooldownUntil[playerId] = globalTick + GOLD_QI_COOLDOWN_TICKS;

            playSound(world, player.getLocation(), Sound.ENTITY_PLAYER_ATTACK_SWEEP, 1.0, 1.5);
        } catch (e) {
            log.error("Durendal 发射金色剑气异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    registerEvent("org.bukkit.event.player.PlayerItemHeldEvent", function (event) {
        try {
            var player = event.getPlayer();
            if (!(player instanceof Player)) return;

            var previousItem = null;
            var newItem = null;
            try { previousItem = player.getInventory().getItem(event.getPreviousSlot()); } catch (e) { }
            try { newItem = player.getInventory().getItem(event.getNewSlot()); } catch (e) { }

            var holding = isDurendal(previousItem);
            var selecting = isDurendal(newItem);
            var uuid = getPlayerId(player);
            var charging = uuid && activeCharges[uuid];

            // 非杜兰达尔切换：如果正在蓄力，视为释放。
            if (!holding && !selecting) {
                if (charging) releaseCharge(player, false);
                return;
            }

            // 按 1（槽位 0）：开始/继续蓄力；如果武器已在手，取消槽位切换以保持持剑。
            if (event.getNewSlot() === 0) {
                if (holding) event.setCancelled(true);
                if (!charging) startCharge(player);
                return;
            }

            // 按 4（槽位 3）：释放当前蓄力并发射金色剑气。
            if (event.getNewSlot() === 3) {
                if (charging) releaseCharge(player, false);
                if (holding) event.setCancelled(true);
                fireGoldQi(player);
                return;
            }

            // 其他数字键：视为提前释放蓄力。
            if (charging) releaseCharge(player, false);
        } catch (e) {
            log.error("Durendal 数字键事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // -----------------------------------------------------------------------
    // 蓄力 / 金块 / 剑气主循环
    // -----------------------------------------------------------------------
    function spawnChargeParticles(player, ticks) {
        try {
            var world = player.getWorld();
            var location = player.getLocation().clone().add(0, 1.0, 0);
            var progress = ticks / MAX_CHARGE_TICKS;
            var radius = 0.8 + progress * 1.2;
            world.spawnParticle(Particle.DUST, location.getX(), location.getY(),
                    location.getZ(), 10, radius, 0.5, radius, 0.0, GOLD_DUST);
        } catch (e) { }
    }

    function updateCharges() {
        var currentKeys = [];
        for (var key in activeCharges) {
            if (activeCharges.hasOwnProperty(key)) currentKeys.push(key);
        }

        for (var i = 0; i < currentKeys.length; i++) {
            var uuid = currentKeys[i];
            var charge = activeCharges[uuid];
            if (!charge) continue;

            try {
                var player = charge.player;
                if (!player || !player.isOnline() || !player.isValid()) {
                    delete activeCharges[uuid];
                    continue;
                }

                charge.ticks++;
                if (charge.ticks % 2 === 0) {
                    var seconds = (charge.ticks / 20.0).toFixed(1);
                    sendActionBar(player, ChatColor.GOLD + "金块蓄力："
                            + ChatColor.YELLOW + seconds + ChatColor.GOLD + " / 3.0 秒");
                    spawnChargeParticles(player, charge.ticks);
                }

                if (charge.ticks >= MAX_CHARGE_TICKS) {
                    releaseCharge(player, true);
                }
            } catch (e) {
                delete activeCharges[uuid];
                log.error("Durendal 蓄力更新异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
            }
        }
    }

    function spawnGoldBlockTrail(goldBlock) {
        try {
            var location = goldBlock.location;
            goldBlock.world.spawnParticle(Particle.DUST, location.getX(), location.getY(),
                    location.getZ(), 8, 0.25, 0.25, 0.25, 0.0, GOLD_DUST);
            goldBlock.world.spawnParticle(Particle.DUST, location.getX(), location.getY(),
                    location.getZ(), 4, 0.15, 0.15, 0.15, 0.0, GOLD_SMALL_DUST);
        } catch (e) { }
    }

    function removeGoldBlockAt(index, impactLocation) {
        var goldBlock = activeGoldBlocks[index];
        if (goldBlock && goldBlock.display) {
            try {
                if (goldBlock.display.isValid()) goldBlock.display.remove();
            } catch (e) { }
        }
        activeGoldBlocks.splice(index, 1);
    }

    function impactGoldBlock(goldBlock, location) {
        try {
            var nearby = goldBlock.world.getNearbyEntities(location,
                    goldBlock.hitRadius, goldBlock.hitRadius, goldBlock.hitRadius);
            var iterator = nearby.iterator();

            while (iterator.hasNext()) {
                var target = iterator.next();
                if (target === goldBlock.owner) continue;
                if (!(target instanceof LivingEntity)) continue;
                if (target.isDead() || !target.isValid()) continue;

                dealAbilityDamage(target, goldBlock.power, goldBlock.display);
                try {
                    var push = goldBlock.direction.clone().multiply(0.8);
                    push.setY(0.35);
                    target.setVelocity(push);
                } catch (e) { }
            }

            goldBlock.world.spawnParticle(Particle.DUST, location.getX(), location.getY(),
                    location.getZ(), 40, goldBlock.hitRadius, goldBlock.hitRadius,
                    goldBlock.hitRadius, 0.0, GOLD_DUST);
            goldBlock.world.spawnParticle(Particle.DUST, location.getX(), location.getY(),
                    location.getZ(), 20, goldBlock.hitRadius * 0.7, goldBlock.hitRadius * 0.7,
                    goldBlock.hitRadius * 0.7, 0.0, GOLD_SMALL_DUST);
            playSound(goldBlock.world, location, Sound.ENTITY_GENERIC_EXPLODE, 0.6, 1.6);
        } catch (e) {
            log.error("Durendal 金块命中异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    function isBlockedLocation(world, location) {
        try {
            return !location.getBlock().isPassable();
        } catch (e) {
            return false;
        }
    }

    function updateGoldBlocks() {
        for (var i = activeGoldBlocks.length - 1; i >= 0; i--) {
            var goldBlock = activeGoldBlocks[i];
            if (!goldBlock) {
                activeGoldBlocks.splice(i, 1);
                continue;
            }

            try {
                if (!goldBlock.display || !goldBlock.display.isValid()) {
                    removeGoldBlockAt(i, null);
                    continue;
                }

                var next = goldBlock.location.clone()
                        .add(goldBlock.direction.clone().multiply(GOLD_BLOCK_SPEED));
                goldBlock.travelled += GOLD_BLOCK_SPEED;

                if (goldBlock.travelled >= goldBlock.maxRange
                        || isBlockedLocation(goldBlock.world, next)) {
                    impactGoldBlock(goldBlock, next);
                    removeGoldBlockAt(i, next);
                    continue;
                }

                goldBlock.location = next;
                try {
                    goldBlock.display.teleport(next);
                    setGoldBlockTransform(goldBlock.display, goldBlock.visualScale);
                } catch (e) { }
                spawnGoldBlockTrail(goldBlock);
            } catch (e) {
                log.error("Durendal 金块更新异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
                removeGoldBlockAt(i, null);
            }
        }
    }

    function spawnGoldQiParticles(world, location, direction) {
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
                        1, 0.0, 0.0, 0.0, 0.0, GOLD_DUST);
            }
            world.spawnParticle(Particle.DUST, location.getX(), location.getY(),
                    location.getZ(), 5, 0.2, 0.2, 0.2, 0.0, GOLD_SMALL_DUST);
        } catch (e) { }
    }

    function removeGoldQiAt(index) {
        var qi = activeGoldQis[index];
        if (qi && qi.source) {
            try {
                if (qi.source.isValid()) qi.source.remove();
            } catch (e) { }
        }
        activeGoldQis.splice(index, 1);
    }

    function damageGoldQiEntities(qi, location) {
        try {
            var nearby = qi.world.getNearbyEntities(location,
                    GOLD_QI_HIT_RADIUS, GOLD_QI_HIT_RADIUS, GOLD_QI_HIT_RADIUS);
            var iterator = nearby.iterator();

            while (iterator.hasNext()) {
                var target = iterator.next();
                if (target === qi.owner) continue;
                if (!(target instanceof LivingEntity)) continue;
                if (target.isDead() || !target.isValid()) continue;

                var targetId = String(target.getUniqueId().toString());
                if (qi.hit[targetId]) continue;
                qi.hit[targetId] = true;

                dealAbilityDamage(target, GOLD_QI_DAMAGE, qi.source);
                try {
                    qi.world.spawnParticle(Particle.SWEEP_ATTACK,
                            target.getLocation().getX(), target.getLocation().getY() + 1.0,
                            target.getLocation().getZ(), 1, 0.0, 0.0, 0.0, 0.0);
                } catch (e) { }
            }
        } catch (e) {
            log.error("Durendal 金色剑气命中异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    function updateGoldQis() {
        for (var i = activeGoldQis.length - 1; i >= 0; i--) {
            var qi = activeGoldQis[i];
            if (!qi) {
                activeGoldQis.splice(i, 1);
                continue;
            }

            try {
                if (!qi.owner || !qi.owner.isOnline() || !qi.owner.isValid()
                        || !qi.source || !qi.source.isValid()) {
                    removeGoldQiAt(i);
                    continue;
                }

                var next = qi.location.clone().add(qi.direction.clone().multiply(GOLD_QI_SPEED));
                qi.travelled += GOLD_QI_SPEED;

                if (qi.travelled > GOLD_QI_RANGE || isBlockedLocation(qi.world, next)) {
                    spawnGoldQiParticles(qi.world, next, qi.direction);
                    removeGoldQiAt(i);
                    continue;
                }

                qi.location = next;
                try { qi.source.teleport(next); } catch (e) { }
                spawnGoldQiParticles(qi.world, next, qi.direction);
                damageGoldQiEntities(qi, next);
            } catch (e) {
                log.error("Durendal 金色剑气更新异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
                removeGoldQiAt(i);
            }
        }
    }

    // 1 tick 主循环：蓄力、金块飞行、金色剑气飞行。
    task.repeat(ticks(1), ticks(1), function () {
        globalTick++;
        try {
            updateCharges();
            updateGoldBlocks();
            updateGoldQis();
        } catch (e) {
            log.error("Durendal 主循环异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // 玩家退出时清理该玩家的蓄力与冷却状态。
    registerEvent("org.bukkit.event.player.PlayerQuitEvent", function (event) {
        try {
            var uuid = String(event.getPlayer().getUniqueId().toString());
            delete activeCharges[uuid];
            delete healCooldownUntil[uuid];
            delete chargeCooldownUntil[uuid];
            delete qiCooldownUntil[uuid];
        } catch (e) { }
    });

    // -----------------------------------------------------------------------
    // 禁止附魔：附魔台 / 铁砧 / 指令
    // -----------------------------------------------------------------------
    registerEvent("org.bukkit.event.enchantment.PrepareItemEnchantEvent", function (event) {
        try {
            if (isDurendal(event.getItem())) event.setCancelled(true);
        } catch (e) {
            log.error("Durendal 附魔台准备事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    registerEvent("org.bukkit.event.enchantment.EnchantItemEvent", function (event) {
        try {
            if (!isDurendal(event.getItem())) return;
            event.setCancelled(true);

            var enchanter = event.getEnchanter();
            if (enchanter != null) enchanter.sendMessage(ChatColor.RED + SWORD_NAME + " 无法被附魔。");
        } catch (e) {
            log.error("Durendal 附魔事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
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

            if (!isDurendal(first) && !isDurendal(second)) return;
            if (result == null) return;

            var resultMeta = result.getItemMeta();
            if (resultMeta != null && resultMeta.hasEnchants()) {
                event.setResult(null);
            }
        } catch (e) {
            log.error("Durendal 铁砧事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    registerEvent("org.bukkit.event.player.PlayerItemHeldEvent", function (event) {
        try {
            var player = event.getPlayer();
            if (!(player instanceof Player)) return;

            var item = null;
            try { item = player.getInventory().getItem(event.getNewSlot()); } catch (e) { }
            if (item != null && sanitizeDurendalItem(item)) {
                try { player.getInventory().setItem(event.getNewSlot(), item); } catch (e) { }
            }
        } catch (e) {
            log.error("Durendal 切换物品净化异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    registerEvent("org.bukkit.event.player.PlayerSwapHandItemsEvent", function (event) {
        try {
            var mainItem = null;
            var offItem = null;
            try { mainItem = event.getMainHandItem(); } catch (e) { }
            try { offItem = event.getOffHandItem(); } catch (e) { }

            if (mainItem != null && sanitizeDurendalItem(mainItem)) event.setMainHandItem(mainItem);
            if (offItem != null && sanitizeDurendalItem(offItem)) event.setOffHandItem(offItem);
        } catch (e) {
            log.error("Durendal 换手净化异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    registerEvent("org.bukkit.event.player.PlayerCommandPreprocessEvent", function (event) {
        try {
            var player = event.getPlayer();
            if (!(player instanceof Player)) return;
            if (!isDurendal(getMainHandItem(player))) return;

            var message = String(event.getMessage() == null ? "" : event.getMessage()).trim().toLowerCase();
            if (message.indexOf("/enchant") === 0) {
                event.setCancelled(true);
                player.sendMessage(ChatColor.RED + SWORD_NAME + " 无法被附魔。");
            }
        } catch (e) {
            log.error("Durendal 指令附魔拦截异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // 脚本卸载 / 热重载：清理蓄力、金块、剑气实体并在装备注册表中注销。
    try {
        task.bindToUnload(function () {
            activeCharges = {};

            for (var i = activeGoldBlocks.length - 1; i >= 0; i--) {
                removeGoldBlockAt(i, null);
            }
            activeGoldBlocks = [];

            for (var j = activeGoldQis.length - 1; j >= 0; j--) {
                removeGoldQiAt(j);
            }
            activeGoldQis = [];

            try {
                var registry = getShared("EquipRegistry");
                if (registry) registry.unregister(EQUIP_SLOT, SWORD_ID);
            } catch (e) { }
        });
    } catch (e) { }

    log.info("Durendal 已加载：/equip arms " + SWORD_NAME
            + "（伤害 12 / 亡灵 +4 / Q 治疗 / 1 蓄力金块 / 4 金色剑气）");
})();
