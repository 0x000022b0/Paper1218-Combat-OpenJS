/*
 * EnderSword.js —— 自定义武器「末影剑」（OpenJS 1.5.0）
 *
 * 获取方式：/equip arms 末影剑
 *
 * 机制摘要：
 *   - 铁剑魔改：基础伤害 9，无限耐久，无附魔但强制附魔光效。
 *   - 触及 +1.5：主手装备时同时增加方块交互距离与实体交互距离。
 *   - Q（丢弃物品事件）：拦截丢剑，向视线方向投掷一颗 2.5 倍飞行速度的末影珍珠。
 *
 * 鼠标悬停介绍中写入：
 *   - 触及 +1.5
 *   - Q 投掷 2.5 倍飞行速度的末影珍珠
 * 另外附带基础伤害 9 的说明。
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
    var Attribute = Java.type("org.bukkit.attribute.Attribute");
    var AttributeModifier = Java.type("org.bukkit.attribute.AttributeModifier");
    var AttributeOperation = Java.type("org.bukkit.attribute.AttributeModifier$Operation");
    var EquipmentSlotGroup = Java.type("org.bukkit.inventory.EquipmentSlotGroup");
    var Vector = Java.type("org.bukkit.util.Vector");
    var Sound = Java.type("org.bukkit.Sound");
    var Class = Java.type("java.lang.Class");
    var ItemFlagClass = Class.forName("org.bukkit.inventory.ItemFlag");
    var Array = Java.type("java.lang.reflect.Array");
    var EnderPearlClass = Class.forName("org.bukkit.entity.EnderPearl");

    // -----------------------------------------------------------------------
    // 数值配置
    // -----------------------------------------------------------------------
    var SWORD_ID = "ender_sword";
    var SWORD_NAME = "末影剑";
    var EQUIP_SLOT = "arms";

    var SWORD_KEY = new NamespacedKey(plugin, "ender_sword_item");
    var DAMAGE_MODIFIER_KEY = new NamespacedKey(plugin, "ender_sword_attack_damage");
    var SPEED_MODIFIER_KEY = new NamespacedKey(plugin, "ender_sword_attack_speed");
    var ENTITY_RANGE_MODIFIER_KEY = new NamespacedKey(plugin, "ender_sword_entity_reach");
    var BLOCK_RANGE_MODIFIER_KEY = new NamespacedKey(plugin, "ender_sword_block_reach");

    var PLAYER_BASE_ATTACK_DAMAGE = 1.0;
    var PLAYER_BASE_ATTACK_SPEED = 4.0;
    var IRON_SWORD_ATTACK_SPEED = 1.6;

    var SWORD_ATTACK_DAMAGE = 9.0;
    var ADDED_ATTACK_DAMAGE = SWORD_ATTACK_DAMAGE - PLAYER_BASE_ATTACK_DAMAGE; // +8.0
    var ADDED_ATTACK_SPEED = IRON_SWORD_ATTACK_SPEED - PLAYER_BASE_ATTACK_SPEED; // -2.4

    var REACH_BONUS = 1.5;
    var NORMAL_ENDER_PEARL_SPEED = 1.5;
    var PEARL_SPEED_MULTIPLIER = 2.5;
    var THROWN_PEARL_SPEED = NORMAL_ENDER_PEARL_SPEED * PEARL_SPEED_MULTIPLIER; // 3.75
    var PEARL_COOLDOWN_TICKS = 12;

    var PROJECTILE_TAG = "ender_sword_pearl";

    // -----------------------------------------------------------------------
    // 运行时状态
    // -----------------------------------------------------------------------
    var globalTick = 0;
    var activePearls = [];       // 本武器投掷出的末影珍珠，脚本卸载时清理
    var pearlReadyTick = {};     // player uuid -> 下一次可投掷末影珍珠的 tick
    var lastEquipRegistry = null;

    // -----------------------------------------------------------------------
    // 工具函数
    // -----------------------------------------------------------------------
    function isEnderSword(item) {
        try {
            if (item == null || item.getType() != Material.IRON_SWORD) return false;
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

    function safeNormalize(vector) {
        if (!vector) return new Vector(0, 0, 1);
        if (vector.lengthSquared() < 0.0001) return new Vector(0, 0, 1);
        return vector.clone().normalize();
    }

    function cleanupInactivePearls() {
        var current = [];
        for (var i = 0; i < activePearls.length; i++) {
            var pearl = activePearls[i];
            try {
                if (pearl != null && pearl.isValid()) current.push(pearl);
            } catch (e) { }
        }
        activePearls = current;
    }

    function getPlayerId(player) {
        try {
            return String(player.getUniqueId().toString());
        } catch (e) {
            return "";
        }
    }

    function canThrowPearl(player) {
        var uuid = getPlayerId(player);
        if (!uuid) return false;
        return globalTick >= (pearlReadyTick[uuid] || 0);
    }

    function setPearlCooldown(player, ticks) {
        var uuid = getPlayerId(player);
        if (uuid) pearlReadyTick[uuid] = globalTick + Math.max(0, ticks);

        try {
            var item = player.getInventory().getItemInMainHand();
            if (isEnderSword(item)) player.setCooldown(item, ticks);
        } catch (e) { }
    }

    function warnPearlCooldown(player) {
        try {
            var uuid = getPlayerId(player);
            var remain = Math.max(0, (pearlReadyTick[uuid] || 0) - globalTick);
            player.sendActionBar(ChatColor.GRAY + "末影珍珠冷却中："
                    + ChatColor.YELLOW + remain + ChatColor.GRAY + " tick");
        } catch (e) { }
    }

    // -----------------------------------------------------------------------
    // 物品构建 / 净化 / 注册
    // -----------------------------------------------------------------------
    function createEnderSwordItem() {
        var item = new ItemStack(Material.IRON_SWORD, 1);
        var meta = item.getItemMeta();
        if (meta == null) return item;

        meta.setDisplayName(ChatColor.DARK_PURPLE + SWORD_NAME);
        meta.setLore(toJavaList([
            ChatColor.YELLOW + "基础伤害：" + ChatColor.RED + "9",
            ChatColor.YELLOW + "触及：" + ChatColor.RED + "+1.5",
            ChatColor.AQUA + "Q " + ChatColor.GRAY + "投掷 2.5 倍飞行速度的末影珍珠"
        ]));

        meta.setUnbreakable(true);

        // 有附魔光效，但不需要真实附魔；通过事件拦截保证无法附魔。
        try {
            meta.setEnchantmentGlintOverride(true);
        } catch (e) { }

        // Nashorn/OpenJS 1.5.0 下 Java 变参方法传多个枚举会报 ClassCastException，
        // 必须构造真实的 ItemFlag[] 后再调用 addItemFlags。
        try {
            var flags = Array.newInstance(ItemFlagClass, 2);
            Array.set(flags, 0, ItemFlag.HIDE_ATTRIBUTES);
            Array.set(flags, 1, ItemFlag.HIDE_UNBREAKABLE);
            meta.addItemFlags(flags);
        } catch (e) { }

        try {
            // 基础伤害 9：玩家基础 1 + 8。
            meta.addAttributeModifier(Attribute.ATTACK_DAMAGE,
                    new AttributeModifier(DAMAGE_MODIFIER_KEY, ADDED_ATTACK_DAMAGE,
                            AttributeOperation.ADD_NUMBER, EquipmentSlotGroup.MAINHAND));

            // 保留原版铁剑 1.6 攻速：玩家基础 4.0 - 2.4。
            meta.addAttributeModifier(Attribute.ATTACK_SPEED,
                    new AttributeModifier(SPEED_MODIFIER_KEY, ADDED_ATTACK_SPEED,
                            AttributeOperation.ADD_NUMBER, EquipmentSlotGroup.MAINHAND));

            // 触及 +1.5：实体交互距离与方块交互距离同时提升。
            meta.addAttributeModifier(Attribute.ENTITY_INTERACTION_RANGE,
                    new AttributeModifier(ENTITY_RANGE_MODIFIER_KEY, REACH_BONUS,
                            AttributeOperation.ADD_NUMBER, EquipmentSlotGroup.MAINHAND));
            meta.addAttributeModifier(Attribute.BLOCK_INTERACTION_RANGE,
                    new AttributeModifier(BLOCK_RANGE_MODIFIER_KEY, REACH_BONUS,
                            AttributeOperation.ADD_NUMBER, EquipmentSlotGroup.MAINHAND));
        } catch (e) {
            log.error("EnderSword 写入属性失败：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }

        meta.getPersistentDataContainer().set(SWORD_KEY, PersistentDataType.STRING, SWORD_ID);
        item.setItemMeta(meta);
        return item;
    }

    function sanitizeEnderSwordItem(item) {
        try {
            if (!isEnderSword(item)) return false;

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

    var enderSwordDefinition = {
        id: SWORD_ID,
        slot: EQUIP_SLOT,
        name: SWORD_NAME,
        aliases: ["末影", "end_sword", "ender_sword"],
        create: createEnderSwordItem
    };

    function ensureRegistered() {
        try {
            var registry = getShared("EquipRegistry");
            if (!registry) return;

            if (registry !== lastEquipRegistry || !registry.get(EQUIP_SLOT, SWORD_ID)) {
                registry.register(enderSwordDefinition);
                lastEquipRegistry = registry;
            } else {
                registry.heartbeat(EQUIP_SLOT, SWORD_ID);
            }
        } catch (e) {
            log.error("EnderSword 注册装备失败：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    ensureRegistered();
    task.repeat(ticks(20), ticks(20), ensureRegistered);

    // 1 tick 主循环：维护 Q 技能冷却计时。
    task.repeat(ticks(1), ticks(1), function () {
        globalTick++;
    });

    // 玩家退出时清理冷却状态。
    registerEvent("org.bukkit.event.player.PlayerQuitEvent", function (event) {
        try {
            var uuid = String(event.getPlayer().getUniqueId().toString());
            delete pearlReadyTick[uuid];
        } catch (e) { }
    });

    // -----------------------------------------------------------------------
    // Q 技能：投掷高速末影珍珠
    // -----------------------------------------------------------------------
    function throwEnderPearl(player) {
        try {
            var eye = player.getEyeLocation();
            var direction = safeNormalize(eye.getDirection());
            var spawnLocation = eye.clone().add(direction.clone().multiply(0.6));
            var world = player.getWorld();

            cleanupInactivePearls();

            var pearl = world.spawn(spawnLocation, EnderPearlClass);
            if (!pearl) {
                sendMessage(player, ChatColor.RED + "末影珍珠生成失败，请稍后再试。");
                return false;
            }

            pearl.setShooter(player);
            try {
                pearl.setItem(new ItemStack(Material.ENDER_PEARL, 1));
            } catch (e) { }
            pearl.setVelocity(direction.clone().multiply(THROWN_PEARL_SPEED));
            pearl.setPersistent(false);
            pearl.addScoreboardTag(PROJECTILE_TAG);

            activePearls.push(pearl);

            try {
                world.playSound(player.getLocation(), Sound.ENTITY_ENDER_PEARL_THROW, 1.0, 1.0);
            } catch (e) { }

            return true;
        } catch (e) {
            log.error("EnderSword 投掷末影珍珠异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
            return false;
        }
    }

    function sendMessage(player, text) {
        try {
            player.sendMessage(text);
        } catch (e) { }
    }

    registerEvent("org.bukkit.event.player.PlayerDropItemEvent", function (event) {
        try {
            var player = event.getPlayer();
            if (!(player instanceof Player)) return;

            var droppedItem = null;
            try {
                droppedItem = event.getItemDrop().getItemStack();
            } catch (e) { }

            if (!isEnderSword(droppedItem)) return;

            // 按 Q 时不允许真的丢出末影剑，改为投掷末影珍珠。
            event.setCancelled(true);

            if (!canThrowPearl(player)) {
                warnPearlCooldown(player);
                return;
            }

            if (throwEnderPearl(player)) {
                setPearlCooldown(player, PEARL_COOLDOWN_TICKS);
            }
        } catch (e) {
            log.error("EnderSword Q 事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // -----------------------------------------------------------------------
    // 禁止附魔：附魔台 / 铁砧 / 指令
    // -----------------------------------------------------------------------
    registerEvent("org.bukkit.event.enchantment.PrepareItemEnchantEvent", function (event) {
        try {
            if (isEnderSword(event.getItem())) event.setCancelled(true);
        } catch (e) {
            log.error("EnderSword 附魔台准备事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    registerEvent("org.bukkit.event.enchantment.EnchantItemEvent", function (event) {
        try {
            if (!isEnderSword(event.getItem())) return;
            event.setCancelled(true);

            var enchanter = event.getEnchanter();
            if (enchanter != null) enchanter.sendMessage(ChatColor.RED + SWORD_NAME + " 无法被附魔。");
        } catch (e) {
            log.error("EnderSword 附魔事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
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

            if (!isEnderSword(first) && !isEnderSword(second)) return;
            if (result == null) return;

            var resultMeta = result.getItemMeta();
            if (resultMeta != null && resultMeta.hasEnchants()) {
                event.setResult(null);
            }
        } catch (e) {
            log.error("EnderSword 铁砧事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // 玩家切换到末影剑时立刻净化附魔，并确保附魔光效开启。
    registerEvent("org.bukkit.event.player.PlayerItemHeldEvent", function (event) {
        try {
            var player = event.getPlayer();
            if (!(player instanceof Player)) return;

            var item = null;
            try {
                item = player.getInventory().getItem(event.getNewSlot());
            } catch (e) { }

            if (item != null && sanitizeEnderSwordItem(item)) {
                try {
                    player.getInventory().setItem(event.getNewSlot(), item);
                } catch (e) { }
            }
        } catch (e) {
            log.error("EnderSword 切换物品事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // F 换手时净化主手/副手末影剑，防止带附魔版本扩散。
    registerEvent("org.bukkit.event.player.PlayerSwapHandItemsEvent", function (event) {
        try {
            var mainItem = null;
            var offItem = null;
            try { mainItem = event.getMainHandItem(); } catch (e) { }
            try { offItem = event.getOffHandItem(); } catch (e) { }

            if (mainItem != null && sanitizeEnderSwordItem(mainItem)) {
                event.setMainHandItem(mainItem);
            }
            if (offItem != null && sanitizeEnderSwordItem(offItem)) {
                event.setOffHandItem(offItem);
            }
        } catch (e) {
            log.error("EnderSword 换手事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // 阻止 /enchant 直接给末影剑添加附魔。
    registerEvent("org.bukkit.event.player.PlayerCommandPreprocessEvent", function (event) {
        try {
            var player = event.getPlayer();
            if (!(player instanceof Player)) return;

            var item = null;
            try {
                item = player.getInventory().getItemInMainHand();
            } catch (e) { }
            if (!isEnderSword(item)) return;

            var message = String(event.getMessage() == null ? "" : event.getMessage()).trim().toLowerCase();
            if (message.indexOf("/enchant") === 0) {
                event.setCancelled(true);
                player.sendMessage(ChatColor.RED + SWORD_NAME + " 无法被附魔。");
            }
        } catch (e) {
            log.error("EnderSword 指令附魔拦截异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // 脚本卸载 / 热重载时清理仍有效的本武器珍珠实体并在装备注册表中注销。
    try {
        task.bindToUnload(function () {
            cleanupInactivePearls();
            for (var i = 0; i < activePearls.length; i++) {
                try {
                    if (activePearls[i] != null && activePearls[i].isValid()) activePearls[i].remove();
                } catch (e) { }
            }
            activePearls = [];
            pearlReadyTick = {};

            try {
                var registry = getShared("EquipRegistry");
                if (registry) registry.unregister(EQUIP_SLOT, SWORD_ID);
            } catch (e) { }
        });
    } catch (e) { }

    log.info("EnderSword 已加载：/equip arms " + SWORD_NAME
            + "（基础伤害 9 / 触及 +1.5 / Q 高速末影珍珠，冷却 "
            + PEARL_COOLDOWN_TICKS + " tick）");
})();
