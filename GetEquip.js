/*
 * GetEquip.js —— 通用自定义装备获取框架（OpenJS 1.5.0）
 *
 * 统一指令格式（后续所有自定义装备都遵守此格式）：
 *     /equip <槽位> [装备名]
 *     例：/equip arms 村好剑
 *
 * 效果：
 *     按“槽位 + 装备 id”从注册表中解析装备，调用装备脚本提供的 create() 构建 ItemStack，
 *     并在物品 PDC 中写入通用的 get_equip_item_id 标记后给予玩家。
 *
 * 后续新增装备的方式：
 *     新建一个 .js 脚本，调用 getShared("EquipRegistry").register({...}) 注册即可。
 *     register 需要提供：
 *         id        —— 英文唯一 id（例如 village_sword）
 *         slot      —— 槽位 id，例如 arms / head / chest / legs / feet / offhand
 *         name      —— 中文显示名（例如 村好剑）
 *         aliases   —— 可选，指令可用的别名数组
 *         heartbeat —— 由注册的装备脚本定期更新，用来判断脚本是否还在运行
 *         create()  —— 真正构建 ItemStack 的函数，必须返回 ItemStack，返回 null / 抛异常视为失败
 *
 * 说明：本框架只负责“指令 -> 注册表查询 -> 构建物品 -> 给予玩家”这条通用链路，
 *       装备的具体数值、技能、事件全部由各自的装备脚本实现。
 */

// 作用域隔离：所有变量、常量和函数都封装在本 IIFE 内，避免与其他 OpenJS 脚本的全局名称互相覆盖。
// 规范详见仓库根目录《OpenJS脚本数据契约.md》。
(function () {
    "use strict";

    // -----------------------------------------------------------------------
    // Java / API 类型
    // -----------------------------------------------------------------------
    var ItemStack = Java.type("org.bukkit.inventory.ItemStack");
    var ChatColor = Java.type("org.bukkit.ChatColor");
    var PersistentDataType = Java.type("org.bukkit.persistence.PersistentDataType");
    var NamespacedKey = Java.type("org.bukkit.NamespacedKey");
    var Player = Java.type("org.bukkit.entity.Player");

    // -----------------------------------------------------------------------
    // 数值配置
    // -----------------------------------------------------------------------
    var HEARTBEAT_TIMEOUT_MS = 10000;

    var EQUIP_ITEM_KEY = new NamespacedKey(plugin, "get_equip_item_id");

    // 槽位显示名；未列出的槽位直接显示原始槽位 id。
    var SLOT_DISPLAY_NAMES = {
        arms: "武器",
        head: "头盔",
        chest: "胸甲",
        legs: "护腿",
        feet: "靴子",
        offhand: "副手 / 盾牌",
        shield: "盾牌",
        accessory: "饰品"
    };

    // 槽位别名：统一解析到规范槽位，方便后续扩展。
    // 例如 /equip shield 基础盾牌 等价于 /equip offhand 基础盾牌。
    var SLOT_ALIASES = {
        weapon: "arms",
        weapons: "arms",
        shield: "offhand",
        off_hand: "offhand",
        secondary: "offhand"
    };

    // -----------------------------------------------------------------------
    // 运行时状态
    // -----------------------------------------------------------------------
    var definitions = {};   // "slot:id" -> definition
    var lookup = {};        // "slot:归一化名称" -> definition

    // -----------------------------------------------------------------------
    // 工具函数
    // -----------------------------------------------------------------------
    function normalizeSlot(value) {
        var normalized = String(value == null ? "" : value).trim().toLowerCase();
        return SLOT_ALIASES[normalized] || normalized;
    }

    function normalizeName(value) {
        return String(value == null ? "" : value).trim().toLowerCase();
    }

    function makeDefinitionKey(slot, id) {
        return normalizeSlot(slot) + ":" + String(id == null ? "" : id).trim().toLowerCase();
    }

    function makeLookupKey(slot, name) {
        return normalizeSlot(slot) + ":" + normalizeName(name);
    }

    function getSlotDisplayName(slot) {
        var normalized = normalizeSlot(slot);
        return SLOT_DISPLAY_NAMES[normalized] || normalized;
    }

    function isAliveDefinition(def) {
        if (!def) return false;
        if (typeof def.heartbeat === "number" && def.heartbeat > 0) {
            return (Date.now() - def.heartbeat) <= HEARTBEAT_TIMEOUT_MS;
        }
        return true;
    }

    function rebuildLookup() {
        lookup = {};
        for (var key in definitions) {
            if (!definitions.hasOwnProperty(key)) continue;
            var def = definitions[key];
            if (!def) continue;

            lookup[makeLookupKey(def.slot, def.id)] = def;
            lookup[makeLookupKey(def.slot, def.name)] = def;

            var aliases = def.aliases;
            if (aliases) {
                for (var i = 0; i < aliases.length; i++) {
                    lookup[makeLookupKey(def.slot, aliases[i])] = def;
                }
            }
        }
    }

    function purgeExpiredDefinitions() {
        var changed = false;
        for (var key in definitions) {
            if (!definitions.hasOwnProperty(key)) continue;
            if (!isAliveDefinition(definitions[key])) {
                delete definitions[key];
                changed = true;
            }
        }
        if (changed) rebuildLookup();
    }

    // -----------------------------------------------------------------------
    // 注册表 API
    // -----------------------------------------------------------------------
    function register(def) {
        if (!def || !def.id || !def.name || !def.slot || typeof def.create !== "function") {
            log.warn("GetEquip.register 参数不完整，已忽略。需要 id / slot / name / create()。");
            return false;
        }

        def.id = String(def.id);
        def.slot = normalizeSlot(def.slot);
        def.name = String(def.name);
        if (!def.aliases) def.aliases = [];
        def.heartbeat = Date.now();

        var key = makeDefinitionKey(def.slot, def.id);
        if (definitions[key]) {
            log.info("GetEquip 重新注册装备：" + def.name + " (" + def.slot + ":" + def.id + ")");
        } else {
            log.info("GetEquip 注册装备：" + def.name + " (" + def.slot + ":" + def.id + ")");
        }

        definitions[key] = def;
        rebuildLookup();
        return true;
    }

    function unregister(slotOrDef, idOrDef) {
        var slot = null;
        var id = null;

        if (slotOrDef && typeof slotOrDef === "object" && slotOrDef.id && slotOrDef.slot) {
            slot = slotOrDef.slot;
            id = slotOrDef.id;
        } else {
            slot = slotOrDef;
            id = idOrDef;
        }

        var key = makeDefinitionKey(slot, id);
        if (definitions[key]) {
            delete definitions[key];
            rebuildLookup();
        }
    }

    function heartbeat(slot, id) {
        var def = definitions[makeDefinitionKey(slot, id)];
        if (def) def.heartbeat = Date.now();
    }

    function get(slot, id) {
        var key = makeDefinitionKey(slot, id);
        var def = definitions[key];
        if (def && isAliveDefinition(def)) return def;
        if (def) {
            delete definitions[key];
            rebuildLookup();
        }
        return null;
    }

    function list(slot) {
        var normalized = normalizeSlot(slot);
        var result = [];
        for (var key in definitions) {
            if (!definitions.hasOwnProperty(key)) continue;
            var def = definitions[key];
            if (!def || !isAliveDefinition(def)) continue;
            if (def.slot === normalized) result.push(def);
        }
        return result;
    }

    function listSlots() {
        var result = [];
        for (var key in definitions) {
            if (!definitions.hasOwnProperty(key)) continue;
            var def = definitions[key];
            if (!def || !isAliveDefinition(def)) continue;
            if (result.indexOf(def.slot) === -1) result.push(def.slot);
        }
        if (result.indexOf("arms") === -1) result.push("arms");
        return result;
    }

    function resolve(slot, query) {
        var normalizedSlot = normalizeSlot(slot);
        var q = normalizeName(query);
        if (!q) return null;

        var exact = lookup[makeLookupKey(normalizedSlot, q)];
        if (exact) {
            if (isAliveDefinition(exact)) return exact;
            unregister(exact.slot, exact.id);
        }

        // 支持唯一前缀匹配，例如 /equip arms 村
        var matches = [];
        for (var key in definitions) {
            if (!definitions.hasOwnProperty(key)) continue;
            var def = definitions[key];
            if (!def || !isAliveDefinition(def)) continue;
            if (def.slot !== normalizedSlot) continue;

            var keys = [def.id, def.name].concat(def.aliases || []);
            for (var i = 0; i < keys.length; i++) {
                if (normalizeName(keys[i]).indexOf(q) === 0 && matches.indexOf(def) === -1) {
                    matches.push(def);
                    break;
                }
            }
        }

        if (matches.length === 1) return matches[0];
        if (matches.length > 1) return { ambiguous: matches };
        return null;
    }

    // -----------------------------------------------------------------------
    // 物品创建 / 发放
    // -----------------------------------------------------------------------
    function createItem(def) {
        if (!def) return null;

        var item = null;
        try {
            item = def.create();
        } catch (e) {
            log.error("GetEquip 构建装备[" + def.name + "]失败：" + e
                    + (e && e.stack ? "\n" + e.stack : ""));
            return null;
        }

        if (item == null || !(item instanceof ItemStack)) {
            log.error("GetEquip 构建装备[" + def.name + "]失败：create() 未返回 ItemStack。");
            return null;
        }

        try {
            var meta = item.getItemMeta();
            if (meta != null) {
                meta.getPersistentDataContainer().set(
                        EQUIP_ITEM_KEY,
                        PersistentDataType.STRING,
                        def.slot + ":" + def.id);
                item.setItemMeta(meta);
            }
        } catch (e) {
            log.error("GetEquip 写入装备标记失败[" + def.name + "]：" + e
                    + (e && e.stack ? "\n" + e.stack : ""));
        }

        return item;
    }

    function isEquipItem(item) {
        try {
            if (item == null || !item.hasItemMeta()) return false;
            var meta = item.getItemMeta();
            if (meta == null) return false;
            return meta.getPersistentDataContainer().has(EQUIP_ITEM_KEY, PersistentDataType.STRING);
        } catch (e) {
            return false;
        }
    }

    function giveToPlayer(player, def) {
        var item = createItem(def);
        if (!item) {
            player.sendMessage(ChatColor.RED + "装备构建失败：" + ChatColor.YELLOW + def.name
                    + ChatColor.RED + "，请查看控制台日志。");
            return false;
        }

        var leftover = player.getInventory().addItem(item);
        if (leftover != null && !leftover.isEmpty()) {
            // addItem 可能只放入了一部分，这里只把真正剩余的部分丢在玩家脚下，避免复制物品。
            var iterator = leftover.values().iterator();
            while (iterator.hasNext()) {
                player.getWorld().dropItemNaturally(player.getLocation(), iterator.next());
            }
            player.sendMessage(ChatColor.YELLOW + "背包已满，未能放入的装备已掉落在你脚下。");
        }

        player.sendMessage(ChatColor.GREEN + "已获得：" + ChatColor.GOLD + def.name
                + ChatColor.GRAY + "（" + getSlotDisplayName(def.slot) + "）");
        return true;
    }

    // -----------------------------------------------------------------------
    // 指令帮助
    // -----------------------------------------------------------------------
    function sendEquipUsage(sender) {
        sender.sendMessage(ChatColor.GOLD + "===== 自定义装备获取 =====");
        sender.sendMessage(ChatColor.YELLOW + "/equip" + ChatColor.GRAY + " —— 查看装备槽位");
        sender.sendMessage(ChatColor.YELLOW + "/equip <槽位>" + ChatColor.GRAY + " —— 查看该槽位已注册装备");
        sender.sendMessage(ChatColor.YELLOW + "/equip arms [武器名]" + ChatColor.GRAY
                + " —— 获取指定武器，例：/equip arms 村好剑");
        sender.sendMessage(ChatColor.YELLOW + "/equip shield 基础盾牌" + ChatColor.GRAY
                + " —— 获取盾牌（等价于 /equip offhand 基础盾牌）");
    }

    function sendSlotList(sender) {
        var slots = listSlots();
        if (slots.length === 0) {
            sender.sendMessage(ChatColor.RED + "当前没有已注册的自定义装备槽位。");
            return;
        }

        sender.sendMessage(ChatColor.GOLD + "当前自定义装备槽位：");
        for (var i = 0; i < slots.length; i++) {
            sender.sendMessage(ChatColor.YELLOW + " - " + getSlotDisplayName(slots[i])
                    + ChatColor.GRAY + " (" + slots[i] + ")");
        }
    }

    function sendDefinitionList(sender, slot) {
        var defs = list(slot);
        if (defs.length === 0) {
            sender.sendMessage(ChatColor.RED + "槽位 " + ChatColor.YELLOW + normalizeSlot(slot)
                    + ChatColor.RED + " 暂无已注册装备。");
            return;
        }

        sender.sendMessage(ChatColor.GOLD + "槽位 " + getSlotDisplayName(slot) + " 当前可获取：");
        for (var i = 0; i < defs.length; i++) {
            sender.sendMessage(ChatColor.YELLOW + " - " + ChatColor.GOLD + defs[i].name
                    + ChatColor.GRAY + "   /equip " + defs[i].slot + " " + defs[i].name);
        }
    }
    // -----------------------------------------------------------------------
    // /equip <槽位> [装备名]
    // -----------------------------------------------------------------------
    addCommand("equip", {
        onCommand: function (sender, args) {
            try {
                if (!args || args.length === 0) {
                    sendEquipUsage(sender);
                    sendSlotList(sender);
                    return;
                }

                var slot = normalizeSlot(args[0]);
                if (args.length < 2) {
                    sendDefinitionList(sender, slot);
                    return;
                }

                if (!(sender instanceof Player)) {
                    sender.sendMessage(ChatColor.RED + "该指令只能由玩家使用（控制台无法持有装备）。");
                    return;
                }

                var query = toArray(args).slice(1).join(" ").trim();
                var def = resolve(slot, query);

                if (!def) {
                    sender.sendMessage(ChatColor.RED + "在槽位 " + ChatColor.YELLOW + slot
                            + ChatColor.RED + " 中找不到装备：" + ChatColor.YELLOW + query
                            + ChatColor.RED + "。使用 /equip " + slot + " 查看列表。");
                    return;
                }

                if (def.ambiguous) {
                    sender.sendMessage(ChatColor.RED + "匹配到多个装备，请输入完整名字：");
                    for (var i = 0; i < def.ambiguous.length; i++) {
                        sender.sendMessage(ChatColor.YELLOW + " - " + def.ambiguous[i].name);
                    }
                    return;
                }

                giveToPlayer(sender, def);
            } catch (e) {
                log.error("GetEquip 指令异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
                sender.sendMessage(ChatColor.RED + "获取装备时发生异常，请查看控制台日志。");
            }
        },

        onTabComplete: function (sender, args) {
            var result = [];
            try {
                var arr = toArray(args);
                if (arr.length <= 1) {
                    var slots = listSlots();
                    // 同时补全槽位别名，例如 shield -> offhand / weapon -> arms。
                    if (slots.indexOf("shield") === -1) slots.push("shield");
                    if (slots.indexOf("weapon") === -1) slots.push("weapon");

                    var slotPrefix = arr.length === 1 ? normalizeName(arr[0]) : "";
                    for (var i = 0; i < slots.length; i++) {
                        if (!slotPrefix || normalizeName(slots[i]).indexOf(slotPrefix) === 0) {
                            result.push(slots[i]);
                        }
                    }
                    return toJavaList(result);
                }

                var slot = normalizeSlot(arr[0]);
                if (arr.length === 2) {
                    var prefix = normalizeName(arr[1]);
                    var defs = list(slot);
                    for (var j = 0; j < defs.length; j++) {
                        if (!prefix || normalizeName(defs[j].name).indexOf(prefix) === 0
                                || normalizeName(defs[j].id).indexOf(prefix) === 0) {
                            result.push(defs[j].name);
                        }
                    }
                }
            } catch (e) {
                log.error("GetEquip Tab 补全异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
            }
            return toJavaList(result);
        }
    });

    // 清理 10 秒未刷新的过期装备注册，避免装备脚本卸载后仍能获取到空壳物品。
    task.repeat(ticks(20), ticks(20), function () {
        try {
            purgeExpiredDefinitions();
        } catch (e) {
            log.error("GetEquip 清理过期注册异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
        }
    });

    // -----------------------------------------------------------------------
    // 共享 API
    // -----------------------------------------------------------------------
    var EquipRegistry = {
        version: 1,
        register: register,
        unregister: unregister,
        heartbeat: heartbeat,
        get: get,
        resolve: resolve,
        list: list,
        listSlots: listSlots,
        createItem: createItem,
        isEquipItem: isEquipItem,
        getSlotDisplayName: getSlotDisplayName
    };
    setShared("EquipRegistry", EquipRegistry);

    log.info("GetEquip 框架已加载：/equip <槽位> [装备名]");
})();
