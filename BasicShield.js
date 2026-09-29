/*
 * BasicShield.js —— 自定义盾牌「基础盾牌」（OpenJS 1.5.0）
 *
 * 获取方式：/equip shield 基础盾牌
 *          /equip offhand 基础盾牌（等价指令）
 *
 * 特殊效果：
 *   - 副手装备时：+10 最大生命上限
 *   - 无限耐久
 *   - 无法附魔，但始终具有附魔光效
 *   - 固有 20% 减伤
 *   - 格挡时获得 0.35 秒（7 tick）无敌时间
 *
 * 注意：按照需求，只有“格挡时获得 7 tick 无敌时间”这一条写入物品 Lore。
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
    var DamageModifier = Java.type("org.bukkit.event.entity.EntityDamageEvent$DamageModifier");
    var Class = Java.type("java.lang.Class");
    var ItemFlagClass = Class.forName("org.bukkit.inventory.ItemFlag");
    var Array = Java.type("java.lang.reflect.Array");

    // -----------------------------------------------------------------------
    // 数值配置
    // -----------------------------------------------------------------------
    var SHIELD_ID = "basic_shield";
    var SHIELD_NAME = "基础盾牌";
    var EQUIP_SLOT = "offhand";

    var SHIELD_KEY = new NamespacedKey(plugin, "basic_shield_item");
    var MAX_HEALTH_MODIFIER_KEY = new NamespacedKey(plugin, "basic_shield_max_health");

    var EXTRA_MAX_HEALTH = 10.0;
    var DAMAGE_TAKEN_MULTIPLIER = 0.8;      // 固有 20% 减伤
    var BLOCK_INVULNERABLE_TICKS = 7;       // 0.35 秒

    // -----------------------------------------------------------------------
    // 运行时状态
    // -----------------------------------------------------------------------
    var globalTick = 0;
    var blockInvulnerableUntil = {};  // player uuid -> 格挡无敌结束 tick
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

    function isBasicShield(item) {
        try {
            if (item == null || item.getType() != Material.SHIELD) return false;
            if (!item.hasItemMeta()) return false;

            var meta = item.getItemMeta();
            if (meta == null) return false;

            var container = meta.getPersistentDataContainer();
            if (!container.has(SHIELD_KEY, PersistentDataType.STRING)) return false;
            return String(container.get(SHIELD_KEY, PersistentDataType.STRING)) === SHIELD_ID;
        } catch (e) {
            return false;
        }
    }

    function getOffhandShield(player) {
        try {
            return player.getInventory().getItemInOffHand();
        } catch (e) {
            return null;
        }
    }

    // 判断“这次受击是否被盾牌真正格挡”。优先读取 Bukkit 的 BLOCKING 伤害修正；
    // 普通基础伤害事件没有该修正时，退回 player.isBlocking()。
    function isBlockedByShield(event, player) {
        try {
            if (event.isApplicable(DamageModifier.BLOCKING)) {
                return event.getDamage(DamageModifier.BLOCKING) < 0.0;
            }
        } catch (e) { }
        try {
            return player.isBlocking();
        } catch (e) {
            return false;
        }
    }

    // -----------------------------------------------------------------------
    // 物品构建 / 净化 / 注册
    // -----------------------------------------------------------------------
    function createBasicShieldItem() {
        var item = new ItemStack(Material.SHIELD, 1);
        var meta = item.getItemMeta();
        if (meta == null) return item;

        meta.setDisplayName(ChatColor.AQUA + SHIELD_NAME);

        // 按需求：鼠标悬停介绍中只写格挡无敌这一条特殊效果。
        meta.setLore(toJavaList([
            ChatColor.GRAY + "格挡时获得 " + ChatColor.WHITE + "0.35 秒"
                    + ChatColor.GRAY + "（" + ChatColor.WHITE + "7 tick"
                    + ChatColor.GRAY + "）无敌时间"
        ]));

        meta.setUnbreakable(true);

        // 无法附魔，但强制保留附魔光效。
        try {
            meta.setEnchantmentGlintOverride(true);
        } catch (e) { }
        try {
            // Nashorn/OpenJS 1.5.0 下 Java 变参方法传多个枚举会报 ClassCastException，
            // 必须构造真实的 ItemFlag[] 后再调用 addItemFlags。
            var flags = Array.newInstance(ItemFlagClass, 2);
            Array.set(flags, 0, ItemFlag.HIDE_ATTRIBUTES);
            Array.set(flags, 1, ItemFlag.HIDE_UNBREAKABLE);
            meta.addItemFlags(flags);
        } catch (e) { }

        // 副手装备时 +10 最大生命。
        try {
            meta.addAttributeModifier(Attribute.MAX_HEALTH,
                    new AttributeModifier(MAX_HEALTH_MODIFIER_KEY, EXTRA_MAX_HEALTH,
                            AttributeOperation.ADD_NUMBER, EquipmentSlotGroup.OFFHAND));
        } catch (e) {
            log.error("BasicShield 写入最大生命属性失败：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }

        meta.getPersistentDataContainer().set(SHIELD_KEY, PersistentDataType.STRING, SHIELD_ID);
        item.setItemMeta(meta);
        return item;
    }

    function sanitizeShieldItem(item) {
        try {
            if (!isBasicShield(item)) return false;

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

    var basicShieldDefinition = {
        id: SHIELD_ID,
        slot: EQUIP_SLOT,
        name: SHIELD_NAME,
        aliases: ["基础盾", "jichudunpai", "basic_shield", "shield"],
        create: createBasicShieldItem
    };

    function ensureRegistered() {
        try {
            var registry = getShared("EquipRegistry");
            if (!registry) return;

            if (registry !== lastEquipRegistry || !registry.get(EQUIP_SLOT, SHIELD_ID)) {
                registry.register(basicShieldDefinition);
                lastEquipRegistry = registry;
            } else {
                registry.heartbeat(EQUIP_SLOT, SHIELD_ID);
            }
        } catch (e) {
            log.error("BasicShield 注册装备失败：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    }

    ensureRegistered();
    task.repeat(ticks(20), ticks(20), ensureRegistered);

    // -----------------------------------------------------------------------
    // 受伤事件：20% 减伤 + 格挡 7 tick 无敌
    // -----------------------------------------------------------------------
    registerEvent("org.bukkit.event.entity.EntityDamageEvent", function (event) {
        try {
            var entity = event.getEntity();
            if (!(entity instanceof Player)) return;
            if (event.isCancelled()) return;

            var player = entity;
            var uuid = getPlayerId(player);
            if (!uuid) return;

            // 格挡触发的 7 tick 无敌：窗口内直接拦截后续伤害事件。
            if (globalTick < (blockInvulnerableUntil[uuid] || 0)) {
                event.setCancelled(true);
                return;
            }

            // 只有副手持有基础盾牌时才享受剩余效果。
            if (!isBasicShield(getOffhandShield(player))) return;

            // 固有 20% 减伤。
            var reduced = event.getDamage() * DAMAGE_TAKEN_MULTIPLIER;
            event.setDamage(reduced < 0.0 ? 0.0 : reduced);

            // 格挡成功：获得 0.35 秒（7 tick）无敌时间。
            if (isBlockedByShield(event, player)) {
                blockInvulnerableUntil[uuid] = globalTick + BLOCK_INVULNERABLE_TICKS;
            }
        } catch (e) {
            log.error("BasicShield 受伤事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // -----------------------------------------------------------------------
    // 禁止附魔：附魔台 / 铁砧 / 指令
    // -----------------------------------------------------------------------
    registerEvent("org.bukkit.event.enchantment.PrepareItemEnchantEvent", function (event) {
        try {
            if (isBasicShield(event.getItem())) event.setCancelled(true);
        } catch (e) {
            log.error("BasicShield 附魔台准备事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    registerEvent("org.bukkit.event.enchantment.EnchantItemEvent", function (event) {
        try {
            if (!isBasicShield(event.getItem())) return;
            event.setCancelled(true);

            var enchanter = event.getEnchanter();
            if (enchanter != null) {
                enchanter.sendMessage(ChatColor.RED + SHIELD_NAME + " 无法被附魔。");
            }
        } catch (e) {
            log.error("BasicShield 附魔事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
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

            if (!isBasicShield(first) && !isBasicShield(second)) return;
            if (result == null) return;

            var resultMeta = result.getItemMeta();
            if (resultMeta != null && resultMeta.hasEnchants()) {
                event.setResult(null);
            }
        } catch (e) {
            log.error("BasicShield 铁砧事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // 玩家切换到盾牌时立刻净化附魔，并确保附魔光效开启。
    registerEvent("org.bukkit.event.player.PlayerItemHeldEvent", function (event) {
        try {
            var player = event.getPlayer();
            if (!(player instanceof Player)) return;

            var item = null;
            try {
                item = player.getInventory().getItem(event.getNewSlot());
            } catch (e) { }

            if (item != null && sanitizeShieldItem(item)) {
                try {
                    player.getInventory().setItem(event.getNewSlot(), item);
                } catch (e) { }
            }
        } catch (e) {
            log.error("BasicShield 切换物品事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // F 换手时净化主手/副手盾牌，防止带附魔版本进入其他槽位。
    registerEvent("org.bukkit.event.player.PlayerSwapHandItemsEvent", function (event) {
        try {
            var mainItem = null;
            var offItem = null;
            try { mainItem = event.getMainHandItem(); } catch (e) { }
            try { offItem = event.getOffHandItem(); } catch (e) { }

            if (mainItem != null && sanitizeShieldItem(mainItem)) {
                event.setMainHandItem(mainItem);
            }
            if (offItem != null && sanitizeShieldItem(offItem)) {
                event.setOffHandItem(offItem);
            }
        } catch (e) {
            log.error("BasicShield 换手事件异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // 阻止 /enchant 直接给基础盾牌添加附魔。
    registerEvent("org.bukkit.event.player.PlayerCommandPreprocessEvent", function (event) {
        try {
            var player = event.getPlayer();
            if (!(player instanceof Player)) return;

            var offhandShield = getOffhandShield(player);
            if (!isBasicShield(offhandShield)) return;

            var message = String(event.getMessage() == null ? "" : event.getMessage()).trim().toLowerCase();
            if (message.indexOf("/enchant") === 0) {
                event.setCancelled(true);
                player.sendMessage(ChatColor.RED + SHIELD_NAME + " 无法被附魔。");
            }
        } catch (e) {
            log.error("BasicShield 指令附魔拦截异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // 玩家退出时清理无敌窗口。
    registerEvent("org.bukkit.event.player.PlayerQuitEvent", function (event) {
        try {
            var uuid = String(event.getPlayer().getUniqueId().toString());
            delete blockInvulnerableUntil[uuid];
        } catch (e) { }
    });

    // -----------------------------------------------------------------------
    // 主循环：推进全局 tick，供格挡无敌窗口计时。
    // -----------------------------------------------------------------------
    task.repeat(ticks(1), ticks(1), function () {
        globalTick++;
    });

    // 脚本卸载 / 热重载时清理状态并在装备注册表中注销。
    try {
        task.bindToUnload(function () {
            blockInvulnerableUntil = {};
            try {
                var registry = getShared("EquipRegistry");
                if (registry) registry.unregister(EQUIP_SLOT, SHIELD_ID);
            } catch (e) { }
        });
    } catch (e) { }

    log.info("BasicShield 已加载：/equip shield " + SHIELD_NAME
            + "（+10 生命 / 20% 减伤 / 格挡 7 tick 无敌）");
})();
